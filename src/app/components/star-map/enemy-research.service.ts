import { Injectable } from '@angular/core';
import { Faction, FactionProduction, FactionShipStock, Fleet, StarSystem, Technology, TechnologyBonus } from './star-map.models';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { EconomyService } from '../../services/economy.service';
import { isCombatShipType } from './ai-queries';
import { getAiPersonalityProfile } from './ai-personality';
import { hostileFactionIds } from './diplomacy';
import { SpaceBaseService } from './space-base.service';
import planetData from './planet-data.json';
import { DYSON_ANCHOR_SHIP_TYPE } from './dyson-anchor';

/*
 * =========================================================
 * ENEMY RESEARCH SERVICE (AI technology research)
 * =========================================================
 *
 * Buys technologies for AI factions through the same authoritative API
 * the player's research tree uses: ResearchService.canResearch /
 * researchTechnology. Research is an instant purchase paid in research
 * points AND credits (ResearchService.getResearchPrice), so there is no "in progress"
 * state to track: one technology per DECISION_INTERVAL, then the next
 * decision picks the next one.
 *
 * Selection: every technology whose prerequisites are met is scored by
 *   (direct value + LOOKAHEAD × best value it unlocks next) / cost
 * where direct value comes from what the technology adds that the
 * faction does not already have:
 *  - combat ships: strength relative to the best combat ship already
 *    unlocked (only an improvement counts), × military need;
 *  - buildings: BUILDING_VALUE (economic usefulness for the AI economy
 *    manager);
 *  - bonuses (TechModifiers): valued from the faction's current situation
 *    using the same EconomyService numbers the economy tick applies —
 *    e.g. upkeep reductions by today's upkeep share of income, energy by
 *    the tightest planet's energy margin, raw output by raw income, ship
 *    combat bonuses by the share of the faction's own fleet strength in
 *    the affected hulls × military need, sensors by expansion (AI intel
 *    uses the sensor bonus);
 *  - personality weights (economy / research / expansion / offense)
 *    scale the matching values, so personalities research differently;
 *    under threat the peacetime values are divided by the military need.
 * Military need rises when hostile fleets are near AI territory.
 *
 * Credits: a technology is affordable only if both parts of its price
 * are, and the credit part must leave CORE credits untouched: the price of
 * a missing Spaceship Factory / Spaceport, which the economy manager needs
 * first (research must not starve the infrastructure that builds ships),
 * and of the next colonizer while the faction is waiting for one (research
 * must not stall expansion).
 *
 * Saving: if the best-scoring technology is not affordable yet, scores
 * clearly better than the best affordable one, and research and credit
 * income will pay for it within SAVE_HORIZON seconds, the faction waits for it.
 * Otherwise it buys the best affordable technology, so a faction with
 * little research income never stalls. It never issues an attempt that
 * ResearchService would reject. Every value is derived from game state
 * the faction legitimately knows (its own economy and fleets, perceived
 * hostile fleets), never from other factions' research.
 */
@Injectable({ providedIn: 'root' })
export class EnemyResearchService {
  static readonly DECISION_INTERVAL = 5;
  private static readonly LOOKAHEAD_WEIGHT = 0.5;
  private static readonly THREAT_RADIUS = 25;
  /*
   * Economic usefulness of buildings to the AI economy manager
   * (EnemyEconomyService): power and housing drive growth, labs drive
   * research. Buildings the AI never builds (social) score low.
   */
  private static readonly BUILDING_VALUE: Record<string, number> = {
    fusion_plant: 3,
    medium_residential: 2,
    large_residential: 3,
    research_lab: 2,
    planetary_shield: 1,
    missile_turret: 0.5,
    hospital: 0.2,
    school: 0.2,
    park: 0.2,
    entertainment_center: 0.2,
  };
  // Floor so effect-less leftovers (e.g. a bonus for hulls never built) still finish eventually.
  private static readonly MIN_VALUE = 0.05;
  private static readonly SAVE_HORIZON = 180;
  private static readonly SAVE_SCORE_RATIO = 1.5;

  private readonly accumulators = new Map<string, number>();
  private readonly history = new Map<string, string[]>();

  constructor(
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly economyService: EconomyService,
    private readonly spaceBaseService: SpaceBaseService,
  ) {}

  /*
   * Technology each faction is currently saving for (selectTechnology
   * chose to wait for it). EnemyEconomyService reserves its credit price so
   * construction does not spend the credits research is waiting for — the
   * two used to protect different technologies. In memory only: a reload
   * recomputes it at the next research decision.
   */
  private readonly targets = new Map<string, string>();

  reset(): void {
    this.accumulators.clear();
    this.history.clear();
    this.targets.clear();
  }

  /* The technology the faction is saving for, if it is still available. */
  getResearchTarget(faction: Faction): Technology | undefined {
    const id = this.targets.get(faction.id);
    if (!id || (faction.researchedTechnologies ?? []).includes(id)) return undefined;
    return this.researchService.getTechnology(id);
  }

  /* Technologies researched by the AI in this session, in order (diagnostics/tests). */
  getResearchHistory(factionId: string): readonly string[] {
    return this.history.get(factionId) ?? [];
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    // Ship pipeline, to see whether a colonizer is already stocked or queued.
    pipeline?: { shipStock: FactionShipStock[]; production: FactionProduction[] },
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return false;
    }
    // The first decision happens immediately so a new game spends its
    // starting research points right away.
    const accumulator = (this.accumulators.get(faction.id) ?? EnemyResearchService.DECISION_INTERVAL) + gameDeltaTime;
    if (accumulator < EnemyResearchService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, Math.max(0, accumulator - EnemyResearchService.DECISION_INTERVAL));

    const choice = this.selectTechnology(faction, factions, starSystems, fleets, pipeline);
    if (!choice) {
      return false;
    }
    const result = this.researchService.researchTechnology(faction, choice.id);
    if (!result.ok) {
      return false;
    }
    const list = this.history.get(faction.id) ?? [];
    list.push(choice.id);
    this.history.set(faction.id, list);
    return true;
  }

  selectTechnology(
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    pipeline?: { shipStock: FactionShipStock[]; production: FactionProduction[] },
  ): Technology | undefined {
    const researched = new Set(faction.researchedTechnologies ?? []);
    const available = this.researchService
      .getAllTechnologies()
      .filter((tech) => !researched.has(tech.id) && tech.prerequisites.every((p) => researched.has(p)));
    if (available.length === 0) {
      this.targets.delete(faction.id);
      return undefined;
    }

    const context = this.buildContext(faction, factions, starSystems, fleets);
    const scored = available.map((tech) => {
      const value = this.directValue(faction, tech, context)
        + EnemyResearchService.LOOKAHEAD_WEIGHT * this.bestFollowUpValue(faction, tech, context);
      const cost = this.researchService.getResearchCost(faction, tech);
      return { tech, cost, score: Math.max(EnemyResearchService.MIN_VALUE, value) / Math.max(1, cost) };
    });
    scored.sort((a, b) => b.score - a.score || a.cost - b.cost || a.tech.id.localeCompare(b.tech.id));

    const points = faction.currencies['research'] ?? 0;
    const spendableCredits = (faction.currencies['credits'] ?? 0) - this.coreCreditReserve(faction, starSystems, fleets, pipeline);
    const creditCost = (s: { tech: Technology }) => this.researchService.getResearchCreditCost(faction, s.tech);
    const bestAffordable = scored.find((s) => s.cost <= points && creditCost(s) <= spendableCredits);
    const best = scored[0];
    if (best !== bestAffordable) {
      const shortfall = best.cost - points;
      const creditShortfall = creditCost(best) - spendableCredits;
      const reachable = (shortfall <= 0 || (context.researchIncome > 0
        && shortfall / context.researchIncome <= EnemyResearchService.SAVE_HORIZON))
        && (creditShortfall <= 0 || (context.creditIncome > 0
          && creditShortfall / context.creditIncome <= EnemyResearchService.SAVE_HORIZON));
      const worthWaiting = !bestAffordable || best.score >= bestAffordable.score * EnemyResearchService.SAVE_SCORE_RATIO;
      if (reachable && worthWaiting) {
        this.targets.set(faction.id, best.tech.id);
        return undefined; // save research points and credits for `best`
      }
    }
    this.targets.delete(faction.id);
    return bestAffordable?.tech;
  }

  /*
   * Credits research must not touch: the price of the faction's missing
   * Spaceship Factory and Spaceport (it cannot build or field warships
   * without them) and, when the ship pipeline is known, of a colonizer while
   * an unhabited planet is in sight and no colonizer is in a fleet, the
   * stock or a production queue (the economy manager's colonizer rule).
   */
  private coreCreditReserve(
    faction: Faction,
    starSystems: StarSystem[],
    fleets: Fleet[],
    pipeline?: { shipStock: FactionShipStock[]; production: FactionProduction[] },
  ): number {
    const owned = starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
    const prices = new Map((planetData as { buildings: { name: string; price: number }[] }).buildings.map((b) => [b.name, b.price]));
    let reserve = 0;
    for (const name of ['Spaceship Factory', 'Spaceport']) {
      if (!owned.some((p) => p.buildings.some((b) => b.name === name))) reserve += prices.get(name) ?? 0;
    }
    if (pipeline) {
      const target = starSystems.some((s) => s.planetsTiles.some((p) => p.factionId === 'unhabited'));
      const inFleet = fleets.some((f) => f.factionId === faction.id && !f.destroyed && f.ships.some((s) => s.type === 'colonizer' && !s.destroyed));
      const inStock = (pipeline.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).some((s) => s.type === 'colonizer');
      const queued = Object.values(pipeline.production.find((p) => p.factionId === faction.id)?.ordersByPlanet ?? {})
        .flat().some((o) => o.shipTypeId === 'colonizer');
      if (target && !inFleet && !inStock && !queued) reserve += this.shipService.getShipType('colonizer')?.cost ?? 0;
    }
    return reserve;
  }

  /* Situation snapshot shared by all technology valuations of one decision. */
  private buildContext(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): ResearchContext {
    const economy = this.economyService.calculateEconomy(faction.id, factions, starSystems, fleets);
    const owned = starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
    let tightestEnergyMargin = 1;
    let growthRoom = 0;
    for (const planet of owned) {
      const e = this.economyService.calculatePlanetEconomy(planet, faction);
      if (e.energyProduction > 0 || e.energyConsumption > 0) {
        tightestEnergyMargin = Math.min(tightestEnergyMargin, (e.energyProduction - e.energyConsumption) / Math.max(1, e.energyProduction));
      }
      const capacity = this.economyService.getPopulationCapacity(planet);
      if (capacity > 0 && (planet.population ?? 0) < capacity * 0.9) growthRoom++;
    }
    const ownShips = fleets.filter((f) => f.factionId === faction.id && !f.destroyed).flatMap((f) => f.ships.filter((s) => !s.destroyed));
    const strengthByType = new Map<string, number>();
    for (const ship of ownShips) {
      strengthByType.set(ship.type, (strengthByType.get(ship.type) ?? 0) + this.shipService.calculateFleetStrength([ship]));
    }
    const weights = getAiPersonalityProfile(faction).weights;
    const militaryNeed = this.militaryNeed(faction, factions, starSystems, fleets);
    // Under threat (need > 1) peacetime priorities step back: economic,
    // research and expansion values are divided by the military need.
    const peace = 1 / militaryNeed;
    return {
      militaryNeed,
      income: Math.max(1, economy.incomePerSecond),
      buildingUpkeep: economy.buildingUpkeepPerSecond,
      shipUpkeep: economy.shipUpkeepPerSecond,
      rawIncome: economy.net['rawmaterials'] ?? 0,
      researchIncome: economy.net['research'] ?? 0,
      creditIncome: economy.netPerSecond,
      tightestEnergyMargin,
      growthRoom,
      planetCount: owned.length,
      stationCount: this.countStations(faction.id, starSystems),
      hasFactory: owned.some((p) => p.buildings.some((b) => b.name === 'Spaceship Factory')),
      fleetStrength: [...strengthByType.values()].reduce((a, b) => a + b, 0),
      strengthByType,
      weights: {
        economy: weights.economy * peace,
        research: weights.research * peace,
        expansion: weights.expansion * peace,
        military: Math.max(weights.offense, weights.defense),
      },
    };
  }

  private countStations(factionId: string, starSystems: StarSystem[]): number {
    let count = this.spaceBaseService.basesOf(factionId).length;
    for (const system of starSystems) {
      for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
        if (asteroid.miningStation?.factionId === factionId) count++;
      }
    }
    return count;
  }

  /*
   * bonusValue: Value of one technology bonus for this faction now, on
   * roughly the same scale as BUILDING_VALUE (1 ≈ a useful building).
   */
  private bonusValue(faction: Faction, bonus: TechnologyBonus, ctx: ResearchContext): number {
    const w = ctx.weights;
    switch (bonus.type) {
      case 'buildingUpkeep':
        return w.economy * Math.min(3, 40 * Math.abs(bonus.value) * ctx.buildingUpkeep / ctx.income);
      case 'shipUpkeep':
        return w.economy * Math.min(3, 40 * Math.abs(bonus.value) * ctx.shipUpkeep / ctx.income);
      case 'energyOutput':
        // Valuable when some planet is energy-tight (the AI then needs fewer power plants).
        return w.economy * (ctx.tightestEnergyMargin < 0.2 ? 1.5 : 0.5);
      case 'rawOutput':
        return w.economy * (ctx.rawIncome < 15 ? 1.5 : 0.6);
      case 'researchOutput':
        return w.research * Math.min(3, 0.5 + ctx.researchIncome / 10);
      case 'shipBuildSpeed':
        return ctx.hasFactory ? w.military * (0.5 + 0.5 * ctx.militaryNeed) : 0;
      case 'populationGrowth':
        return w.expansion * Math.min(2.5, 0.3 + 0.3 * ctx.growthRoom);
      case 'sensorRange':
        // AI intel (fog of war) uses the sensor bonus: worth more while expanding.
        return w.expansion * (0.2 + 0.05 * ctx.planetCount);
      case 'stationTurrets':
        // Turrets protect stations only: worthless without any, more valuable
        // with every station and under threat.
        return ctx.stationCount === 0 ? 0.1 : w.military * Math.min(2, 0.3 * ctx.stationCount) * (0.5 + 0.5 * ctx.militaryNeed);
      case 'shipAttack':
      case 'shipShield': {
        const affected = (bonus.shipTypes ?? []).reduce((sum, t) => sum + (ctx.strengthByType.get(t) ?? 0), 0);
        const buildable = (bonus.shipTypes ?? []).some((t) => this.researchService.isShipUnlocked(faction, t));
        const share = (ctx.fleetStrength > 0 ? affected / ctx.fleetStrength : 0) + (buildable ? 0.2 : 0);
        return w.military * ctx.militaryNeed * bonus.value * 5 * Math.min(1, share);
      }
      default:
        return 0;
    }
  }

  private directValue(faction: Faction, tech: Technology, ctx: ResearchContext): number {
    const militaryNeed = ctx.militaryNeed;
    let value = 0;

    const bestStrength = this.bestUnlockedCombatStrength(faction);
    for (const shipId of tech.unlocksShips) {
      if (this.researchService.isShipUnlocked(faction, shipId)) {
        continue;
      }
      const shipType = this.shipService.getShipType(shipId);
      if (!isCombatShipType(shipType)) {
        continue;
      }
      const strength = this.shipService.calculateFleetStrength([{ type: shipId }]);
      if (strength > bestStrength) {
        value += (strength / Math.max(1, bestStrength)) * militaryNeed * ctx.weights.military;
      }
    }

    for (const buildingId of tech.unlocksBuildings) {
      if (this.researchService.isBuildingUnlocked(faction, buildingId)) {
        continue;
      }
      value += (EnemyResearchService.BUILDING_VALUE[buildingId] ?? 0.2) * ctx.weights.economy;
    }

    for (const bonus of tech.bonuses ?? []) {
      value += this.bonusValue(faction, bonus, ctx);
    }
    // The Swarm Constructor is not a combat ship; its worth is the
    // personality's Dyson ambition (ai-personality.ts `dyson`).
    if (tech.unlocksShips.includes(DYSON_ANCHOR_SHIP_TYPE) && !this.researchService.isShipUnlocked(faction, DYSON_ANCHOR_SHIP_TYPE)) {
      value += getAiPersonalityProfile(faction).dyson.researchValue;
    }
    return value;
  }

  /*
   * bestFollowUpValue: Value of the best technology that becomes
   * researchable once `tech` is researched (one level of lookahead), so
   * pure prerequisite technologies (e.g. orbital_engineering) are not
   * scored as worthless.
   */
  private bestFollowUpValue(faction: Faction, tech: Technology, ctx: ResearchContext): number {
    const researched = new Set([...(faction.researchedTechnologies ?? []), tech.id]);
    const hypothetical: Faction = { ...faction, researchedTechnologies: [...researched] };
    let best = 0;
    for (const next of this.researchService.getAllTechnologies()) {
      if (researched.has(next.id) || !next.prerequisites.includes(tech.id)) {
        continue;
      }
      if (!next.prerequisites.every((p) => researched.has(p))) {
        continue;
      }
      best = Math.max(best, this.directValue(hypothetical, next, ctx));
    }
    return best;
  }

  private bestUnlockedCombatStrength(faction: Faction): number {
    let best = 0;
    for (const shipType of this.shipService.getAllShipTypes()) {
      if (isCombatShipType(shipType) && this.researchService.isShipUnlocked(faction, shipType.id)) {
        best = Math.max(best, this.shipService.calculateFleetStrength([{ type: shipType.id }]));
      }
    }
    return best;
  }

  /*
   * militaryNeed: 1 normally; up to 3 when hostile fleets stronger than
   * the faction's own fleets are near its systems.
   */
  private militaryNeed(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): number {
    const owned = starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === faction.id));
    const hostileIds = hostileFactionIds(faction, factions);
    let threat = 0;
    for (const fleet of fleets) {
      if (!hostileIds.has(fleet.factionId) || fleet.destroyed) {
        continue;
      }
      const near = owned.some((s) => Math.hypot(s.x - fleet.x, s.y - fleet.y) <= EnemyResearchService.THREAT_RADIUS);
      if (near) {
        threat += this.shipService.calculateFleetStrength(fleet.ships);
      }
    }
    if (threat <= 0) {
      return 1;
    }
    const own = fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
    return Math.min(3, 1 + threat / Math.max(1, own));
  }
}

interface ResearchContext {
  militaryNeed: number;
  income: number;
  buildingUpkeep: number;
  shipUpkeep: number;
  rawIncome: number;
  researchIncome: number;
  /* Net credits per second (the credit part of research prices). */
  creditIncome: number;
  /* Smallest (production − consumption) / production over owned planets. */
  tightestEnergyMargin: number;
  /* Owned planets below 90% of housing capacity. */
  growthRoom: number;
  planetCount: number;
  /* Space bases + mining stations the faction owns (Turret Research targets). */
  stationCount: number;
  hasFactory: boolean;
  fleetStrength: number;
  strengthByType: Map<string, number>;
  weights: { economy: number; research: number; expansion: number; military: number };
}

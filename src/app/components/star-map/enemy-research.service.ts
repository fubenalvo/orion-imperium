import { Injectable } from '@angular/core';
import { Faction, Fleet, StarSystem, Technology } from './star-map.models';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { isCombatShipType } from './ai-queries';

/*
 * =========================================================
 * ENEMY RESEARCH SERVICE (AI technology research)
 * =========================================================
 *
 * Buys technologies for AI factions through the same authoritative API
 * the player's research tree uses: ResearchService.canResearch /
 * researchTechnology. Research is an instant purchase paid in research
 * points (`faction.currencies.research`), so there is no "in progress"
 * state to track: one technology per DECISION_INTERVAL, then the next
 * decision picks the next one.
 *
 * Selection: every technology the faction can research right now
 * (prerequisites met, affordable, not yet researched) is scored by
 *   (direct value + LOOKAHEAD × best value it unlocks next) / cost
 * where direct value comes from what the technology unlocks that the
 * faction does not already have:
 *  - combat ships: strength relative to the best combat ship already
 *    unlocked (only an improvement counts), × military need;
 *  - buildings: BUILDING_VALUE (economic usefulness for the AI economy
 *    manager), × economic need;
 *  - sensor bonuses: small, because AI decisions do not use sensors.
 * Military need rises when hostile fleets are near AI territory.
 * When nothing is affordable the service simply waits; it never issues
 * an attempt that ResearchService would reject.
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
  private static readonly SENSOR_VALUE = 0.1;

  private readonly accumulators = new Map<string, number>();
  private readonly history = new Map<string, string[]>();

  constructor(
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.history.clear();
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

    const choice = this.selectTechnology(faction, factions, starSystems, fleets);
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

  selectTechnology(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): Technology | undefined {
    const candidates = this.researchService
      .getAllTechnologies()
      .filter((tech) => this.researchService.canResearch(faction, tech.id));
    if (candidates.length === 0) {
      return undefined;
    }

    const militaryNeed = this.militaryNeed(faction, factions, starSystems, fleets);
    const scored = candidates.map((tech) => {
      const value = this.directValue(faction, tech, militaryNeed)
        + EnemyResearchService.LOOKAHEAD_WEIGHT * this.bestFollowUpValue(faction, tech, militaryNeed);
      return { tech, score: value / Math.max(1, tech.researchCost) };
    });
    scored.sort((a, b) => b.score - a.score || a.tech.researchCost - b.tech.researchCost || a.tech.id.localeCompare(b.tech.id));
    return scored[0].tech;
  }

  private directValue(faction: Faction, tech: Technology, militaryNeed: number): number {
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
        value += (strength / Math.max(1, bestStrength)) * militaryNeed;
      }
    }

    for (const buildingId of tech.unlocksBuildings) {
      if (this.researchService.isBuildingUnlocked(faction, buildingId)) {
        continue;
      }
      value += EnemyResearchService.BUILDING_VALUE[buildingId] ?? 0.2;
    }

    if ((tech.bonuses ?? []).some((b) => b.type === 'sensorRange')) {
      value += EnemyResearchService.SENSOR_VALUE;
    }
    return value;
  }

  /*
   * bestFollowUpValue: Value of the best technology that becomes
   * researchable once `tech` is researched (one level of lookahead), so
   * pure prerequisite technologies (e.g. orbital_engineering) are not
   * scored as worthless.
   */
  private bestFollowUpValue(faction: Faction, tech: Technology, militaryNeed: number): number {
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
      best = Math.max(best, this.directValue(hypothetical, next, militaryNeed));
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
    const hostileIds = new Set(factions.filter((f) => f.team !== 0 && f.team !== faction.team).map((f) => f.id));
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

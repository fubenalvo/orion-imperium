import { Injectable } from '@angular/core';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { EnemyReachService } from './enemy-reach.service';
import { getAiPersonalityProfile } from './ai-personality';
import { canAttackPlanetOf, hostileFactionIds } from './diplomacy';

/*
 * =========================================================
 * ENEMY PLAN SERVICE (strategic assessment and posture)
 * =========================================================
 *
 * One place that scores a faction's strategic situation and turns it into
 * a posture the other AI layers follow, so they stop applying separate,
 * occasionally contradictory thresholds.
 *
 * Scores (each 0..1, defense 0..2), recomputed every DECISION_INTERVAL:
 *   economy   — share of owned planets at risk (energy deficit or
 *               satisfaction below STABILITY_THRESHOLD): need to stabilize
 *   defense   — hostile fleet strength near owned systems / own living
 *               fleet strength (living ships only)
 *   expansion — reachable unhabited planets (EnemyReachService reach; the
 *               reach widens when nothing is in reach, see adaptReach)
 *   offense   — reachable hostile planets, scaled by the strength surplus
 *               left after covering the threat
 *   research  — affordable technologies waiting
 * The personality's weights multiply the scores; the highest weighted
 * score is the faction's primary priority (reported for diagnostics and
 * for EnemyProgressService).
 *
 * Posture consumers:
 *   allowParallelColonization → EnemyGoalService keeps a colonization
 *       objective alongside a military primary goal (multiple objectives);
 *   allowAssault, homeGuardFraction, assaultMinSurvival → EnemyFleetService;
 *   militaryTargetMultiplier, researchBuildingsPerPlanet → EnemyEconomyService.
 *
 * Neutral case (balanced personality, no threat, healthy economy) equals
 * the Phase 4 constants: military ×1, home guard 30%, assault survival 50%.
 */
export type StrategicPriority = 'stabilize' | 'defend' | 'expand' | 'attack' | 'research' | 'develop';

export interface StrategicScores {
  economy: number;
  defense: number;
  expansion: number;
  offense: number;
  research: number;
}

export interface StrategicPosture {
  primary: StrategicPriority;
  scores: StrategicScores;
  allowParallelColonization: boolean;
  allowAssault: boolean;
  militaryTargetMultiplier: number;
  homeGuardFraction: number;
  assaultMinSurvival: number;
  researchBuildingsPerPlanet: number;
  concurrentColonizations: number;
}

@Injectable({ providedIn: 'root' })
export class EnemyPlanService {
  static readonly DECISION_INTERVAL = 5;
  private static readonly THREAT_RADIUS = 25;
  private static readonly STABILITY_THRESHOLD = 40;
  // Weighted scores below this mean "nothing pressing": develop.
  private static readonly MIN_PRIORITY_SCORE = 0.15;

  private readonly accumulators = new Map<string, number>();
  private readonly postures = new Map<string, StrategicPosture>();

  constructor(
    private readonly economyService: EconomyService,
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
    private readonly reachService: EnemyReachService,
  ) {}

  // Clock time since which a faction has had no colonization target in reach.
  private readonly noTargetSince = new Map<string, number>();
  private readonly clocks = new Map<string, number>();
  private static readonly WIDEN_AFTER = 60;

  reset(): void {
    this.accumulators.clear();
    this.postures.clear();
    this.noTargetSince.clear();
    this.clocks.clear();
  }

  /* Current posture; before the first assessment, the neutral posture. */
  getPosture(faction: Faction | undefined): StrategicPosture {
    return (faction && this.postures.get(faction.id)) ?? this.neutralPosture(faction);
  }

  tick(gameDeltaTime: number, faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return false;
    }
    const clock = (this.clocks.get(faction.id) ?? 0) + gameDeltaTime;
    this.clocks.set(faction.id, clock);
    const accumulator = (this.accumulators.get(faction.id) ?? EnemyPlanService.DECISION_INTERVAL) + gameDeltaTime;
    if (accumulator < EnemyPlanService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, Math.max(0, accumulator - EnemyPlanService.DECISION_INTERVAL));
    const posture = this.assess(faction, factions, starSystems, fleets);
    this.postures.set(faction.id, posture);
    this.adaptReach(faction, posture, starSystems, clock);
    return false; // Assessment only; no game state changes.
  }

  /*
   * adaptReach: Widens the faction's colonization reach when it has had no
   * target in reach for WIDEN_AFTER seconds while unhabited planets exist
   * elsewhere and it is not under threat (see EnemyReachService).
   */
  private adaptReach(faction: Faction, posture: StrategicPosture, starSystems: StarSystem[], clock: number): void {
    // Under fog of war an uncharted system (planets not yet seen) may hold targets too.
    const anyFree = starSystems.some((s) => s.planetsTiles.some((p) => p.factionId === 'unhabited')
      || (s.planetsTiles.length === 0 && s.planets > 0));
    if (posture.scores.expansion > 0 || !anyFree || posture.scores.defense >= 0.5) {
      this.noTargetSince.delete(faction.id);
      return;
    }
    const since = this.noTargetSince.get(faction.id) ?? clock;
    this.noTargetSince.set(faction.id, since);
    if (clock - since >= EnemyPlanService.WIDEN_AFTER) {
      this.reachService.widen(faction.id);
      this.noTargetSince.set(faction.id, clock);
    }
  }

  assess(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): StrategicPosture {
    const personality = getAiPersonalityProfile(faction);
    const scores = this.score(faction, factions, starSystems, fleets);
    const w = personality.weights;
    const weighted: [StrategicPriority, number][] = [
      ['stabilize', scores.economy * w.economy * 2],
      ['defend', Math.min(1, scores.defense) * w.defense],
      ['expand', scores.expansion * w.expansion],
      ['attack', scores.offense * w.offense],
      ['research', scores.research * w.research],
    ];
    weighted.sort((a, b) => b[1] - a[1]);
    const primary: StrategicPriority = weighted[0][1] >= EnemyPlanService.MIN_PRIORITY_SCORE ? weighted[0][0] : 'develop';
    const threat = Math.min(1, scores.defense);

    return {
      primary,
      scores,
      allowParallelColonization:
        scores.expansion > 0 && scores.defense <= personality.parallelColonizationMaxThreat && scores.economy < 0.5,
      allowAssault: scores.offense > 0 && scores.defense < 0.5 && scores.economy < 0.5,
      militaryTargetMultiplier: personality.militaryTarget * (1 + threat),
      homeGuardFraction: Math.min(0.8, personality.homeGuard + 0.4 * threat),
      assaultMinSurvival: personality.assaultMinSurvival,
      researchBuildingsPerPlanet: personality.researchBuildingsPerPlanet,
      concurrentColonizations: personality.concurrentColonizations,
    };
  }

  private score(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): StrategicScores {
    const ownedPlanets = starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
    const ownedSystems = starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === faction.id));

    const atRisk = ownedPlanets.filter((p) => {
      const e = this.economyService.calculatePlanetEconomy(p, faction);
      return e.energyProduction < e.energyConsumption || (p.satisfaction ?? 100) < EnemyPlanService.STABILITY_THRESHOLD;
    }).length;
    const economy = ownedPlanets.length > 0 ? atRisk / ownedPlanets.length : 0;

    const ownStrength = fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
    const hostileIds = hostileFactionIds(faction, factions);
    const threat = fleets
      .filter((f) => hostileIds.has(f.factionId) && !f.destroyed)
      .filter((f) => ownedSystems.some((s) => Math.hypot(s.x - f.x, s.y - f.y) <= EnemyPlanService.THREAT_RADIUS))
      .reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
    const defense = threat <= 0 ? 0 : Math.min(2, threat / Math.max(1, ownStrength));

    // Reach is measured from owned systems; a faction that lost every
    // planet measures it from its fleets (its recovery route, matching
    // EnemyFleetService.planAssault).
    const origins: { x: number; y: number }[] = ownedSystems.length > 0
      ? ownedSystems
      : fleets.filter((f) => f.factionId === faction.id && !f.destroyed);
    const inReach = (s: StarSystem) =>
      origins.some((o) => Math.hypot(o.x - s.x, o.y - s.y) <= this.reachService.getReach(faction));
    const reachable = starSystems.filter(inReach);
    const colonizable = reachable.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === 'unhabited').length;
    const expansion = Math.min(1, colonizable / 3);

    const hostileTeamPlanets = reachable.flatMap((s) => s.planetsTiles).filter((p) => {
      if (p.factionId === 'unhabited' || p.factionId === faction.id) return false;
      return canAttackPlanetOf(faction, factions.find((f) => f.id === p.factionId));
    }).length;
    const surplus = ownStrength > 0 ? Math.max(0, (ownStrength - 1.5 * threat) / ownStrength) : 0;
    const offense = hostileTeamPlanets > 0 ? Math.min(1, surplus) : 0;

    const affordable = this.researchService.getAllTechnologies().filter((t) => this.researchService.canResearch(faction, t.id)).length;
    const research = affordable > 0 ? Math.min(1, 0.2 + affordable / 10) : 0;

    return { economy, defense, expansion, offense, research };
  }

  private neutralPosture(faction: Faction | undefined): StrategicPosture {
    const personality = getAiPersonalityProfile(faction);
    return {
      primary: 'develop',
      scores: { economy: 0, defense: 0, expansion: 0, offense: 0, research: 0 },
      allowParallelColonization: false,
      allowAssault: true,
      militaryTargetMultiplier: personality.militaryTarget,
      homeGuardFraction: personality.homeGuard,
      assaultMinSurvival: personality.assaultMinSurvival,
      researchBuildingsPerPlanet: personality.researchBuildingsPerPlanet,
      concurrentColonizations: personality.concurrentColonizations,
    };
  }
}

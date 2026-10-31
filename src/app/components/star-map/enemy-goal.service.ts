import { Injectable } from '@angular/core';
import {
  Fleet,
  Faction,
  StarSystem,
  AiStrategy,
  StrategicGoal,
  ColonizeGoal,
  AttackGoal,
  DefendGoal,
  DevelopGoal,
} from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { getEnemyFleets, getHostileFleets, getEnemyPlanets, getUnhabitedPlanets, getColonizationReach, isHostileFleet } from './ai-queries';
import { EnemyReachService } from './enemy-reach.service';
import { TerritoryService } from './territory.service';

/*
 * =========================================================
 * ENEMY GOAL SERVICE
 * =========================================================
 *
 * Second strategic AI layer below EnemyStrategyService (V4.1)
 * and above EnemyAiService V3.
 *
 * Given a faction's current strategy, selects a concrete
 * strategic goal with a specific target. Does NOT execute
 * the goal — that is left to future capability/action layers.
 *
 * Timing: goals are recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, matching
 * the V4.1 cadence. Goals are kept until invalidated or until
 * the high-level strategy changes.
 */

@Injectable({ providedIn: 'root' })
export class EnemyGoalService {
  private readonly STRATEGY_TICK_INTERVAL = 2;
  private readonly THREAT_DISTANCE = 5;
  private readonly ENGAGEMENT_DISTANCE = 15;
  private readonly EXPANSION_DISTANCE = 20;
  /*
   * Colonization reach and failure recovery. An AI colonizer fleet built
   * by FleetAssemblyService moves at 0.2 cells/s on the galaxy map
   * (speed 4 / 10 / GALAXY_MOVEMENT_CELL_SIZE_VW 2), so 60 cells is ~300 s of travel; a
   * goal still unfinished after COLONIZE_GOAL_TIMEOUT (production +
   * assembly + travel with margin) is treated as failed and its target
   * is skipped until COLONIZE_RETRY_DELAY has passed.
   */
  // Colonization reach per faction (EnemyReachService: personality + adaptive bonus).
  private readonly colonizationReach = new Map<string, number>();
  // Owned systems as of the last tick, for distance-based colonization timeouts.
  private readonly ownedSystemsCache = new Map<string, StarSystem[]>();
  private readonly COLONIZE_GOAL_TIMEOUT = 480;
  private readonly COLONIZE_RETRY_DELAY = 600;
  // Score multiplier for systems where another faction already owns a planet.
  private readonly CONTESTED_SYSTEM_WEIGHT = 0.5;

  /*
   * One accumulator per faction. tick() is called once per AI faction per
   * frame, so a single shared accumulator advanced N times per frame and
   * only the faction whose call crossed the threshold was processed —
   * every other AI faction starved. Keyed by faction id so each faction
   * gets its own STRATEGY_TICK_INTERVAL cadence.
   */
  private readonly accumulators = new Map<string, number>();
  private readonly currentGoals = new Map<string, StrategicGoal>();
  // Per-faction game-time clock (advanced on every tick call).
  private readonly clocks = new Map<string, number>();
  private readonly goalStartedAt = new Map<string, number>();
  // factionId → (planetId → clock time when the target may be retried).
  private readonly failedColonizeTargets = new Map<string, Map<number, number>>();
  /*
   * Parallel colonization objective. The primary goal follows the
   * strategy (one of colonize / attack / defend / develop); when the
   * primary is NOT colonize and EnemyPlanService allows it, a faction
   * keeps a second, colonization-only objective so a military situation
   * does not cancel an expansion run. A colonize primary that is replaced
   * by a military goal hands its target and timer over to this slot, so
   * the run continues instead of restarting. Never duplicates the
   * primary's target; same validity, timeout and failure memory.
   */
  private readonly colonizationGoals = new Map<string, ColonizeGoal>();
  private readonly colonizationStartedAt = new Map<string, number>();
  // factionId → (player fleet id → clock time when it may be targeted again),
  // filled when EnemyProgressService abandons a stuck attack goal.
  private readonly abandonedAttackTargets = new Map<string, Map<number, number>>();
  private readonly ATTACK_RETRY_DELAY = 120;

  constructor(
    private readonly shipService: ShipService,
    private readonly reachService: EnemyReachService,
    private readonly territory: TerritoryService,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.currentGoals.clear();
    this.clocks.clear();
    this.goalStartedAt.clear();
    this.failedColonizeTargets.clear();
    this.colonizationGoals.clear();
    this.colonizationStartedAt.clear();
    this.abandonedAttackTargets.clear();
  }

  /* The parallel colonization objective, if any (never equal to the primary goal). */
  getColonizationGoal(factionId: string): ColonizeGoal | undefined {
    return this.colonizationGoals.get(factionId);
  }

  /*
   * abandonGoal: Drops a goal that EnemyProgressService found stuck. A
   * colonization target is remembered as failed for COLONIZE_RETRY_DELAY so
   * the next selection picks something else.
   */
  abandonGoal(factionId: string, slot: 'primary' | 'colonization'): void {
    const goal = slot === 'primary' ? this.currentGoals.get(factionId) : this.colonizationGoals.get(factionId);
    const clock = this.clocks.get(factionId) ?? 0;
    if (goal?.type === 'colonize') {
      this.markColonizeTargetFailed(factionId, goal.targetPlanetId, clock);
    }
    if (goal?.type === 'attack') {
      const abandoned = this.abandonedAttackTargets.get(factionId) ?? new Map<number, number>();
      abandoned.set(goal.targetFleetId, clock + this.ATTACK_RETRY_DELAY);
      this.abandonedAttackTargets.set(factionId, abandoned);
    }
    if (slot === 'primary') {
      this.currentGoals.delete(factionId);
    } else {
      this.colonizationGoals.delete(factionId);
    }
  }

  tick(
    gameDeltaTime: number,
    currentStrategy: AiStrategy,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    allowParallelColonization = false,
    // 2 = the parallel slot may also run beside a colonize primary (expansionist).
    concurrentColonizations = 1,
  ): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

    const clock = (this.clocks.get(factionId) ?? 0) + gameDeltaTime;
    this.clocks.set(factionId, clock);
    this.colonizationReach.set(factionId, this.reachService.getReach(factions.find((f) => f.id === factionId)));
    this.ownedSystemsCache.set(factionId, starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === factionId)));

    const accumulator = (this.accumulators.get(factionId) ?? 0) + gameDeltaTime;
    if (accumulator < this.STRATEGY_TICK_INTERVAL) {
      this.accumulators.set(factionId, accumulator);
      return false;
    }
    this.accumulators.set(factionId, Math.max(0, accumulator - this.STRATEGY_TICK_INTERVAL));

    const previousPrimary = this.currentGoals.get(factionId);
    const primaryStartedAt = this.goalStartedAt.get(factionId);
    const primaryChanged = this.updatePrimaryGoal(currentStrategy, factionId, fleets, factions, starSystems, clock);
    const colonizationChanged = this.updateColonizationGoal(
      factionId, fleets, factions, starSystems, clock, allowParallelColonization, previousPrimary, primaryStartedAt, concurrentColonizations,
    );
    return primaryChanged || colonizationChanged;
  }

  private updatePrimaryGoal(
    currentStrategy: AiStrategy,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    clock: number,
  ): boolean {
    const previousGoal = this.currentGoals.get(factionId);
    const timedOut = previousGoal?.type === 'colonize' && this.hasColonizeGoalTimedOut(factionId, previousGoal, clock);
    const needsNewGoal = previousGoal === undefined
      || timedOut
      || !this.isGoalValid(previousGoal, factionId, fleets, factions, starSystems)
      || !this.strategyMatchesGoal(currentStrategy, previousGoal);

    if (!needsNewGoal) {
      return false;
    }
    if (timedOut) {
      // Drop the stuck goal first so the target is no longer reserved.
      this.currentGoals.delete(factionId);
    }

    const nextGoal = this.selectGoal(currentStrategy, factionId, fleets, factions, starSystems);
    if (nextGoal !== undefined && !this.isSameGoal(previousGoal, nextGoal)) {
      this.goalStartedAt.set(factionId, clock);
    }

    if (previousGoal !== undefined && nextGoal !== undefined) {
      this.currentGoals.set(factionId, nextGoal);
      return true;
    }

    if (previousGoal === undefined && nextGoal !== undefined) {
      this.currentGoals.set(factionId, nextGoal);
      return true;
    }

    if (previousGoal !== undefined && nextGoal === undefined) {
      this.currentGoals.delete(factionId);
      return true;
    }

    return false;
  }

  private updateColonizationGoal(
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    clock: number,
    allowed: boolean,
    previousPrimary: StrategicGoal | undefined,
    previousPrimaryStartedAt: number | undefined,
    concurrentColonizations: number,
  ): boolean {
    const primary = this.currentGoals.get(factionId);
    const existing = this.colonizationGoals.get(factionId);

    if (!allowed || (primary?.type === 'colonize' && concurrentColonizations < 2)) {
      if (existing) {
        this.colonizationGoals.delete(factionId);
        return true;
      }
      return false;
    }

    // Hand-over: a colonize primary replaced by a military goal continues here.
    const handOverFailed = previousPrimary?.type === 'colonize'
      && (this.failedColonizeTargets.get(factionId)?.get(previousPrimary.targetPlanetId) ?? -Infinity) > clock;
    // Only a primary that actually changed away from this colonize goal hands over.
    const primaryChanged = previousPrimary !== primary;
    if (!existing && primaryChanged && previousPrimary?.type === 'colonize' && !handOverFailed
      && this.isColonizeGoalValid(previousPrimary, factionId, factions, starSystems)) {
      this.colonizationGoals.set(factionId, previousPrimary);
      this.colonizationStartedAt.set(factionId, previousPrimaryStartedAt ?? clock);
      return true;
    }

    if (existing) {
      const startedAt = this.colonizationStartedAt.get(factionId) ?? clock;
      const timedOut = clock - startedAt > this.colonizeTimeout(factionId, existing, starSystems);
      if (!timedOut && this.isColonizeGoalValid(existing, factionId, factions, starSystems)) {
        return false;
      }
      if (timedOut) {
        this.markColonizeTargetFailed(factionId, existing.targetPlanetId, clock);
      }
      this.colonizationGoals.delete(factionId);
    }

    const next = this.selectColonizeGoal(factionId, fleets, factions, starSystems);
    if (next) {
      this.colonizationGoals.set(factionId, next);
      this.colonizationStartedAt.set(factionId, clock);
      return true;
    }
    return existing !== undefined;
  }

  /*
   * colonizeTimeout: COLONIZE_GOAL_TIMEOUT, or longer for distant targets
   * (adaptive reach can exceed 60 cells): production/assembly allowance
   * plus 1.5 × the travel time of an AI-assembled fleet (0.2 cells/s).
   */
  private colonizeTimeout(factionId: string, goal: ColonizeGoal, starSystems: StarSystem[] | undefined): number {
    const owned = this.ownedSystemsCache.get(factionId) ?? [];
    const target = (starSystems ?? owned).find((s) => s.id === goal.targetSystemId)
      ?? [...this.ownedSystemsCache.values()].flat().find((s) => s.id === goal.targetSystemId);
    if (!target || owned.length === 0) {
      return this.COLONIZE_GOAL_TIMEOUT;
    }
    const distance = Math.min(...owned.map((s) => Math.hypot(s.x - target.x, s.y - target.y)));
    return Math.max(this.COLONIZE_GOAL_TIMEOUT, 120 + 1.5 * (distance / 0.2));
  }

  private markColonizeTargetFailed(factionId: string, planetId: number, clock: number): void {
    let failed = this.failedColonizeTargets.get(factionId);
    if (!failed) {
      failed = new Map();
      this.failedColonizeTargets.set(factionId, failed);
    }
    failed.set(planetId, clock + this.COLONIZE_RETRY_DELAY);
  }

  /*
   * hasColonizeGoalTimedOut: A colonization goal that is still unfinished
   * after COLONIZE_GOAL_TIMEOUT is recorded as failed for its target, so
   * the faction moves on instead of waiting forever (e.g. a colonizer that
   * keeps getting destroyed, or production that never completes). The
   * target becomes eligible again after COLONIZE_RETRY_DELAY.
   */
  private hasColonizeGoalTimedOut(factionId: string, goal: ColonizeGoal, clock: number): boolean {
    const startedAt = this.goalStartedAt.get(factionId) ?? clock;
    if (clock - startedAt <= this.colonizeTimeout(factionId, goal, undefined)) {
      return false;
    }
    let failed = this.failedColonizeTargets.get(factionId);
    if (!failed) {
      failed = new Map();
      this.failedColonizeTargets.set(factionId, failed);
    }
    failed.set(goal.targetPlanetId, clock + this.COLONIZE_RETRY_DELAY);
    return true;
  }

  private isSameGoal(a: StrategicGoal | undefined, b: StrategicGoal): boolean {
    return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
  }

  getGoal(factionId: string): StrategicGoal | undefined {
    return this.currentGoals.get(factionId);
  }

  private selectGoal(
    strategy: AiStrategy,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): StrategicGoal | undefined {
    switch (strategy) {
      case 'expand':
        return this.selectColonizeGoal(factionId, fleets, factions, starSystems);
      case 'attack':
        return this.selectAttackGoal(factionId, fleets, factions);
      case 'defend':
        return this.selectDefendGoal(factionId, fleets, factions, starSystems);
      case 'develop':
        return this.selectDevelopGoal();
      default:
        return undefined;
    }
  }

  private selectColonizeGoal(
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): ColonizeGoal | undefined {
    const enemyPlanets = getEnemyPlanets(factionId, starSystems);
    const enemyFleets = getEnemyFleets(factionId, fleets);
    // Same territory rule as the player (TerritoryService.canColonizeIn).
    const self = factions.find((f) => f.id === factionId);
    const candidates = getUnhabitedPlanets(starSystems).filter(({ system }) =>
      this.territory.canColonizeIn(self, system, starSystems, factions),
    );

    if (enemyFleets.length === 0 || candidates.length === 0) {
      return undefined;
    }

    const targetedPlanetIds = this.getTargetedColonizePlanetIds();
    const clock = this.clocks.get(factionId) ?? 0;
    const failed = this.failedColonizeTargets.get(factionId);

    const scored = candidates
      .filter(({ planet }) => !targetedPlanetIds.has(planet.id))
      .filter(({ planet }) => (failed?.get(planet.id) ?? -Infinity) <= clock)
      .map(({ system, planet }) => {
        const distanceFromEnemy = enemyPlanets.length > 0
          ? this.getMinDistanceToEnemyPlanets(system, enemyPlanets)
          : this.getMinDistanceToEnemyFleets(system, enemyFleets);
        if (distanceFromEnemy === Infinity || distanceFromEnemy > (this.colonizationReach.get(factionId) ?? getColonizationReach(undefined))) {
          return null;
        }

        const habitabilityWeight = this.getHabitabilityWeight(planet);
        const sizeWeight = this.getSizeWeight(planet);
        const contested = system.planetsTiles.some(
          (p) => p.factionId !== factionId && p.factionId !== 'unhabited',
        );
        const contestWeight = contested ? this.CONTESTED_SYSTEM_WEIGHT : 1;
        const score = (20 / distanceFromEnemy) * habitabilityWeight * sizeWeight * contestWeight;

        return {
          system,
          planet,
          score,
          distanceFromEnemy,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.distanceFromEnemy !== b.distanceFromEnemy) {
          return a.distanceFromEnemy - b.distanceFromEnemy;
        }
        if (a.planet.id !== b.planet.id) {
          return a.planet.id - b.planet.id;
        }
        return a.system.id.localeCompare(b.system.id);
      });

    if (scored.length === 0) {
      return undefined;
    }

    const best = scored[0];
    return {
      type: 'colonize',
      targetPlanetId: best.planet.id,
      targetSystemId: best.system.id,
    };
  }

  private selectAttackGoal(
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
  ): AttackGoal | undefined {
    const enemyFleets = getEnemyFleets(factionId, fleets);
    const clock = this.clocks.get(factionId) ?? 0;
    const abandoned = this.abandonedAttackTargets.get(factionId);
    const playerFleets = getHostileFleets(factionId, fleets, factions)
      .filter((f) => (abandoned?.get(f.id) ?? -Infinity) <= clock);

    if (enemyFleets.length === 0 || playerFleets.length === 0) {
      return undefined;
    }

    const maxEnemyStrength = Math.max(
      ...enemyFleets.map((fleet) => this.shipService.calculateFleetStrength(fleet.ships)),
      0,
    );

    const scored = playerFleets.map((playerFleet) => {
      const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
      const ratio = maxEnemyStrength > 0 ? playerStrength / maxEnemyStrength : 1;
      const category = this.getStrengthCategory(ratio);

      const closestDistance = Math.min(
        ...enemyFleets.map((enemyFleet) => {
          const dx = enemyFleet.x - playerFleet.x;
          const dy = enemyFleet.y - playerFleet.y;
          return Math.sqrt(dx * dx + dy * dy);
        }),
      );

      return {
        fleet: playerFleet,
        category,
        ratio,
        closestDistance,
      };
    });

    const categoryOrder = { weak: 0, comparable: 1, strong: 2 };
    scored.sort((a, b) => {
      const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (categoryDiff !== 0) {
        return categoryDiff;
      }
      if (a.closestDistance !== b.closestDistance) {
        return a.closestDistance - b.closestDistance;
      }
      return a.fleet.id - b.fleet.id;
    });

    const best = scored[0];
    return {
      type: 'attack',
      targetFleetId: best.fleet.id,
    };
  }

  private selectDefendGoal(
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): DefendGoal | undefined {
    const enemyPlanets = getEnemyPlanets(factionId, starSystems);
    const playerFleets = getHostileFleets(factionId, fleets, factions);

    if (enemyPlanets.length === 0 || playerFleets.length === 0) {
      return undefined;
    }

    let bestSystem: StarSystem | undefined;
    let bestPlanet = enemyPlanets[0].planetsTiles[0];
    let bestDistance = Infinity;
    let threateningFleetId: number | undefined;

    for (const system of enemyPlanets) {
      for (const planet of system.planetsTiles) {
        if (planet.factionId !== factionId) {
          continue;
        }

        for (const playerFleet of playerFleets) {
          const dx = playerFleet.x - system.x;
          const dy = playerFleet.y - system.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < bestDistance) {
            bestDistance = distance;
            bestSystem = system;
            bestPlanet = planet;
            threateningFleetId = playerFleet.id;
          }
        }
      }
    }

    if (bestSystem === undefined || bestDistance > this.THREAT_DISTANCE) {
      return undefined;
    }

    return {
      type: 'defend',
      targetPlanetId: bestPlanet.id,
      targetSystemId: bestSystem.id,
      threateningFleetId,
    };
  }

  private selectDevelopGoal(): DevelopGoal {
    return { type: 'develop' };
  }

  private isGoalValid(
    goal: StrategicGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): boolean {
    switch (goal.type) {
      case 'colonize':
        return this.isColonizeGoalValid(goal, factionId, factions, starSystems);
      case 'attack':
        return this.isAttackGoalValid(goal, factionId, fleets, factions);
      case 'defend':
        return this.isDefendGoalValid(goal, factionId, fleets, factions, starSystems);
      case 'develop':
        return true;
    }
  }

  private isColonizeGoalValid(goal: ColonizeGoal, factionId: string, factions: Faction[], starSystems: StarSystem[]): boolean {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    if (!system) {
      return false;
    }
    const planet = system.planetsTiles.find((p) => p.id === goal.targetPlanetId);
    if (!planet) {
      return false;
    }
    // A target that fell into another (non-hostile) empire's territory is dropped.
    return planet.factionId === 'unhabited'
      && this.territory.canColonizeIn(factions.find((f) => f.id === factionId), system, starSystems, factions);
  }

  /* The target must still be alive and its owner still at war with us (peace ends the goal). */
  private isAttackGoalValid(goal: AttackGoal, factionId: string, fleets: Fleet[], factions: Faction[]): boolean {
    const fleet = fleets.find((f) => f.id === goal.targetFleetId);
    if (!fleet || fleet.destroyed || fleet.ships.length === 0) {
      return false;
    }
    return isHostileFleet(fleet, factionId, factions);
  }

  private isDefendGoalValid(
    goal: DefendGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): boolean {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    if (!system) {
      return false;
    }
    const planet = system.planetsTiles.find((p) => p.id === goal.targetPlanetId);
    if (!planet || planet.factionId !== factionId) {
      return false;
    }
    const playerFleets = getHostileFleets(factionId, fleets, factions);
    return playerFleets.some(
      (fleet) => {
        const dx = fleet.x - system.x;
        const dy = fleet.y - system.y;
        return Math.sqrt(dx * dx + dy * dy) <= this.THREAT_DISTANCE;
      },
    );
  }

  private strategyMatchesGoal(strategy: AiStrategy, goal: StrategicGoal): boolean {
    switch (strategy) {
      case 'expand':
        return goal.type === 'colonize';
      case 'attack':
        return goal.type === 'attack';
      case 'defend':
        return goal.type === 'defend';
      case 'develop':
        return goal.type === 'develop';
      default:
        return false;
    }
  }

  private getTargetedColonizePlanetIds(): Set<number> {
    const ids = new Set<number>([...this.colonizationGoals.values()].map((g) => g.targetPlanetId));
    for (const goal of this.currentGoals.values()) {
      if (goal.type === 'colonize') {
        ids.add(goal.targetPlanetId);
      }
    }
    return ids;
  }

  private getMinDistanceToEnemyPlanets(
    system: StarSystem,
    enemyPlanets: StarSystem[],
  ): number {
    let minDistance = Infinity;
    for (const enemySystem of enemyPlanets) {
      const dx = system.x - enemySystem.x;
      const dy = system.y - enemySystem.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  private getMinDistanceToEnemyFleets(
    system: StarSystem,
    enemyFleets: Fleet[],
  ): number {
    let minDistance = Infinity;
    for (const enemyFleet of enemyFleets) {
      const dx = system.x - enemyFleet.x;
      const dy = system.y - enemyFleet.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  private getHabitabilityWeight(planet: StarSystem['planetsTiles'][0]): number {
    switch (planet.type) {
      case 'earthlike':
      case 'gasgiant':
        return 1.0;
      case 'desert':
      case 'venuslike':
        return 0.8;
      case 'marslike':
        return 0.9;
      case 'ice':
        return 0.7;
      default:
        return 1.0;
    }
  }

  private getSizeWeight(planet: StarSystem['planetsTiles'][0]): number {
    switch (planet.size) {
      case 'tiny':
        return 0.6;
      case 'small':
        return 0.8;
      case 'medium':
        return 1.0;
      case 'big':
      case 'huge':
        return 1.1;
      default:
        return 1.0;
    }
  }

  private getStrengthCategory(ratio: number): 'weak' | 'comparable' | 'strong' {
    if (ratio <= 0.75) {
      return 'weak';
    }
    if (ratio <= 1.5) {
      return 'comparable';
    }
    return 'strong';
  }

  private getGoalType(goal: StrategicGoal): string {
    return goal.type;
  }
}

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
  private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);
  private readonly STRATEGY_TICK_INTERVAL = 2;
  private readonly THREAT_DISTANCE = 5;
  private readonly ENGAGEMENT_DISTANCE = 15;
  private readonly EXPANSION_DISTANCE = 20;
  private readonly STRENGTH_ADVANTAGE = 1.2;

  private accumulator = 0;
  private readonly currentGoals = new Map<string, StrategicGoal>();

  constructor(private readonly shipService: ShipService) {}

  reset(): void {
    this.accumulator = 0;
    this.currentGoals.clear();
  }

  tick(
    gameDeltaTime: number,
    currentStrategy: AiStrategy,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

    this.accumulator += gameDeltaTime;
    if (this.accumulator < this.STRATEGY_TICK_INTERVAL) {
      return false;
    }

    this.accumulator -= this.STRATEGY_TICK_INTERVAL;
    if (this.accumulator < 0) {
      this.accumulator = 0;
    }

    const previousGoal = this.currentGoals.get(factionId);
    const needsNewGoal = previousGoal === undefined
      || !this.isGoalValid(previousGoal, factionId, fleets, factions, starSystems)
      || !this.strategyMatchesGoal(currentStrategy, previousGoal);

    if (!needsNewGoal) {
      return false;
    }

    const nextGoal = this.selectGoal(currentStrategy, factionId, fleets, factions, starSystems);

    if (previousGoal !== undefined && nextGoal !== undefined) {
      this.currentGoals.set(factionId, nextGoal);
      console.log(
        `[Enemy Goal] ${factionId}: ${this.getGoalType(previousGoal)} -> ${this.getGoalType(nextGoal)}`,
        nextGoal,
      );
      return true;
    }

    if (previousGoal === undefined && nextGoal !== undefined) {
      this.currentGoals.set(factionId, nextGoal);
      console.log(`[Enemy Goal] ${factionId}: none -> ${this.getGoalType(nextGoal)}`, nextGoal);
      return true;
    }

    if (previousGoal !== undefined && nextGoal === undefined) {
      this.currentGoals.delete(factionId);
      console.log(`[Enemy Goal] ${factionId}: ${this.getGoalType(previousGoal)} -> none`);
      return true;
    }

    return false;
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
        return this.selectColonizeGoal(factionId, fleets, starSystems);
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
    starSystems: StarSystem[],
  ): ColonizeGoal | undefined {
    const enemyPlanets = this.getEnemyPlanets(factionId, starSystems);
    const enemyFleets = this.getEnemyFleets(factionId, fleets);
    const candidates = this.getUnhabitedPlanets(starSystems);

    if (enemyFleets.length === 0 || candidates.length === 0) {
      return undefined;
    }

    const targetedPlanetIds = this.getTargetedColonizePlanetIds();

    const scored = candidates
      .filter(({ planet }) => !targetedPlanetIds.has(planet.id))
      .map(({ system, planet }) => {
        const distanceFromEnemy = enemyPlanets.length > 0
          ? this.getMinDistanceToEnemyPlanets(system, enemyPlanets)
          : this.getMinDistanceToEnemyFleets(system, enemyFleets);
        if (distanceFromEnemy === Infinity) {
          return null;
        }

        const habitabilityWeight = this.getHabitabilityWeight(planet);
        const sizeWeight = this.getSizeWeight(planet);
        const score = (20 / distanceFromEnemy) * habitabilityWeight * sizeWeight;

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
    const enemyFleets = this.getEnemyFleets(factionId, fleets);
    const playerFleets = this.getPlayerFleets(fleets, factions);

    if (enemyFleets.length === 0 || playerFleets.length === 0) {
      return undefined;
    }

    const maxEnemyStrength = Math.max(
      ...enemyFleets.map((fleet) => this.calculateFleetStrength(fleet)),
      0,
    );

    const scored = playerFleets.map((playerFleet) => {
      const playerStrength = this.calculateFleetStrength(playerFleet);
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
    const enemyPlanets = this.getEnemyPlanets(factionId, starSystems);
    const playerFleets = this.getPlayerFleets(fleets, factions);

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
        return this.isColonizeGoalValid(goal, starSystems);
      case 'attack':
        return this.isAttackGoalValid(goal, fleets, factions);
      case 'defend':
        return this.isDefendGoalValid(goal, factionId, fleets, factions, starSystems);
      case 'develop':
        return true;
    }
  }

  private isColonizeGoalValid(goal: ColonizeGoal, starSystems: StarSystem[]): boolean {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    if (!system) {
      return false;
    }
    const planet = system.planetsTiles.find((p) => p.id === goal.targetPlanetId);
    if (!planet) {
      return false;
    }
    return planet.factionId === 'unhabited';
  }

  private isAttackGoalValid(goal: AttackGoal, fleets: Fleet[], factions: Faction[]): boolean {
    const fleet = fleets.find((f) => f.id === goal.targetFleetId);
    if (!fleet || fleet.destroyed || fleet.ships.length === 0) {
      return false;
    }
    const playerFactionIds = new Set(
      factions
        .filter((faction) => faction.team === 1)
        .map((faction) => faction.id),
    );
    return playerFactionIds.has(fleet.factionId);
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
    const playerFleets = this.getPlayerFleets(fleets, factions);
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
    const ids = new Set<number>();
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

  private getEnemyFleets(factionId: string, fleets: Fleet[]): Fleet[] {
    return fleets.filter(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.length > 0,
    );
  }

  private getPlayerFleets(fleets: Fleet[], factions: Faction[]): Fleet[] {
    const playerFactionIds = new Set(
      factions
        .filter((faction) => faction.team === 1)
        .map((faction) => faction.id),
    );

    return fleets.filter(
      (fleet) =>
        playerFactionIds.has(fleet.factionId) && !fleet.destroyed && fleet.ships.length > 0,
    );
  }

  private getEnemyPlanets(factionId: string, starSystems: StarSystem[]): StarSystem[] {
    return starSystems.filter((system) =>
      system.planetsTiles.some((planet) => planet.factionId === factionId),
    );
  }

  private getUnhabitedPlanets(starSystems: StarSystem[]): { system: StarSystem; planet: StarSystem['planetsTiles'][0] }[] {
    const result: { system: StarSystem; planet: StarSystem['planetsTiles'][0] }[] = [];

    for (const system of starSystems) {
      for (const planet of system.planetsTiles) {
        if (planet.factionId === 'unhabited') {
          result.push({ system, planet });
        }
      }
    }

    return result;
  }

  private calculateFleetStrength(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => {
      const shipType = this.shipService.getShipType(ship.type);
      if (!shipType) {
        return sum;
      }
      return sum + shipType.attack + shipType.defense + shipType.hitPoints / 10 + shipType.shield / 10;
    }, 0);
  }
}

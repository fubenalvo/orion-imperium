import { Injectable } from '@angular/core';
import { Fleet, Faction, StarSystem, AiStrategy, getAiFactionIds } from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { getEnemyFleets, getPlayerFleets, getEnemyPlanets, getUnhabitedPlanets } from './ai-queries';
import { EnemyReachService } from './enemy-reach.service';
import { getAiDifficultyProfile } from './ai-difficulty';

/*
 * =========================================================
 * ENEMY STRATEGY SERVICE
 * =========================================================
 *
 * First strategic AI layer above EnemyAiService V3.
 * Determines the current high-level intention for each
 * enemy faction (expand, attack, defend, develop).
 *
 * This layer does NOT execute strategy. It only inspects
 * the game state and returns/logs the current strategic goal.
 *
 * Timing: strategy is recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, so it
 * naturally respects pause and game speed.
 */

@Injectable({ providedIn: 'root' })
export class EnemyStrategyService {
  private readonly STRATEGY_TICK_INTERVAL = 2;
  private readonly THREAT_DISTANCE = 5;
  private readonly THREAT_SIGNIFICANCE = 0.25;
  private readonly ENGAGEMENT_DISTANCE = 15;
  private readonly EXPANSION_DISTANCE = 20;
  /*
   * Expansion reach is measured from systems the faction already owns
   * (EnemyReachService: personality and adaptive bonus). The fleet-based EXPANSION_DISTANCE alone never
   * reaches a neighbouring system on generated maps, so a faction whose
   * home system is fully settled would stay in 'develop' forever.
   */
  // The ATTACK strength advantage is per faction and comes from its AI
  // difficulty profile (1.2 for 'normal', the historical constant).

  private accumulator = 0;
  private readonly currentStrategies = new Map<string, AiStrategy>();

  // The default only serves hand-built instances in specs; Angular DI
  // always injects the shared EnemyReachService.
  constructor(
    private readonly shipService: ShipService,
    private readonly reachService: EnemyReachService = new EnemyReachService(),
  ) {}

  reset(): void {
    this.accumulator = 0;
    this.currentStrategies.clear();
  }

  tick(
    gameDeltaTime: number,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    // Fog of war: what each faction knows (EnemyIntelService). Defaults to the real world.
    perceive?: (factionId: string) => { fleets: Fleet[]; starSystems: StarSystem[] },
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

    let changed = false;

    const aiFactionIds = getAiFactionIds(factions);

    for (const factionId of aiFactionIds) {
      const previous = this.currentStrategies.get(factionId);
      const view = perceive?.(factionId) ?? { fleets, starSystems };
      const next = this.determineStrategy(factionId, view.fleets, factions, view.starSystems);

      if (previous !== next) {
        this.currentStrategies.set(factionId, next);
        changed = true;
      }
    }

    return changed;
  }

  getStrategy(factionId: string): AiStrategy | undefined {
    return this.currentStrategies.get(factionId);
  }

  private determineStrategy(
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): AiStrategy {
    const enemyPlanets = getEnemyPlanets(factionId, starSystems);
    const enemyFleets = getEnemyFleets(factionId, fleets);
    const playerFleets = getPlayerFleets(fleets, factions);
    const unhabitedPlanets = getUnhabitedPlanets(starSystems);

    if (this.isThreatened(enemyPlanets, playerFleets, enemyFleets)) {
      return 'defend';
    }

    const strengthAdvantage = getAiDifficultyProfile(
      factions.find((f) => f.id === factionId),
    ).attackStrengthAdvantage;
    if (this.hasFavorableEngagement(enemyFleets, playerFleets, strengthAdvantage)) {
      return 'attack';
    }

    if (this.canExpand(enemyFleets, enemyPlanets, unhabitedPlanets, this.reachService.getReach(factions.find((f) => f.id === factionId)))) {
      return 'expand';
    }

    return 'develop';
  }

  /*
   * isThreatened: A hostile fleet near an owned system is a strategic
   * threat only if it is significant relative to the faction's own fleets
   * (THREAT_SIGNIFICANCE of their total strength). A lone scout passing
   * by must not switch the whole faction into 'defend' and stall
   * expansion; EnemyFleetService intercepts such intruders.
   */
  private isThreatened(
    enemyPlanets: StarSystem[],
    playerFleets: Fleet[],
    enemyFleets: Fleet[],
  ): boolean {
    const ownStrength = enemyFleets.reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
    for (const system of enemyPlanets) {
      for (const fleet of playerFleets) {
        const dx = fleet.x - system.x;
        const dy = fleet.y - system.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= this.THREAT_DISTANCE
          && this.shipService.calculateFleetStrength(fleet.ships) >= this.THREAT_SIGNIFICANCE * ownStrength) {
          return true;
        }
      }
    }

    return false;
  }

  /*
   * hasFavorableEngagement: An AI fleet within ENGAGEMENT_DISTANCE of a
   * player fleet that it outguns by `strengthAdvantage`, where the player
   * fleet is also strategically significant (THREAT_SIGNIFICANCE of the
   * faction's total strength). Insignificant targets (a lone scout) are
   * left to EnemyFleetService interception so they cannot hold the whole
   * faction in 'attack' and block expansion.
   */
  private hasFavorableEngagement(
    enemyFleets: Fleet[],
    playerFleets: Fleet[],
    strengthAdvantage: number,
  ): boolean {
    const ownStrength = enemyFleets.reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
    for (const enemyFleet of enemyFleets) {
      const enemyStrength = this.shipService.calculateFleetStrength(enemyFleet.ships);

      for (const playerFleet of playerFleets) {
        const dx = enemyFleet.x - playerFleet.x;
        const dy = enemyFleet.y - playerFleet.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > this.ENGAGEMENT_DISTANCE) {
          continue;
        }

        const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
        if (playerStrength < this.THREAT_SIGNIFICANCE * ownStrength) {
          continue;
        }
        if (enemyStrength >= playerStrength * strengthAdvantage) {
          return true;
        }
      }
    }

    return false;
  }

  private canExpand(
    enemyFleets: Fleet[],
    ownedSystems: StarSystem[],
    unhabitedPlanets: { system: StarSystem; planet: StarSystem['planetsTiles'][0] }[],
    colonyReach: number,
  ): boolean {
    // Colonization needs a fleet to carry the colonizer.
    if (enemyFleets.length === 0) {
      return false;
    }

    for (const owned of ownedSystems) {
      for (const { system } of unhabitedPlanets) {
        const dx = owned.x - system.x;
        const dy = owned.y - system.y;
        if (Math.sqrt(dx * dx + dy * dy) <= colonyReach) {
          return true;
        }
      }
    }

    for (const fleet of enemyFleets) {
      for (const { system } of unhabitedPlanets) {
        const dx = fleet.x - system.x;
        const dy = fleet.y - system.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= this.EXPANSION_DISTANCE) {
          return true;
        }
      }
    }

    return false;
  }
}

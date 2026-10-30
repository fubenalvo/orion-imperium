import { Injectable } from '@angular/core';
import { Fleet, Faction, getAiFactionIds } from './star-map.models';
import { getHostileFleets } from './ai-queries';
import { ShipService } from '../../services/ship.service';

/*
 * =========================================================
 * ENEMY AI SERVICE (legacy reactive fleet targeting, "V3")
 * =========================================================
 *
 * Reactive opportunistic pursuit: an idle AI fleet picks a nearby player
 * fleet (weak before comparable before strong, then nearest) and follows
 * it. Runs every frame, before the strategic pipeline.
 *
 * Ownership rules (the strategic pipeline always wins):
 *  - Fleets in `reservedFleetIds` are never touched. StarMapAiTickService
 *    reserves fleets the pipeline is commanding (move_to_target / defend)
 *    and every fleet carrying a colonizer.
 *  - A new pursuit only starts against player fleets within
 *    PURSUIT_ACQUIRE_RANGE cells; an already-acquired target is followed
 *    while it stays valid.
 *  - This service only clears targets it set itself, so it never cancels
 *    a movement order issued by the executor or the player.
 */
@Injectable({ providedIn: 'root' })
export class EnemyAiService {
  // Matches EnemyStrategyService.ENGAGEMENT_DISTANCE.
  private readonly PURSUIT_ACQUIRE_RANGE = 15;
  private readonly currentTargets = new Map<number, number>();

  constructor(private readonly shipService: ShipService) {}

  reset(): void {
    this.currentTargets.clear();
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

  tick(
    gameDeltaTime: number,
    fleets: Fleet[],
    factions: Faction[],
    reservedFleetIds: ReadonlySet<number> = new Set(),
  ): boolean {
     if (gameDeltaTime <= 0) {
      return false;
    }

    const aiFactionIds = new Set(getAiFactionIds(factions));

    // Pursuit targets are the living fleets of factions this AI faction is
    // at war with (diplomacy.ts); before diplomacy that was the human (team 1).
    const hostileFleetCache = new Map<string, Fleet[]>();
    const hostileFleetsFor = (factionId: string): Fleet[] => {
      let cached = hostileFleetCache.get(factionId);
      if (!cached) {
        cached = getHostileFleets(factionId, fleets, factions);
        hostileFleetCache.set(factionId, cached);
      }
      return cached;
    };

    let changed = false;

    for (const fleet of fleets) {
      if (!aiFactionIds.has(fleet.factionId)) {
        continue;
      }

      if (fleet.destroyed) {
        continue;
      }

      if (reservedFleetIds.has(fleet.id)) {
        this.currentTargets.delete(fleet.id);
        continue;
      }

      const playerFleets = hostileFleetsFor(fleet.factionId);
      let targetedPlayerFleet: Fleet | undefined;
      const targetedPlayerFleetId = this.currentTargets.get(fleet.id);

      if (targetedPlayerFleetId !== undefined) {
        targetedPlayerFleet = fleets.find(
          (candidate) => candidate.id === targetedPlayerFleetId,
        );
      } else if (fleet.targetX !== null && fleet.targetY !== null) {
        targetedPlayerFleet = playerFleets.find(
          (candidate) =>
            candidate.x === fleet.targetX && candidate.y === fleet.targetY,
        );
        if (targetedPlayerFleet) {
          this.currentTargets.set(fleet.id, targetedPlayerFleet.id);
        }
      }

      const hasValidTarget = targetedPlayerFleet !== undefined
        && playerFleets.includes(targetedPlayerFleet)
        && !targetedPlayerFleet.destroyed
        && targetedPlayerFleet.ships.length > 0;

      if (!hasValidTarget) {
        const ownedTarget = targetedPlayerFleetId !== undefined;
        if (ownedTarget) {
          this.currentTargets.delete(fleet.id);
        }

        const enemyStrength = this.shipService.calculateFleetStrength(fleet.ships);
        const candidates = playerFleets
          .map((playerFleet) => {
            const dx = fleet.x - playerFleet.x;
            const dy = fleet.y - playerFleet.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
            const ratio = enemyStrength > 0 ? playerStrength / enemyStrength : 1;
            const category = this.getStrengthCategory(ratio);
            return { fleet: playerFleet, distance, category, ratio };
          })
          .filter((candidate) => candidate.distance <= this.PURSUIT_ACQUIRE_RANGE);

        if (candidates.length === 0) {
          // Stop a pursuit this service started; leave foreign orders alone.
          if (ownedTarget) {
            fleet.targetX = null;
            fleet.targetY = null;
          }
          continue;
        }

        candidates.sort((a, b) => {
          const categoryOrder = { weak: 0, comparable: 1, strong: 2 };
          const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
          if (categoryDiff !== 0) {
            return categoryDiff;
          }
          return a.distance - b.distance;
        });

        const bestCandidate = candidates[0];
        const nearestPlayerFleet = bestCandidate.fleet;

        fleet.targetX = nearestPlayerFleet.x;
        fleet.targetY = nearestPlayerFleet.y;
        this.currentTargets.set(fleet.id, nearestPlayerFleet.id);
        changed = true;
        continue;
      }

      fleet.targetX = targetedPlayerFleet!.x;
      fleet.targetY = targetedPlayerFleet!.y;
    }

    return changed;
  }
}

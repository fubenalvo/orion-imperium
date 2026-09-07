import { Injectable } from '@angular/core';
import { Fleet, Faction, getAiFactionIds } from './star-map.models';
import { ShipService } from '../../services/ship.service';

@Injectable({ providedIn: 'root' })
export class EnemyAiService {
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

  tick(gameDeltaTime: number, fleets: Fleet[], factions: Faction[]): boolean {
     if (gameDeltaTime <= 0) {
      return false;
    }

    const aiFactionIds = new Set(getAiFactionIds(factions));

    const playerFactionIds = new Set(
      factions
        .filter((faction) => faction.team === 1)
        .map((faction) => faction.id),
    );

    const playerFleets = fleets.filter((candidate) => {
      if (!playerFactionIds.has(candidate.factionId)) {
        return false;
      }
      if (candidate.destroyed) {
        return false;
      }
      if (candidate.ships.length === 0) {
        return false;
      }
      return true;
    });

    const playerFleetIds = new Set(playerFleets.map((fleet) => fleet.id));

    let changed = false;

    for (const fleet of fleets) {
      if (!aiFactionIds.has(fleet.factionId)) {
        continue;
      }

      if (fleet.destroyed) {
        continue;
      }

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
        && playerFleetIds.has(targetedPlayerFleet.id)
        && !targetedPlayerFleet.destroyed
        && targetedPlayerFleet.ships.length > 0;

      if (!hasValidTarget) {
        if (targetedPlayerFleetId !== undefined) {
          this.currentTargets.delete(fleet.id);
        }

        if (playerFleets.length === 0) {
          fleet.targetX = null;
          fleet.targetY = null;
          continue;
        }

          const enemyStrength = this.shipService.calculateFleetStrength(fleet.ships);
          const candidates = playerFleets.map((playerFleet) => {
            const dx = fleet.x - playerFleet.x;
            const dy = fleet.y - playerFleet.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
          const ratio = enemyStrength > 0 ? playerStrength / enemyStrength : 1;
          const category = this.getStrengthCategory(ratio);
          return { fleet: playerFleet, distance, category, ratio };
        });

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
        console.log(
          `[Enemy AI] ${fleet.name} -> ${nearestPlayerFleet.name} (${bestCandidate.category} target, ratio=${bestCandidate.ratio.toFixed(2)})`,
        );
        continue;
      }

      fleet.targetX = targetedPlayerFleet!.x;
      fleet.targetY = targetedPlayerFleet!.y;
    }

    return changed;
  }
}

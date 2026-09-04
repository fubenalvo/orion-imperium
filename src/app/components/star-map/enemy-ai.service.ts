import { Injectable } from '@angular/core';
import { Fleet, Faction } from './star-map.models';

@Injectable({ providedIn: 'root' })
export class EnemyAiService {
  private enemyFactionIds = new Set(['enemy1', 'enemy2']);

  /**
   * Runs one AI tick. Returns true if any fleet state was mutated
   * (so the caller knows whether to trigger change detection).
   */
  tick(gameDeltaTime: number, fleets: Fleet[], factions: Faction[]): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }
    const playerFactionIds = new Set(
      factions
        .filter((faction) => faction.team === 1)
        .map((faction) => faction.id),
    );

    let changed = false;

    for (const fleet of fleets) {
      if (!this.enemyFactionIds.has(fleet.factionId)) {
        continue;
      }

      if (fleet.destroyed) {
        continue;
      }

      if (fleet.targetX !== null && fleet.targetY !== null) {
        continue;
      }

      const playerFleets = fleets.filter((candidate) => {
        if (!playerFactionIds.has(candidate.factionId)) {
          return false;
        }
        if (candidate.destroyed) {
          return false;
        }
        return true;
      });

      if (playerFleets.length === 0) {
        continue;
      }

      let nearestPlayerFleet: Fleet | null = null;
      let nearestDistance = Infinity;

      for (const playerFleet of playerFleets) {
        const dx = fleet.x - playerFleet.x;
        const dy = fleet.y - playerFleet.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPlayerFleet = playerFleet;
        }
      }

      if (nearestPlayerFleet) {
        fleet.targetX = nearestPlayerFleet.x;
        fleet.targetY = nearestPlayerFleet.y;
        changed = true;
        console.log(`[Enemy AI] ${fleet.name} -> ${nearestPlayerFleet.name}`);
      }
    }

    return changed;
  }
}

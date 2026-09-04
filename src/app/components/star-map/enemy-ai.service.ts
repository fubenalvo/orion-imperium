import { Injectable } from '@angular/core';
import { Fleet, Faction } from './star-map.models';

@Injectable({ providedIn: 'root' })
export class EnemyAiService {
  private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);
  private readonly currentTargets = new Map<number, number>();

  reset(): void {
    this.currentTargets.clear();
  }

  tick(gameDeltaTime: number, fleets: Fleet[], factions: Faction[]): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

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
      if (!this.enemyFactionIds.has(fleet.factionId)) {
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
          this.currentTargets.set(fleet.id, nearestPlayerFleet.id);
          changed = true;
          console.log(
            targetedPlayerFleetId !== undefined || (fleet.targetX !== null && fleet.targetY !== null)
              ? `[Enemy AI] ${fleet.name} retargeted -> ${nearestPlayerFleet.name}`
              : `[Enemy AI] ${fleet.name} -> ${nearestPlayerFleet.name}`,
          );
        }
        continue;
      }

      fleet.targetX = targetedPlayerFleet!.x;
      fleet.targetY = targetedPlayerFleet!.y;
    }

    return changed;
  }
}

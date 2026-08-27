import { Injectable } from '@angular/core';
import { BattleService } from '../../services/battle.service';
import { Fleet, StarSystem, Faction } from './star-map.models';

/*
 * =========================================================
 * STAR MAP BATTLE DETECTION SERVICE
 * =========================================================
 *
 * Handles collision-based battle detection.
 * Checks if two fleets occupy the same grid cell and
 * whether they are eligible to battle.
 */

@Injectable({ providedIn: 'root' })
export class StarMapBattleDetectionService {
  constructor(private battleService: BattleService) {}

  /*
   * checkForBattles: Iterates through all active fleet pairs
   * and triggers battles for eligible collisions.
   *
   * Battle conditions:
   * - Both fleets must be in the same grid cell
   * - Both fleets must have valid faction references
   * - Neither faction can be neutral (team 0)
   * - Factions must be on different teams
   * - The pair must not have already triggered a battle
   *
   * Returns true if a battle was triggered.
   */
  checkForBattles(
    fleets: Fleet[],
    factions: Faction[],
    calculateGridCell: (x: number, y: number) => { col: number; row: number },
    isFleetInSystem: (fleet: Fleet, system: StarSystem) => boolean,
    starSystems: StarSystem[],
    saveGame: () => void,
    navigateToBattle: () => void,
    triggeredBattles: Set<string>,
  ): boolean {
    const activeFleets = fleets.filter((f) => !f.destroyed);

    for (let i = 0; i < activeFleets.length; i++) {
      for (let j = i + 1; j < activeFleets.length; j++) {
        const fleet1 = activeFleets[i];
        const fleet2 = activeFleets[j];

        const fleet1Cell = calculateGridCell(fleet1.x, fleet1.y);
        const fleet2Cell = calculateGridCell(fleet2.x, fleet2.y);

        if (fleet1Cell.col !== fleet2Cell.col || fleet1Cell.row !== fleet2Cell.row) {
          continue;
        }

        const faction1 = factions.find((f) => f.id === fleet1.factionId);
        const faction2 = factions.find((f) => f.id === fleet2.factionId);

        if (!faction1 || !faction2) {
          continue;
        }

        if (faction1.team === 0 || faction2.team === 0) {
          continue;
        }

        if (faction1.team === faction2.team) {
          continue;
        }

        const battleKey = `${Math.min(fleet1.id, fleet2.id)}-${Math.max(fleet1.id, fleet2.id)}`;

        if (triggeredBattles.has(battleKey)) {
          continue;
        }

        triggeredBattles.add(battleKey);

        const attackerId =
          fleet1.targetX !== null && fleet1.targetY !== null ? fleet1.id : fleet2.id;
        const defenderId = attackerId === fleet1.id ? fleet2.id : fleet1.id;

        this.battleService.setBattle({
          fleet1,
          fleet2,
          faction1Name: faction1.name,
          faction1Color: faction1.color,
          faction2Name: faction2.name,
          faction2Color: faction2.color,
          attackerId,
          defenderId,
        });

        saveGame();
        navigateToBattle();

        return true;
      }
    }

    return false;
  }
}

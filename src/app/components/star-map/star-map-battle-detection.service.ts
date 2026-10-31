import { Injectable } from '@angular/core';
import { ResearchService } from '../../services/research.service';
import { BattleService } from '../../services/battle.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { autoResolveBattle } from '../battle-screen/battle/battle-auto-resolve';
import { Battle, BattleOutcome } from '../battle-screen/battle/battle.types';
import { Fleet, StarSystem, Faction } from './star-map.models';
import { areFactionsHostile } from './diplomacy';

/*
 * =========================================================
 * STAR MAP BATTLE DETECTION SERVICE
 * =========================================================
 *
 * Handles collision-based battle detection.
 * Checks if two fleets occupy the same grid cell and
 * whether they are eligible to battle.
 *
 * Only battles with a human side open the interactive battle screen.
 * Battles between two AI factions (possible since AIs can be at war with
 * each other, see docs/diplomacy.md) are auto-resolved on the spot with
 * the same resolver the AI uses for planet assaults, and the outcome is
 * written to the live fleets — the player is never pulled into a fight
 * they are not part of.
 */

@Injectable({ providedIn: 'root' })
export class StarMapBattleDetectionService {
  constructor(
    private battleService: BattleService,
    private researchService: ResearchService,
    private battleOutcomeService: BattleOutcomeService,
    private shipService: ShipService,
    private planetBattleService: PlanetBattleService,
  ) {}

  /*
   * checkForBattles: Iterates through all active fleet pairs
   * and triggers battles for eligible collisions.
   *
   * Battle conditions:
   * - Both fleets must be in the same grid cell
   * - Both fleets must have valid faction references
   * - The factions must be at war (diplomacy.ts areFactionsHostile:
   *   never neutral, never allied, never at peace)
   * - The pair must not have already triggered a battle
   *
   * Returns true if an interactive battle was triggered (the caller
   * navigates away). AI-vs-AI battles are resolved immediately, reported
   * through `onAutoResolved`, and scanning continues.
   */
  checkForBattles(
    fleets: Fleet[],
    factions: Faction[],
    calculateGridCell: (x: number, y: number) => { col: number; row: number },
    isFleetInSystem: (fleet: Fleet, system: StarSystem) => boolean,
    starSystems: StarSystem[],
    enterBattleScreen: () => void,
    triggeredBattles: Set<string>,
    onAutoResolved?: (battle: Battle, outcome: BattleOutcome) => void,
  ): boolean {
    const activeFleets = fleets.filter((f) => !f.destroyed && this.hasLivingShips(f));

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

        if (!areFactionsHostile(faction1, faction2)) {
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

        const battle: Battle = {
          fleet1,
          fleet2,
          faction1Name: faction1.name,
          faction1Color: faction1.color,
          faction2Name: faction2.name,
          faction2Color: faction2.color,
          attackerId,
          defenderId,
          combatBonuses: this.researchService.buildCombatBonuses([faction1, faction2]),
        };

        if (faction1.ai === true && faction2.ai === true) {
          const { outcome } = autoResolveBattle(battle, this.shipService, this.planetBattleService);
          this.battleOutcomeService.applyFleetBattleOutcome({ fleets, factions }, outcome);
          for (const fleet of [fleet1, fleet2]) {
            if (fleet.destroyed) {
              fleet.targetX = null;
              fleet.targetY = null;
            }
          }
          onAutoResolved?.(battle, outcome);
          continue;
        }

        this.battleService.setBattle(battle);

        enterBattleScreen();

        return true;
      }
    }

    return false;
  }

  private hasLivingShips(fleet: Fleet): boolean {
    return (fleet.ships ?? []).some((ship) => ship.destroyed !== true);
  }
}

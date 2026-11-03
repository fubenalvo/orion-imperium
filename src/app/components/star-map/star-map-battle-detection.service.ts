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
import { OpeningGraceService } from './opening-grace';

/* AI empires and outlaws (pirates) fight each other by auto-resolve; only the human opens the battle screen. */
const isComputerSide = (f: Faction): boolean => f.ai === true || f.outlaw === true;
import { SpaceBaseService } from './space-base.service';
import { buildBaseDefenseFleet } from './space-base';
import {
  buildStationDefenseFleet,
  miningStationDefenseFleetId,
  stationDefenseStateFromOutcome,
  stationTurretCount,
} from './station-defense';
import { isStationComplete } from './station-construction';
import { isCombatShipType } from './ai-queries';

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
    private spaceBaseService: SpaceBaseService,
    private openingGrace: OpeningGraceService,
  ) {}

  /*
   * checkBaseBattles: a fleet on a space base's galaxy cell whose faction is
   * at war with the base's owner attacks the base (docs/territory.md#combat).
   * Fleets inside a system view never touch a base (bases keep a distance
   * from stars).
   *
   * Returns true if an interactive battle was triggered.
   */
  checkBaseBattles(
    fleets: Fleet[],
    factions: Faction[],
    enterBattleScreen: () => void,
    triggeredBattles: Set<string>,
    onAutoResolved?: (battle: Battle, outcome: BattleOutcome) => void,
  ): boolean {
    if (this.spaceBaseService.bases.length === 0) return false;
    for (const fleet of fleets) {
      if (fleet.destroyed || fleet.system || !this.hasLivingShips(fleet)) continue;
      const base = this.spaceBaseService.getBaseAtCell(Math.floor(fleet.x), Math.floor(fleet.y));
      if (!base) continue;
      const attacker = factions.find((f) => f.id === fleet.factionId);
      const owner = factions.find((f) => f.id === base.factionId);
      if (!attacker || !owner || !areFactionsHostile(attacker, owner)) continue;
      // Opening grace (opening-grace.ts): no AI attack on the player's base yet; not marked as triggered.
      if (this.openingGrace.spares(attacker, owner)) continue;
      const key = `base${base.id}-${fleet.id}`;
      if (triggeredBattles.has(key)) continue;
      triggeredBattles.add(key);

      const defense = buildBaseDefenseFleet(base, this.stationTurretsOf(owner));
      const battle = this.buildStationBattle(fleet, attacker, owner, defense, base.name, { spaceBaseId: base.id });
      const entered = this.startStationBattle(fleet, battle, attacker, owner, { fleets, factions }, enterBattleScreen, onAutoResolved, (destroyed, outcome) => {
        // The base registry is live state separate from `fleets`: apply here.
        if (destroyed) this.spaceBaseService.destroy(base.id);
        else this.spaceBaseService.setDefenseState(base.id, stationDefenseStateFromOutcome(outcome.defender));
      });
      if (entered) return true;
    }
    return false;
  }

  /*
   * checkMiningStationBattles: a fleet whose faction is at war with a mining
   * station's owner and that is stopped in the station's star system (on the
   * system's galaxy cell, no galaxy target) attacks the station
   * (docs/territory.md#station-defense). The galaxy cell is used, not
   * system-view positions, because AI fleets never get in-system positions;
   * so player and AI follow the same rule in any view. Only fleets with at
   * least one warship trigger it, so colonizer and outpost convoys parked
   * in a contested system are not thrown away on a station. A fleet fights
   * one station at a time; with an interactive battle the next station
   * triggers after the return from the battle screen.
   *
   * Returns true if an interactive battle was triggered.
   */
  checkMiningStationBattles(
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    enterBattleScreen: () => void,
    triggeredBattles: Set<string>,
    onAutoResolved?: (battle: Battle, outcome: BattleOutcome) => void,
  ): boolean {
    for (let systemIndex = 0; systemIndex < starSystems.length; systemIndex++) {
      const system = starSystems[systemIndex];
      const asteroids = system.asteroidBelt?.asteroids ?? [];
      if (!asteroids.some((a) => a.miningStation)) continue;
      const col = Math.floor(system.x);
      const row = Math.floor(system.y);
      for (const fleet of fleets) {
        if (fleet.destroyed || fleet.targetX !== null || fleet.targetY !== null) continue;
        if (Math.floor(fleet.x) !== col || Math.floor(fleet.y) !== row || !this.hasLivingWarship(fleet)) continue;
        const attacker = factions.find((f) => f.id === fleet.factionId);
        if (!attacker) continue;
        for (let asteroidIndex = 0; asteroidIndex < asteroids.length; asteroidIndex++) {
          const asteroid = asteroids[asteroidIndex];
          const station = asteroid.miningStation;
          if (!station) continue;
          const owner = factions.find((f) => f.id === station.factionId);
          if (!owner || !areFactionsHostile(attacker, owner)) continue;
          if (this.openingGrace.spares(attacker, owner)) continue;
          const key = `mine${system.id}:${asteroid.col},${asteroid.row}-${fleet.id}`;
          if (triggeredBattles.has(key)) continue;
          triggeredBattles.add(key);

          const name = `${system.name} Mining Station`;
          const defense = buildStationDefenseFleet({
            fleetId: miningStationDefenseFleetId(systemIndex, asteroidIndex),
            name,
            factionId: owner.id,
            x: system.x,
            y: system.y,
            turretCount: this.stationTurretsOf(owner),
            shieldPoolCurrent: station.shieldPoolCurrent,
            hullCurrent: station.hullCurrent,
            underConstruction: !isStationComplete(station),
          });
          const battle = this.buildStationBattle(fleet, attacker, owner, defense, name, {
            miningStation: { systemId: system.id, col: asteroid.col, row: asteroid.row },
          });
          // The station lives on the live asteroid, so passing the live
          // systems lets applyStationBattleOutcome update it directly.
          if (this.startStationBattle(fleet, battle, attacker, owner, { fleets, factions, starSystems }, enterBattleScreen, onAutoResolved)) {
            return true;
          }
          if (fleet.destroyed) break;
        }
      }
    }
    return false;
  }

  /* Turrets on every station of `owner`: its Turret Research level. */
  stationTurretsOf(owner: Faction): number {
    return stationTurretCount(this.researchService.getModifiers(owner).stationTurrets);
  }

  private buildStationBattle(
    fleet: Fleet,
    attacker: Faction,
    owner: Faction,
    defense: Fleet,
    stationName: string,
    station: Pick<Battle, 'spaceBaseId' | 'miningStation'>,
  ): Battle {
    return {
      fleet1: fleet,
      fleet2: defense,
      faction1Name: attacker.name,
      faction1Color: attacker.color,
      faction2Name: owner.name,
      faction2Color: owner.color,
      attackerId: fleet.id,
      defenderId: defense.id,
      type: 'planet',
      ...station,
      planetName: stationName,
      planetColor: owner.color,
      combatBonuses: this.researchService.buildCombatBonuses([attacker, owner]),
    };
  }

  /*
   * Shared human/AI split of station battles (same as fleet battles): a
   * human side opens the battle screen (the result is applied to the
   * autosave snapshot there); AI-vs-AI is auto-resolved and applied to the
   * live state at once. Returns true if the battle screen was entered.
   */
  private startStationBattle(
    attackerFleet: Fleet,
    battle: Battle,
    attacker: Faction,
    owner: Faction,
    data: { fleets: Fleet[]; factions: Faction[]; starSystems?: StarSystem[] },
    enterBattleScreen: () => void,
    onAutoResolved: ((battle: Battle, outcome: BattleOutcome) => void) | undefined,
    applyLive?: (destroyed: boolean, outcome: BattleOutcome) => void,
  ): boolean {
    if (isComputerSide(attacker) && isComputerSide(owner)) {
      const { outcome } = autoResolveBattle(battle, this.shipService, this.planetBattleService);
      const destroyed = this.battleOutcomeService.applyStationBattleOutcome(data, outcome);
      applyLive?.(destroyed, outcome);
      if (attackerFleet.destroyed) {
        attackerFleet.targetX = null;
        attackerFleet.targetY = null;
      }
      onAutoResolved?.(battle, outcome);
      return false;
    }
    this.battleService.setPlanetBattle(battle);
    enterBattleScreen();
    return true;
  }

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

        // Opening grace (opening-grace.ts): an AI does not attack the player
        // yet; only a contact the player started is fought. Not marked as
        // triggered, so the contact can still become a battle later.
        if (this.openingGrace.blocksFleetBattle(fleet1, faction1, fleet2, faction2)) {
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

        if (isComputerSide(faction1) && isComputerSide(faction2)) {
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

  private hasLivingWarship(fleet: Fleet): boolean {
    return (fleet.ships ?? []).some((ship) => ship.destroyed !== true && isCombatShipType(this.shipService.getShipType(ship.type)));
  }

  private hasLivingShips(fleet: Fleet): boolean {
    return (fleet.ships ?? []).some((ship) => ship.destroyed !== true);
  }
}

import { Injectable } from '@angular/core';
import { Battle, BattleOutcome } from '../components/battle-screen/battle/battle.types';
import { Faction, FactionProduction, Fleet, FleetShip, StarSystem } from '../components/star-map/star-map.models';
import { PlanetOwnershipService } from './planet-ownership.service';
import { ShipService } from './ship.service';
import { recordHostileAct, recordShipLosses } from '../components/star-map/diplomacy';

/*
 * =========================================================
 * BATTLE OUTCOME SERVICE
 * =========================================================
 *
 * Writes a BattleOutcome back onto overworld game data. Shared by the
 * battle screen (which applies the result to the autosave snapshot) and
 * the AI invasion path (which applies auto-resolved results to the live
 * game state), so an outcome has the same consequences no matter how the
 * battle was fought.
 *
 * Planet battles: on attacker victory the planet changes owner through
 * PlanetOwnershipService (the only ownership pathway) and a real garrison
 * fleet is destroyed with it; otherwise the garrison keeps its per-ship
 * damage. The attacker roster is always written back, so a damaged
 * winner stays damaged and a wiped-out attacker is destroyed. The
 * persisted planetary shield pool is updated. The virtual defense fleet
 * (negative id) is never written.
 */
type OutcomeData = {
  starSystems?: StarSystem[];
  fleets?: Fleet[];
  production?: FactionProduction[];
  factions?: Faction[];
};

@Injectable({ providedIn: 'root' })
export class BattleOutcomeService {
  constructor(
    private readonly planetOwnership: PlanetOwnershipService,
    private readonly shipService: ShipService,
  ) {}

  /* Fleet-vs-fleet: both real rosters, wiped fleets destroyed. */
  applyFleetBattleOutcome(data: OutcomeData, outcome: BattleOutcome): void {
    const before = this.fleetValueByFaction(data);
    for (const fleetOutcome of [outcome.attacker, outcome.defender]) {
      const fleet = data.fleets?.find((f) => f.id === fleetOutcome.fleetId);
      if (!fleet) {
        continue;
      }
      fleet.ships = shipsFromOutcome(fleetOutcome.ships);
      if (fleetOutcome.wipedOut) {
        fleet.destroyed = true;
      }
    }
    this.recordWarLosses(data, outcome, before);
  }

  /* Planet battle; returns true when the planet changed owner. */
  applyPlanetBattleOutcome(data: OutcomeData, battle: Battle, outcome: BattleOutcome): boolean {
    const before = this.fleetValueByFaction(data);
    const defenderFleet = battle.attackerId === battle.fleet1.id ? battle.fleet2 : battle.fleet1;
    const garrisonFleetId = defenderFleet.garrisonFleetId;
    const garrisonShipMap = defenderFleet.garrisonShipMap;
    let captured = false;

    for (const system of data.starSystems ?? []) {
      const planet = system.planetsTiles?.find((p) => p.id === battle.planetId);
      if (!planet) {
        continue;
      }
      if (outcome.winnerSide === 'attacker') {
        captured = this.planetOwnership.transferPlanet(data, planet, outcome.attacker.factionId, 'battle_won');
      }
      if (outcome.defender.shieldPoolCurrent !== undefined) {
        planet.shieldPoolCurrent = outcome.defender.shieldPoolCurrent;
      }
      const fleet = data.fleets?.find((f) => f.id === outcome.attacker.fleetId);
      if (fleet) {
        fleet.ships = shipsFromOutcome(outcome.attacker.ships);
        if (outcome.attacker.wipedOut) {
          fleet.destroyed = true;
        }
      }

      // Persist the real garrison fleet's damage and losses. Virtual turret
      // ids below 1000000 are never in garrisonShipMap and are skipped.
      if (garrisonFleetId != null) {
        const garrisonFleet = data.fleets?.find((f) => f.id === garrisonFleetId);
        if (garrisonFleet) {
          if (outcome.winnerSide === 'attacker') {
            // The captured garrison is destroyed along with the planet loss.
            garrisonFleet.destroyed = true;
            for (const ship of garrisonFleet.ships) {
              ship.destroyed = true;
            }
          } else if (garrisonShipMap) {
            for (const shipOutcome of outcome.defender.ships) {
              const originalShipId = garrisonShipMap[shipOutcome.shipId];
              if (originalShipId === undefined) {
                continue;
              }
              const ship = garrisonFleet.ships.find((s) => s.id === originalShipId);
              if (ship) {
                ship.currentHp = Math.max(0, shipOutcome.hp);
                ship.destroyed = shipOutcome.destroyed;
              }
            }
            if (garrisonFleet.ships.length > 0 && garrisonFleet.ships.every((s) => s.destroyed === true)) {
              garrisonFleet.destroyed = true;
            }
          }
        }
      }
      break;
    }
    this.recordWarLosses(data, outcome, before);
    return captured;
  }

  /*
   * War bookkeeping (docs/diplomacy.md): the attack itself (surprise-attack
   * check) and each side's lost ship value, measured as the drop of its
   * living fleet value across the whole application, so garrison losses
   * count too. Virtual turrets are not ships and never count.
   */
  private recordWarLosses(data: OutcomeData, outcome: BattleOutcome, before: Map<string, number>): void {
    const factions = data.factions ?? [];
    const attacker = factions.find((f) => f.id === outcome.attacker.factionId);
    const defender = factions.find((f) => f.id === outcome.defender.factionId);
    if (!attacker || !defender) return;
    recordHostileAct(attacker, defender);
    const after = this.fleetValueByFaction(data);
    for (const [side, enemy, sideOutcome] of [[attacker, defender, outcome.attacker], [defender, attacker, outcome.defender]] as const) {
      const lost = (before.get(side.id) ?? 0) - (after.get(side.id) ?? 0);
      if (lost > 0) recordShipLosses(side, enemy, lost, before.get(side.id) ?? 0, sideOutcome.wipedOut === true);
    }
  }

  /* Credit value of every faction's living fleet ships. */
  private fleetValueByFaction(data: OutcomeData): Map<string, number> {
    const totals = new Map<string, number>();
    for (const fleet of data.fleets ?? []) {
      if (fleet.destroyed) continue;
      let value = 0;
      for (const ship of fleet.ships) {
        if (!ship.destroyed) value += this.shipService.getShipType(ship.type)?.cost ?? 0;
      }
      totals.set(fleet.factionId, (totals.get(fleet.factionId) ?? 0) + value);
    }
    return totals;
  }
}

/* Converts outcome ship records back to the overworld FleetShip shape. */
export function shipsFromOutcome(ships: BattleOutcome['attacker']['ships']): FleetShip[] {
  return ships.map((s) => ({
    id: s.shipId,
    name: s.name,
    type: s.typeId,
    currentHp: s.hp,
    destroyed: s.destroyed,
  }));
}

import { Injectable } from '@angular/core';
import { Fleet, FleetShip, PlanetTile } from '../components/star-map/star-map.models';
import planetData from '../components/star-map/planet-data.json';

/*
 * =========================================================
 * PLANET BATTLE SERVICE
 * =========================================================
 *
 * Creates virtual defense fleets from planet buildings
 * and handles planet battle resolution logic.
 *
 * A planet's defensive buildings are converted into virtual
 * ships that fight alongside any garrisoned fleet during
 * a planet attack battle.
 */

interface BuildingDef {
  id: string;
  name: string;
  role: string;
  type: string;
  attack?: number;
  attackType?: string;
  range?: number;
  weakness?: string;
  shield?: number;
  shieldRegen?: number;
  energyConsumption?: number;
  maintenanceCost?: number;
  size?: number;
  price?: number;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class PlanetBattleService {
  private readonly buildingDefs: BuildingDef[];

  constructor() {
    this.buildingDefs = (planetData as { buildings: BuildingDef[] }).buildings;
  }

  /*
   * createVirtualDefenseFleet: Builds a synthetic Fleet from a planet's
   * defensive buildings and optional garrison fleet.
   *
   * Each defense building becomes one virtual ship with stats from the
   * building definition. Shield buildings contribute to a shared shield pool.
   * Garrison ships are appended to the virtual fleet.
   */
  createVirtualDefenseFleet(planet: PlanetTile, garrisonFleet: Fleet | null): Fleet {
    const virtualShips: FleetShip[] = [];
    let nextShipId = 1000000;
    let totalShield = 0;

    for (const building of planet.buildings) {
      const def = this.buildingDefs.find((b) => b.name === building.name);
      if (!def || def.role !== 'defense') {
        continue;
      }

      if (def.type === 'shield') {
        totalShield += def.shield ?? 0;
        continue;
      }

      virtualShips.push({
        id: nextShipId++,
        name: `${building.name} #${nextShipId - 1000000}`,
        type: def.id,
        currentHp: this.getBuildingHitPoints(def),
        destroyed: false,
      });
    }

    if (garrisonFleet) {
      for (const ship of garrisonFleet.ships) {
        if (ship.destroyed) continue;
        virtualShips.push({
          ...ship,
          id: nextShipId++,
        });
      }
    }

    return {
      id: -planet.id,
      name: `${planet.name} Defenses`,
      factionId: planet.factionId,
      x: 0,
      y: 0,
      targetX: null,
      targetY: null,
      speed: 0,
      system: null,
      ships: virtualShips,
      destroyed: false,
      shieldPool: totalShield,
    } as Fleet & { shieldPool: number };
  }

  /*
   * hasPlanetDefenses: Returns true if a planet has any defensive buildings.
   */
  hasPlanetDefenses(planet: PlanetTile): boolean {
    return planet.buildings.some((b) => {
      const def = this.buildingDefs.find((d) => d.name === b.name);
      return def?.role === 'defense';
    });
  }

  /*
   * getBuildingHitPoints: Returns the effective HP for a defense building.
   * Turrets use attack * 3 as HP, shields have their own shield value.
   */
  private getBuildingHitPoints(def: BuildingDef): number {
    if (def.type === 'shield') {
      return def.shield ?? 0;
    }
    return (def.attack ?? 10) * 3;
  }

  /*
   * getBuildingAttack: Returns the attack value for a defense building.
   */
  getBuildingAttack(buildingName: string): number {
    const def = this.buildingDefs.find((d) => d.name === buildingName);
    return def?.attack ?? 0;
  }

  /*
   * getBuildingDefense: Returns the effective defense for a defense building.
   * Used as flat damage reduction in battle calculations.
   */
  getBuildingDefense(buildingName: string): number {
    const def = this.buildingDefs.find((d) => d.name === buildingName);
    if (!def) return 0;
    if (def.type === 'shield') return 5;
    return Math.floor((def.attack ?? 10) / 5);
  }

  /*
   * getVirtualShipType: Returns virtual ship type info for battle display.
   * Used by the battle screen to render building-type ships.
   */
  getVirtualShipType(typeId: string): {
    id: string;
    name: string;
    hitPoints: number;
    attack: number;
    defense: number;
    attackType: string;
    weakness: string;
  } | null {
    const def = this.buildingDefs.find((d) => d.id === typeId);
    if (!def) return null;

    return {
      id: def.id,
      name: def.name,
      hitPoints: this.getBuildingHitPoints(def),
      attack: def.attack ?? 0,
      defense: this.getBuildingDefense(def.name),
      attackType: def.attackType ?? 'kinetic',
      weakness: def.weakness ?? 'energy',
    };
  }

  /*
   * resolveUninhabitedArrival: Handles fleet arrival at an uninhabited planet.
   * Returns the colonizer ship index if colonization occurs, -1 otherwise.
   */
  resolveUninhabitedArrival(fleet: Fleet): { colonized: boolean; colonizerIndex: number } {
    const colonizerIndex = fleet.ships.findIndex((s) => s.type === 'colonizer' && !s.destroyed);
    return {
      colonized: colonizerIndex >= 0,
      colonizerIndex,
    };
  }
}

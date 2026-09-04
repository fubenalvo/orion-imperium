import { Injectable } from '@angular/core';
import shipData from '../components/star-map/ship-data.json';

export type ProductionBuildingKind = 'spaceship_factory' | 'orbital_factory';

export interface ShipType {
  id: string;
  name: string;
  role: string;
  hitPoints: number;
  shield: number;
  shieldRegen: number;
  attack: number;
  attackType: string;
  weakness: string;
  defense: number;
  speed: number;
  range: number;
  cost: number;
  maintenanceCost: number;
  /*
   * Production metadata. Absent on the seeded JSON; both fields are
   * filled in by `normalizeShipType` with sensible defaults so the
   * rest of the production system can rely on them being present.
   */
  buildTime?: number;
  productionBuilding?: ProductionBuildingKind;
}

const DEFAULT_BUILD_TIME_PER_COST = 0.1;

@Injectable({ providedIn: 'root' })
export class ShipService {
  private readonly shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes.map(
    (t) => ShipService.normalizeShipType(t),
  );

  private readonly shipTypeById: Map<string, ShipType> = new Map(
    this.shipTypes.map((type) => [type.id, type] as [string, ShipType]),
  );

  getShipType(typeId: string): ShipType | undefined {
    return this.shipTypeById.get(typeId);
  }

  getAllShipTypes(): ShipType[] {
    return this.shipTypes;
  }

  getShipTypeMap(): Map<string, { attack: number; shield: number }> {
    const map = new Map<string, { attack: number; shield: number }>();
    for (const type of this.shipTypes) {
      map.set(type.id, { attack: type.attack, shield: type.shield });
    }
    return map;
  }

  /*
   * normalizeShipType: Fills in production defaults for ship types
   * that did not declare them. `buildTime` defaults to `cost / 10`
   * seconds-at-1-factory so the existing `cost` field remains the
   * primary balancing knob. `productionBuilding` defaults to
   * `spaceship_factory`.
   */
  static normalizeShipType(t: ShipType): ShipType {
    return {
      ...t,
      buildTime: t.buildTime ?? Math.max(1, t.cost * DEFAULT_BUILD_TIME_PER_COST),
      productionBuilding: t.productionBuilding ?? 'spaceship_factory',
    };
  }
}

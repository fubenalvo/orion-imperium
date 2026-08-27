import { Injectable } from '@angular/core';
import shipData from '../components/star-map/ship-data.json';

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
}

@Injectable({ providedIn: 'root' })
export class ShipService {
  private readonly shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes;

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
}

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class BattleService {
  private currentBattle: Battle | null = null;

  setBattle(battle: Battle): void {
    this.currentBattle = battle;
  }

  getBattle(): Battle | null {
    return this.currentBattle;
  }

  clearBattle(): void {
    this.currentBattle = null;
  }
}

export interface Fleet {
  id: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  speed: number;
  systemId?: number;
  systemX?: number | null;
  systemY?: number | null;
  systemTargetX?: number | null;
  systemTargetY?: number | null;
  gridCol: number;
  gridRow: number;
  ships: FleetShip[];
}

export interface FleetShip {
  id: number;
  name: string;
  type: string;
}

export interface Battle {
  fleet1: Fleet;
  fleet2: Fleet;
  faction1Name: string;
  faction1Color: string;
  faction2Name: string;
  faction2Color: string;
}

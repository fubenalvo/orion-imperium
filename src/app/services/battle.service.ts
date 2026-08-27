import { Injectable } from '@angular/core';
import { ShipService } from './ship.service';

/*
 * =========================================================
 * BATTLE SERVICE
 * =========================================================
 *
 * Manages turn-based battle simulation between two fleets.
 *
 * Lifecycle:
 * 1. StarMap detects collision -> setBattle()
 * 2. BattleScreen reads battle, calls startBattle() to initialize
 * 3. BattleScreen repeatedly calls processStep() on a timer
 * 4. When battle ends, loser fleet is marked destroyed on back navigation
 * 5. StarMap processes destroyedFleetId on next init
 */

@Injectable({ providedIn: 'root' })
export class BattleService {
  private currentBattle: Battle | null = null;
  private battleState: BattleState | null = null;
  private destroyedFleetId: number | null = null;
  private tickRateMs = 1000;

  constructor(private shipService: ShipService) {}

  setTickRate(ms: number): void {
    this.tickRateMs = ms;
  }

  getTickRate(): number {
    return this.tickRateMs;
  }

  setBattle(battle: Battle): void {
    this.currentBattle = battle;
    this.battleState = null;
    this.destroyedFleetId = null;
  }

  getBattle(): Battle | null {
    return this.currentBattle;
  }

  getBattleState(): BattleState | null {
    return this.battleState;
  }

  getDestroyedFleetId(): number | null {
    return this.destroyedFleetId;
  }

  setDestroyedFleetId(fleetId: number): void {
    this.destroyedFleetId = fleetId;
  }

  /*
   * =========================================================
   * START BATTLE
   * =========================================================
   *
   * Initializes ship HP from ship type definitions and resets
   * destroyed flags. Does not advance the battle.
   */
  startBattle(): void {
    if (!this.currentBattle) {
      throw new Error('No battle to start');
    }

    const shipTypeMap = this.shipService.getShipTypeMap();

    const initShips = (ships: FleetShip[]): FleetShip[] =>
      ships.map((ship) => ({
        ...ship,
        currentHp: this.shipService.getShipType(ship.type)?.hitPoints ?? ship.currentHp ?? 0,
        destroyed: false,
      }));

    const fleet1 = {
      ...this.currentBattle.fleet1,
      ships: initShips(this.currentBattle.fleet1.ships),
    };
    const fleet2 = {
      ...this.currentBattle.fleet2,
      ships: initShips(this.currentBattle.fleet2.ships),
    };

    const battle: Battle = {
      ...this.currentBattle,
      fleet1,
      fleet2,
      attackerId: this.currentBattle.attackerId ?? fleet1.id,
      defenderId: this.currentBattle.defenderId ?? fleet2.id,
    };

    this.currentBattle = battle;

    this.battleState = {
      attackerId: battle.attackerId,
      defenderId: battle.defenderId,
      currentFleetId: battle.attackerId,
      currentShipIndex: 0,
      log: [],
      round: 1,
      isOver: false,
      winnerId: null,
      loserId: null,
    };
  }

  /*
   * =========================================================
   * PROCESS STEP
   * =========================================================
   *
   * Executes one ship attack. The attacker fleet attacks first,
   * then the defender fleet. Within each fleet, ships attack
   * in order, always targeting the weakest non-destroyed ship
   * in the opposing fleet.
   *
   * Returns true if a step was processed, false if battle is over.
   */
  processStep(): boolean {
    if (!this.currentBattle || !this.battleState || this.battleState.isOver) {
      return false;
    }

    const attacker = this.getFleet(this.battleState.currentFleetId);
    const defender = this.getFleet(
      this.battleState.currentFleetId === this.battleState.attackerId
        ? this.battleState.defenderId
        : this.battleState.attackerId,
    );

    if (!attacker || !defender) {
      return false;
    }

    const attackerShips = attacker.ships.filter((s) => !s.destroyed);
    const defenderShips = defender.ships.filter((s) => !s.destroyed);

    if (attackerShips.length === 0 || defenderShips.length === 0) {
      this.endBattle();
      return false;
    }

    const attackingShip = attackerShips[this.battleState.currentShipIndex % attackerShips.length];
    const targetShip = this.getWeakestShip(defender.ships);

    if (!targetShip) {
      this.endBattle();
      return false;
    }

    const shipType = this.shipService.getShipType(attackingShip.type);
    const targetType = this.shipService.getShipType(targetShip.type);

    const baseDamage = shipType?.attack ?? 0;
    const defense = targetType?.defense ?? 0;
    const damage = Math.max(1, baseDamage - defense);

    targetShip.currentHp = (targetShip.currentHp ?? 0) - damage;

    if (targetShip.currentHp <= 0) {
      targetShip.destroyed = true;
      targetShip.currentHp = 0;
    }

    const logEntry: BattleLogEntry = {
      round: this.battleState.round,
      attackerFleetName: attacker.name,
      attackerShipName: attackingShip.name,
      defenderFleetName: defender.name,
      defenderShipName: targetShip.name,
      damage,
      targetDestroyed: targetShip.destroyed ?? false,
    };

    this.battleState.log.push(logEntry);

    this.battleState.currentShipIndex++;

    if (this.battleState.currentShipIndex >= attackerShips.length) {
      this.battleState.currentShipIndex = 0;

      if (this.battleState.currentFleetId === this.battleState.attackerId) {
        this.battleState.currentFleetId = this.battleState.defenderId;
      } else {
        this.battleState.currentFleetId = this.battleState.attackerId;
        this.battleState.round++;
      }
    }

    const remainingAttacker = attacker.ships.filter((s) => !s.destroyed).length;
    const remainingDefender = defender.ships.filter((s) => !s.destroyed).length;

    if (remainingAttacker === 0 || remainingDefender === 0) {
      this.endBattle();
    }

    return true;
  }

  getBattleLog(): BattleLogEntry[] {
    return this.battleState?.log ?? [];
  }

  isBattleOver(): boolean {
    return this.battleState?.isOver ?? true;
  }

  getWinner(): Fleet | null {
    if (!this.battleState?.winnerId || !this.currentBattle) return null;
    return this.currentBattle.fleet1.id === this.battleState.winnerId
      ? this.currentBattle.fleet1
      : this.currentBattle.fleet2;
  }

  getLoser(): Fleet | null {
    if (!this.battleState?.loserId || !this.currentBattle) return null;
    return this.currentBattle.fleet1.id === this.battleState.loserId
      ? this.currentBattle.fleet1
      : this.currentBattle.fleet2;
  }

  getCurrentRound(): number {
    return this.battleState?.round ?? 1;
  }

  clearBattle(): void {
    this.currentBattle = null;
    this.battleState = null;
    this.destroyedFleetId = null;
  }

  private getFleet(fleetId: number): { id: number; name: string; ships: FleetShip[] } | null {
    if (!this.currentBattle) return null;
    if (this.currentBattle.fleet1.id === fleetId) return this.currentBattle.fleet1;
    if (this.currentBattle.fleet2.id === fleetId) return this.currentBattle.fleet2;
    return null;
  }

  private getWeakestShip(ships: FleetShip[]): FleetShip | null {
    const alive = ships.filter((s) => !s.destroyed);
    if (alive.length === 0) return null;
    return alive.reduce((weakest, ship) => {
      const shipType = this.shipService.getShipType(ship.type);
      const weakestType = this.shipService.getShipType(weakest.type);
      const shipHp = ship.currentHp ?? 0;
      const weakestHp = weakest.currentHp ?? 0;
      if (shipHp < weakestHp) return ship;
      if (shipHp === weakestHp && (shipType?.hitPoints ?? 0) < (weakestType?.hitPoints ?? 0))
        return ship;
      return weakest;
    }, alive[0]);
  }

  private endBattle(): void {
    if (!this.currentBattle || !this.battleState) return;

    const fleet1Alive = this.currentBattle.fleet1.ships.filter((s) => !s.destroyed).length;
    const fleet2Alive = this.currentBattle.fleet2.ships.filter((s) => !s.destroyed).length;

    if (fleet1Alive === 0 && fleet2Alive === 0) {
      this.battleState.winnerId = this.battleState.attackerId;
      this.battleState.loserId = this.battleState.defenderId;
    } else if (fleet1Alive === 0) {
      this.battleState.winnerId = this.currentBattle.fleet2.id;
      this.battleState.loserId = this.currentBattle.fleet1.id;
    } else if (fleet2Alive === 0) {
      this.battleState.winnerId = this.currentBattle.fleet1.id;
      this.battleState.loserId = this.currentBattle.fleet2.id;
    } else {
      this.battleState.winnerId = this.battleState.attackerId;
      this.battleState.loserId = this.battleState.defenderId;
    }

    this.battleState.isOver = true;
  }
}

/*
 * =========================================================
 * DATA MODELS
 * =========================================================
 *
 * Fleet: Represents a group of ships moving on the map or inside a star system.
 * FleetShip: Individual ship entry within a fleet with combat state.
 * Battle: Temporary container for two fleets and their faction display info.
 * BattleState: Runtime simulation state for the active battle.
 * BattleLogEntry: Single attack event in the battle log.
 */

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
  gridCol?: number;
  gridRow?: number;
  ships: FleetShip[];
  destroyed?: boolean;
}

export interface FleetShip {
  id: number;
  name: string;
  type: string;
  currentHp?: number;
  destroyed?: boolean;
}

export interface Battle {
  fleet1: Fleet;
  fleet2: Fleet;
  faction1Name: string;
  faction1Color: string;
  faction2Name: string;
  faction2Color: string;
  attackerId: number;
  defenderId: number;
}

export interface BattleState {
  attackerId: number;
  defenderId: number;
  currentFleetId: number;
  currentShipIndex: number;
  log: BattleLogEntry[];
  round: number;
  isOver: boolean;
  winnerId: number | null;
  loserId: number | null;
}

export interface BattleLogEntry {
  round: number;
  attackerFleetName: string;
  attackerShipName: string;
  defenderFleetName: string;
  defenderShipName: string;
  damage: number;
  targetDestroyed: boolean;
}

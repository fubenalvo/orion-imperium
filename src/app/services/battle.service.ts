import { Injectable } from '@angular/core';
import { Battle, BattleOutcome } from '../components/battle-screen/battle/battle.types';

export type { Battle, BattleOutcome } from '../components/battle-screen/battle/battle.types';

/*
 * =========================================================
 * BATTLE SERVICE (TRANSPORT BOUNDARY)
 * =========================================================
 *
 * The only channel between the outside game and the battle minigame.
 *
 * Input:  StarMap calls setBattle() / setPlanetBattle() (fleet-vs-fleet
 *         collision or defended-planet arrival), saves, then navigates
 *         to /battle. The Battle object is passed on, untouched, to the
 *         minigame, which deep-clones the fleets it needs.
 *
 * Output: The minigame writes its BattleOutcome via setBattleResult();
 *         the loser fleet id is reported via setDestroyedFleetId() when
 *         a real fleet was wiped out. StarMap applies both on its next
 *         /star-map navigation.
 *
 * No simulation logic lives here anymore — the minigame is fully
 * self-contained in components/battle-screen/battle/.
 */

@Injectable({ providedIn: 'root' })
export class BattleService {
  private currentBattle: Battle | null = null;
  private destroyedFleetId: number | null = null;
  private battleResult: BattleOutcome | null = null;

  setBattle(battle: Battle): void {
    this.currentBattle = battle;
    this.destroyedFleetId = null;
    this.battleResult = null;
  }

  setPlanetBattle(battle: Battle): void {
    this.currentBattle = { ...battle, type: 'planet' };
    this.destroyedFleetId = null;
    this.battleResult = null;
  }

  getBattle(): Battle | null {
    return this.currentBattle;
  }

  setBattleResult(result: BattleOutcome): void {
    this.battleResult = result;
  }

  getBattleResult(): BattleOutcome | null {
    return this.battleResult;
  }

  getDestroyedFleetId(): number | null {
    return this.destroyedFleetId;
  }

  setDestroyedFleetId(fleetId: number): void {
    this.destroyedFleetId = fleetId;
  }

  clearBattle(): void {
    this.currentBattle = null;
    this.destroyedFleetId = null;
    this.battleResult = null;
  }
}

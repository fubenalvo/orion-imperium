import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
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
let BattleService = class BattleService {
    currentBattle = null;
    destroyedFleetId = null;
    battleResult = null;
    setBattle(battle) {
        this.currentBattle = battle;
        this.destroyedFleetId = null;
        this.battleResult = null;
    }
    setPlanetBattle(battle) {
        this.currentBattle = { ...battle, type: 'planet' };
        this.destroyedFleetId = null;
        this.battleResult = null;
    }
    getBattle() {
        return this.currentBattle;
    }
    setBattleResult(result) {
        this.battleResult = result;
    }
    getBattleResult() {
        return this.battleResult;
    }
    getDestroyedFleetId() {
        return this.destroyedFleetId;
    }
    setDestroyedFleetId(fleetId) {
        this.destroyedFleetId = fleetId;
    }
    clearBattle() {
        this.currentBattle = null;
        this.destroyedFleetId = null;
        this.battleResult = null;
    }
};
BattleService = __decorate([
    Injectable({ providedIn: 'root' })
], BattleService);
export { BattleService };

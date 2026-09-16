import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
let BattleFleetPanelComponent = class BattleFleetPanelComponent {
    fleetName = '';
    factionColor = '#3586e5';
    roster = [];
    isActive = false;
    result = null;
    get aliveCount() {
        return this.roster.filter((s) => !this.isDestroyed(s)).length;
    }
    isDestroyed(ship) {
        return ship.destroyed === true || ship.alive === false;
    }
    hullFraction(ship) {
        const max = ship.maxHp ?? 0;
        if (max <= 0) {
            // BattleShipOutcome has no maxHp; fall back to a 0..1 fraction of
            // the ship's current HP so damaged survivors still show a partial bar.
            const hp = ship.hp ?? 0;
            return hp > 0 ? 1 : 0;
        }
        return Math.max(0, (ship.hp ?? 0) / max);
    }
    /* Shield fraction for the per-ship shield bar. BattleOutcome ships have
     * no shield fields (shield is battle-local only), so they render no
     * shield bar — the result view intentionally omits shield state. */
    shieldFraction(ship) {
        const max = ship.maxShield ?? 0;
        if (max <= 0) {
            return 0;
        }
        return Math.max(0, (ship.shield ?? 0) / max);
    }
};
__decorate([
    Input()
], BattleFleetPanelComponent.prototype, "fleetName", void 0);
__decorate([
    Input()
], BattleFleetPanelComponent.prototype, "factionColor", void 0);
__decorate([
    Input()
], BattleFleetPanelComponent.prototype, "roster", void 0);
__decorate([
    Input()
], BattleFleetPanelComponent.prototype, "isActive", void 0);
__decorate([
    Input()
], BattleFleetPanelComponent.prototype, "result", void 0);
BattleFleetPanelComponent = __decorate([
    Component({
        selector: 'app-battle-fleet-panel',
        standalone: true,
        imports: [NgClass],
        templateUrl: './battle-fleet-panel.component.html',
        styleUrl: './battle-fleet-panel.component.scss',
    })
], BattleFleetPanelComponent);
export { BattleFleetPanelComponent };

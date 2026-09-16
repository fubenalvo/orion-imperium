import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { BATTLE_CELL_SIZE_VW } from '../battle/battle.types';
import { BattlePlanetComponent } from '../battle-planet/battle-planet.component';
/*
 * =========================================================
 * BATTLE GRID VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of the battle screen: renders the 18x7 tactical
 * grid, the stacked ship units, movement highlights, and attack effects
 * (projectile / impact / explosion). All rules live in the battle
 * services; this component only maps state to pixels and forwards clicks.
 *
 * Stack positions are driven by the real-time game loop (BattleGameLoopService),
 * which sets x/y every frame. No CSS transitions — direct style binding
 * to the current vw position.
 */
let BattleGridComponent = class BattleGridComponent {
    stacks = [];
    selectedStackId = null;
    moveCells = [];
    attackTargetIds = [];
    moveToAttackTargetIds = [];
    carrierBoostTargetIds = [];
    effect = null;
    canSelect = true;
    /* Faction colors per side, passed from the orchestrator. Used only for
     * subtle per-stack tinting (background wash, count text, hull bar) so each
     * stack reads as belonging to its faction without fighting the existing
     * state-driven highlights (selected / attack-target / etc.). */
    attackerColor = '#ff5252';
    defenderColor = '#4caf50';
    /*
     * Planet battles only: a separate visual target and its shared-shield
     * fraction. Both are null/0 in fleet battles, so the grid stays clean.
     */
    planet = null;
    planetShieldFraction = 0;
    onStackClick = () => { };
    onCellClick = () => { };
    /* vw offset of a stack cell centre, relative to the grid container.
     * Uses real-time x/y set by the game loop, with col/row used only
     * for initial side-offset alignment. */
    stackVw(stack) {
        const offset = (stack.size - 1) / 2;
        const visualCol = stack.side === 'attacker' ? stack.col + offset : stack.col - offset;
        return {
            x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW + (stack.x ?? 0),
            y: (stack.row - 0.5) * BATTLE_CELL_SIZE_VW + (stack.y ?? 0),
        };
    }
    cellVw(cell) {
        return {
            x: (cell.col - 0.5) * BATTLE_CELL_SIZE_VW,
            y: (cell.row - 0.5) * BATTLE_CELL_SIZE_VW,
        };
    }
    cellKey(cell) {
        return `${cell.col}-${cell.row}`;
    }
    /* Aggregate stack hull fraction for the HP bar. */
    hullFraction(stack) {
        const total = stack.ships.reduce((sum, s) => sum + s.maxHp, 0);
        if (total <= 0) {
            return 0;
        }
        return stack.ships.reduce((sum, s) => sum + s.hp, 0) / total;
    }
    /* Aggregate stack shield fraction for the shield bar. Pure read of
     * BattleShip.shield/maxShield — no combat logic duplicated here. */
    shieldFraction(stack) {
        const total = stack.ships.reduce((sum, s) => sum + (s.maxShield ?? 0), 0);
        if (total <= 0) {
            return 0;
        }
        return stack.ships.reduce((sum, s) => sum + (s.shield ?? 0), 0) / total;
    }
    /* True while an attack is landing on this stack — used to flash the
     * shield bar so shield absorption is visibly distinct from hull HP. */
    isShieldHit(stackId) {
        return !!this.effect &&
            (this.effect.phase === 'impact' || this.effect.phase === 'explosion') &&
            this.effect.targetStackId === stackId;
    }
    isMoveCell(col, row) {
        return this.moveCells.some((c) => c.col === col && c.row === row);
    }
    isAttackTarget(stackId) {
        return this.attackTargetIds.includes(stackId);
    }
    isMoveToAttackTarget(stackId) {
        return this.moveToAttackTargetIds.includes(stackId);
    }
    isCarrierBoostTarget(stackId) {
        return this.carrierBoostTargetIds.includes(stackId);
    }
    stackSize(stack) {
        return stack.size;
    }
    /* Attack-available indicator: bottom-right corner of the stack sprite.
     * Visible when the stack can attack — not currently moving or firing. */
    hasAttackDot(stack) {
        return !stack.moving && !stack.firing;
    }
    /* Faction color for a stack — used to tint per-stack accents (count text,
     * hull bar, background wash) so each stack reads as belonging to its
     * faction without fighting the state-driven highlights. */
    factionColor(stack) {
        return stack.side === 'attacker' ? this.attackerColor : this.defenderColor;
    }
    stackClasses(stack) {
        const classes = ['stack', stack.typeId, 'stack-' + stack.ships.length];
        if (stack.stackId === this.selectedStackId) {
            classes.push('selected');
        }
        if (stack.moving) {
            classes.push('moving');
        }
        if (stack.firing) {
            classes.push('firing');
        }
        if (this.isAttackTarget(stack.stackId)) {
            classes.push('attack-target');
        }
        if (this.isMoveToAttackTarget(stack.stackId)) {
            classes.push('move-to-attack-target');
        }
        return classes;
    }
    /* Projectile line geometry (same pattern as the fleet movement trails). */
    getProjectileLine() {
        if (!this.effect || this.effect.phase !== 'projectile') {
            return null;
        }
        const from = this.effect.from;
        const to = this.effect.to;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.0001) {
            return null;
        }
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return { x: from.x, y: from.y, length, angleDeg };
    }
    onStackClickHandler(event, stackId) {
        if (this.canSelect) {
            event.stopPropagation();
            this.onStackClick(stackId);
        }
    }
    onGridClickHandler(event) {
        if (!this.canSelect) {
            return;
        }
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        const vwUnit = window.innerWidth / 100;
        const vwX = (event.clientX - rect.left) / vwUnit;
        const vwY = (event.clientY - rect.top) / vwUnit;
        const col = Math.floor(vwX / BATTLE_CELL_SIZE_VW) + 1;
        const row = Math.floor(vwY / BATTLE_CELL_SIZE_VW) + 1;
        this.onCellClick(col, row);
    }
};
__decorate([
    Input()
], BattleGridComponent.prototype, "stacks", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "selectedStackId", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "moveCells", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "attackTargetIds", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "moveToAttackTargetIds", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "carrierBoostTargetIds", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "effect", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "canSelect", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "attackerColor", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "defenderColor", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "planet", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "planetShieldFraction", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "onStackClick", void 0);
__decorate([
    Input()
], BattleGridComponent.prototype, "onCellClick", void 0);
BattleGridComponent = __decorate([
    Component({
        selector: 'app-battle-grid',
        standalone: true,
        imports: [NgClass, BattlePlanetComponent],
        templateUrl: './battle-grid.component.html',
        styleUrl: './battle-grid.component.scss',
    })
], BattleGridComponent);
export { BattleGridComponent };

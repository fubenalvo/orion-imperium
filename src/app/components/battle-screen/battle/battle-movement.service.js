import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { BATTLE_CELL_SIZE_VW } from './battle.types';
import { isInBounds, isPathClear, linePath, findBestMoveToAttackCell, isInRange } from './battle-grid';
/*
 * =========================================================
 * BATTLE MINIGAME — MOVEMENT SERVICE
 * =========================================================
 *
 * Real-time, speed-based movement. One command sets a stack's vw target;
 * the game loop (BattleScreenComponent) calls updateStackPositions() every
 * frame to interpolate the stack toward its target at `speed` vw/s.
 *
 * No AP costs, no moveRange limits. The only gate is the animation busy
 * lock during attacks — stacks can move while attacks are animating on
 * other stacks.
 *
 * Movement direction uses straight-line paths (orthogonal + diagonal),
 * matching the star-map fleet movement pattern. Each intermediate cell
 * must be in bounds and unoccupied — no pathfinding through obstacles.
 */
let BattleMovementService = class BattleMovementService {
    anim;
    combat;
    constructor(anim, combat) {
        this.anim = anim;
        this.combat = combat;
    }
    async moveStack(state, stackId, targetCol, targetRow) {
        const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
        if (!stack || state.winner || stack.moving || stack.immobile) {
            return false;
        }
        const from = { col: stack.col, row: stack.row };
        const target = { col: targetCol, row: targetRow };
        if (!isInBounds(target.col, target.row) || target.col === stack.col && target.row === stack.row) {
            return false;
        }
        const path = linePath(from, target);
        if (!path) {
            return false;
        }
        if (!isPathClear(state, path, stack)) {
            return false;
        }
        // Set target to the visual centre of the destination cell.
        const targetVw = cellCenterVw(target, stack);
        stack.targetX = targetVw.x;
        stack.targetY = targetVw.y;
        stack.moving = true;
        return true;
    }
    /*
     * Move to attack: find the best cell within attack range of the target,
     * then move there. When the stack arrives, the caller (player clicks or
     * AI tick) handles the attack separately.
     */
    async moveToAttack(state, stackId, targetStackId) {
        const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
        const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
        if (!stack || !target || state.winner || stack.moving || stack.immobile) {
            return false;
        }
        if (stack.side === target.side) {
            return false;
        }
        const from = { col: stack.col, row: stack.row };
        const to = { col: target.col, row: target.row };
        if (isInRange(from, to, stack.attackRange)) {
            return this.combat.attackStack(state, stackId, targetStackId);
        }
        const bestCell = findBestMoveToAttackCell(state, stack, target);
        if (!bestCell) {
            return false;
        }
        return this.moveStack(state, stackId, bestCell.col, bestCell.row);
    }
};
BattleMovementService = __decorate([
    Injectable({ providedIn: 'root' })
], BattleMovementService);
export { BattleMovementService };
/* Compute the vw centre of a cell adjusted for the stack's visual offset. */
function cellCenterVw(cell, stack) {
    const offset = (stack.size - 1) / 2;
    const visualCol = stack.side === 'attacker' ? cell.col + offset : cell.col - offset;
    return {
        x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW,
        y: (cell.row - 0.5) * BATTLE_CELL_SIZE_VW,
    };
}

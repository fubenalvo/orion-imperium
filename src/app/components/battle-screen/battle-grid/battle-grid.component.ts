import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  BattleAttackEffect,
  BattleSide,
  BattleStack,
  GridCell,
} from '../battle/battle.types';
import { ANIMATION_MS, BATTLE_CELL_SIZE_VW } from '../battle/battle.types';

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
 * Stack cells are absolutely positioned and CSS-transitioned, so moving
 * a stack (which commits the target cell when the animation starts)
 * produces the visual tween for free.
 */

@Component({
  selector: 'app-battle-grid',
  standalone: true,
  imports: [NgClass],
  templateUrl: './battle-grid.component.html',
  styleUrl: './battle-grid.component.scss',
})
export class BattleGridComponent {
  @Input() stacks: BattleStack[] = [];
  @Input() selectedStackId: string | null = null;
  @Input() moveCells: GridCell[] = [];
  @Input() attackTargetIds: string[] = [];
  @Input() moveToAttackTargetIds: string[] = [];
  @Input() effect: BattleAttackEffect | null = null;
  @Input() canSelect = true;
  @Input() activeSide: BattleSide = 'attacker';

  @Input() onStackClick: (stackId: string) => void = () => {};
  @Input() onCellClick: (col: number, row: number) => void = () => {};

  /* vw offset of a stack cell centre, relative to the grid container. */
  stackVw(stack: BattleStack): { x: number; y: number } {
    const offset = (stack.size - 1) / 2;
    const visualCol = stack.side === 'attacker' ? stack.col + offset : stack.col - offset;
    return {
      x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW,
      y: (stack.row - 0.5) * BATTLE_CELL_SIZE_VW,
    };
  }

  cellVw(cell: GridCell): { x: number; y: number } {
    return {
      x: (cell.col - 0.5) * BATTLE_CELL_SIZE_VW,
      y: (cell.row - 0.5) * BATTLE_CELL_SIZE_VW,
    };
  }

  cellKey(cell: GridCell): string {
    return `${cell.col}-${cell.row}`;
  }

  /* Per-stack move tween duration, matched to the animation busy lock. */
  stackTransition(stack: BattleStack): string {
    const ms = Math.max(ANIMATION_MS.move, stack.moveMs);
    return `left ${ms}ms linear, top ${ms}ms linear`;
  }

  /* Aggregate stack hull fraction for the HP bar. */
  hullFraction(stack: BattleStack): number {
    const total = stack.ships.reduce((sum, s) => sum + s.maxHp, 0);
    if (total <= 0) {
      return 0;
    }
    return stack.ships.reduce((sum, s) => sum + s.hp, 0) / total;
  }

  isMoveCell(col: number, row: number): boolean {
    return this.moveCells.some((c) => c.col === col && c.row === row);
  }

  isAttackTarget(stackId: string): boolean {
    return this.attackTargetIds.includes(stackId);
  }

  isMoveToAttackTarget(stackId: string): boolean {
    return this.moveToAttackTargetIds.includes(stackId);
  }

  stackSize(stack: BattleStack): number {
    return stack.size;
  }

  stackClasses(stack: BattleStack): string[] {
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
    // Spent: already moved or attacked this turn, and animation has finished
    // Only apply to active side's own stacks (not enemy targets)
    if (
      stack.side === this.activeSide &&
      (stack.cellsMovedThisTurn > 0 || stack.attackedThisTurn) &&
      !stack.moving &&
      !stack.firing
    ) {
      classes.push('spent');
    }
    return classes;
  }

  /* Projectile line geometry (same pattern as the fleet movement trails). */
  getProjectileLine(): { x: number; y: number; length: number; angleDeg: number } | null {
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

  onStackClickHandler(event: MouseEvent, stackId: string): void {
    if (this.canSelect) {
      event.stopPropagation();
      this.onStackClick(stackId);
    }
  }

  onGridClickHandler(event: MouseEvent): void {
    if (!this.canSelect) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const vwUnit = window.innerWidth / 100;
    const vwX = (event.clientX - rect.left) / vwUnit;
    const vwY = (event.clientY - rect.top) / vwUnit;
    const col = Math.floor(vwX / BATTLE_CELL_SIZE_VW) + 1;
    const row = Math.floor(vwY / BATTLE_CELL_SIZE_VW) + 1;
    this.onCellClick(col, row);
  }
}

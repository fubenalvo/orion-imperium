import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  BattleAttackEffect,
  BattlePlanetVisual,
  BattleProjectile,
  BattleSide,
  BattleStack,
  GridCell,
} from '../battle/battle.types';
import {
  BATTLE_CELL_WIDTH_VW,
  BATTLE_CELL_HEIGHT_VW,
  BATTLE_FIELD_HEIGHT_VW,
  BATTLE_FIELD_WIDTH_VW,
  BATTLE_GRID_COLUMNS,
  BATTLE_GRID_ROWS,
  PROJECTILE_LENGTH_VW,
} from '../battle/battle.types';

/* Must stay consistent with --z-units / --z-selected / --z-bolts in the
 * SCSS: base + 2 * 16 rows + 1 = 43 < selected (50) < bolts (60). */
const STACK_Z_BASE = 10;
const STACK_Z_SELECTED = 50;
import { BattlePlanetComponent } from '../battle-planet/battle-planet.component';

/*
 * =========================================================
 * BATTLE GRID VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of the battle screen: renders the tactical grid
 * (BATTLE_GRID_COLUMNS x BATTLE_GRID_ROWS), the stacked ship units, the
 * selected stack's range ring and order marker, laser bolts in flight, and
 * impact / explosion effects. All rules live in the battle
 * services; this component only maps state to pixels and forwards clicks.
 *
 * Stack positions are driven by the real-time game loop (BattleGameLoopService),
 * which sets x/y every frame. No CSS transitions — direct style binding
 * to the current vw position.
 */

@Component({
  selector: 'app-battle-grid',
  standalone: true,
  imports: [NgClass, BattlePlanetComponent],
  templateUrl: './battle-grid.component.html',
  styleUrl: './battle-grid.component.scss',
})
export class BattleGridComponent {
  @Input() stacks: BattleStack[] = [];
  @Input() selectedStackId: string | null = null;
  @Input() moveCells: GridCell[] = [];
  @Input() attackTargetIds: string[] = [];
  /* The selected stack's manual attack target (crosshair marker). */
  @Input() orderTargetId: string | null = null;
  /* Effective reach of the selected stack, drawn as a circle. */
  @Input() rangeRing: { x: number; y: number; radiusVw: number } | null = null;
  @Input() carrierBoostTargetIds: string[] = [];
  /* Sides the player controls. Drives the friend/foe markers, which are
   * deliberately independent of faction colors (two factions can have
   * near-identical colors, and the player may be attacker or defender). */
  @Input() playerSides: BattleSide[] = [];
  @Input() effects: BattleAttackEffect[] = [];
  @Input() projectiles: BattleProjectile[] = [];
  @Input() canSelect = true;
  @Input() connectionLine: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  @Input() attackConnectionLine: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  /* Faction colors per side, passed from the orchestrator. Used only for
   * subtle per-stack tinting (background wash, count text, hull bar) so each
   * stack reads as belonging to its faction without fighting the existing
   * state-driven highlights (selected / attack-target / etc.). */
  @Input() attackerColor = '#ff5252';
  @Input() defenderColor = '#4caf50';
  /*
   * Planet battles only: a separate visual target and its shared-shield
   * fraction. Both are null/0 in fleet battles, so the grid stays clean.
   */
  @Input() planet: BattlePlanetVisual | null = null;
  @Input() planetShieldFraction = 0;

  @Input() onStackClick: (stackId: string) => void = () => {};
  @Input() onCellClick: (col: number, row: number) => void = () => {};

  /* CSS length for `fieldUnits` battlefield units. The simulation's "vw"
   * coordinates are field units; they render through --u so the field can
   * scale to its container (see battle-grid.component.scss). */
  u(fieldUnits: number): string {
    return `calc(var(--u) * ${fieldUnits})`;
  }

  /* Stacking order of a ship (see the layer table in the SCSS). Lower rows
   * draw over upper rows; a moving ship draws over a stationary one in the
   * same row; the selected ship is above all ships but never above bolts
   * or effects. */
  stackZIndex(stack: BattleStack): number {
    if (stack.stackId === this.selectedStackId) {
      return STACK_Z_SELECTED;
    }
    return STACK_Z_BASE + stack.row * 2 + (stack.moving ? 1 : 0);
  }

  /* vw position of a stack. stack.x/y are absolute VW coordinates maintained
   * by the game loop (initialized from stackCenterVw). col/row are used for
   * movement, pathing, occupancy, and click cells; combat range uses x/y. */
  stackVw(stack: BattleStack): { x: number; y: number } {
    return {
      x: stack.x ?? 0,
      y: stack.y ?? 0,
    };
  }

  cellVw(cell: GridCell): { x: number; y: number } {
    return {
      x: (cell.col - 0.5) * BATTLE_CELL_WIDTH_VW,
      y: (cell.row - 0.5) * BATTLE_CELL_HEIGHT_VW,
    };
  }

  cellKey(cell: GridCell): string {
    return `${cell.col}-${cell.row}`;
  }

  /* Aggregate stack hull fraction for the HP bar. */
  hullFraction(stack: BattleStack): number {
    const total = stack.ships.reduce((sum, s) => sum + s.maxHp, 0);
    if (total <= 0) {
      return 0;
    }
    return stack.ships.reduce((sum, s) => sum + s.hp, 0) / total;
  }

  /* Aggregate stack shield fraction for the shield bar. Pure read of
   * BattleShip.shield/maxShield — no combat logic duplicated here. */
  shieldFraction(stack: BattleStack): number {
    const total = stack.ships.reduce((sum, s) => sum + (s.maxShield ?? 0), 0);
    if (total <= 0) {
      return 0;
    }
    return stack.ships.reduce((sum, s) => sum + (s.shield ?? 0), 0) / total;
  }

  /* True while an attack is landing on this stack — used to flash the
   * shield bar so shield absorption is visibly distinct from hull HP. */
  isShieldHit(stackId: string): boolean {
    return this.effects.some(e =>
      (e.phase === 'impact' || e.phase === 'explosion') &&
      e.targetStackId === stackId
    );
  }

  isMoveCell(col: number, row: number): boolean {
    return this.moveCells.some((c) => c.col === col && c.row === row);
  }

  isAttackTarget(stackId: string): boolean {
    return this.attackTargetIds.includes(stackId);
  }

  isCarrierBoostTarget(stackId: string): boolean {
    return this.carrierBoostTargetIds.includes(stackId);
  }

  stackSize(stack: BattleStack): number {
    return stack.size;
  }

  /* Attack-available indicator: bottom-right corner of the stack sprite.
   * Visible when the stack can attack and is not currently firing. */
  hasAttackDot(stack: BattleStack): boolean {
    return !stack.firing;
  }

  /* Faction color for a stack — used to tint per-stack accents (count text,
   * hull bar, background wash) so each stack reads as belonging to its
   * faction without fighting the state-driven highlights. */
  factionColor(stack: BattleStack): string {
    return stack.side === 'attacker' ? this.attackerColor : this.defenderColor;
  }

  isFriendly(stack: BattleStack): boolean {
    return this.playerSides.includes(stack.side);
  }

  stackAriaLabel(stack: BattleStack): string {
    return `${this.isFriendly(stack) ? 'Friendly' : 'Enemy'} ${stack.typeName}`;
  }

  stackClasses(stack: BattleStack): string[] {
    const classes = ['stack', stack.typeId, 'stack-' + stack.ships.length];
    classes.push(this.isFriendly(stack) ? 'stack--friendly' : 'stack--enemy');
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
    if (stack.stackId === this.orderTargetId) {
      classes.push('order-target');
    }
    return classes;
  }

  /*
   * Laser bolt geometry: a fixed-length segment ending at the bolt tip.
   * Right after launch the bolt is shorter than PROJECTILE_LENGTH_VW so it
   * never appears to start behind the firing ship.
   */
  getBolts(): { id: number; x: number; y: number; length: number; angleDeg: number; color: string }[] {
    return this.projectiles.map((p) => {
      const length = Math.min(PROJECTILE_LENGTH_VW, p.traveledVw);
      return {
        id: p.id,
        x: p.x - p.dirX * length,
        y: p.y - p.dirY * length,
        length,
        angleDeg: (Math.atan2(p.dirY, p.dirX) * 180) / Math.PI,
        color: p.color,
      };
    });
  }

  /* Impact/explosion effects for rendering. */
  getImpacts(): { x: number; y: number; isExplosion: boolean }[] {
    const impacts: { x: number; y: number; isExplosion: boolean }[] = [];
    for (const effect of this.effects) {
      if (effect.phase === 'impact' || effect.phase === 'explosion') {
        impacts.push({ x: effect.to.x, y: effect.to.y, isExplosion: effect.phase === 'explosion' });
      }
    }
    return impacts;
  }

  /* Connection line from selected stack to its target/destination. */
  getConnectionLine(): { x: number; y: number; length: number; angleDeg: number } | null {
    if (!this.connectionLine) {
      return null;
    }
    const from = this.connectionLine.from;
    const to = this.connectionLine.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.01) {
      return null;
    }
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    return { x: from.x, y: from.y, length, angleDeg };
  }

  /* Connection line from selected stack to its attack target. */
  getAttackConnectionLine(): { x: number; y: number; length: number; angleDeg: number } | null {
    if (!this.attackConnectionLine) {
      return null;
    }
    const from = this.attackConnectionLine.from;
    const to = this.attackConnectionLine.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.01) {
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
    const cell = clientPointToCell(event.clientX, event.clientY, target.getBoundingClientRect());
    if (cell) {
      this.onCellClick(cell.col, cell.row);
    }
  }
}

/*
 * Maps a pointer position to the grid cell under it, using only the grid's
 * rendered rect. The battlefield is scaled to fit its container, so the
 * conversion must not assume any fixed px-per-unit (the old version divided
 * by window.innerWidth / 100 and broke as soon as the field was not exactly
 * 72vw wide). Returns null outside the field.
 */
export function clientPointToCell(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): GridCell | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const fieldX = ((clientX - rect.left) / rect.width) * BATTLE_FIELD_WIDTH_VW;
  const fieldY = ((clientY - rect.top) / rect.height) * BATTLE_FIELD_HEIGHT_VW;
  const col = Math.floor(fieldX / BATTLE_CELL_WIDTH_VW) + 1;
  const row = Math.floor(fieldY / BATTLE_CELL_HEIGHT_VW) + 1;
  if (col < 1 || row < 1 || col > BATTLE_GRID_COLUMNS || row > BATTLE_GRID_ROWS) {
    return null;
  }
  return { col, row };
}

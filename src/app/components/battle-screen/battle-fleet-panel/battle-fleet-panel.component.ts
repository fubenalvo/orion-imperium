import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { BattleShipOutcome } from '../battle/battle.types';

/*
 * =========================================================
 * BATTLE FLEET PANEL COMPONENT
 * =========================================================
 *
 * Presentational roster panel for one side: every ship row with an HP
 * bar, the alive count, and the victory / destroyed result state.
 *
 * Two roster shapes are supported:
 *  - BattleShip[]  (live battle state, has alive/maxHp + shield)
 *  - BattleShipOutcome[] (final BattleOutcome, has destroyed/hp)
 * Both are structurally compatible with this template because the
 * panel only reads `name`, `hp`, and a "dead" flag. BattleOutcome
 * ships carry no shield fields, so the shield bar renders empty for
 * them — shield is battle-local only.
 */

/* Every field except name/hp is optional so both BattleShip and
 * BattleShipOutcome structurally match: a row that simply omits
 * shield/maxHp renders those bars as empty rather than crashing. */
interface ShipRow {
  shipId?: number;
  name: string;
  typeId?: string;
  hp: number;
  maxHp?: number;
  shield?: number;
  maxShield?: number;
  shieldRegen?: number;
  destroyed?: boolean;
  alive?: boolean;
}

@Component({
  selector: 'app-battle-fleet-panel',
  standalone: true,
  imports: [NgClass],
  templateUrl: './battle-fleet-panel.component.html',
  styleUrl: './battle-fleet-panel.component.scss',
})
export class BattleFleetPanelComponent {
  @Input() fleetName = '';
  @Input() factionColor = '#3586e5';
  @Input() roster: ShipRow[] = [];
  @Input() isActive = false;
  @Input() result: 'winner' | 'loser' | null = null;

  get aliveCount(): number {
    return this.roster.filter((s) => !this.isDestroyed(s)).length;
  }

  isDestroyed(ship: ShipRow): boolean {
    return ship.destroyed === true || ship.alive === false;
  }

  hullFraction(ship: ShipRow): number {
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
  shieldFraction(ship: ShipRow): number {
    const max = ship.maxShield ?? 0;
    if (max <= 0) {
      return 0;
    }
    return Math.max(0, (ship.shield ?? 0) / max);
  }
}
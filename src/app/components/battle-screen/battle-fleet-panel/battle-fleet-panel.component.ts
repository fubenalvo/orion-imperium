import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { BattleShip } from '../battle/battle.types';

/*
 * =========================================================
 * BATTLE FLEET PANEL COMPONENT
 * =========================================================
 *
 * Presentational roster panel for one side: every ship row with an HP
 * bar, the alive count, and the victory / destroyed result state.
 */

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
  @Input() roster: BattleShip[] = [];
  @Input() isActive = false;
  @Input() result: 'winner' | 'loser' | null = null;

  get aliveCount(): number {
    return this.roster.filter((s) => s.alive).length;
  }

  hullFraction(ship: BattleShip): number {
    return ship.maxHp > 0 ? Math.max(0, ship.hp / ship.maxHp) : 0;
  }
}

import { Component, Input } from '@angular/core';
import { BattlePlanetVisual } from '../battle/battle.types';

/*
 * =========================================================
 * BATTLE PLANET COMPONENT
 * =========================================================
 *
 * Presentational planet marker for planet battles. This is deliberately
 * separate from BattleStack: the planet is scenery and must never be
 * targetable, selectable, or part of combat state. The component only
 * renders the planet body, its name, and a bubble representing the shared
 * planetary shield fraction.
 */

@Component({
  selector: 'app-battle-planet',
  standalone: true,
  templateUrl: './battle-planet.component.html',
  styleUrl: './battle-planet.component.scss',
})
export class BattlePlanetComponent {
  @Input() planet: BattlePlanetVisual | null = null;
  @Input() shieldFraction = 0;

  shieldOpacity(): number {
    return 0.25 + Math.max(0, Math.min(1, this.shieldFraction)) * 0.55;
  }

  shieldScale(): number {
    return 1 + Math.max(0, Math.min(1, this.shieldFraction)) * 0.08;
  }
}

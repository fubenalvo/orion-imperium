import { Component, DestroyRef, inject, signal } from '@angular/core';
import { GameTimeService } from '../../services/game-time.service';
import { BattleTimeService } from '../battle-screen/battle/battle-time.service';

/*
 * Whole-app "rotate your device" screen for touch devices held upright.
 *
 * The game is designed for landscape only, so the gate sits at the app root
 * (app.html) above every route: main menu, New Game setup, star map and
 * battle. It covers the screen while the viewport is portrait AND the
 * primary pointer is coarse (phones, tablets). Desktop browsers are never
 * blocked, even in a narrow window, because they have a fine pointer.
 *
 * Entering portrait pauses the star map clock and the battle clock, so
 * nothing happens unseen behind the gate. Rotating back does not resume:
 * the player resumes on purpose, as after a window blur.
 */
const PORTRAIT_TOUCH_QUERY = '(orientation: portrait) and (pointer: coarse)';

@Component({
  selector: 'app-orientation-gate',
  templateUrl: './orientation-gate.component.html',
  styleUrl: './orientation-gate.component.scss',
})
export class OrientationGateComponent {
  private readonly gameTime = inject(GameTimeService);
  private readonly battleTime = inject(BattleTimeService);

  readonly blocked = signal(false);

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(PORTRAIT_TOUCH_QUERY);
    const apply = (matches: boolean): void => {
      this.blocked.set(matches);
      if (matches) {
        this.gameTime.pause();
        this.battleTime.pause();
      }
    };
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    apply(query.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
}

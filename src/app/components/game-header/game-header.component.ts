import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface GameHeaderSpeedOption {
  value: number;
  label: string;
}

/*
 * =========================================================
 * GAME HEADER
 * =========================================================
 *
 * The single top bar used by every in-game screen (star map, system view,
 * planet view, battle). It owns the layout and look of the bar; screens only
 * supply data and handle the emitted events.
 *
 * Layout: a three-column grid
 *   [start: back button + title/subtitle] [center: time controls] [end: status + menu]
 * The start column may shrink to zero (the title truncates with an ellipsis);
 * the end column never shrinks below its content. This is what guarantees that
 * no two elements overlap: when space runs out the title gives way, instead
 * of controls sliding over each other. Narrow-viewport rules in the SCSS then
 * hide secondary labels (back text, subtitle) to keep room for the controls.
 *
 * Content projection:
 *   [gameHeaderSubtitle]  small line under the title (e.g. battle matchup)
 *   [gameHeaderTimeExtra] extra buttons after the speed buttons (e.g. AUTO)
 *   default               status area before the menu button (currencies,
 *                         ship stock, planet shield, ...)
 *
 * Sizing: everything scales from --game-header-h (global token in styles.scss)
 * through the --gh-u unit set here, which projected content can also use.
 *
 * Constraint: do not add `container-type`, `transform`, `filter` or
 * `backdrop-filter` to the header or its host. Those turn it into the
 * containing block for `position: fixed` descendants, and the currency /
 * ship-stock detail overlays rendered inside the header rely on being fixed
 * to the viewport.
 *
 * The component is purely presentational: time state lives in
 * GameTimeService (star map) or BattleTimeService (battle).
 */
@Component({
  selector: 'app-game-header',
  standalone: true,
  templateUrl: './game-header.component.html',
  styleUrl: './game-header.component.scss',
})
export class GameHeaderComponent {
  @Input() title = '';
  /** 'alert' colours the title for hostile contexts (battle). */
  @Input() tone: 'default' | 'alert' = 'default';
  /** Destination name for the back button ("STAR MAP"). No button when null. */
  @Input() backLabel: string | null = null;

  /** Speed buttons shown after the pause button. No time controls when empty. */
  @Input() speedOptions: readonly GameHeaderSpeedOption[] = [];
  @Input() activeSpeed: number | null = null;
  @Input() isPaused = false;

  @Input() showMenuButton = false;

  @Output() back = new EventEmitter<void>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() setSpeed = new EventEmitter<number>();
  @Output() openMenu = new EventEmitter<void>();
}

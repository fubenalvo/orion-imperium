import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AiDebugSnapshot } from '../enemy-debug.service';

/*
 * Developer-facing AI debug panel (toggle: F9 on the star map). Purely
 * presentational: StarMap passes snapshots built by EnemyDebugService about
 * once per second while the panel is open; nothing is computed here.
 */
@Component({
  selector: 'app-ai-debug-panel',
  standalone: true,
  templateUrl: './ai-debug-panel.component.html',
  styleUrl: './ai-debug-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiDebugPanelComponent {
  @Input() snapshots: AiDebugSnapshot[] = [];
  @Input() consoleEnabled = false;
  @Output() close = new EventEmitter<void>();
  @Output() toggleConsole = new EventEmitter<void>();
}

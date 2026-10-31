import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AnomalyEventVm } from '../anomaly.service';

/*
 * Exploration event dialog (docs/exploration-anomalies.md). Stateless apart
 * from the double-click guard: the event, its choices, costs, consequences
 * and the reason a choice is unavailable all arrive in the view model built
 * by AnomalyService; the choice goes back to StarMap, which resolves it.
 *
 * Every choice resolves the event, so after the first click all buttons stay
 * disabled until StarMap hands over a new event (or an error for the same
 * one). The game is paused while the dialog is open, and it has no close
 * button: every event offers a free option to walk away.
 */
@Component({
  selector: 'app-star-map-anomaly-event',
  standalone: true,
  templateUrl: './star-map-anomaly-event.component.html',
  styleUrl: './star-map-anomaly-event.component.scss',
})
export class StarMapAnomalyEventComponent implements OnChanges {
  @Input({ required: true }) vm!: AnomalyEventVm;
  @Input() error: string | null = null;
  @Output() choose = new EventEmitter<string>();

  /* The choice already sent for the current event (blocks repeated clicks). */
  chosen: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    // A new view model (next event, or the same event re-built after a
    // refused choice) re-enables the buttons.
    if (changes['vm'] || changes['error']) this.chosen = null;
  }

  pick(choiceId: string): void {
    if (this.chosen) return;
    const choice = this.vm.choices.find((c) => c.id === choiceId);
    if (!choice || choice.disabled) return;
    this.chosen = choiceId;
    this.choose.emit(choiceId);
  }

  chipClass(): string {
    switch (this.vm.category) {
      case 'Hostile':
        return 'ui-chip ui-chip--danger';
      case 'Encounter':
        return 'ui-chip ui-chip--warning';
      default:
        return 'ui-chip';
    }
  }
}

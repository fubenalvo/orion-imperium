import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

export interface CampaignMessageChoiceVm {
  id: string;
  label: string;
  consequences: string;
  disabled: boolean;
}

export interface CampaignMessageVm {
  eventId: string;
  speakerName: string;
  speakerColor: string;
  title: string;
  text: string;
  /* Empty: the message only needs to be acknowledged (CONTINUE). */
  choices: CampaignMessageChoiceVm[];
}

/*
 * Story message dialog of a campaign mission (docs/campaign-design.md §12):
 * a speaker, a title, one to three sentences and 0–3 choices. Presentational;
 * StarMap builds the view model from CampaignService.pendingEvent, pauses
 * the game while it is open and applies the answer. Like the anomaly
 * dialog it has no close button: the message must be answered.
 *
 * Emits the choice id, or null for CONTINUE on a message without choices.
 */
@Component({
  selector: 'app-star-map-campaign-message',
  standalone: true,
  templateUrl: './star-map-campaign-message.component.html',
  styleUrl: './star-map-campaign-message.component.scss',
})
export class StarMapCampaignMessageComponent implements OnChanges {
  @Input({ required: true }) vm!: CampaignMessageVm;
  @Output() choose = new EventEmitter<string | null>();

  /* True once an answer was sent for the current message (blocks repeated clicks). */
  answered = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vm']) this.answered = false;
  }

  pick(choiceId: string | null): void {
    if (this.answered) return;
    if (choiceId !== null && this.vm.choices.find((c) => c.id === choiceId)?.disabled !== false) return;
    this.answered = true;
    this.choose.emit(choiceId);
  }
}

import { Component, Input } from '@angular/core';
import { ObjectiveView } from '../../../campaign/campaign.service';

/*
 * Objective tracker of a campaign mission (docs/campaign-design.md §12):
 * main objectives first, optional ones below, done and failed ones dimmed.
 * Presentational and collapsible; StarMap refreshes the list once per
 * economy tick (CampaignService.objectiveViews), never per frame.
 */
@Component({
  selector: 'app-star-map-campaign-objectives',
  standalone: true,
  templateUrl: './star-map-campaign-objectives.component.html',
  styleUrl: './star-map-campaign-objectives.component.scss',
})
export class StarMapCampaignObjectivesComponent {
  @Input({ required: true }) missionTitle = '';
  @Input({ required: true }) objectives: ObjectiveView[] = [];

  collapsed = false;

  get main(): ObjectiveView[] {
    return this.objectives.filter((o) => !o.optional);
  }

  get optional(): ObjectiveView[] {
    return this.objectives.filter((o) => o.optional);
  }

  get openCount(): number {
    return this.main.filter((o) => o.status === 'active').length;
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
  }

  marker(objective: ObjectiveView): string {
    if (objective.status === 'done') return '✓';
    if (objective.status === 'failed') return '✕';
    return '◆';
  }
}

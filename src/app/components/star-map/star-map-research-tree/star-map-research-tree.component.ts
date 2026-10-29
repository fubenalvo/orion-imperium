import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Faction, Technology } from '../star-map.models';
import { ResearchService, TechnologyStatus } from '../../../services/research.service';

@Component({
  selector: 'app-star-map-research-tree',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-research-tree.component.html',
  styleUrl: './star-map-research-tree.component.scss',
})
export class StarMapResearchTreeComponent {
  @Input() faction: Faction | null = null;
  /*
   * Current research income (points per second, from the economy
   * breakdown the HUD shows). Used only for the time estimate: research is
   * an instant purchase once enough points have accumulated.
   */
  @Input() researchPerSecond = 0;
  @Output() close = new EventEmitter<void>();
  @Output() researched = new EventEmitter<void>();

  constructor(public researchService: ResearchService) {}

  getAllTechnologies(): Technology[] {
    return this.researchService.getAllTechnologies();
  }

  getStatus(technologyId: string): TechnologyStatus {
    if (!this.faction) return 'locked';
    return this.researchService.getStatus(this.faction, technologyId);
  }

  canResearch(technologyId: string): boolean {
    if (!this.faction) return false;
    return this.researchService.canResearch(this.faction, technologyId);
  }

  getResearchPoints(): number {
    return this.faction?.currencies['research'] ?? 0;
  }

  onClose(): void {
    this.close.emit();
  }

  onResearch(technologyId: string): void {
    if (!this.faction) return;
    const result = this.researchService.researchTechnology(this.faction, technologyId);
    if (result.ok) {
      this.researched.emit();
    }
  }

  getStatusLabel(status: TechnologyStatus): string {
    switch (status) {
      case 'researched':
        return 'RESEARCHED';
      case 'available':
        return 'AVAILABLE';
      case 'locked':
        return 'LOCKED';
      default:
        return 'UNKNOWN';
    }
  }

  /* Current cost for this faction (grows with technologies already researched). */
  getCost(tech: Technology): number {
    return this.researchService.getResearchCost(this.faction, tech);
  }

  getPrerequisiteNames(tech: Technology): string[] {
    return tech.prerequisites
      .map((id) => this.researchService.getTechnology(id)?.name ?? id)
      .filter(Boolean);
  }

  /* Mechanical effects (from the data the rules read), separate from flavour text. */
  getEffects(tech: Technology): string[] {
    return this.researchService.describeEffects(tech);
  }

  getDependentNames(tech: Technology): string[] {
    return this.researchService.getDependents(tech.id).map((t) => t.name);
  }

  /*
   * Why the technology cannot be researched now, or an empty string. For
   * missing points it includes the time to reach the cost at the current
   * research income.
   */
  getBlockerText(tech: Technology): string {
    if (!this.faction) return '';
    const blocker = this.researchService.getResearchBlocker(this.faction, tech.id);
    if (blocker === 'prerequisites_missing') {
      const missing = tech.prerequisites
        .filter((id) => !this.researchService.isResearched(this.faction!, id))
        .map((id) => this.researchService.getTechnology(id)?.name ?? id);
      return `Requires ${missing.join(', ')}`;
    }
    if (blocker === 'insufficient_research') {
      const shortfall = Math.ceil(this.getCost(tech) - this.getResearchPoints());
      if (this.researchPerSecond <= 0) {
        return `Need ${shortfall} more RP (no research income — build research labs)`;
      }
      return `Need ${shortfall} more RP (~${this.formatDuration(shortfall / this.researchPerSecond)} at ${this.researchPerSecond.toFixed(1)} RP/s)`;
    }
    return '';
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${Math.ceil(seconds - minutes * 60)} s`;
  }
}

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

  getPrerequisiteNames(tech: Technology): string[] {
    return tech.prerequisites
      .map((id) => this.researchService.getTechnology(id)?.name ?? id)
      .filter(Boolean);
  }
}

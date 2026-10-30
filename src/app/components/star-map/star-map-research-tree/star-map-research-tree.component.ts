import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Faction, Technology } from '../star-map.models';
import { ResearchService, TechnologyStatus } from '../../../services/research.service';

export type ResearchFilter = 'all' | TechnologyStatus;

/* One row of the research screen: technologies at the same prerequisite depth. */
export interface ResearchTierGroup {
  tier: number;
  technologies: Technology[];
  researched: number;
}

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

  /* Presentation-only filter; it never changes what can be researched. */
  filter: ResearchFilter = 'all';
  readonly filters: { id: ResearchFilter; label: string }[] = [
    { id: 'all', label: 'ALL' },
    { id: 'available', label: 'AVAILABLE' },
    { id: 'researched', label: 'RESEARCHED' },
    { id: 'locked', label: 'LOCKED' },
  ];

  /*
   * Tier = prerequisite depth (no prerequisites = tier 1, otherwise one more
   * than the deepest prerequisite). Derived from the technology data rather
   * than stored on it, so the screen stays in sync with any data change. The
   * technology list is static for a session, so the map is built once.
   */
  private tierById: Map<string, number> | null = null;

  constructor(public researchService: ResearchService) {}

  getTier(tech: Technology): number {
    if (!this.tierById) {
      const byId = new Map(this.getAllTechnologies().map((t) => [t.id, t] as const));
      const tiers = new Map<string, number>();
      const resolve = (t: Technology, visiting: Set<string>): number => {
        const known = tiers.get(t.id);
        if (known !== undefined) return known;
        // A cycle in the data would recurse forever; treat it as tier 1.
        if (visiting.has(t.id)) return 1;
        visiting.add(t.id);
        let depth = 1;
        for (const id of t.prerequisites) {
          const prerequisite = byId.get(id);
          if (prerequisite) depth = Math.max(depth, resolve(prerequisite, visiting) + 1);
        }
        visiting.delete(t.id);
        tiers.set(t.id, depth);
        return depth;
      };
      for (const t of byId.values()) resolve(t, new Set());
      this.tierById = tiers;
    }
    return this.tierById.get(tech.id) ?? 1;
  }

  /* Technologies grouped by tier, honoring the active filter (empty tiers dropped). */
  getTierGroups(): ResearchTierGroup[] {
    const groups = new Map<number, ResearchTierGroup>();
    for (const tech of this.getAllTechnologies()) {
      const tier = this.getTier(tech);
      let group = groups.get(tier);
      if (!group) {
        group = { tier, technologies: [], researched: 0 };
        groups.set(tier, group);
      }
      const status = this.getStatus(tech.id);
      if (status === 'researched') group.researched++;
      if (this.filter === 'all' || this.filter === status) group.technologies.push(tech);
    }
    return [...groups.values()]
      .filter((group) => group.technologies.length > 0)
      .sort((a, b) => a.tier - b.tier);
  }

  getResearchedCount(): number {
    return this.getAllTechnologies().filter((tech) => this.getStatus(tech.id) === 'researched').length;
  }

  countByStatus(filter: ResearchFilter): number {
    if (filter === 'all') return this.getAllTechnologies().length;
    return this.getAllTechnologies().filter((tech) => this.getStatus(tech.id) === filter).length;
  }

  /* Share of the current cost already banked (0..1), for the affordability meter. */
  getAffordFraction(tech: Technology): number {
    const cost = this.getCost(tech);
    if (cost <= 0) return 1;
    return Math.min(1, this.getResearchPoints() / cost);
  }

  toRoman(value: number): string {
    const numerals: [number, string][] = [
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let rest = value;
    let result = '';
    for (const [amount, numeral] of numerals) {
      while (rest >= amount) {
        result += numeral;
        rest -= amount;
      }
    }
    return result;
  }

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

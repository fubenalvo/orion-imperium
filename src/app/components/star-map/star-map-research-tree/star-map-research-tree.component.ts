import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Faction, Technology, TechnologyBonusType } from '../star-map.models';
import { ResearchService, TechnologyStatus } from '../../../services/research.service';
import { ShipService, ShipType } from '../../../services/ship.service';
import { HullRoleComponent } from '../hull-role/hull-role.component';
import { isCombatShipType } from '../ai-queries';

export type ResearchFilter = 'all' | TechnologyStatus;

/* One column of the tech board: technologies at the same prerequisite depth. */
export interface ResearchTierGroup {
  tier: number;
  technologies: Technology[];
  researched: number;
}

/*
 * Icon family of a technology on the tech board. Not stored in the data:
 * derived from what the technology unlocks or boosts (techCategory), so new
 * technologies get a sensible icon without extra fields.
 */
export type TechCategory =
  | 'ships'
  | 'weapons'
  | 'shields'
  | 'radar'
  | 'energy'
  | 'science'
  | 'industry'
  | 'colony'
  | 'station'
  | 'stellar';

const BONUS_CATEGORY: Record<TechnologyBonusType, TechCategory> = {
  sensorRange: 'radar',
  energyOutput: 'energy',
  researchOutput: 'science',
  rawOutput: 'industry',
  buildingUpkeep: 'industry',
  shipUpkeep: 'ships',
  shipBuildSpeed: 'ships',
  populationGrowth: 'colony',
  shipAttack: 'weapons',
  shipShield: 'shields',
  stationTurrets: 'station',
  stationRepair: 'station',
};

/* Building unlocks by building id; anything unlisted counts as 'colony'. */
const BUILDING_CATEGORY: Record<string, TechCategory> = {
  solar_array: 'energy',
  fusion_plant: 'energy',
  small_research_lab: 'science',
  research_lab: 'science',
  hospital: 'science',
  school: 'science',
  mining_complex: 'industry',
  trading_post: 'industry',
  bank: 'industry',
  planetary_shield: 'shields',
  laser_turret: 'weapons',
  missile_turret: 'weapons',
  spaceship_factory: 'ships',
  spaceport: 'ships',
};

/* One mechanical effect line in the detail console, with its icon. */
export interface TechEffectRow {
  icon: TechCategory;
  text: string;
}

@Component({
  selector: 'app-star-map-research-tree',
  standalone: true,
  imports: [CommonModule, HullRoleComponent],
  templateUrl: './star-map-research-tree.component.html',
  styleUrl: './star-map-research-tree.component.scss',
})
export class StarMapResearchTreeComponent {
  @Input() faction: Faction | null = null;
  /*
   * Current research income (points per second, from the economy
   * breakdown the HUD shows). Used only for the time estimate: research is
   * an instant purchase once enough points and credits have accumulated.
   */
  @Input() researchPerSecond = 0;
  /* Current net credit income, for the same estimate on the credit part of the price. */
  @Input() creditsPerSecond = 0;
  @Output() close = new EventEmitter<void>();
  @Output() researched = new EventEmitter<void>();

  /* Presentation-only filter: technologies that do not match are dimmed on
     the board (the tree keeps its shape); it never changes what can be researched. */
  filter: ResearchFilter = 'all';

  /* Technology shown in the detail console; null = pick a sensible default (see `selected`). */
  selectedId: string | null = null;

  private readonly categoryById = new Map<string, TechCategory>();
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

  constructor(
    public researchService: ResearchService,
    private readonly shipService: ShipService,
  ) {}

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

  /* Board columns: every technology grouped by tier (the filter only dims, see matchesFilter). */
  getTierGroups(): ResearchTierGroup[] {
    const groups = new Map<number, ResearchTierGroup>();
    for (const tech of this.getAllTechnologies()) {
      const tier = this.getTier(tech);
      let group = groups.get(tier);
      if (!group) {
        group = { tier, technologies: [], researched: 0 };
        groups.set(tier, group);
      }
      if (this.getStatus(tech.id) === 'researched') group.researched++;
      group.technologies.push(tech);
    }
    return [...groups.values()].sort((a, b) => a.tier - b.tier);
  }

  matchesFilter(tech: Technology): boolean {
    return this.filter === 'all' || this.getStatus(tech.id) === this.filter;
  }

  getCategory(tech: Technology): TechCategory {
    let category = this.categoryById.get(tech.id);
    if (!category) {
      category = this.techCategory(tech);
      this.categoryById.set(tech.id, category);
    }
    return category;
  }

  /* Ship unlocks win (the hull is the headline), then the first bonus, then the first building. */
  private techCategory(tech: Technology): TechCategory {
    if (tech.unlocksShips.includes('swarm_constructor')) return 'stellar';
    if (tech.unlocksShips.length > 0) return 'ships';
    const bonus = tech.bonuses?.[0];
    if (bonus) return BONUS_CATEGORY[bonus.type];
    const building = tech.unlocksBuildings[0];
    return (building && BUILDING_CATEGORY[building]) || 'colony';
  }

  /*
   * Technology in the detail console. Without an explicit choice: the first
   * technology the player can research right now, else the first available
   * one, else the first not yet researched, so opening the screen lands on
   * the next decision.
   */
  get selected(): Technology | null {
    const all = this.getAllTechnologies();
    const chosen = this.selectedId ? all.find((t) => t.id === this.selectedId) : undefined;
    return (
      chosen ??
      all.find((t) => this.canResearch(t.id)) ??
      all.find((t) => this.getStatus(t.id) === 'available') ??
      all.find((t) => this.getStatus(t.id) !== 'researched') ??
      all[0] ??
      null
    );
  }

  select(tech: Technology): void {
    this.selectedId = tech.id;
  }

  /* Board highlight: direct prerequisites and direct follow-ups of the selected technology. */
  isPrerequisiteOfSelected(tech: Technology): boolean {
    return this.selected?.prerequisites.includes(tech.id) ?? false;
  }

  isDependentOfSelected(tech: Technology): boolean {
    const selected = this.selected;
    return !!selected && tech.prerequisites.includes(selected.id);
  }

  getPrerequisites(tech: Technology): Technology[] {
    return tech.prerequisites
      .map((id) => this.researchService.getTechnology(id))
      .filter((t): t is Technology => !!t);
  }

  getDependents(tech: Technology): Technology[] {
    return this.researchService.getDependents(tech.id);
  }

  /*
   * Effect lines with icons. describeEffects lists ship unlocks, building
   * unlocks, then one line per bonus, in that order; the icons follow the
   * same order.
   */
  getEffectRows(tech: Technology): TechEffectRow[] {
    const icons: TechCategory[] = [];
    if (tech.unlocksShips.length > 0)
      icons.push(tech.unlocksShips.includes('swarm_constructor') ? 'stellar' : 'ships');
    if (tech.unlocksBuildings.length > 0) icons.push('colony');
    for (const bonus of tech.bonuses ?? []) icons.push(BONUS_CATEGORY[bonus.type]);
    return this.getEffects(tech).map((text, i) => ({
      icon: icons[i] ?? this.getCategory(tech),
      text,
    }));
  }

  getResearchedCount(): number {
    return this.getAllTechnologies().filter((tech) => this.getStatus(tech.id) === 'researched')
      .length;
  }

  countByStatus(filter: ResearchFilter): number {
    if (filter === 'all') return this.getAllTechnologies().length;
    return this.getAllTechnologies().filter((tech) => this.getStatus(tech.id) === filter).length;
  }

  /*
   * Share of the current price already banked (0..1), for the affordability
   * meter: the scarcer of the two resources decides.
   */
  getAffordFraction(tech: Technology): number {
    const cost = this.getCost(tech);
    const credits = this.getCreditCost(tech);
    const rp = cost <= 0 ? 1 : Math.min(1, this.getResearchPoints() / cost);
    const cr = credits <= 0 ? 1 : Math.min(1, this.getCredits() / credits);
    return Math.min(rp, cr);
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

  getCredits(): number {
    return this.faction?.currencies['credits'] ?? 0;
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

  /* Current research-point cost for this faction (grows with technologies already researched). */
  getCost(tech: Technology): number {
    return this.researchService.getResearchCost(this.faction, tech);
  }

  /* Credit part of the current price. */
  getCreditCost(tech: Technology): number {
    return this.researchService.getResearchCreditCost(this.faction, tech);
  }

  /* Price already paid for a researched technology is not tracked; show its base price. */
  getBaseCreditCost(tech: Technology): number {
    return this.researchService.getResearchCreditCost(null, tech);
  }

  /* Mechanical effects (from the data the rules read), separate from flavour text. */
  getEffects(tech: Technology): string[] {
    return this.researchService.describeEffects(tech);
  }

  /* Combat hulls this technology unlocks, shown with their hull-class role. */
  getUnlockedCombatShips(tech: Technology): ShipType[] {
    return tech.unlocksShips
      .map((id) => this.shipService.getShipType(id))
      .filter((t): t is ShipType => isCombatShipType(t));
  }

  /*
   * Why the technology cannot be researched now, or an empty string. Every
   * missing resource is listed (research points and credits), each with the
   * time to reach it at the current income.
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
    if (blocker !== 'insufficient_research' && blocker !== 'insufficient_credits') return '';
    const parts: string[] = [];
    const rpShortfall = Math.ceil(this.getCost(tech) - this.getResearchPoints());
    if (rpShortfall > 0) {
      parts.push(
        this.researchPerSecond <= 0
          ? `Need ${rpShortfall} more RP (no research income — build research labs)`
          : `Need ${rpShortfall} more RP (~${this.formatDuration(rpShortfall / this.researchPerSecond)} at ${this.researchPerSecond.toFixed(1)} RP/s)`,
      );
    }
    const crShortfall = Math.ceil(this.getCreditCost(tech) - this.getCredits());
    if (crShortfall > 0) {
      parts.push(
        this.creditsPerSecond <= 0
          ? `Need ${crShortfall} more credits (no net credit income)`
          : `Need ${crShortfall} more credits (~${this.formatDuration(crShortfall / this.creditsPerSecond)} at current income)`,
      );
    }
    return parts.join(' · ');
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${Math.ceil(seconds - minutes * 60)} s`;
  }
}

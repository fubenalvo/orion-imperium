import { Injectable } from '@angular/core';
import { Faction, Technology, TechnologyBonus, TechnologyBonusType } from '../components/star-map/star-map.models';
import researchTreeData from '../components/star-map/research-tree.json';
import shipData from '../components/star-map/ship-data.json';
import planetData from '../components/star-map/planet-data.json';

export type TechnologyStatus = 'researched' | 'available' | 'locked';

/*
 * Aggregated mechanical effect of a faction's researched technologies.
 * Multipliers are 1 when nothing applies. Derived from
 * `faction.researchedTechnologies` on demand and never stored, so effects
 * apply exactly once, follow the researched list immediately, and are
 * recomputed identically after loading a save.
 */
export interface TechModifiers {
  /* Extra sensor range in grid cells. */
  sensorRange: number;
  /* Multiplier on building energy production. */
  energyOutput: number;
  /* Multiplier on building research production. */
  researchOutput: number;
  /* Multiplier on building raw-material production (not the population trickle). */
  rawOutput: number;
  /* Multiplier on building upkeep. */
  buildingUpkeep: number;
  /* Multiplier on fleet and reserve ship upkeep. */
  shipUpkeep: number;
  /* Multiplier on factory production power (ship build speed). */
  shipBuildSpeed: number;
  /* Multiplier on natural population growth. */
  populationGrowth: number;
  /* Battle attack / shield multipliers per ship type (absent → 1). */
  shipAttack: Record<string, number>;
  shipShield: Record<string, number>;
}

export const NEUTRAL_TECH_MODIFIERS: Readonly<TechModifiers> = Object.freeze({
  sensorRange: 0,
  energyOutput: 1,
  researchOutput: 1,
  rawOutput: 1,
  buildingUpkeep: 1,
  shipUpkeep: 1,
  shipBuildSpeed: 1,
  populationGrowth: 1,
  shipAttack: Object.freeze({}) as Record<string, number>,
  shipShield: Object.freeze({}) as Record<string, number>,
});

/* Reductions can never remove more than this share of a cost. */
const MIN_COST_MULTIPLIER = 0.25;

/*
 * Research cost scaling: every technology a faction has researched beyond
 * the starting ones raises the cost of its next technologies by this share
 * of their base cost. Early choices stay cheap while a research leader pays
 * more for the late tree, which damps runaway research advantages and keeps
 * the full tree a long-session goal (docs/research.md).
 */
export const RESEARCH_COST_GROWTH_PER_TECH = 0.02;

export interface ResearchResult {
  ok: boolean;
  reason?: 'already_researched' | 'prerequisites_missing' | 'insufficient_research';
  technology?: Technology;
}

export interface ValidationError {
  type: 'duplicate_id' | 'missing_prerequisite' | 'self_reference' | 'circular_dependency' | 'invalid_ship' | 'invalid_building';
  technologyId: string;
  message: string;
}

/*
 * =========================================================
 * RESEARCH SERVICE
 * =========================================================
 *
 * Data-driven research system. Technologies are defined in
 * research-tree.json and referenced by ID from ships and buildings.
 *
 * Technologies have two kinds of effect: unlocks (`unlocksShips`,
 * `unlocksBuildings`, checked by isShipUnlocked / isBuildingUnlocked) and
 * bonuses (`bonuses`, aggregated by getModifiers and read by the systems
 * that own the mechanic: EconomyService, ProductionService, sensors, AI
 * intel, battle setup). See docs/research.md for the effect inventory.
 *
 * The service does NOT:
 *  - modify ship or building definitions
 *  - store derived effects (getModifiers recomputes them from the
 *    researched list; the result is cached by that list)
 *  - persist state (save/load is handled by StarMapData)
 */

const STARTING_TECHNOLOGY_IDS = [
  'basic_engineering',
  'basic_science',
  'basic_industry',
  'basic_power',
];

@Injectable({ providedIn: 'root' })
export class ResearchService {
  private readonly technologies: Technology[];
  private readonly technologyMap: Map<string, Technology>;
  private readonly validationErrors: ValidationError[];
  private readonly modifierCache = new Map<string, TechModifiers>();

  constructor() {
    const data = researchTreeData as { technologies: Technology[] };
    this.technologies = data.technologies;
    this.technologyMap = new Map(this.technologies.map((t) => [t.id, t]));
    this.validationErrors = this.validateTechnologies();
  }

  getAllTechnologies(): Technology[] {
    return this.technologies;
  }

  getTechnology(id: string): Technology | undefined {
    return this.technologyMap.get(id);
  }

  getStartingTechnologyIds(): string[] {
    return [...STARTING_TECHNOLOGY_IDS];
  }

  getResearchedTechnologies(faction: Faction): string[] {
    return faction.researchedTechnologies ?? [];
  }

  isResearched(faction: Faction, technologyId: string): boolean {
    return (faction.researchedTechnologies ?? []).includes(technologyId);
  }

  /*
   * isShipUnlocked: Returns true if any researched technology lists the
   * given ship type in its unlocksShips array.
   */
  isShipUnlocked(faction: Faction, shipTypeId: string): boolean {
    const researched = faction.researchedTechnologies ?? [];
    return this.technologies.some(
      (tech) => researched.includes(tech.id) && tech.unlocksShips.includes(shipTypeId),
    );
  }

  /*
   * isBuildingUnlocked: Returns true if any researched technology lists
   * the given building id in its unlocksBuildings array.
   */
  isBuildingUnlocked(faction: Faction, buildingId: string): boolean {
    const researched = faction.researchedTechnologies ?? [];
    return this.technologies.some(
      (tech) => researched.includes(tech.id) && tech.unlocksBuildings.includes(buildingId),
    );
  }

  /*
   * getStatus: Returns the current status of a technology for a faction.
   */
  getStatus(faction: Faction, technologyId: string): TechnologyStatus {
    if (this.isResearched(faction, technologyId)) {
      return 'researched';
    }
    const tech = this.technologyMap.get(technologyId);
    if (!tech) {
      return 'locked';
    }
    const researched = faction.researchedTechnologies ?? [];
    const hasPrerequisites = tech.prerequisites.every((prereq) => researched.includes(prereq));
    if (!hasPrerequisites) {
      return 'locked';
    }
    return 'available';
  }

  /*
   * getResearchCost: What this faction pays for the technology now — the
   * base `researchCost` × (1 + RESEARCH_COST_GROWTH_PER_TECH × researched
   * non-starting technologies), rounded. The single cost rule used by
   * canResearch, researchTechnology, the research UI and the AI.
   */
  getResearchCost(faction: Faction | null | undefined, tech: Technology): number {
    const researched = new Set(faction?.researchedTechnologies ?? []);
    let count = 0;
    for (const t of this.technologies) {
      if (researched.has(t.id) && !STARTING_TECHNOLOGY_IDS.includes(t.id)) count++;
    }
    return Math.round(tech.researchCost * (1 + RESEARCH_COST_GROWTH_PER_TECH * count));
  }

  getSensorRangeBonus(faction: Faction): number {
    return this.getModifiers(faction).sensorRange;
  }

  /*
   * getModifiers: The aggregated bonuses of every researched technology.
   * Iterates the technology list (not the researched list), so unknown or
   * duplicated ids in a save can never count twice. Cached by the sorted
   * researched list; callers must treat the result as read-only.
   */
  getModifiers(faction: Faction | null | undefined): TechModifiers {
    const researched = faction?.researchedTechnologies ?? [];
    if (researched.length === 0) {
      return NEUTRAL_TECH_MODIFIERS;
    }
    const key = [...researched].sort().join('|');
    const cached = this.modifierCache.get(key);
    if (cached) {
      return cached;
    }
    const owned = new Set(researched);
    const sums: Record<Exclude<TechnologyBonusType, 'shipAttack' | 'shipShield'>, number> = {
      sensorRange: 0, energyOutput: 0, researchOutput: 0, rawOutput: 0,
      buildingUpkeep: 0, shipUpkeep: 0, shipBuildSpeed: 0, populationGrowth: 0,
    };
    const shipAttack: Record<string, number> = {};
    const shipShield: Record<string, number> = {};
    for (const tech of this.technologies) {
      if (!owned.has(tech.id)) continue;
      for (const bonus of tech.bonuses ?? []) {
        if (bonus.type === 'shipAttack' || bonus.type === 'shipShield') {
          const target = bonus.type === 'shipAttack' ? shipAttack : shipShield;
          for (const shipType of bonus.shipTypes ?? []) {
            target[shipType] = (target[shipType] ?? 1) + bonus.value;
          }
        } else {
          sums[bonus.type] += bonus.value;
        }
      }
    }
    const modifiers: TechModifiers = {
      sensorRange: sums.sensorRange,
      energyOutput: 1 + sums.energyOutput,
      researchOutput: 1 + sums.researchOutput,
      rawOutput: 1 + sums.rawOutput,
      buildingUpkeep: Math.max(MIN_COST_MULTIPLIER, 1 + sums.buildingUpkeep),
      shipUpkeep: Math.max(MIN_COST_MULTIPLIER, 1 + sums.shipUpkeep),
      shipBuildSpeed: 1 + sums.shipBuildSpeed,
      populationGrowth: 1 + sums.populationGrowth,
      shipAttack,
      shipShield,
    };
    this.modifierCache.set(key, modifiers);
    return modifiers;
  }

  /*
   * describeEffects: The mechanical effects of a technology as short,
   * player-facing lines (unlocks first, then bonuses). Generated from the
   * same data the game rules read, so the text cannot drift from the
   * implementation.
   */
  describeEffects(tech: Technology): string[] {
    const shipNames = new Map((shipData as { shipTypes: { id: string; name: string }[] }).shipTypes.map((s) => [s.id, s.name]));
    const buildingNames = new Map((planetData as { buildings: { id: string; name: string }[] }).buildings.map((b) => [b.id, b.name]));
    const lines: string[] = [];
    if (tech.unlocksShips.length > 0) {
      lines.push(`Unlocks ships: ${tech.unlocksShips.map((id) => shipNames.get(id) ?? id).join(', ')}`);
    }
    if (tech.unlocksBuildings.length > 0) {
      lines.push(`Unlocks buildings: ${tech.unlocksBuildings.map((id) => buildingNames.get(id) ?? id).join(', ')}`);
    }
    for (const bonus of tech.bonuses ?? []) {
      lines.push(this.describeBonus(bonus, shipNames));
    }
    return lines;
  }

  private describeBonus(bonus: TechnologyBonus, shipNames: Map<string, string>): string {
    const pct = `${bonus.value > 0 ? '+' : ''}${Math.round(bonus.value * 100)}%`;
    const allCombat = (bonus.shipTypes ?? []).length >= 8;
    const hulls = allCombat ? 'all warships' : (bonus.shipTypes ?? []).map((id) => shipNames.get(id) ?? id).join(', ');
    switch (bonus.type) {
      case 'sensorRange': return `+${bonus.value} sensor range (fleets and systems)`;
      case 'energyOutput': return `${pct} energy from power buildings`;
      case 'researchOutput': return `${pct} research from research buildings`;
      case 'rawOutput': return `${pct} raw materials from buildings`;
      case 'buildingUpkeep': return `${pct} building upkeep`;
      case 'shipUpkeep': return `${pct} ship upkeep`;
      case 'shipBuildSpeed': return `${pct} ship construction speed`;
      case 'populationGrowth': return `${pct} population growth`;
      case 'shipAttack': return `${pct} battle damage: ${hulls}`;
      case 'shipShield': return `${pct} battle shields: ${hulls}`;
    }
  }

  /* Technologies that list `technologyId` as a prerequisite. */
  getDependents(technologyId: string): Technology[] {
    return this.technologies.filter((t) => t.prerequisites.includes(technologyId));
  }

  /*
   * buildCombatBonuses: Battle attack/shield multipliers of the given
   * factions, keyed by faction id, for Battle.combatBonuses.
   */
  buildCombatBonuses(factions: (Faction | null | undefined)[]): Record<string, { attack: Record<string, number>; shield: Record<string, number> }> {
    const result: Record<string, { attack: Record<string, number>; shield: Record<string, number> }> = {};
    for (const faction of factions) {
      if (!faction) continue;
      const modifiers = this.getModifiers(faction);
      result[faction.id] = { attack: { ...modifiers.shipAttack }, shield: { ...modifiers.shipShield } };
    }
    return result;
  }

  /*
   * getResearchBlocker: Why a technology cannot be researched right now,
   * in the same order researchTechnology checks it; undefined when it can.
   */
  getResearchBlocker(faction: Faction, technologyId: string): ResearchResult['reason'] | 'unknown_technology' | undefined {
    const tech = this.technologyMap.get(technologyId);
    if (!tech) return 'unknown_technology';
    if (this.isResearched(faction, technologyId)) return 'already_researched';
    const researched = faction.researchedTechnologies ?? [];
    if (!tech.prerequisites.every((prereq) => researched.includes(prereq))) return 'prerequisites_missing';
    if ((faction.currencies['research'] ?? 0) < this.getResearchCost(faction, tech)) return 'insufficient_research';
    return undefined;
  }

  /*
   * canResearch: Returns true if the technology is not yet researched,
   * all prerequisites are researched, and the faction has enough research
   * points to pay the cost.
   */
  canResearch(faction: Faction, technologyId: string): boolean {
    const tech = this.technologyMap.get(technologyId);
    if (!tech) return false;
    if (this.isResearched(faction, technologyId)) return false;
    const researched = faction.researchedTechnologies ?? [];
    const hasPrerequisites = tech.prerequisites.every((prereq) => researched.includes(prereq));
    if (!hasPrerequisites) return false;
    const researchPoints = faction.currencies['research'] ?? 0;
    return researchPoints >= this.getResearchCost(faction, tech);
  }

  /*
   * researchTechnology: Attempts to research a technology. Deducts the
   * research cost from the faction and marks the technology as researched.
   */
  researchTechnology(faction: Faction, technologyId: string): ResearchResult {
    const tech = this.technologyMap.get(technologyId);
    if (!tech) {
      return { ok: false, reason: 'prerequisites_missing', technology: undefined };
    }
    if (this.isResearched(faction, technologyId)) {
      return { ok: false, reason: 'already_researched', technology: tech };
    }
    const researched = faction.researchedTechnologies ?? [];
    const hasPrerequisites = tech.prerequisites.every((prereq) => researched.includes(prereq));
    if (!hasPrerequisites) {
      return { ok: false, reason: 'prerequisites_missing', technology: tech };
    }
    const researchPoints = faction.currencies['research'] ?? 0;
    const cost = this.getResearchCost(faction, tech);
    if (researchPoints < cost) {
      return { ok: false, reason: 'insufficient_research', technology: tech };
    }
    faction.currencies['research'] = researchPoints - cost;
    if (!faction.researchedTechnologies) {
      faction.researchedTechnologies = [];
    }
    faction.researchedTechnologies.push(technologyId);
    return { ok: true, technology: tech };
  }

  /*
   * validateTechnologies: Runs structural checks on the loaded research
   * tree. Returns an array of ValidationError describing any problems.
   *
   * Checks performed:
   *  - duplicate technology IDs
   *  - missing prerequisite IDs
   *  - self-referencing prerequisites
   *  - circular dependencies
   *  - technologies referencing nonexistent ships
   *  - technologies referencing nonexistent buildings
   *
   * This is intentionally a pure analysis pass: it does not mutate
   * game state and does not block loading. It exists to catch
   * data-definition errors early.
   */
  validateTechnologies(): ValidationError[] {
    const errors: ValidationError[] = [];
    const ids = this.technologies.map((t) => t.id);
    const idSet = new Set(ids);
    const validShipIds = new Set((shipData as { shipTypes: { id: string }[] }).shipTypes.map((s) => s.id));
    const validBuildingIds = new Set((planetData as { buildings: { id: string }[] }).buildings.map((b) => b.id));

    if (ids.length !== idSet.size) {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          errors.push({
            type: 'duplicate_id',
            technologyId: id,
            message: `Duplicate technology id: ${id}`,
          });
        }
        seen.add(id);
      }
    }

    for (const tech of this.technologies) {
      for (const prereq of tech.prerequisites) {
        if (!idSet.has(prereq)) {
          errors.push({
            type: 'missing_prerequisite',
            technologyId: tech.id,
            message: `${tech.id} references missing prerequisite ${prereq}`,
          });
        }
        if (prereq === tech.id) {
          errors.push({
            type: 'self_reference',
            technologyId: tech.id,
            message: `${tech.id} has itself as a prerequisite`,
          });
        }
      }

      for (const shipId of tech.unlocksShips) {
        if (!validShipIds.has(shipId)) {
          errors.push({
            type: 'invalid_ship',
            technologyId: tech.id,
            message: `${tech.id} unlocks nonexistent ship ${shipId}`,
          });
        }
      }

      for (const buildingId of tech.unlocksBuildings) {
        if (!validBuildingIds.has(buildingId)) {
          errors.push({
            type: 'invalid_building',
            technologyId: tech.id,
            message: `${tech.id} unlocks nonexistent building ${buildingId}`,
          });
        }
      }
    }

    this.detectCircularDependencies(errors);

    return errors;
  }

  /*
   * getValidationErrors: Returns the validation errors detected when
   * the research tree was loaded. Useful for debugging and testing.
   */
  getValidationErrors(): ValidationError[] {
    return [...this.validationErrors];
  }

  private detectCircularDependencies(errors: ValidationError[]): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const visit = (techId: string): boolean => {
      if (inStack.has(techId)) {
        const cycleStart = path.indexOf(techId);
        const cycle = path.slice(cycleStart).concat(techId);
        errors.push({
          type: 'circular_dependency',
          technologyId: techId,
          message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        });
        return true;
      }
      if (visited.has(techId)) {
        return false;
      }

      visited.add(techId);
      inStack.add(techId);
      path.push(techId);

      const tech = this.technologyMap.get(techId);
      if (tech) {
        for (const prereq of tech.prerequisites) {
          visit(prereq);
        }
      }

      inStack.delete(techId);
      path.pop();
      return false;
    };

    for (const tech of this.technologies) {
      visit(tech.id);
    }
  }
}

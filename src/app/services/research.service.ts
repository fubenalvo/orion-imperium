import { Injectable } from '@angular/core';
import { Faction, Technology } from '../components/star-map/star-map.models';
import researchTreeData from '../components/star-map/research-tree.json';

export type TechnologyStatus = 'researched' | 'available' | 'locked';

export interface ResearchResult {
  ok: boolean;
  reason?: 'already_researched' | 'prerequisites_missing' | 'insufficient_research';
  technology?: Technology;
}

/*
 * =========================================================
 * RESEARCH SERVICE
 * =========================================================
 *
 * Data-driven research system. Technologies are defined in
 * research-tree.json and referenced by ID from ships and buildings.
 *
 * The service does NOT:
 *  - modify ship or building definitions
 *  - alter the economy
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

  constructor() {
    const data = researchTreeData as { technologies: Technology[] };
    this.technologies = data.technologies;
    this.technologyMap = new Map(this.technologies.map((t) => [t.id, t]));
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
    return researchPoints >= tech.researchCost;
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
    if (researchPoints < tech.researchCost) {
      return { ok: false, reason: 'insufficient_research', technology: tech };
    }
    faction.currencies['research'] = researchPoints - tech.researchCost;
    if (!faction.researchedTechnologies) {
      faction.researchedTechnologies = [];
    }
    faction.researchedTechnologies.push(technologyId);
    return { ok: true, technology: tech };
  }
}

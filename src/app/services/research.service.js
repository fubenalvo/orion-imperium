import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import researchTreeData from '../components/star-map/research-tree.json';
import shipData from '../components/star-map/ship-data.json';
import planetData from '../components/star-map/planet-data.json';
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
let ResearchService = class ResearchService {
    technologies;
    technologyMap;
    validationErrors;
    constructor() {
        const data = researchTreeData;
        this.technologies = data.technologies;
        this.technologyMap = new Map(this.technologies.map((t) => [t.id, t]));
        this.validationErrors = this.validateTechnologies();
    }
    getAllTechnologies() {
        return this.technologies;
    }
    getTechnology(id) {
        return this.technologyMap.get(id);
    }
    getStartingTechnologyIds() {
        return [...STARTING_TECHNOLOGY_IDS];
    }
    getResearchedTechnologies(faction) {
        return faction.researchedTechnologies ?? [];
    }
    isResearched(faction, technologyId) {
        return (faction.researchedTechnologies ?? []).includes(technologyId);
    }
    /*
     * isShipUnlocked: Returns true if any researched technology lists the
     * given ship type in its unlocksShips array.
     */
    isShipUnlocked(faction, shipTypeId) {
        const researched = faction.researchedTechnologies ?? [];
        return this.technologies.some((tech) => researched.includes(tech.id) && tech.unlocksShips.includes(shipTypeId));
    }
    /*
     * isBuildingUnlocked: Returns true if any researched technology lists
     * the given building id in its unlocksBuildings array.
     */
    isBuildingUnlocked(faction, buildingId) {
        const researched = faction.researchedTechnologies ?? [];
        return this.technologies.some((tech) => researched.includes(tech.id) && tech.unlocksBuildings.includes(buildingId));
    }
    /*
     * getStatus: Returns the current status of a technology for a faction.
     */
    getStatus(faction, technologyId) {
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
    getSensorRangeBonus(faction) {
        const researched = faction.researchedTechnologies ?? [];
        let bonus = 0;
        for (const tech of this.technologies) {
            if (!researched.includes(tech.id))
                continue;
            const bonuses = tech.bonuses ?? [];
            for (const b of bonuses) {
                if (b.type === 'sensorRange') {
                    bonus += b.value;
                }
            }
        }
        return bonus;
    }
    /*
     * canResearch: Returns true if the technology is not yet researched,
     * all prerequisites are researched, and the faction has enough research
     * points to pay the cost.
     */
    canResearch(faction, technologyId) {
        const tech = this.technologyMap.get(technologyId);
        if (!tech)
            return false;
        if (this.isResearched(faction, technologyId))
            return false;
        const researched = faction.researchedTechnologies ?? [];
        const hasPrerequisites = tech.prerequisites.every((prereq) => researched.includes(prereq));
        if (!hasPrerequisites)
            return false;
        const researchPoints = faction.currencies['research'] ?? 0;
        return researchPoints >= tech.researchCost;
    }
    /*
     * researchTechnology: Attempts to research a technology. Deducts the
     * research cost from the faction and marks the technology as researched.
     */
    researchTechnology(faction, technologyId) {
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
    validateTechnologies() {
        const errors = [];
        const ids = this.technologies.map((t) => t.id);
        const idSet = new Set(ids);
        const validShipIds = new Set(shipData.shipTypes.map((s) => s.id));
        const validBuildingIds = new Set(planetData.buildings.map((b) => b.id));
        if (ids.length !== idSet.size) {
            const seen = new Set();
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
    getValidationErrors() {
        return [...this.validationErrors];
    }
    detectCircularDependencies(errors) {
        const visited = new Set();
        const inStack = new Set();
        const path = [];
        const visit = (techId) => {
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
};
ResearchService = __decorate([
    Injectable({ providedIn: 'root' })
], ResearchService);
export { ResearchService };

import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { getEnemyFleets, getPlayerFleets, getEnemyPlanets, getUnhabitedPlanets } from './ai-queries';
/*
 * =========================================================
 * ENEMY GOAL SERVICE
 * =========================================================
 *
 * Second strategic AI layer below EnemyStrategyService (V4.1)
 * and above EnemyAiService V3.
 *
 * Given a faction's current strategy, selects a concrete
 * strategic goal with a specific target. Does NOT execute
 * the goal — that is left to future capability/action layers.
 *
 * Timing: goals are recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, matching
 * the V4.1 cadence. Goals are kept until invalidated or until
 * the high-level strategy changes.
 */
let EnemyGoalService = class EnemyGoalService {
    shipService;
    STRATEGY_TICK_INTERVAL = 2;
    THREAT_DISTANCE = 5;
    ENGAGEMENT_DISTANCE = 15;
    EXPANSION_DISTANCE = 20;
    STRENGTH_ADVANTAGE = 1.2;
    accumulator = 0;
    currentGoals = new Map();
    constructor(shipService) {
        this.shipService = shipService;
    }
    reset() {
        this.accumulator = 0;
        this.currentGoals.clear();
    }
    tick(gameDeltaTime, currentStrategy, factionId, fleets, factions, starSystems) {
        if (gameDeltaTime <= 0) {
            return false;
        }
        this.accumulator += gameDeltaTime;
        if (this.accumulator < this.STRATEGY_TICK_INTERVAL) {
            return false;
        }
        this.accumulator -= this.STRATEGY_TICK_INTERVAL;
        if (this.accumulator < 0) {
            this.accumulator = 0;
        }
        const previousGoal = this.currentGoals.get(factionId);
        const needsNewGoal = previousGoal === undefined
            || !this.isGoalValid(previousGoal, factionId, fleets, factions, starSystems)
            || !this.strategyMatchesGoal(currentStrategy, previousGoal);
        if (!needsNewGoal) {
            return false;
        }
        const nextGoal = this.selectGoal(currentStrategy, factionId, fleets, factions, starSystems);
        if (previousGoal !== undefined && nextGoal !== undefined) {
            this.currentGoals.set(factionId, nextGoal);
            return true;
        }
        if (previousGoal === undefined && nextGoal !== undefined) {
            this.currentGoals.set(factionId, nextGoal);
            return true;
        }
        if (previousGoal !== undefined && nextGoal === undefined) {
            this.currentGoals.delete(factionId);
            return true;
        }
        return false;
    }
    getGoal(factionId) {
        return this.currentGoals.get(factionId);
    }
    selectGoal(strategy, factionId, fleets, factions, starSystems) {
        switch (strategy) {
            case 'expand':
                return this.selectColonizeGoal(factionId, fleets, starSystems);
            case 'attack':
                return this.selectAttackGoal(factionId, fleets, factions);
            case 'defend':
                return this.selectDefendGoal(factionId, fleets, factions, starSystems);
            case 'develop':
                return this.selectDevelopGoal();
            default:
                return undefined;
        }
    }
    selectColonizeGoal(factionId, fleets, starSystems) {
        const enemyPlanets = getEnemyPlanets(factionId, starSystems);
        const enemyFleets = getEnemyFleets(factionId, fleets);
        const candidates = getUnhabitedPlanets(starSystems);
        if (enemyFleets.length === 0 || candidates.length === 0) {
            return undefined;
        }
        const targetedPlanetIds = this.getTargetedColonizePlanetIds();
        const scored = candidates
            .filter(({ planet }) => !targetedPlanetIds.has(planet.id))
            .map(({ system, planet }) => {
            const distanceFromEnemy = enemyPlanets.length > 0
                ? this.getMinDistanceToEnemyPlanets(system, enemyPlanets)
                : this.getMinDistanceToEnemyFleets(system, enemyFleets);
            if (distanceFromEnemy === Infinity) {
                return null;
            }
            const habitabilityWeight = this.getHabitabilityWeight(planet);
            const sizeWeight = this.getSizeWeight(planet);
            const score = (20 / distanceFromEnemy) * habitabilityWeight * sizeWeight;
            return {
                system,
                planet,
                score,
                distanceFromEnemy,
            };
        })
            .filter((item) => item !== null)
            .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            if (a.distanceFromEnemy !== b.distanceFromEnemy) {
                return a.distanceFromEnemy - b.distanceFromEnemy;
            }
            if (a.planet.id !== b.planet.id) {
                return a.planet.id - b.planet.id;
            }
            return a.system.id.localeCompare(b.system.id);
        });
        if (scored.length === 0) {
            return undefined;
        }
        const best = scored[0];
        return {
            type: 'colonize',
            targetPlanetId: best.planet.id,
            targetSystemId: best.system.id,
        };
    }
    selectAttackGoal(factionId, fleets, factions) {
        const enemyFleets = getEnemyFleets(factionId, fleets);
        const playerFleets = getPlayerFleets(fleets, factions);
        if (enemyFleets.length === 0 || playerFleets.length === 0) {
            return undefined;
        }
        const maxEnemyStrength = Math.max(...enemyFleets.map((fleet) => this.shipService.calculateFleetStrength(fleet.ships)), 0);
        const scored = playerFleets.map((playerFleet) => {
            const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
            const ratio = maxEnemyStrength > 0 ? playerStrength / maxEnemyStrength : 1;
            const category = this.getStrengthCategory(ratio);
            const closestDistance = Math.min(...enemyFleets.map((enemyFleet) => {
                const dx = enemyFleet.x - playerFleet.x;
                const dy = enemyFleet.y - playerFleet.y;
                return Math.sqrt(dx * dx + dy * dy);
            }));
            return {
                fleet: playerFleet,
                category,
                ratio,
                closestDistance,
            };
        });
        const categoryOrder = { weak: 0, comparable: 1, strong: 2 };
        scored.sort((a, b) => {
            const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
            if (categoryDiff !== 0) {
                return categoryDiff;
            }
            if (a.closestDistance !== b.closestDistance) {
                return a.closestDistance - b.closestDistance;
            }
            return a.fleet.id - b.fleet.id;
        });
        const best = scored[0];
        return {
            type: 'attack',
            targetFleetId: best.fleet.id,
        };
    }
    selectDefendGoal(factionId, fleets, factions, starSystems) {
        const enemyPlanets = getEnemyPlanets(factionId, starSystems);
        const playerFleets = getPlayerFleets(fleets, factions);
        if (enemyPlanets.length === 0 || playerFleets.length === 0) {
            return undefined;
        }
        let bestSystem;
        let bestPlanet = enemyPlanets[0].planetsTiles[0];
        let bestDistance = Infinity;
        let threateningFleetId;
        for (const system of enemyPlanets) {
            for (const planet of system.planetsTiles) {
                if (planet.factionId !== factionId) {
                    continue;
                }
                for (const playerFleet of playerFleets) {
                    const dx = playerFleet.x - system.x;
                    const dy = playerFleet.y - system.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestSystem = system;
                        bestPlanet = planet;
                        threateningFleetId = playerFleet.id;
                    }
                }
            }
        }
        if (bestSystem === undefined || bestDistance > this.THREAT_DISTANCE) {
            return undefined;
        }
        return {
            type: 'defend',
            targetPlanetId: bestPlanet.id,
            targetSystemId: bestSystem.id,
            threateningFleetId,
        };
    }
    selectDevelopGoal() {
        return { type: 'develop' };
    }
    isGoalValid(goal, factionId, fleets, factions, starSystems) {
        switch (goal.type) {
            case 'colonize':
                return this.isColonizeGoalValid(goal, starSystems);
            case 'attack':
                return this.isAttackGoalValid(goal, fleets, factions);
            case 'defend':
                return this.isDefendGoalValid(goal, factionId, fleets, factions, starSystems);
            case 'develop':
                return true;
        }
    }
    isColonizeGoalValid(goal, starSystems) {
        const system = starSystems.find((s) => s.id === goal.targetSystemId);
        if (!system) {
            return false;
        }
        const planet = system.planetsTiles.find((p) => p.id === goal.targetPlanetId);
        if (!planet) {
            return false;
        }
        return planet.factionId === 'unhabited';
    }
    isAttackGoalValid(goal, fleets, factions) {
        const fleet = fleets.find((f) => f.id === goal.targetFleetId);
        if (!fleet || fleet.destroyed || fleet.ships.length === 0) {
            return false;
        }
        const playerFactionIds = new Set(factions
            .filter((faction) => faction.team === 1)
            .map((faction) => faction.id));
        return playerFactionIds.has(fleet.factionId);
    }
    isDefendGoalValid(goal, factionId, fleets, factions, starSystems) {
        const system = starSystems.find((s) => s.id === goal.targetSystemId);
        if (!system) {
            return false;
        }
        const planet = system.planetsTiles.find((p) => p.id === goal.targetPlanetId);
        if (!planet || planet.factionId !== factionId) {
            return false;
        }
        const playerFleets = getPlayerFleets(fleets, factions);
        return playerFleets.some((fleet) => {
            const dx = fleet.x - system.x;
            const dy = fleet.y - system.y;
            return Math.sqrt(dx * dx + dy * dy) <= this.THREAT_DISTANCE;
        });
    }
    strategyMatchesGoal(strategy, goal) {
        switch (strategy) {
            case 'expand':
                return goal.type === 'colonize';
            case 'attack':
                return goal.type === 'attack';
            case 'defend':
                return goal.type === 'defend';
            case 'develop':
                return goal.type === 'develop';
            default:
                return false;
        }
    }
    getTargetedColonizePlanetIds() {
        const ids = new Set();
        for (const goal of this.currentGoals.values()) {
            if (goal.type === 'colonize') {
                ids.add(goal.targetPlanetId);
            }
        }
        return ids;
    }
    getMinDistanceToEnemyPlanets(system, enemyPlanets) {
        let minDistance = Infinity;
        for (const enemySystem of enemyPlanets) {
            const dx = system.x - enemySystem.x;
            const dy = system.y - enemySystem.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }
        return minDistance;
    }
    getMinDistanceToEnemyFleets(system, enemyFleets) {
        let minDistance = Infinity;
        for (const enemyFleet of enemyFleets) {
            const dx = system.x - enemyFleet.x;
            const dy = system.y - enemyFleet.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }
        return minDistance;
    }
    getHabitabilityWeight(planet) {
        switch (planet.type) {
            case 'earthlike':
            case 'gasgiant':
                return 1.0;
            case 'desert':
            case 'venuslike':
                return 0.8;
            case 'marslike':
                return 0.9;
            case 'ice':
                return 0.7;
            default:
                return 1.0;
        }
    }
    getSizeWeight(planet) {
        switch (planet.size) {
            case 'tiny':
                return 0.6;
            case 'small':
                return 0.8;
            case 'medium':
                return 1.0;
            case 'big':
            case 'huge':
                return 1.1;
            default:
                return 1.0;
        }
    }
    getStrengthCategory(ratio) {
        if (ratio <= 0.75) {
            return 'weak';
        }
        if (ratio <= 1.5) {
            return 'comparable';
        }
        return 'strong';
    }
    getGoalType(goal) {
        return goal.type;
    }
};
EnemyGoalService = __decorate([
    Injectable({ providedIn: 'root' })
], EnemyGoalService);
export { EnemyGoalService };

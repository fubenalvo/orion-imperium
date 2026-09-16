import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { getAiFactionIds } from './star-map.models';
import { getEnemyFleets, getPlayerFleets, getEnemyPlanets, getUnhabitedPlanets } from './ai-queries';
/*
 * =========================================================
 * ENEMY STRATEGY SERVICE
 * =========================================================
 *
 * First strategic AI layer above EnemyAiService V3.
 * Determines the current high-level intention for each
 * enemy faction (expand, attack, defend, develop).
 *
 * This layer does NOT execute strategy. It only inspects
 * the game state and returns/logs the current strategic goal.
 *
 * Timing: strategy is recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, so it
 * naturally respects pause and game speed.
 */
let EnemyStrategyService = class EnemyStrategyService {
    shipService;
    STRATEGY_TICK_INTERVAL = 2;
    THREAT_DISTANCE = 5;
    ENGAGEMENT_DISTANCE = 15;
    EXPANSION_DISTANCE = 20;
    STRENGTH_ADVANTAGE = 1.2;
    accumulator = 0;
    currentStrategies = new Map();
    constructor(shipService) {
        this.shipService = shipService;
    }
    reset() {
        this.accumulator = 0;
        this.currentStrategies.clear();
    }
    tick(gameDeltaTime, fleets, factions, starSystems) {
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
        let changed = false;
        const aiFactionIds = getAiFactionIds(factions);
        for (const factionId of aiFactionIds) {
            const previous = this.currentStrategies.get(factionId);
            const next = this.determineStrategy(factionId, fleets, factions, starSystems);
            if (previous !== next) {
                this.currentStrategies.set(factionId, next);
                changed = true;
            }
        }
        return changed;
    }
    getStrategy(factionId) {
        return this.currentStrategies.get(factionId);
    }
    determineStrategy(factionId, fleets, factions, starSystems) {
        const enemyPlanets = getEnemyPlanets(factionId, starSystems);
        const enemyFleets = getEnemyFleets(factionId, fleets);
        const playerFleets = getPlayerFleets(fleets, factions);
        const unhabitedPlanets = getUnhabitedPlanets(starSystems);
        if (this.isThreatened(enemyPlanets, playerFleets)) {
            return 'defend';
        }
        if (this.hasFavorableEngagement(enemyFleets, playerFleets)) {
            return 'attack';
        }
        if (this.canExpand(enemyFleets, unhabitedPlanets)) {
            return 'expand';
        }
        return 'develop';
    }
    isThreatened(enemyPlanets, playerFleets) {
        for (const system of enemyPlanets) {
            for (const fleet of playerFleets) {
                const dx = fleet.x - system.x;
                const dy = fleet.y - system.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= this.THREAT_DISTANCE) {
                    return true;
                }
            }
        }
        return false;
    }
    hasFavorableEngagement(enemyFleets, playerFleets) {
        for (const enemyFleet of enemyFleets) {
            const enemyStrength = this.shipService.calculateFleetStrength(enemyFleet.ships);
            for (const playerFleet of playerFleets) {
                const dx = enemyFleet.x - playerFleet.x;
                const dy = enemyFleet.y - playerFleet.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > this.ENGAGEMENT_DISTANCE) {
                    continue;
                }
                const playerStrength = this.shipService.calculateFleetStrength(playerFleet.ships);
                if (enemyStrength >= playerStrength * this.STRENGTH_ADVANTAGE) {
                    return true;
                }
            }
        }
        return false;
    }
    canExpand(enemyFleets, unhabitedPlanets) {
        for (const fleet of enemyFleets) {
            for (const { system } of unhabitedPlanets) {
                const dx = fleet.x - system.x;
                const dy = fleet.y - system.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= this.EXPANSION_DISTANCE) {
                    return true;
                }
            }
        }
        return false;
    }
};
EnemyStrategyService = __decorate([
    Injectable({ providedIn: 'root' })
], EnemyStrategyService);
export { EnemyStrategyService };

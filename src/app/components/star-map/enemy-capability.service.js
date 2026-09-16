import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { isPlayerFleet, isCombatShipType } from './ai-queries';
/*
 * =========================================================
 * ENEMY CAPABILITY SERVICE
 * =========================================================
 *
 * Third strategic AI layer below EnemyStrategyService V4.1
 * and EnemyGoalService V4.2.
 *
 * Given a faction's current goal, evaluates whether the faction
 * currently has the capabilities required to pursue that goal.
 *
 * This layer does NOT execute actions. It only inspects the
 * current game state and reports what is available and what
 * is missing.
 *
 * Timing: capabilities are recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, matching
 * the V4.1/V4.2 cadence.
 */
let EnemyCapabilityService = class EnemyCapabilityService {
    shipService;
    researchService;
    shipStockService;
    STRATEGY_TICK_INTERVAL = 2;
    THREAT_DISTANCE = 5;
    REINFORCEMENT_THRESHOLD = 0.5;
    accumulator = 0;
    currentCapabilities = new Map();
    peakStrength = new Map();
    constructor(shipService, researchService, shipStockService) {
        this.shipService = shipService;
        this.researchService = researchService;
        this.shipStockService = shipStockService;
    }
    reset() {
        this.accumulator = 0;
        this.currentCapabilities.clear();
        this.peakStrength.clear();
    }
    tick(gameDeltaTime, currentGoal, factionId, fleets, factions, starSystems, shipStock, production) {
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
        if (currentGoal !== undefined) {
            this.updatePeakStrength(factionId, fleets);
        }
        const previous = this.currentCapabilities.get(factionId);
        const next = currentGoal !== undefined
            ? this.evaluateGoal(currentGoal, factionId, fleets, factions, starSystems, shipStock, production)
            : undefined;
        if (previous !== undefined && next !== undefined) {
            const changed = JSON.stringify(previous) !== JSON.stringify(next);
            if (changed) {
                this.currentCapabilities.set(factionId, next);
            }
            return changed;
        }
        if (previous === undefined && next !== undefined) {
            this.currentCapabilities.set(factionId, next);
            return true;
        }
        if (previous !== undefined && next === undefined) {
            this.currentCapabilities.delete(factionId);
            return true;
        }
        return false;
    }
    getCapability(factionId) {
        return this.currentCapabilities.get(factionId);
    }
    evaluateGoal(goal, factionId, fleets, factions, starSystems, shipStock, production) {
        switch (goal.type) {
            case 'colonize':
                return this.evaluateColonize(goal, factionId, fleets, factions, starSystems, shipStock);
            case 'attack':
                return this.evaluateAttack(goal, factionId, fleets, factions);
            case 'defend':
                return this.evaluateDefend(goal, factionId, fleets, factions, starSystems);
            case 'develop':
                return this.evaluateDevelop(factionId);
        }
    }
    evaluateColonize(goal, factionId, fleets, factions, starSystems, shipStock) {
        const requirements = [];
        const faction = factions.find((f) => f.id === factionId);
        const hasTechnology = faction !== undefined && this.researchService.isResearched(faction, 'basic_engineering');
        requirements.push({
            type: 'colonizer_technology',
            satisfied: hasTechnology,
            reason: hasTechnology ? 'satisfied' : 'no_colonizer_technology',
        });
        const isUnlocked = faction !== undefined && this.researchService.isShipUnlocked(faction, 'colonizer');
        requirements.push({
            type: 'colonizer_unlocked',
            satisfied: isUnlocked,
            reason: isUnlocked ? 'satisfied' : 'colonizer_not_unlocked',
        });
        const stockData = { shipStock };
        const colonizerInStock = this.shipStockService.getCount(stockData, factionId, 'colonizer');
        const colonizerInFleet = fleets.some((fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => ship.type === 'colonizer' && !ship.destroyed));
        const hasColonizer = colonizerInStock > 0 || colonizerInFleet;
        requirements.push({
            type: 'colonizer_available',
            satisfied: hasColonizer,
            reason: hasColonizer ? 'satisfied' : 'no_colonizer_available',
        });
        const usableFleet = fleets.some((fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed));
        requirements.push({
            type: 'usable_fleet',
            satisfied: usableFleet,
            reason: usableFleet ? 'satisfied' : 'no_usable_fleet',
        });
        const system = starSystems.find((s) => s.id === goal.targetSystemId);
        const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);
        const targetValid = system !== undefined && planet !== undefined && planet.factionId === 'unhabited';
        requirements.push({
            type: 'target_valid',
            satisfied: targetValid,
            reason: targetValid ? 'satisfied' : 'target_invalid',
        });
        return {
            canExecute: requirements.every((r) => r.satisfied),
            goalType: 'colonize',
            factionId,
            requirements,
        };
    }
    evaluateAttack(goal, factionId, fleets, factions) {
        const requirements = [];
        const enemyFleets = fleets.filter((fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed));
        const hasFleet = enemyFleets.length > 0;
        requirements.push({
            type: 'available_fleet',
            satisfied: hasFleet,
            reason: hasFleet ? 'satisfied' : 'no_available_fleet',
        });
        const targetFleet = fleets.find((f) => f.id === goal.targetFleetId);
        const playerFactionIds = new Set(factions
            .filter((faction) => faction.team === 1)
            .map((faction) => faction.id));
        const targetValid = targetFleet !== undefined
            && !targetFleet.destroyed
            && targetFleet.ships.some((ship) => !ship.destroyed)
            && playerFactionIds.has(targetFleet.factionId);
        requirements.push({
            type: 'target_valid',
            satisfied: targetValid,
            reason: targetValid ? 'satisfied' : 'target_destroyed',
        });
        const hasCombatCapability = hasFleet && enemyFleets.some((fleet) => this.shipService.calculateFleetStrength(fleet.ships) > 0);
        requirements.push({
            type: 'fleet_can_engage',
            satisfied: hasCombatCapability,
            reason: hasCombatCapability ? 'satisfied' : 'no_combat_capability',
        });
        return {
            canExecute: requirements.every((r) => r.satisfied),
            goalType: 'attack',
            factionId,
            requirements,
        };
    }
    evaluateDefend(goal, factionId, fleets, factions, starSystems) {
        const requirements = [];
        const enemyFleets = fleets.filter((fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed));
        const hasFleet = enemyFleets.length > 0;
        requirements.push({
            type: 'available_fleet',
            satisfied: hasFleet,
            reason: hasFleet ? 'satisfied' : 'no_available_fleet',
        });
        const system = starSystems.find((s) => s.id === goal.targetSystemId);
        const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);
        const targetValid = system !== undefined && planet !== undefined && planet.factionId === factionId;
        requirements.push({
            type: 'target_valid',
            satisfied: targetValid,
            reason: targetValid ? 'satisfied' : 'target_lost',
        });
        const playerFleets = fleets.filter((fleet) => isPlayerFleet(fleet, factions) && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed));
        const threatPresent = targetValid && playerFleets.some((fleet) => {
            const dx = fleet.x - system.x;
            const dy = fleet.y - system.y;
            return Math.sqrt(dx * dx + dy * dy) <= this.THREAT_DISTANCE;
        });
        requirements.push({
            type: 'threat_present',
            satisfied: threatPresent,
            reason: threatPresent ? 'satisfied' : 'no_threat',
        });
        /*
         * Combat capability must come from combat-role ships, not from any
         * hull. Colonizers and scouts still contribute hitPoints/defense to
         * calculateFleetStrength, so a strength>0 test would report a
         * transport-only fleet as able to engage, which in turn made the
         * combat-production and fleet-creation branches unreachable.
         */
        const hasCombatCapability = hasFleet && enemyFleets.some((fleet) => fleet.ships.some((ship) => !ship.destroyed && isCombatShipType(this.shipService.getShipType(ship.type))));
        requirements.push({
            type: 'fleet_can_engage',
            satisfied: hasCombatCapability,
            reason: hasCombatCapability ? 'satisfied' : 'no_combat_capability',
        });
        const peak = this.peakStrength.get(factionId) ?? 0;
        const currentStrength = this.totalFactionStrength(factionId, fleets);
        const needsReinforcement = hasFleet && peak > 0 && currentStrength < this.REINFORCEMENT_THRESHOLD * peak;
        requirements.push({
            type: 'fleet_needs_reinforcement',
            satisfied: needsReinforcement,
            reason: needsReinforcement ? 'fleet_under_strength' : 'fleet_at_strength',
            value: peak,
        });
        return {
            canExecute: requirements
                .filter((r) => r.type !== 'fleet_needs_reinforcement')
                .every((r) => r.satisfied),
            goalType: 'defend',
            factionId,
            requirements,
        };
    }
    evaluateDevelop(factionId) {
        return {
            canExecute: true,
            goalType: 'develop',
            factionId,
            requirements: [
                {
                    type: 'always_executable',
                    satisfied: true,
                    reason: 'satisfied',
                },
            ],
        };
    }
    updatePeakStrength(factionId, fleets) {
        const currentStrength = this.totalFactionStrength(factionId, fleets);
        const peak = this.peakStrength.get(factionId) ?? 0;
        if (currentStrength > peak) {
            this.peakStrength.set(factionId, currentStrength);
        }
    }
    /*
     * totalFactionStrength: Sums the combat strength of every living ship
     * in the faction's living fleets. Destroyed ships stay in the roster
     * after a battle (applyBattleResult re-maps them with destroyed:true),
     * so they must be filtered or a fleet that took losses would keep
     * reporting pre-loss strength and never trigger reinforcement.
     */
    totalFactionStrength(factionId, fleets) {
        return fleets
            .filter((fleet) => fleet.factionId === factionId && !fleet.destroyed)
            .reduce((sum, fleet) => {
            const livingShips = fleet.ships.filter((ship) => !ship.destroyed);
            return sum + this.shipService.calculateFleetStrength(livingShips);
        }, 0);
    }
};
EnemyCapabilityService = __decorate([
    Injectable({ providedIn: 'root' })
], EnemyCapabilityService);
export { EnemyCapabilityService };

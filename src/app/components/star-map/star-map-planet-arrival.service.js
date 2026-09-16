import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { PLANET_TYPE_COLORS } from './star-map.models';
let StarMapPlanetArrivalService = class StarMapPlanetArrivalService {
    planetBattleService;
    battleService;
    movementService;
    // Tracks which fleet is currently on which planet grid cell to log arrivals
    fleetPlanetMap = new Map();
    // Battle tracking (fleet pair keys already triggered)
    triggeredBattles = new Set();
    constructor(planetBattleService, battleService, movementService) {
        this.planetBattleService = planetBattleService;
        this.battleService = battleService;
        this.movementService = movementService;
    }
    /** Clears per-session arrival bookkeeping. Safe to call on every load. */
    reset() {
        this.fleetPlanetMap.clear();
        this.triggeredBattles.clear();
    }
    /** Checks if any fleet arrived at a planet's grid cell and handles the interaction. */
    checkFleetPlanetArrivals(ctx) {
        if (ctx.currentView !== 'system' || !ctx.selectedSystem) {
            return;
        }
        for (const fleet of ctx.fleets) {
            if (fleet.destroyed || fleet.system?.id !== ctx.selectedSystem.id) {
                continue;
            }
            if (!this.hasLivingShips(fleet)) {
                continue;
            }
            if (fleet.system.targetX != null || fleet.system.targetY != null) {
                continue;
            }
            const fleetCell = this.movementService.calculateSystemGridCell(fleet.system.x, fleet.system.y);
            for (const planet of ctx.selectedSystem.planetsTiles) {
                const planetCell = this.movementService.getPlanetGridPosition(planet);
                if (fleetCell.col !== planetCell.col || fleetCell.row !== planetCell.row) {
                    continue;
                }
                const lastPlanetId = this.fleetPlanetMap.get(fleet.id);
                if (lastPlanetId === planet.id) {
                    break;
                }
                this.fleetPlanetMap.set(fleet.id, planet.id);
                this.handleFleetPlanetArrival(fleet, planet, ctx);
                break;
            }
        }
    }
    /** Returns a garrisoned fleet on the given planet that belongs to the planet's owner faction. */
    getFleetOnPlanet(fleets, selectedSystem, planet) {
        if (!selectedSystem)
            return null;
        for (const fleet of fleets) {
            if (fleet.destroyed || fleet.system?.id !== selectedSystem.id)
                continue;
            if (!this.hasLivingShips(fleet))
                continue;
            if (fleet.factionId !== planet.factionId)
                continue;
            if (fleet.system.targetX != null || fleet.system.targetY != null)
                continue;
            const fleetCell = this.movementService.calculateSystemGridCell(fleet.system.x, fleet.system.y);
            const planetCell = this.movementService.getPlanetGridPosition(planet);
            if (fleetCell.col === planetCell.col && fleetCell.row === planetCell.row) {
                return fleet;
            }
        }
        return null;
    }
    /** Handles a fleet arriving at a planet: colonization, orbit, or battle trigger. */
    handleFleetPlanetArrival(fleet, planet, ctx) {
        if (planet.factionId === 'unhabited') {
            const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
            if (result.colonized && result.colonizerIndex >= 0) {
                fleet.ships.splice(result.colonizerIndex, 1);
                planet.factionId = fleet.factionId;
            }
            else {
            }
            ctx.saveGame();
            return;
        }
        if (planet.factionId === fleet.factionId) {
            return;
        }
        const planetFaction = ctx.factions.find((f) => f.id === planet.factionId);
        const fleetFaction = ctx.factions.find((f) => f.id === fleet.factionId);
        if (!planetFaction || !fleetFaction) {
            return;
        }
        if (planetFaction.team === fleetFaction.team) {
            return;
        }
        if (!this.planetBattleService.hasPlanetDefenses(planet)) {
            planet.factionId = fleet.factionId;
            ctx.saveGame();
            return;
        }
        this.triggerPlanetBattle(fleet, planet, ctx);
    }
    /** Triggers a battle between an attacking fleet and a planet's defenses. */
    triggerPlanetBattle(attackerFleet, targetPlanet, ctx) {
        if (!this.hasLivingShips(attackerFleet)) {
            return;
        }
        const garrisonFleet = this.getFleetOnPlanet(ctx.fleets, ctx.selectedSystem, targetPlanet);
        const defenseFleet = this.planetBattleService.createVirtualDefenseFleet(targetPlanet, garrisonFleet);
        /*
         * A planet can have only a shield building and no turrets or garrison.
         * That produces a pool but zero combat stacks, so treat it as an
         * undefended capture instead of opening an unwinnable empty battle.
         */
        if (defenseFleet.ships.length === 0) {
            targetPlanet.factionId = attackerFleet.factionId;
            ctx.saveGame();
            return;
        }
        const attackerFaction = ctx.factions.find((f) => f.id === attackerFleet.factionId);
        const defenderFaction = ctx.factions.find((f) => f.id === targetPlanet.factionId);
        if (!attackerFaction || !defenderFaction) {
            return;
        }
        if (garrisonFleet) {
            const battleKey = `${Math.min(attackerFleet.id, garrisonFleet.id)}-${Math.max(attackerFleet.id, garrisonFleet.id)}`;
            this.triggeredBattles.add(battleKey);
        }
        this.battleService.setPlanetBattle({
            fleet1: attackerFleet,
            fleet2: defenseFleet,
            faction1Name: attackerFaction.name,
            faction1Color: attackerFaction.color,
            faction2Name: defenderFaction.name,
            faction2Color: defenderFaction.color,
            attackerId: attackerFleet.id,
            defenderId: defenseFleet.id,
            planetId: targetPlanet.id,
            planetName: targetPlanet.name,
            planetColor: PLANET_TYPE_COLORS[targetPlanet.type] ?? '#ffffff',
        });
        ctx.enterBattleScreen();
    }
    hasLivingShips(fleet) {
        return (fleet.ships ?? []).some((ship) => ship.destroyed !== true);
    }
};
StarMapPlanetArrivalService = __decorate([
    Injectable({ providedIn: 'root' })
], StarMapPlanetArrivalService);
export { StarMapPlanetArrivalService };

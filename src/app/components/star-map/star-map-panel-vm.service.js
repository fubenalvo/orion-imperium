import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
/*
 * =========================================================
 * STAR MAP PANEL VM SERVICE
 * =========================================================
 *
 * Builds the view models for the production and spaceport
 * panels and maps service failure reasons to user-facing
 * messages. Pure coordination logic: it reads game state
 * through the same services the StarMap component uses and
 * holds no state of its own.
 *
 * `data` follows the structural context pattern used by the
 * stock/production services: the caller passes its live
 * `shipStock` / `production` arrays so the underlying services
 * mutate the component-owned game state.
 */
let StarMapPanelVmService = class StarMapPanelVmService {
    productionService;
    shipStockService;
    shipService;
    spaceportService;
    researchService;
    constructor(productionService, shipStockService, shipService, spaceportService, researchService) {
        this.productionService = productionService;
        this.shipStockService = shipStockService;
        this.shipService = shipService;
        this.spaceportService = spaceportService;
        this.researchService = researchService;
    }
    getProductionPanelVm(data, selectedPlanetTile, selectedSystem, factions) {
        if (!selectedPlanetTile || !selectedSystem) {
            return null;
        }
        const playerFaction = factions.find((f) => f.id === 'player');
        const buildable = this.productionService
            .listBuildableShipTypes(selectedPlanetTile)
            .filter((t) => this.researchService.isShipUnlocked(playerFaction, t.id));
        const queue = this.productionService.getQueue(data, 'player', selectedPlanetTile.id);
        const etas = {};
        for (const order of queue) {
            etas[order.id] = this.productionService.getOrderEta(order, selectedPlanetTile);
        }
        const shipCosts = {};
        const shipBuildTimes = {};
        for (const t of buildable) {
            shipCosts[t.id] = t.cost;
            shipBuildTimes[t.id] = t.buildTime ?? Math.max(1, t.cost * 0.1);
        }
        return {
            planet: selectedPlanetTile,
            system: selectedSystem,
            factionId: 'player',
            buildable,
            capacity: this.productionService.getPlanetCapacity(selectedPlanetTile),
            power: this.productionService.getPlanetPower(selectedPlanetTile),
            queue,
            shipCosts,
            shipBuildTimes,
            etas,
            factionCredits: this.getPlayerCredits(factions),
        };
    }
    getSpaceportPanelVm(data, selectedPlanetTile, selectedSystem, starSystems, factions, spaceportError) {
        if (!selectedPlanetTile || !selectedSystem) {
            return null;
        }
        if (!this.spaceportService.isSpaceportPlanet(selectedPlanetTile)) {
            return null;
        }
        const playerFaction = factions.find((f) => f.id === 'player');
        const assemblySystems = this.spaceportService
            .listSpaceports('player', starSystems)
            .map((loc) => ({
            systemId: loc.system.id,
            systemName: loc.system.name,
            planets: loc.system.planetsTiles
                .filter((p) => p.factionId === 'player' && this.spaceportService.isSpaceportPlanet(p))
                .map((p) => ({ id: p.id, name: p.name })),
        }));
        const summary = this.shipStockService.getSummary(data, 'player');
        const available = summary
            .map((entry) => {
            const type = this.shipService.getShipType(entry.typeId);
            return {
                typeId: entry.typeId,
                typeName: type?.name ?? entry.typeId,
                available: entry.count,
            };
        })
            .filter((entry) => this.researchService.isShipUnlocked(playerFaction, entry.typeId))
            .sort((a, b) => a.typeName.localeCompare(b.typeName));
        return {
            system: selectedSystem,
            planet: selectedPlanetTile,
            factionId: 'player',
            available,
            selectedSystemId: selectedSystem.id,
            selectedPlanetId: selectedPlanetTile.id,
            assemblySystems,
            errorMessage: spaceportError,
        };
    }
    /** Returns the player's current credit balance. */
    getPlayerCredits(factions) {
        const player = factions.find((f) => f.id === 'player');
        return player?.currencies?.['credits'] ?? 0;
    }
    describeProductionError(reason) {
        switch (reason) {
            case 'no_factory':
                return 'No factory on this planet.';
            case 'insufficient_resources':
                return 'Not enough credits.';
            case 'invalid_type':
                return 'Invalid ship type.';
            case 'invalid_quantity':
                return 'Invalid quantity.';
            default:
                return 'Could not queue order.';
        }
    }
    describeAssemblyError(reason) {
        switch (reason) {
            case 'no_spaceport':
                return 'No Spaceport available.';
            case 'insufficient_stock':
                return 'Not enough ships in stock.';
            case 'invalid_composition':
                return 'Select at least one ship.';
            case 'invalid_target':
                return 'Invalid assembly point.';
            case 'fleet_not_found':
                return 'Fleet not found.';
            case 'enemy_fleet':
                return 'Cannot modify an enemy fleet.';
            default:
                return 'Assembly failed.';
        }
    }
    suggestFleetName(fleets) {
        const used = new Set(fleets.filter((f) => f.factionId === 'player').map((f) => f.name));
        for (let i = 1; i < 1000; i++) {
            const name = `${i}${this.ordinalSuffix(i)} Fleet`;
            if (!used.has(name)) {
                return name;
            }
        }
        return 'New Fleet';
    }
    ordinalSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }
};
StarMapPanelVmService = __decorate([
    Injectable({ providedIn: 'root' })
], StarMapPanelVmService);
export { StarMapPanelVmService };

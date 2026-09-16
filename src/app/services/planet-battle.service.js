import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import planetData from '../components/star-map/planet-data.json';
let PlanetBattleService = class PlanetBattleService {
    buildingDefs;
    constructor() {
        this.buildingDefs = planetData.buildings;
    }
    /*
     * createVirtualDefenseFleet: Builds a synthetic Fleet from a planet's
     * defensive buildings and optional garrison fleet.
     *
     * Each defense building becomes one virtual ship with stats from the
     * building definition. Shield buildings do not become ships; they add to
     * the shared shield pool and its per-turn regeneration instead.
     * Garrison ships are appended to the virtual fleet.
     */
    createVirtualDefenseFleet(planet, garrisonFleet) {
        const virtualShips = [];
        let nextShipId = 1000000;
        let totalShield = 0;
        let totalShieldRegen = 0;
        let persistedShieldCurrent = null;
        const garrisonShipMap = {};
        for (const building of planet.buildings) {
            const def = this.buildingDefs.find((b) => b.name === building.name);
            if (!def || def.role !== 'defense') {
                continue;
            }
            if (def.type === 'shield') {
                totalShield += def.shield ?? 0;
                totalShieldRegen += def.shieldRegen ?? 0;
                continue;
            }
            virtualShips.push({
                id: nextShipId++,
                name: `${building.name} #${nextShipId - 1000000}`,
                type: def.id,
                currentHp: this.getBuildingHitPoints(def),
                destroyed: false,
            });
        }
        /*
         * Restore the persisted shared shield pool. A persisted 0 is a real
         * value (the pool was fully depleted in a previous battle) and must
         * not be treated as "no persisted value", or a drained planet would
         * start its next battle at full shields.
         */
        if (planet.shieldPoolCurrent !== undefined) {
            if (typeof planet.shieldPoolCurrent === 'number' && Number.isFinite(planet.shieldPoolCurrent)) {
                persistedShieldCurrent = Math.max(0, Math.min(planet.shieldPoolCurrent, totalShield));
            }
            else {
                persistedShieldCurrent = totalShield;
            }
        }
        if (garrisonFleet) {
            for (const ship of garrisonFleet.ships) {
                if (ship.destroyed)
                    continue;
                const virtualShipId = nextShipId++;
                garrisonShipMap[virtualShipId] = ship.id;
                virtualShips.push({
                    ...ship,
                    id: virtualShipId,
                });
            }
        }
        const startingCurrent = persistedShieldCurrent !== null ? persistedShieldCurrent : totalShield;
        return {
            id: -planet.id,
            name: `${planet.name} Defenses`,
            factionId: planet.factionId,
            x: 0,
            y: 0,
            targetX: null,
            targetY: null,
            speed: 0,
            system: null,
            ships: virtualShips,
            destroyed: false,
            shieldPool: startingCurrent,
            shieldPoolRegen: totalShieldRegen,
            shieldPoolMax: totalShield,
            garrisonFleetId: garrisonFleet?.id,
            garrisonShipMap: garrisonFleet ? garrisonShipMap : undefined,
        };
    }
    /*
     * hasPlanetDefenses: Returns true if a planet has any defensive buildings.
     */
    hasPlanetDefenses(planet) {
        return planet.buildings.some((b) => {
            const def = this.buildingDefs.find((d) => d.name === b.name);
            return def?.role === 'defense';
        });
    }
    /*
     * reconcilePlanetShields: Clamps every persisted shield pool to its
     * building-defined maximum after a load. A missing value stays missing
     * (meaning "start full on next battle"); negative, NaN, and over-max
     * values are normalized instead of being allowed to poison battle state.
     */
    reconcilePlanetShields(starSystems) {
        for (const system of starSystems) {
            for (const planet of system.planetsTiles ?? []) {
                if (planet.shieldPoolCurrent === undefined) {
                    continue;
                }
                const totalShield = this.getTotalShieldForPlanet(planet);
                const current = typeof planet.shieldPoolCurrent === 'number' && Number.isFinite(planet.shieldPoolCurrent)
                    ? planet.shieldPoolCurrent
                    : totalShield;
                planet.shieldPoolCurrent = Math.max(0, Math.min(current, totalShield));
            }
        }
    }
    getTotalShieldForPlanet(planet) {
        return planet.buildings.reduce((sum, building) => {
            const def = this.buildingDefs.find((d) => d.name === building.name);
            if (def?.role === 'defense' && def.type === 'shield') {
                return sum + (def.shield ?? 0);
            }
            return sum;
        }, 0);
    }
    /*
     * getBuildingHitPoints: Returns the effective HP for a defense building.
     * Turrets use attack * 3 as HP, shields have their own shield value.
     */
    getBuildingHitPoints(def) {
        if (def.type === 'shield') {
            return def.shield ?? 0;
        }
        return (def.attack ?? 10) * 3;
    }
    /*
     * getBuildingAttack: Returns the attack value for a defense building.
     */
    getBuildingAttack(buildingName) {
        const def = this.buildingDefs.find((d) => d.name === buildingName);
        return def?.attack ?? 0;
    }
    /*
     * getBuildingDefense: Returns the effective defense for a defense building.
     * Used as flat damage reduction in battle calculations.
     */
    getBuildingDefense(buildingName) {
        const def = this.buildingDefs.find((d) => d.name === buildingName);
        if (!def)
            return 0;
        if (def.type === 'shield')
            return 5;
        return Math.floor((def.attack ?? 10) / 5);
    }
    /*
     * getVirtualShipType: Returns virtual ship type info for battle display.
     * Used by the battle screen to render building-type ships.
     */
    getVirtualShipType(typeId) {
        const def = this.buildingDefs.find((d) => d.id === typeId);
        if (!def)
            return null;
        return {
            id: def.id,
            name: def.name,
            hitPoints: this.getBuildingHitPoints(def),
            attack: def.attack ?? 0,
            defense: this.getBuildingDefense(def.name),
            attackType: def.attackType ?? 'kinetic',
            weakness: def.weakness ?? 'energy',
            role: def.role ?? 'defense',
        };
    }
    /*
     * resolveUninhabitedArrival: Handles fleet arrival at an uninhabited planet.
     * Returns the colonizer ship index if colonization occurs, -1 otherwise.
     */
    resolveUninhabitedArrival(fleet) {
        const colonizerIndex = fleet.ships.findIndex((s) => s.type === 'colonizer' && !s.destroyed);
        return {
            colonized: colonizerIndex >= 0,
            colonizerIndex,
        };
    }
};
PlanetBattleService = __decorate([
    Injectable({ providedIn: 'root' })
], PlanetBattleService);
export { PlanetBattleService };

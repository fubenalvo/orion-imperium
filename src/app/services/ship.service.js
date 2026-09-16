var ShipService_1;
import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import shipData from '../components/star-map/ship-data.json';
const DEFAULT_BUILD_TIME_PER_COST = 0.1;
let ShipService = ShipService_1 = class ShipService {
    shipTypes = shipData.shipTypes.map((t) => ShipService_1.normalizeShipType(t));
    shipTypeById = new Map(this.shipTypes.map((type) => [type.id, type]));
    getShipType(typeId) {
        return this.shipTypeById.get(typeId);
    }
    getAllShipTypes() {
        return this.shipTypes;
    }
    getShipTypeMap() {
        const map = new Map();
        for (const type of this.shipTypes) {
            map.set(type.id, { attack: type.attack, shield: type.shield });
        }
        return map;
    }
    /*
     * calculateFleetStrength: Returns the aggregate combat strength of a fleet
     * using the formula attack + defense + hitPoints/10 + shield/10 per ship.
     * Extracted from duplicated private methods in four AI services.
     */
    calculateFleetStrength(ships) {
        return ships.reduce((sum, ship) => {
            const shipType = this.getShipType(ship.type);
            if (!shipType) {
                return sum;
            }
            return sum + shipType.attack + shipType.defense + shipType.hitPoints / 10 + shipType.shield / 10;
        }, 0);
    }
    /*
     * normalizeShipType: Fills in production defaults for ship types
     * that did not declare them. `buildTime` defaults to `cost / 10`
     * seconds-at-1-factory so the existing `cost` field remains the
     * primary balancing knob. `productionBuilding` defaults to
     * `spaceship_factory`.
     */
    static normalizeShipType(t) {
        return {
            ...t,
            buildTime: t.buildTime ?? Math.max(1, t.cost * DEFAULT_BUILD_TIME_PER_COST),
            productionBuilding: t.productionBuilding ?? 'spaceship_factory',
        };
    }
};
ShipService = ShipService_1 = __decorate([
    Injectable({ providedIn: 'root' })
], ShipService);
export { ShipService };

var SpaceportService_1;
import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
/*
 * SpaceportService
 * ----------------
 * The `Spaceport` building is a permission flag, not a storage depot. This
 * service answers "does the faction have at least one Spaceport?" and
 * "which planets act as assembly points?". Ships are not stored here; they
 * live in the global stock.
 */
let SpaceportService = class SpaceportService {
    static { SpaceportService_1 = this; }
    static SPACEPORT_NAME = 'Spaceport';
    hasSpaceport(factionId, starSystems) {
        return this.listSpaceports(factionId, starSystems).length > 0;
    }
    listSpaceports(factionId, starSystems) {
        const out = [];
        for (const system of starSystems) {
            for (const planet of system.planetsTiles ?? []) {
                if (planet.factionId !== factionId) {
                    continue;
                }
                if (this.isSpaceportPlanet(planet)) {
                    out.push({ system, planet });
                }
            }
        }
        return out;
    }
    isSpaceportPlanet(planet) {
        if (!planet) {
            return false;
        }
        return (planet.buildings ?? []).some((b) => b.name === SpaceportService_1.SPACEPORT_NAME);
    }
};
SpaceportService = SpaceportService_1 = __decorate([
    Injectable({ providedIn: 'root' })
], SpaceportService);
export { SpaceportService };

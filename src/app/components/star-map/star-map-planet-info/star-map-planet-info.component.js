import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpperCasePipe } from '@angular/common';
let StarMapPlanetInfoComponent = class StarMapPlanetInfoComponent {
    planet = null;
    getFactionName = () => 'Unknown';
    getEnergyForPlanet = () => 0;
    getTaxForPlanet = () => 0;
    planetEconomy = null;
    close = new EventEmitter();
    openPlanet = new EventEmitter();
    get groupedBuildings() {
        if (!this.planet?.buildings) {
            return [];
        }
        const map = new Map();
        for (const b of this.planet.buildings) {
            const key = b.id ?? b.name;
            map.set(key, (map.get(key) || 0) + 1);
        }
        return Array.from(map, ([name, count]) => ({ name, count }));
    }
};
__decorate([
    Input()
], StarMapPlanetInfoComponent.prototype, "planet", void 0);
__decorate([
    Input()
], StarMapPlanetInfoComponent.prototype, "getFactionName", void 0);
__decorate([
    Input()
], StarMapPlanetInfoComponent.prototype, "getEnergyForPlanet", void 0);
__decorate([
    Input()
], StarMapPlanetInfoComponent.prototype, "getTaxForPlanet", void 0);
__decorate([
    Input()
], StarMapPlanetInfoComponent.prototype, "planetEconomy", void 0);
__decorate([
    Output()
], StarMapPlanetInfoComponent.prototype, "close", void 0);
__decorate([
    Output()
], StarMapPlanetInfoComponent.prototype, "openPlanet", void 0);
StarMapPlanetInfoComponent = __decorate([
    Component({
        selector: 'app-star-map-planet-info',
        standalone: true,
        imports: [CommonModule, UpperCasePipe],
        templateUrl: './star-map-planet-info.component.html',
        styleUrl: './star-map-planet-info.component.scss',
    })
], StarMapPlanetInfoComponent);
export { StarMapPlanetInfoComponent };

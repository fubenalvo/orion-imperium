import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
/*
 * =========================================================
 * BATTLE PLANET COMPONENT
 * =========================================================
 *
 * Presentational planet marker for planet battles. This is deliberately
 * separate from BattleStack: the planet is scenery and must never be
 * targetable, selectable, or part of combat state. The component only
 * renders the planet body, its name, and a bubble representing the shared
 * planetary shield fraction.
 */
let BattlePlanetComponent = class BattlePlanetComponent {
    planet = null;
    shieldFraction = 0;
    shieldOpacity() {
        return 0.25 + Math.max(0, Math.min(1, this.shieldFraction)) * 0.55;
    }
    shieldScale() {
        return 1 + Math.max(0, Math.min(1, this.shieldFraction)) * 0.08;
    }
};
__decorate([
    Input()
], BattlePlanetComponent.prototype, "planet", void 0);
__decorate([
    Input()
], BattlePlanetComponent.prototype, "shieldFraction", void 0);
BattlePlanetComponent = __decorate([
    Component({
        selector: 'app-battle-planet',
        standalone: true,
        templateUrl: './battle-planet.component.html',
        styleUrl: './battle-planet.component.scss',
    })
], BattlePlanetComponent);
export { BattlePlanetComponent };

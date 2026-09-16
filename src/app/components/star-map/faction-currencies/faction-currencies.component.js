import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let FactionCurrenciesComponent = class FactionCurrenciesComponent {
    currencies = [];
    economyBreakdown = null;
    openResearchTree = new EventEmitter();
    showBreakdown = false;
    selectedCurrency = null;
    expandedPlanet = null;
    toggleBreakdown(currencyName) {
        const validCurrencies = ['credits', 'rawmaterials'];
        if (!validCurrencies.includes(currencyName))
            return;
        if (this.showBreakdown && this.selectedCurrency === currencyName) {
            this.showBreakdown = false;
            this.selectedCurrency = null;
        }
        else {
            this.showBreakdown = true;
            this.selectedCurrency = currencyName;
        }
        this.expandedPlanet = null;
    }
    onCurrencyValueClick(currencyName) {
        if (currencyName === 'research') {
            this.openResearchTree.emit();
        }
        else {
            this.toggleBreakdown(currencyName);
        }
    }
    closeBreakdown() {
        this.showBreakdown = false;
        this.selectedCurrency = null;
        this.expandedPlanet = null;
    }
    togglePlanet(planetName) {
        this.expandedPlanet = this.expandedPlanet === planetName ? null : planetName;
    }
    isPlanetExpanded(planetName) {
        return this.expandedPlanet === planetName;
    }
    getSelectedCurrencyLabel() {
        if (!this.selectedCurrency)
            return '';
        const labels = {
            credits: 'Credits',
            rawmaterials: 'Raw Materials',
            research: 'Research Points',
            energy: 'Energy',
        };
        return labels[this.selectedCurrency] || this.selectedCurrency.toUpperCase();
    }
    getProductionForCurrency() {
        if (!this.economyBreakdown || !this.selectedCurrency)
            return 0;
        return this.economyBreakdown.production[this.selectedCurrency] ?? 0;
    }
    getConsumptionForCurrency() {
        if (!this.economyBreakdown || !this.selectedCurrency)
            return 0;
        return this.economyBreakdown.consumption[this.selectedCurrency] ?? 0;
    }
    getNetForCurrency() {
        if (!this.economyBreakdown || !this.selectedCurrency)
            return 0;
        return this.economyBreakdown.net[this.selectedCurrency] ?? 0;
    }
    getPlanetNet(planet) {
        if (!this.selectedCurrency)
            return 0;
        return planet.netRates[this.selectedCurrency] ?? 0;
    }
    getPlanetProduction(planet) {
        if (!this.selectedCurrency)
            return 0;
        return planet.production[this.selectedCurrency] ?? 0;
    }
    getPlanetConsumption(planet) {
        if (!this.selectedCurrency)
            return 0;
        return planet.consumption[this.selectedCurrency] ?? 0;
    }
    hasPlanetActivity(planet) {
        if (!this.selectedCurrency)
            return false;
        return (planet.production[this.selectedCurrency] ?? 0) !== 0 || (planet.consumption[this.selectedCurrency] ?? 0) !== 0;
    }
};
__decorate([
    Input()
], FactionCurrenciesComponent.prototype, "currencies", void 0);
__decorate([
    Input()
], FactionCurrenciesComponent.prototype, "economyBreakdown", void 0);
__decorate([
    Output()
], FactionCurrenciesComponent.prototype, "openResearchTree", void 0);
FactionCurrenciesComponent = __decorate([
    Component({
        selector: 'app-faction-currencies',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './faction-currencies.component.html',
        styleUrl: './faction-currencies.component.scss',
    })
], FactionCurrenciesComponent);
export { FactionCurrenciesComponent };

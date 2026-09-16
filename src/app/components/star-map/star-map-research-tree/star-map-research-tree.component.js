import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapResearchTreeComponent = class StarMapResearchTreeComponent {
    researchService;
    faction = null;
    close = new EventEmitter();
    researched = new EventEmitter();
    constructor(researchService) {
        this.researchService = researchService;
    }
    getAllTechnologies() {
        return this.researchService.getAllTechnologies();
    }
    getStatus(technologyId) {
        if (!this.faction)
            return 'locked';
        return this.researchService.getStatus(this.faction, technologyId);
    }
    canResearch(technologyId) {
        if (!this.faction)
            return false;
        return this.researchService.canResearch(this.faction, technologyId);
    }
    getResearchPoints() {
        return this.faction?.currencies['research'] ?? 0;
    }
    onClose() {
        this.close.emit();
    }
    onResearch(technologyId) {
        if (!this.faction)
            return;
        const result = this.researchService.researchTechnology(this.faction, technologyId);
        if (result.ok) {
            this.researched.emit();
        }
    }
    getStatusLabel(status) {
        switch (status) {
            case 'researched':
                return 'RESEARCHED';
            case 'available':
                return 'AVAILABLE';
            case 'locked':
                return 'LOCKED';
            default:
                return 'UNKNOWN';
        }
    }
    getPrerequisiteNames(tech) {
        return tech.prerequisites
            .map((id) => this.researchService.getTechnology(id)?.name ?? id)
            .filter(Boolean);
    }
};
__decorate([
    Input()
], StarMapResearchTreeComponent.prototype, "faction", void 0);
__decorate([
    Output()
], StarMapResearchTreeComponent.prototype, "close", void 0);
__decorate([
    Output()
], StarMapResearchTreeComponent.prototype, "researched", void 0);
StarMapResearchTreeComponent = __decorate([
    Component({
        selector: 'app-star-map-research-tree',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-research-tree.component.html',
        styleUrl: './star-map-research-tree.component.scss',
    })
], StarMapResearchTreeComponent);
export { StarMapResearchTreeComponent };

import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { SAVE_VERSION, CURRENT_MAP_GRID, validateSaveData } from './save-validation';
export const SaveSlotId = {
    AUTOSAVE: 0,
    MANUAL_1: 1,
    MANUAL_2: 2,
    MANUAL_3: 3,
    MANUAL_4: 4,
};
export const MANUAL_SLOT_START = SaveSlotId.MANUAL_1;
export const MANUAL_SLOT_COUNT = 4;
export const TOTAL_SLOT_COUNT = MANUAL_SLOT_COUNT + 1;
let SaveGameService = class SaveGameService {
    storageKey = 'orion_save_slots';
    backupKey = 'orion_save_slots_corrupt_backup';
    slotCount = TOTAL_SLOT_COUNT;
    currentSlot = null;
    /*
     * Last persistence error, or null when the last operation succeeded.
     * Used by the UI to avoid reporting "GAME SAVED" after a failed write.
     * Note that activation/validation errors also surface here.
     */
    lastError = null;
    getSlotsError() {
        return this.lastError;
    }
    getSlots() {
        let raw = null;
        try {
            raw = localStorage.getItem(this.storageKey);
        }
        catch {
            this.lastError = 'storage_unavailable';
            return this.emptySlots();
        }
        if (!raw) {
            this.lastError = null;
            return this.emptySlots();
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            this.lastError = 'save_corrupt_parse';
            this.backupRaw(raw);
            return this.emptySlots();
        }
        if (!Array.isArray(parsed)) {
            this.lastError = 'save_corrupt_shape';
            this.backupRaw(raw);
            return this.emptySlots();
        }
        const slots = this.emptySlots();
        let sawCorruptSlot = false;
        for (let i = 0; i < this.slotCount; i++) {
            try {
                const slot = parsed[i];
                if (slot && typeof slot === 'object' && slot.data) {
                    const migrated = this.migrateSave(slot.data);
                    if (this.isSlotShapeValid(migrated)) {
                        slots[i] = { data: migrated, date: slot.date ?? null };
                    }
                    else {
                        sawCorruptSlot = true;
                        slots[i] = { data: null, date: null };
                    }
                }
                else {
                    slots[i] = { data: null, date: null };
                }
            }
            catch {
                sawCorruptSlot = true;
                slots[i] = { data: null, date: null };
            }
        }
        if (sawCorruptSlot) {
            this.lastError = 'slot_corrupt';
            this.backupRaw(raw);
        }
        else {
            this.lastError = null;
        }
        return slots;
    }
    getSlot(slotIndex) {
        const slots = this.getSlots();
        return slots[slotIndex] ?? { data: null, date: null };
    }
    saveToSlot(slotIndex, data) {
        const slots = this.getSlots();
        slots[slotIndex] = {
            data,
            date: new Date().toISOString(),
        };
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(slots));
            this.lastError = null;
            return true;
        }
        catch {
            this.lastError = 'save_quota_error';
            return false;
        }
    }
    loadFromSlot(slotIndex) {
        const slot = this.getSlot(slotIndex);
        if (!slot.data) {
            return null;
        }
        return this.migrateSave(slot.data);
    }
    /*
     * activateSlot: Prepares a save slot as the active session.
     *
     * The active session is always backed by the AUTOSAVE slot (slot 0).
     * Loading a manual slot copies its full snapshot into autosave and
     * switches `currentSlot` to 0 so every subsequent runtime save writes
     * to the same slot that reloadAfterBattle / loadGame read back.
     *
     * The selected manual snapshot is never mutated by activation, and
     * malformed slots leave the current session untouched.
     */
    activateSlot(slotIndex) {
        const previousSlot = this.currentSlot;
        const slot = this.getSlot(slotIndex);
        if (!slot.data || !this.isValidSaveData(slot.data)) {
            return false;
        }
        if (slotIndex !== SaveSlotId.AUTOSAVE) {
            if (!this.saveToSlot(SaveSlotId.AUTOSAVE, this.migrateSave(slot.data))) {
                this.currentSlot = previousSlot;
                return false;
            }
        }
        this.currentSlot = SaveSlotId.AUTOSAVE;
        return true;
    }
    isValidSaveData(data) {
        const result = validateSaveData(data);
        if (!result.ok) {
            this.lastError = `save_invalid: ${result.errors[0]?.message ?? 'unknown error'}`;
            return false;
        }
        return true;
    }
    /*
     * migrateSave: Backfills optional fields introduced after the original
     * save format and runs the versioned legacy migration.
     *
     * Version 0 -> SAVE_VERSION conversions are intentionally placed here
     * (not in StarMap) so the same migration runs on slot reads, activation,
     * and saves, and so it can be made idempotent in one place.
     */
    migrateSave(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        const version = typeof data.saveVersion === 'number' ? data.saveVersion : 0;
        if (!data.shipStock) {
            data.shipStock = [];
        }
        if (!data.production) {
            data.production = [];
        }
        const systems = Array.isArray(data.starSystems) ? data.starSystems : [];
        for (const system of systems) {
            const planets = Array.isArray(system?.planetsTiles) ? system.planetsTiles : [];
            for (const planet of planets) {
                if (!planet.resourceTiles) {
                    planet.resourceTiles = [];
                }
            }
        }
        const factions = Array.isArray(data.factions) ? data.factions : [];
        for (const faction of factions) {
            if (faction.ai === undefined) {
                // Old saves lack the ai flag; derive it from team (team 2+ = AI-controlled).
                faction.ai = faction.team >= 2;
            }
            if (!faction.researchedTechnologies) {
                faction.researchedTechnologies = [
                    'basic_engineering',
                    'basic_science',
                    'basic_industry',
                    'basic_power',
                ];
            }
        }
        if (data.map && data.map.width === 200) {
            this.migrateLegacyGrid(data);
        }
        if (version < SAVE_VERSION) {
            data.saveVersion = SAVE_VERSION;
        }
        return data;
    }
    /*
     * migrateLegacyGrid: Converts the old 200vw map (map.width === 200)
     * to 1-indexed grid cells using a 2vw reference cell size, then pins
     * the map to the current grid dimensions so the migration never runs
     * twice. System-view coordinates are converted with the 5vw reference
     * cell size used by StarMapMovementService.
     */
    migrateLegacyGrid(data) {
        const mapRefCellSize = 2;
        const systemRefCellSize = 5;
        const maxX = CURRENT_MAP_GRID.width;
        const maxY = CURRENT_MAP_GRID.height;
        const maxSystemCol = 18;
        const maxSystemRow = 10;
        const toGrid = (value, refCellSize, max) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return value;
            }
            const grid = Math.floor(value / refCellSize) + 1;
            return Math.max(1, Math.min(grid, max));
        };
        if (data.map) {
            data.map.width = maxX;
            data.map.height = maxY;
        }
        for (const system of Array.isArray(data.starSystems) ? data.starSystems : []) {
            system.x = toGrid(system.x, mapRefCellSize, maxX);
            system.y = toGrid(system.y, mapRefCellSize, maxY);
        }
        for (const fleet of Array.isArray(data.fleets) ? data.fleets : []) {
            fleet.x = toGrid(fleet.x, mapRefCellSize, maxX);
            fleet.y = toGrid(fleet.y, mapRefCellSize, maxY);
            if (typeof fleet.targetX === 'number') {
                fleet.targetX = toGrid(fleet.targetX, mapRefCellSize, maxX);
            }
            if (typeof fleet.targetY === 'number') {
                fleet.targetY = toGrid(fleet.targetY, mapRefCellSize, maxY);
            }
            if (fleet.system) {
                fleet.system.x = toGrid(fleet.system.x, systemRefCellSize, maxSystemCol);
                fleet.system.y = toGrid(fleet.system.y, systemRefCellSize, maxSystemRow);
                if (typeof fleet.system.targetX === 'number') {
                    fleet.system.targetX = toGrid(fleet.system.targetX, systemRefCellSize, maxSystemCol);
                }
                if (typeof fleet.system.targetY === 'number') {
                    fleet.system.targetY = toGrid(fleet.system.targetY, systemRefCellSize, maxSystemRow);
                }
            }
        }
        if (typeof data.targetX === 'number') {
            data.targetX = toGrid(data.targetX, mapRefCellSize, maxX);
        }
        if (typeof data.targetY === 'number') {
            data.targetY = toGrid(data.targetY, mapRefCellSize, maxY);
        }
    }
    clearSlot(slotIndex) {
        const slots = this.getSlots();
        slots[slotIndex] = { data: null, date: null };
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(slots));
            this.lastError = null;
        }
        catch {
            this.lastError = 'save_quota_error';
        }
    }
    hasAnySave() {
        return this.getSlots().some((slot) => slot.data !== null);
    }
    /*
     * getMostRecentSlotIndex: Returns the index of the save slot with the
     * latest date. Returns null if no saves exist or no readable date exists.
     */
    getMostRecentSlotIndex() {
        const slots = this.getSlots();
        let bestIndex = null;
        let bestDate = null;
        for (let i = 0; i < slots.length; i++) {
            const dateValue = this.parseSlotDate(slots[i].date);
            if (dateValue !== null && (bestDate === null || dateValue > bestDate)) {
                bestDate = dateValue;
                bestIndex = i;
            }
        }
        return bestIndex;
    }
    parseSlotDate(date) {
        if (!date) {
            return null;
        }
        const timestamp = Date.parse(date);
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    emptySlots() {
        return Array.from({ length: this.slotCount }, () => ({ data: null, date: null }));
    }
    /*
     * isSlotShapeValid: Top-level structural check applied while listing slots.
     * Deliberately permissive (empty arrays are accepted at list time) so
     * battle-screen autosaves and legacy seeds still list; strict domain
     * validation is intentionally NOT applied here — it belongs to activation
     * and load so partial data can never be destroyed by a list read.
     */
    isSlotShapeValid(data) {
        return (typeof data === 'object' &&
            data !== null &&
            Array.isArray(data.fleets) &&
            Array.isArray(data.starSystems) &&
            Array.isArray(data.factions));
    }
    backupRaw(raw) {
        try {
            localStorage.setItem(this.backupKey, raw);
        }
        catch {
            // Backup is best-effort; the original raw string may still be recoverable manually.
        }
    }
};
SaveGameService = __decorate([
    Injectable({ providedIn: 'root' })
], SaveGameService);
export { SaveGameService };

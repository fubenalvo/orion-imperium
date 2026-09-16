import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveGameService, SaveSlotId } from './save-game.service';
import { SAVE_VERSION, validateSaveData } from './save-validation';
const PLAYER_FACTION = {
    id: 'player',
    name: 'Player',
    color: '#8cc4ff',
    team: 1,
    ai: false,
    currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
};
const ENEMY1_FACTION = {
    id: 'enemy1',
    name: 'Enemy 1',
    color: '#d65757',
    team: 2,
    ai: true,
    currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
};
const makeData = (overrides = {}, factions = [PLAYER_FACTION, ENEMY1_FACTION]) => ({
    factions,
    map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [
        {
            id: 'sol',
            name: 'Sol',
            x: 1,
            y: 1,
            planets: 0,
            color: '#ffffff',
            planetsTiles: [],
            explored: true,
        },
    ],
    fleets: [],
    ...overrides,
});
describe('SaveGameService — research migration', () => {
    let service;
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        service = new SaveGameService();
    });
    afterEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
    });
    it('should backfill researchedTechnologies with starting techs for factions that lack the field', () => {
        const data = makeData();
        const migrated = service.migrateSave(data);
        for (const faction of migrated.factions) {
            expect(faction.researchedTechnologies).toEqual([
                'basic_engineering',
                'basic_science',
                'basic_industry',
                'basic_power',
            ]);
        }
    });
    it('should not overwrite existing researchedTechnologies', () => {
        const data = makeData({
            factions: [
                {
                    id: 'player',
                    name: 'Player',
                    color: '#8cc4ff',
                    team: 1,
                    ai: false,
                    currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
                    researchedTechnologies: ['basic_engineering'],
                },
            ],
        });
        const migrated = service.migrateSave(data);
        expect(migrated.factions[0].researchedTechnologies).toEqual(['basic_engineering']);
    });
    it('should backfill the ai flag from team (team 2 → ai: true)', () => {
        const data = makeData({
            factions: [
                { id: 'player', name: 'Player', color: '#fff', team: 1, currencies: {} },
                { id: 'enemy1', name: 'Enemy 1', color: '#f00', team: 2, currencies: {} },
                { id: 'independent', name: 'Independent', color: '#ff0', team: 0, currencies: {} },
            ],
        });
        const migrated = service.migrateSave(data);
        expect(migrated.factions[0].ai).toBe(false);
        expect(migrated.factions[1].ai).toBe(true);
        expect(migrated.factions[2].ai).toBe(false);
    });
    it('should not overwrite an existing ai flag', () => {
        const data = makeData({
            factions: [
                { id: 'enemy1', name: 'Enemy 1', color: '#f00', team: 2, ai: false, currencies: {} },
            ],
        });
        const migrated = service.migrateSave(data);
        expect(migrated.factions[0].ai).toBe(false);
    });
    it('should preserve other migration behaviors', () => {
        const data = makeData({
            shipStock: undefined,
            production: undefined,
            starSystems: [
                {
                    id: 'sol',
                    name: 'SOL',
                    x: 1,
                    y: 1,
                    planets: 1,
                    color: '#ffcc00',
                    planetsTiles: [
                        {
                            id: 1,
                            index: 1,
                            name: 'Earth',
                            factionId: 'player',
                            x: 1,
                            y: 1,
                            type: 'earthlike',
                            size: 'medium',
                            population: 100,
                            buildings: [],
                            explored: true,
                        },
                    ],
                },
            ],
        });
        const migrated = service.migrateSave(data);
        expect(migrated.shipStock).toEqual([]);
        expect(migrated.production).toEqual([]);
        expect(migrated.starSystems[0].planetsTiles[0].resourceTiles).toEqual([]);
    });
});
describe('SaveGameService — active session activation', () => {
    let service;
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        service = new SaveGameService();
    });
    afterEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
    });
    it('should copy a manual snapshot into autosave and select slot 0 on activation', () => {
        const manual = makeData({
            fleets: [{ id: 1, name: 'ORION', factionId: 'player', x: 5, y: 5, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        service.saveToSlot(1, manual);
        expect(service.activateSlot(1)).toBe(true);
        expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);
        const active = service.loadFromSlot(SaveSlotId.AUTOSAVE);
        expect(active).not.toBeNull();
        expect(active.fleets[0].id).toBe(1);
        expect(active.fleets[0].name).toBe('ORION');
        // The manual snapshot itself is not mutated by activation.
        const manualReloaded = service.loadFromSlot(1);
        expect(manualReloaded.fleets[0].name).toBe('ORION');
    });
    it('should be a no-op copy when activating the autosave slot itself', () => {
        const active = makeData({
            fleets: [{ id: 7, name: 'PEGASUS', factionId: 'player', x: 9, y: 9, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        service.saveToSlot(SaveSlotId.AUTOSAVE, active);
        expect(service.activateSlot(SaveSlotId.AUTOSAVE)).toBe(true);
        expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);
        const reloaded = service.loadFromSlot(SaveSlotId.AUTOSAVE);
        expect(reloaded.fleets[0].id).toBe(7);
    });
    it('should not change the current session for an empty or invalid slot', () => {
        const active = makeData({
            fleets: [{ id: 3, name: 'Fleet', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        service.saveToSlot(SaveSlotId.AUTOSAVE, active);
        service.currentSlot = SaveSlotId.AUTOSAVE;
        expect(service.activateSlot(2)).toBe(false);
        expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);
        const reloaded = service.loadFromSlot(SaveSlotId.AUTOSAVE);
        expect(reloaded.fleets[0].id).toBe(3);
    });
    it('should reject a truthy-but-malformed manual slot without overwriting autosave', () => {
        const active = makeData({
            fleets: [{ id: 9, name: 'Live Fleet', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        service.saveToSlot(SaveSlotId.AUTOSAVE, active);
        service.currentSlot = SaveSlotId.AUTOSAVE;
        // Truthy but missing fleets/starSystems/factions — must not clobber autosave.
        service.saveToSlot(2, { map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 } });
        expect(service.activateSlot(2)).toBe(false);
        expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);
        const reloaded = service.loadFromSlot(SaveSlotId.AUTOSAVE);
        expect(reloaded.fleets[0].id).toBe(9);
    });
    it('should keep the active session when copying a manual slot fails', () => {
        const active = makeData({
            fleets: [{ id: 9, name: 'Live Fleet', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        const manual = makeData({
            fleets: [{ id: 10, name: 'Manual Fleet', factionId: 'player', x: 2, y: 2, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
        });
        service.saveToSlot(SaveSlotId.AUTOSAVE, active);
        service.saveToSlot(1, manual);
        service.currentSlot = SaveSlotId.AUTOSAVE;
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        expect(service.activateSlot(1)).toBe(false);
        expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);
        expect(service.lastError).toBe('save_quota_error');
        expect(service.loadFromSlot(SaveSlotId.AUTOSAVE).fleets[0].id).toBe(9);
        expect(setItemSpy).toHaveBeenCalled();
        setItemSpy.mockRestore();
    });
});
describe('SaveGameService — versioned migration and resilience', () => {
    let service;
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        service = new SaveGameService();
    });
    afterEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
    });
    it('migrates legacy map coordinates once and pins the map dimensions', () => {
        const legacy = makeData({
            map: { width: 200, height: 120, cellSizeVw: 2, cellSizeVh: 2 },
            starSystems: [
                { id: 'sol', name: 'Sol', x: 40, y: 20, planets: 0, color: '#fff', planetsTiles: [], explored: true },
            ],
            fleets: [
                { id: 1, name: 'F', factionId: 'player', x: 80, y: 40, targetX: 160, targetY: 80, speed: 4, ships: [], destroyed: false, system: null },
            ],
        });
        const first = service.migrateSave(legacy);
        expect(first.saveVersion).toBe(SAVE_VERSION);
        expect(first.map.width).toBe(300);
        const systemBefore = first.starSystems[0].x;
        const fleetBefore = first.fleets[0].x;
        expect(systemBefore).toBe(21);
        expect(fleetBefore).toBe(41);
        expect(first.fleets[0].targetX).toBe(81);
        // A second pass must not re-convert the now-grid coordinates.
        const second = service.migrateSave(first);
        expect(second.starSystems[0].x).toBe(systemBefore);
        expect(second.fleets[0].x).toBe(fleetBefore);
        expect(second.fleets[0].targetX).toBe(81);
    });
    it('sets saveVersion on modern saves without running legacy conversion', () => {
        const modern = makeData();
        const migrated = service.migrateSave(modern);
        expect(migrated.saveVersion).toBe(SAVE_VERSION);
        expect(migrated.map.width).toBe(100);
    });
    it('warns about unknown ship types without rejecting the save', () => {
        const data = makeData({
            fleets: [
                {
                    id: 1,
                    name: 'Unknown Fleet',
                    factionId: 'player',
                    x: 1,
                    y: 1,
                    targetX: null,
                    targetY: null,
                    speed: 1,
                    ships: [{ id: 1, name: 'Unknown', type: 'ship_that_does_not_exist' }],
                    destroyed: false,
                    system: null,
                },
            ],
            shipStock: [
                {
                    factionId: 'player',
                    ships: [{ id: 2, name: 'Unknown Stock', type: 'stock_type_unknown' }],
                },
            ],
            production: [
                {
                    factionId: 'player',
                    ordersByPlanet: {
                        1: [
                            {
                                id: 1,
                                shipTypeId: 'production_type_unknown',
                                quantity: 1,
                                progress: 0,
                                startedAtTick: 0,
                            },
                        ],
                    },
                },
            ],
        });
        const result = validateSaveData(data);
        expect(result.ok).toBe(true);
        expect(result.warnings.map((issue) => issue.code)).toEqual([
            'ship_type_unknown',
            'stock_ship_type_unknown',
            'order_ship_type_unknown',
        ]);
    });
    it('ignores malformed dates when selecting the most recent slot', () => {
        service.saveToSlot(1, makeData({ fleets: [{ id: 1, name: 'Old', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 1, ships: [], destroyed: false, system: null }] }));
        service.saveToSlot(2, makeData({ fleets: [{ id: 2, name: 'New', factionId: 'player', x: 2, y: 2, targetX: null, targetY: null, speed: 1, ships: [], destroyed: false, system: null }] }));
        const raw = JSON.parse(localStorage.getItem('orion_save_slots'));
        raw[0].date = 'not-a-date';
        raw[1].date = '2026-01-02T00:00:00.000Z';
        raw[2].date = '2026-01-03T00:00:00.000Z';
        localStorage.setItem('orion_save_slots', JSON.stringify(raw));
        expect(service.getMostRecentSlotIndex()).toBe(2);
    });
    it('rejects a save with a newer format version', () => {
        const data = makeData({ saveVersion: SAVE_VERSION + 1 });
        expect(service.isValidSaveData(data)).toBe(false);
        expect(service.lastError).toContain('save_invalid');
    });
    it('accepts an unversioned save for migration', () => {
        const data = makeData();
        delete data.saveVersion;
        expect(service.isValidSaveData(data)).toBe(true);
    });
    it('isolates a malformed slot from readable slots and quarantines the raw value', () => {
        service.saveToSlot(SaveSlotId.AUTOSAVE, makeData());
        service.saveToSlot(1, makeData({ fleets: [{ id: 4, name: 'G', factionId: 'player', x: 2, y: 2, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }] }));
        // Manually corrupt slot 1's nested shape in the raw JSON.
        const raw = JSON.parse(localStorage.getItem('orion_save_slots'));
        raw[1].data.starSystems = { broken: true };
        raw[1].data.fleets = null;
        localStorage.setItem('orion_save_slots', JSON.stringify(raw));
        const slots = service.getSlots();
        expect(slots[0].data).not.toBeNull();
        expect(slots[1].data).toBeNull();
        expect(slots[2].data).toBeNull();
        expect(localStorage.getItem('orion_save_slots_corrupt_backup')).not.toBeNull();
    });
    it('rejects saves without a player faction', () => {
        const data = makeData();
        data.factions = [
            { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, currencies: { credits: 0, rawmaterials: 0, research: 0 } },
        ];
        expect(service.isValidSaveData(data)).toBe(false);
        expect(service.lastError).toContain('save_invalid');
    });
});

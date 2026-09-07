import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SaveGameService, SaveSlotId } from './save-game.service';
import { StarMapData, Faction } from '../components/star-map/star-map.models';

const PLAYER_FACTION = {
  id: 'player',
  name: 'Player',
  color: '#8cc4ff',
  team: 1,
  ai: false,
  currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
} as Faction;

const ENEMY1_FACTION = {
  id: 'enemy1',
  name: 'Enemy 1',
  color: '#d65757',
  team: 2,
  ai: true,
  currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
} as Faction;

const makeData = (
  overrides: Partial<StarMapData> = {},
  factions: Faction[] = [PLAYER_FACTION, ENEMY1_FACTION],
): StarMapData => ({
  factions,
  map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
  starSystems: [],
  fleets: [],
  ...overrides,
});

describe('SaveGameService — research migration', () => {
  let service: SaveGameService;

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
        } as Faction,
      ],
    });
    const migrated = service.migrateSave(data);

    expect(migrated.factions[0].researchedTechnologies).toEqual(['basic_engineering']);
  });

  it('should backfill the ai flag from team (team 2 → ai: true)', () => {
    const data = makeData({
      factions: [
        { id: 'player', name: 'Player', color: '#fff', team: 1, currencies: {} } as Faction,
        { id: 'enemy1', name: 'Enemy 1', color: '#f00', team: 2, currencies: {} } as Faction,
        { id: 'independent', name: 'Independent', color: '#ff0', team: 0, currencies: {} } as Faction,
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
        { id: 'enemy1', name: 'Enemy 1', color: '#f00', team: 2, ai: false, currencies: {} } as Faction,
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
  let service: SaveGameService;

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
    expect(active!.fleets[0].id).toBe(1);
    expect(active!.fleets[0].name).toBe('ORION');

    // The manual snapshot itself is not mutated by activation.
    const manualReloaded = service.loadFromSlot(1);
    expect(manualReloaded!.fleets[0].name).toBe('ORION');
  });

  it('should be a no-op copy when activating the autosave slot itself', () => {
    const active = makeData({
      fleets: [{ id: 7, name: 'PEGASUS', factionId: 'player', x: 9, y: 9, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
    });
    service.saveToSlot(SaveSlotId.AUTOSAVE, active);

    expect(service.activateSlot(SaveSlotId.AUTOSAVE)).toBe(true);
    expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);

    const reloaded = service.loadFromSlot(SaveSlotId.AUTOSAVE);
    expect(reloaded!.fleets[0].id).toBe(7);
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
    expect(reloaded!.fleets[0].id).toBe(3);
  });

  it('should reject a truthy-but-malformed manual slot without overwriting autosave', () => {
    const active = makeData({
      fleets: [{ id: 9, name: 'Live Fleet', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
    });
    service.saveToSlot(SaveSlotId.AUTOSAVE, active);
    service.currentSlot = SaveSlotId.AUTOSAVE;

    // Truthy but missing fleets/starSystems/factions — must not clobber autosave.
    service.saveToSlot(2, { map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 } } as StarMapData);

    expect(service.activateSlot(2)).toBe(false);
    expect(service.currentSlot).toBe(SaveSlotId.AUTOSAVE);

    const reloaded = service.loadFromSlot(SaveSlotId.AUTOSAVE);
    expect(reloaded!.fleets[0].id).toBe(9);
  });
});

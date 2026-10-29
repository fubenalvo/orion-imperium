import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveGameService, SaveSlotId } from './save-game.service';
import { StarMapData, Faction } from '../components/star-map/star-map.models';
import { SAVE_VERSION, validateSaveData } from './save-validation';

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
    expect(service.loadFromSlot(SaveSlotId.AUTOSAVE)!.fleets[0].id).toBe(9);
    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
  });
});

describe('SaveGameService — versioned migration and resilience', () => {
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

    const raw = JSON.parse(localStorage.getItem('orion_save_slots')!) as Array<{ date: string | null }>;
    raw[0].date = 'not-a-date';
    raw[1].date = '2026-01-02T00:00:00.000Z';
    raw[2].date = '2026-01-03T00:00:00.000Z';
    localStorage.setItem('orion_save_slots', JSON.stringify(raw));

    expect(service.getMostRecentSlotIndex()).toBe(2);
  });

  it('rejects a save with a newer format version', () => {
    const data = makeData({ saveVersion: SAVE_VERSION + 1 } as Partial<StarMapData>);

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
    const raw = JSON.parse(localStorage.getItem('orion_save_slots')!) as {
      data: StarMapData;
      date: string | null;
    }[];
    (raw[1].data as unknown as { starSystems: unknown }).starSystems = { broken: true };
    (raw[1].data as unknown as { fleets: unknown }).fleets = null;
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

describe('SaveGameService — v3 generated-galaxy fields', () => {
  let service: SaveGameService;

  beforeEach(() => {
    localStorage.clear();
    service = new SaveGameService();
  });

  afterEach(() => localStorage.clear());

  it('backfills the legacy black hole for pre-v3 saves of the legacy map', () => {
    const data = makeData({ map: { width: 300, height: 180, cellSizeVw: 2, cellSizeVh: 2 }, saveVersion: 2 });
    const migrated = service.migrateSave(data);
    expect(migrated.specialObjects).toEqual([
      { x: 100, y: 90, type: 'blackhole', width: 4, height: 5, component: 'blackhole' },
    ]);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
  });

  it('does not backfill objects that fall outside a small legacy grid', () => {
    const migrated = service.migrateSave(makeData());
    expect(migrated.specialObjects).toEqual([]);
  });

  it('never touches special objects of generated galaxies', () => {
    const hole = { x: 119, y: 71, type: 'blackhole', width: 4, height: 4, component: 'blackhole' };
    const data = makeData({
      map: { width: 240, height: 144, cellSizeVw: 2, cellSizeVh: 2 },
      galaxy: { size: 'medium', seed: 9, requestedSeed: null, generatorVersion: 1 },
      specialObjects: [hole],
    });
    service.saveToSlot(1, data);
    const loaded = service.loadFromSlot(1)!;
    expect(loaded.specialObjects).toEqual([hole]);
    expect(loaded.map.width).toBe(240);
    expect(loaded.galaxy).toEqual({ size: 'medium', seed: 9, requestedSeed: null, generatorVersion: 1 });
  });

  it("defaults missing AI difficulty to 'normal' and keeps explicit difficulty", () => {
    const hardAi = { ...ENEMY1_FACTION, id: 'enemy2', aiDifficulty: 'hard' as const };
    const migrated = service.migrateSave(makeData({}, [{ ...PLAYER_FACTION }, { ...ENEMY1_FACTION }, hardAi]));
    expect(migrated.factions[0].aiDifficulty).toBeUndefined();
    expect(migrated.factions[1].aiDifficulty).toBe('normal');
    expect(migrated.factions[2].aiDifficulty).toBe('hard');
  });

  it('rejects malformed v3 fields', () => {
    expect(validateSaveData(makeData({ specialObjects: 'nope' as never })).ok).toBe(false);
    expect(validateSaveData(makeData({ galaxy: { size: 'huge', seed: 1 } as never })).ok).toBe(false);
    const badAi = { ...ENEMY1_FACTION, aiDifficulty: 'insane' as never };
    expect(validateSaveData(makeData({}, [PLAYER_FACTION, badAi])).ok).toBe(false);
  });
});

describe('SaveGameService — v4 terrain and asteroid events', () => {
  let service: SaveGameService;

  beforeEach(() => {
    localStorage.clear();
    service = new SaveGameService();
  });

  afterEach(() => localStorage.clear());

  const legacySave = () =>
    makeData({
      map: { width: 240, height: 144, cellSizeVw: 2, cellSizeVh: 2 },
      galaxy: { size: 'medium', seed: 314, requestedSeed: null, generatorVersion: 2 },
      specialObjects: [{ x: 119, y: 71, type: 'blackhole', width: 4, height: 4, component: 'blackhole' }],
      saveVersion: 3,
    });

  it('backfills nebulae and asteroid state once, deterministically, for older saves', () => {
    const first = service.migrateSave(legacySave());
    expect(first.nebulae!.length).toBeGreaterThan(0);
    expect(first.asteroidEvents).toEqual(expect.objectContaining({ nextId: 1, active: [] }));
    expect(first.saveVersion).toBe(SAVE_VERSION);
    // Same save migrated again (e.g. another slot read) yields the same clouds.
    expect(service.migrateSave(legacySave()).nebulae).toEqual(first.nebulae);
  });

  it('never regenerates nebulae that a save already carries', () => {
    const custom = [{ id: 9, x: 50, y: 50, radius: 6, lobes: [1, 0.8, 1.2], rotation: 0, color: '#fff' }];
    const data = { ...legacySave(), nebulae: custom, saveVersion: SAVE_VERSION };
    service.saveToSlot(1, data);
    expect(service.loadFromSlot(1)!.nebulae).toEqual(custom);
  });

  it('round-trips active asteroids through a save slot', () => {
    const asteroid = {
      id: 3, type: 'ore' as const, startX: 0.5, startY: 20, dirX: 1, dirY: 0, speed: 0.15,
      traveled: 33.3, length: 240, reward: { rawmaterials: 410 },
    };
    const data = { ...legacySave(), asteroidEvents: { nextId: 4, spawnTimer: 12.5, rngState: 991, active: [asteroid] } };
    service.saveToSlot(1, data);
    expect(service.loadFromSlot(1)!.asteroidEvents).toEqual({ nextId: 4, spawnTimer: 12.5, rngState: 991, active: [asteroid] });
  });

  it('rejects malformed v4 fields', () => {
    expect(validateSaveData(makeData({ nebulae: 'clouds' as never })).ok).toBe(false);
    expect(validateSaveData(makeData({ nebulae: [{ id: 1, x: 1 }] as never })).ok).toBe(false);
    expect(validateSaveData(makeData({ asteroidEvents: { active: 'x' } as never })).ok).toBe(false);
  });
});

describe('SaveGameService — v5 asteroid belts', () => {
  let service: SaveGameService;

  beforeEach(() => {
    localStorage.clear();
    service = new SaveGameService();
  });

  afterEach(() => localStorage.clear());

  const belt = {
    id: 1,
    points: [
      { x: 20, y: 20 },
      { x: 50, y: 35 },
    ],
    halfWidth: 1.4,
    visualSeed: 77,
  };

  it('loads saves that predate belts with no belts (never inserted into a running game)', () => {
    const migrated = service.migrateSave(makeData({ saveVersion: 4 }));
    expect(migrated.asteroidBelts).toEqual([]);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(validateSaveData(migrated).ok).toBe(true);
  });

  it('round-trips belts unchanged and does not duplicate them on reload', () => {
    service.saveToSlot(1, makeData({ asteroidBelts: [belt] }));
    const first = service.loadFromSlot(1)!;
    expect(first.asteroidBelts).toEqual([belt]);
    service.saveToSlot(1, first);
    expect(service.loadFromSlot(1)!.asteroidBelts).toEqual([belt]);
  });

  it('rejects malformed belts', () => {
    expect(validateSaveData(makeData({ asteroidBelts: 'rocks' as never })).ok).toBe(false);
    expect(validateSaveData(makeData({ asteroidBelts: [{ ...belt, points: [{ x: 1, y: 1 }] }] })).ok).toBe(false);
  });
});

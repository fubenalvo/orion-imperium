import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { FactionShipStock, Fleet, FleetShip, ShipStockEntry, StarSystem } from '../components/star-map/star-map.models';
import { copyEquipment } from '../components/star-map/equipment';
import { autoResolveBattle } from '../components/battle-screen/battle/battle-auto-resolve';
import { Battle, BattleOutcome } from '../components/battle-screen/battle/battle.types';
import { BattleOutcomeService, shipsFromOutcome } from './battle-outcome.service';
import { FleetAssemblyService } from './fleet-assembly.service';
import { FleetOrganizationService } from './fleet-organization.service';
import { PlanetBattleService } from './planet-battle.service';
import { SaveGameService } from './save-game.service';
import { SAVE_VERSION, validateSaveData } from './save-validation';
import { ShipService } from './ship.service';
import { ShipStockService } from './ship-stock.service';

/*
 * Installed equipment must survive every place that rebuilds a ship record
 * (docs/ship-equipment.md, B.7): battle write-back, stock ↔ fleet, fleet
 * organization, disband, and save validation / normalization.
 */

const RAILGUN = { weapon: 'railgun', defense: 'energy_shield' };
const WARP = { engine: 'warp_drive' };

const fleetOf = (id: number, factionId: string, ships: FleetShip[], extra: Partial<Fleet> = {}): Fleet => ({
  id,
  name: `Fleet ${id}`,
  factionId,
  x: 10.4,
  y: 20.7,
  targetX: null,
  targetY: null,
  speed: 4,
  system: { id: 'sol', x: 12.5, y: 7.5, targetX: null, targetY: null },
  ships,
  destroyed: false,
  ...extra,
});

const spaceportSystem = (factionId = 'player'): StarSystem =>
  ({
    id: 'sol',
    name: 'Sol',
    x: 10,
    y: 20,
    planets: 1,
    color: '#fff',
    planetsTiles: [{ id: 1, factionId, buildings: [{ name: 'Spaceport' }] }],
  }) as unknown as StarSystem;

describe('copyEquipment', () => {
  it('copies a loadout without sharing the object, and adds nothing for none', () => {
    const source = { equipment: { weapon: 'railgun' } };
    const copied = copyEquipment(source);
    expect(copied).toEqual({ equipment: { weapon: 'railgun' } });
    expect(copied.equipment).not.toBe(source.equipment);
    expect(copyEquipment({})).toEqual({});
    expect(copyEquipment({ equipment: {} })).toEqual({});
  });

  it('copies unknown module ids unchanged (quarantine)', () => {
    expect(copyEquipment({ equipment: { weapon: 'future_weapon' } })).toEqual({ equipment: { weapon: 'future_weapon' } });
  });
});

describe('shipsFromOutcome', () => {
  const outcomeShip = (shipId: number, hp: number, destroyed = false) =>
    ({ shipId, name: 'Ship', typeId: 'cruiser', hp, maxHp: 280, destroyed }) as BattleOutcome['attacker']['ships'][number];

  it('keeps the equipment of ships it finds in the previous roster', () => {
    const previous: FleetShip[] = [
      { id: 1, name: 'Ship', type: 'cruiser', equipment: { ...RAILGUN } },
      { id: 2, name: 'Ship', type: 'cruiser' },
    ];
    const ships = shipsFromOutcome([outcomeShip(1, 120), outcomeShip(2, 0, true)], previous);
    expect(ships).toEqual([
      { id: 1, name: 'Ship', type: 'cruiser', currentHp: 120, destroyed: false, equipment: RAILGUN },
      { id: 2, name: 'Ship', type: 'cruiser', currentHp: 0, destroyed: true },
    ]);
  });

  it('builds plain records for ships it does not know, as before', () => {
    expect(shipsFromOutcome([outcomeShip(7, 50)])).toEqual([
      { id: 7, name: 'Ship', type: 'cruiser', currentHp: 50, destroyed: false },
    ]);
  });
});

describe('equipment through a resolved fleet battle', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('keeps every ship\'s equipment after the outcome is applied, survivors and losses alike', () => {
    const attacker = fleetOf(1, 'player', [
      { id: 1, name: 'Ship', type: 'dreadnought', equipment: { ...RAILGUN } },
      { id: 2, name: 'Ship', type: 'dreadnought', equipment: { ...WARP } },
    ]);
    const defender = fleetOf(2, 'enemy1', [
      { id: 3, name: 'Ship', type: 'fighter', equipment: { weapon: 'laser_cannon' } },
    ]);
    const battle: Battle = {
      fleet1: attacker,
      fleet2: defender,
      faction1Name: 'Player',
      faction1Color: '#fff',
      faction2Name: 'Enemy',
      faction2Color: '#f00',
      attackerId: 1,
      defenderId: 2,
      type: 'fleet',
    };
    const { outcome } = autoResolveBattle(battle, TestBed.inject(ShipService), TestBed.inject(PlanetBattleService));
    expect(outcome.winnerSide).toBe('attacker');

    TestBed.inject(BattleOutcomeService).applyFleetBattleOutcome({ fleets: [attacker, defender], factions: [] }, outcome);

    expect(attacker.ships.map((s) => s.equipment)).toEqual([RAILGUN, WARP]);
    expect(defender.ships[0].destroyed).toBe(true);
    expect(defender.ships[0].equipment).toEqual({ weapon: 'laser_cannon' });
  });
});

describe('equipment between the stock and fleets', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const stockOf = (entries: ShipStockEntry[]): FactionShipStock[] => [{ factionId: 'player', ships: entries }];

  it('reinforceFleet carries a stock ship\'s equipment into the fleet', () => {
    const fleet = fleetOf(1, 'player', [{ id: 10, name: 'Ship', type: 'fighter' }], { x: 10.5, y: 20.5, system: null });
    const data = { fleets: [fleet], shipStock: stockOf([{ id: 20, type: 'frigate', name: 'Ship', equipment: { ...WARP } }]) };

    const result = TestBed.inject(FleetAssemblyService).reinforceFleet(data, [spaceportSystem()], {
      factionId: 'player',
      fleetId: 1,
      composition: [{ typeId: 'frigate', count: 1 }],
    });

    expect(result.ok).toBe(true);
    expect(fleet.ships.find((s) => s.id === 20)!.equipment).toEqual(WARP);
  });

  it('fleet organization carries equipment both ways through the reserve and keeps moved fleet ships as they are', () => {
    const armed: FleetShip = { id: 1, name: 'Ship', type: 'cruiser', currentHp: 100, equipment: { ...RAILGUN } };
    const moved: FleetShip = { id: 2, name: 'Ship', type: 'fighter', equipment: { ...WARP } };
    const a = fleetOf(1, 'player', [armed, moved]);
    const b = fleetOf(2, 'player', [{ id: 3, name: 'Ship', type: 'scout' }]);
    const reserveShip: ShipStockEntry = { id: 4, type: 'frigate', name: 'Ship', equipment: { engine: 'ion_engine' } };
    const data = { fleets: [a, b], shipStock: stockOf([reserveShip]) };

    const result = TestBed.inject(FleetOrganizationService).applyPlan(data, [spaceportSystem()], {
      factionId: 'player',
      sourceFleetIds: [1, 2],
      fleets: [
        { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [4] },
        { fleetId: 2, originFleetId: 2, name: 'B', shipIds: [3, 2] },
      ],
      reserveShipIds: [1],
    });

    expect(result.ok).toBe(true);
    expect(a.ships.find((s) => s.id === 4)!.equipment).toEqual({ engine: 'ion_engine' });
    expect(b.ships.find((s) => s.id === 2)).toBe(moved);
    expect(data.shipStock[0].ships).toEqual([{ id: 1, type: 'cruiser', name: 'Ship', currentHp: 100, equipment: RAILGUN }]);
  });

  it('disbanding a fleet keeps each surviving ship\'s equipment in the stock', () => {
    const fleet = fleetOf(1, 'player', [
      { id: 1, name: 'Ship', type: 'cruiser', equipment: { ...RAILGUN } },
      { id: 2, name: 'Ship', type: 'scout' },
    ]);
    const data: { shipStock?: FactionShipStock[] } = {};

    TestBed.inject(ShipStockService).disbandFleet(data, fleet);

    expect(data.shipStock![0].ships.map((s) => s.equipment)).toEqual([RAILGUN, undefined]);
  });
});

describe('equipment in saves', () => {
  const save = (extra: Record<string, unknown>) => ({
    saveVersion: SAVE_VERSION,
    factions: [],
    map: { width: 10, height: 10, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [],
    fleets: [],
    ...extra,
  });
  const codes = (result: ReturnType<typeof validateSaveData>) => ({
    errors: result.errors.map((e) => e.code).filter((c) => c.startsWith('equipment')),
    warnings: result.warnings.map((w) => w.code).filter((c) => c.startsWith('equipment')),
  });

  it('accepts valid loadouts and inventories without issues, and saves without either', () => {
    const result = validateSaveData(
      save({
        fleets: [fleetOf(1, 'player', [{ id: 1, name: 'Ship', type: 'cruiser', equipment: { ...RAILGUN, engine: 'standard_engine' } }])],
        shipStock: [{ factionId: 'player', ships: [{ id: 2, type: 'scout', name: 'Ship', equipment: { ...WARP } }] }],
        equipmentInventory: [{ factionId: 'player', modules: { railgun: 2, ion_engine: 0 } }],
      }),
    );
    expect(codes(result)).toEqual({ errors: [], warnings: [] });
    expect(codes(validateSaveData(save({})))).toEqual({ errors: [], warnings: [] });
  });

  it('warns (but loads) for unknown modules and modules in the wrong slot', () => {
    const result = validateSaveData(
      save({
        fleets: [fleetOf(1, 'player', [{ id: 1, name: 'Ship', type: 'cruiser', equipment: { weapon: 'future_gun', engine: 'railgun' } }])],
        equipmentInventory: [{ factionId: 'player', modules: { future_gun: 1, standard_weapon: 3 } }],
      }),
    );
    expect(codes(result).errors).toEqual([]);
    expect(codes(result).warnings.sort()).toEqual(
      ['equipment_inventory_module_unknown', 'equipment_inventory_module_unknown', 'equipment_module_unknown', 'equipment_module_wrong_slot'].sort(),
    );
  });

  it('rejects broken shapes', () => {
    const result = validateSaveData(
      save({
        fleets: [
          fleetOf(1, 'player', [
            { id: 1, name: 'Ship', type: 'cruiser', equipment: ['railgun'] as never },
            { id: 2, name: 'Ship', type: 'cruiser', equipment: { hull: 'x', weapon: '' } as never },
          ]),
        ],
        shipStock: [{ factionId: 'player', ships: [{ id: 3, type: 'scout', name: 'Ship', equipment: 'warp_drive' }] }],
        equipmentInventory: [{ factionId: '', modules: { railgun: -1, laser_cannon: 1.5 } }, 'x'],
      }),
    );
    expect(codes(result).errors.sort()).toEqual(
      [
        'equipment_invalid',
        'equipment_slot_invalid',
        'equipment_module_invalid',
        'equipment_invalid',
        'equipment_inventory_faction_invalid',
        'equipment_inventory_count_invalid',
        'equipment_inventory_count_invalid',
        'equipment_inventory_entry_invalid',
      ].sort(),
    );
    expect(validateSaveData(save({ equipmentInventory: {} })).errors.map((e) => e.code)).toContain('equipment_inventory_not_array');
  });

  it('normalizeSave leaves loadouts and the inventory untouched', () => {
    TestBed.configureTestingModule({});
    const data = save({
      fleets: [fleetOf(1, 'player', [{ id: 1, name: 'Ship', type: 'cruiser', equipment: { weapon: 'future_gun' } }])],
      shipStock: [{ factionId: 'player', ships: [{ id: 2, type: 'scout', name: 'Ship', equipment: { ...WARP } }] }],
      equipmentInventory: [{ factionId: 'player', modules: { railgun: 2 } }],
    });
    const normalized = TestBed.inject(SaveGameService).normalizeSave(JSON.parse(JSON.stringify(data)));
    expect(normalized.fleets[0].ships[0].equipment).toEqual({ weapon: 'future_gun' });
    expect(normalized.shipStock![0].ships[0].equipment).toEqual(WARP);
    expect(normalized.equipmentInventory).toEqual([{ factionId: 'player', modules: { railgun: 2 } }]);
  });
});

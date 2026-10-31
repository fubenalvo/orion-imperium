import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction, Fleet, PlanetTile, SpaceBase, StarMapData, StarSystem } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { TerritoryService } from './territory.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { BattleService } from '../../services/battle.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION, validateSaveData } from '../../services/save-validation';
import { StarMapSensorService } from './star-map-sensor.service';
import { normalizeRelations, startPeace, startWar } from './diplomacy';
import {
  OUTPOST_SHIP_TYPE,
  SPACE_BASE_CONFIG,
  buildBaseDefenseFleet,
  spaceBaseDefenseFleetId,
  validateBaseDeployment,
} from './space-base';
import { TERRITORY_CONFIG } from './territory';
import { BattleOutcome } from '../battle-screen/battle/battle.types';

/*
 * Space bases (docs/territory.md): deployment rules and mutation, the base
 * as a territory and sensor source, base battles through the planet-battle
 * path (AI auto-resolve and the player's battle screen), save/load.
 */

const W = 120;
const H = 80;

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: {} },
    { id: 'enemy2', name: 'Orn', color: '#fc4', team: 3, ai: true, currencies: {} },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

function system(id: string, x: number, y: number, owner: string | null): StarSystem {
  const planets = owner
    ? [{ id: x * 1000 + y, index: 0, name: 'P', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 50, buildings: [], explored: true } as PlanetTile]
    : [];
  return { id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true };
}

function fleet(id: number, factionId: string, x: number, y: number, types: string[]): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, system: null,
    ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
  };
}

describe('space bases', () => {
  let bases: SpaceBaseService;
  let territory: TerritoryService;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    bases = TestBed.inject(SpaceBaseService);
    territory = TestBed.inject(TerritoryService);
    bases.restore([]);
  });

  const ctx = (factions: Faction[], systems: StarSystem[]) => ({
    factions,
    starSystems: systems,
    territory: territory.get(systems, factions),
    width: W,
    height: H,
  });

  describe('deployment rules (shared by player and AI)', () => {
    it('accepts a stopped outpost fleet in open, unclaimed space', () => {
      const factions = makeFactions();
      const f = fleet(1, 'player', 60.4, 40.7, [OUTPOST_SHIP_TYPE]);
      expect(bases.check(f, ctx(factions, []))).toEqual({ ok: true, col: 60, row: 40 });
    });

    it('rejects each rule violation with its reason', () => {
      const factions = makeFactions();
      const systems = [system('enemyHome', 30, 30, 'enemy1'), system('empty', 90, 60, null)];
      const reason = (f: Fleet, list: SpaceBase[] = []) => {
        const result = validateBaseDeployment({ ...ctx(factions, systems), fleet: f, bases: list });
        return result.ok ? 'ok' : result.reason;
      };
      expect(reason(fleet(1, 'player', 60, 40, ['frigate']))).toBe('no_outpost_ship');
      const moving = fleet(2, 'player', 60, 40, [OUTPOST_SHIP_TYPE]);
      moving.targetX = 70;
      moving.targetY = 40;
      expect(reason(moving)).toBe('fleet_moving');
      const inSystem = fleet(3, 'player', 60, 40, [OUTPOST_SHIP_TYPE]);
      inSystem.system = { id: 'empty', x: 1, y: 1, targetX: null, targetY: null };
      expect(reason(inSystem)).toBe('inside_system');
      expect(reason(fleet(4, 'player', 91, 60, [OUTPOST_SHIP_TYPE]))).toBe('near_star');
      expect(reason(fleet(5, 'player', 30 + TERRITORY_CONFIG.systemClaimRadius, 30, [OUTPOST_SHIP_TYPE]))).toBe('foreign_territory');
      expect(reason(fleet(6, 'player', 64, 40, [OUTPOST_SHIP_TYPE]), [{ id: 1, name: 'B', factionId: 'enemy2', x: 60, y: 40 }])).toBe('too_close_to_base');
      expect(reason(fleet(7, 'player', 60 + SPACE_BASE_CONFIG.minBaseSpacing, 40, [OUTPOST_SHIP_TYPE]), [{ id: 1, name: 'B', factionId: 'player', x: 60, y: 40 }])).toBe('ok');
      const blocked = validateBaseDeployment({ ...ctx(factions, systems), fleet: fleet(8, 'player', 60, 40, [OUTPOST_SHIP_TYPE]), bases: [], isBlocked: () => true });
      expect(blocked.ok ? 'ok' : blocked.reason).toBe('blocked_terrain');
    });
  });

  it('deploying consumes one outpost ship, creates the base and extends territory', () => {
    const factions = makeFactions();
    const systems = [system('home', 30, 30, 'player')];
    const f = fleet(1, 'player', 60, 40, [OUTPOST_SHIP_TYPE, 'frigate']);
    const result = bases.deploy(f, ctx(factions, systems));
    expect(result.base).toMatchObject({ id: 1, factionId: 'player', x: 60, y: 40, name: 'home Outpost' });
    expect(result.base && 'fleetRetired' in result && result.fleetRetired).toBe(false);
    expect(f.ships.map((s) => s.type)).toEqual(['frigate']);
    expect(territory.get(systems, factions).ownerAt(60 + TERRITORY_CONFIG.baseClaimRadius, 40)).toBe('player');
    expect(territory.get(systems, factions).ownerAt(60 + TERRITORY_CONFIG.baseClaimRadius + 1, 40)).toBeNull();
  });

  it('a fleet left without ships is retired, and a second base needs spacing', () => {
    const factions = makeFactions();
    const f = fleet(1, 'player', 60, 40, [OUTPOST_SHIP_TYPE]);
    const first = bases.deploy(f, ctx(factions, []));
    expect(first.base).not.toBeNull();
    expect(f.destroyed).toBe(true);

    const g = fleet(2, 'player', 63, 40, [OUTPOST_SHIP_TYPE]);
    const second = bases.deploy(g, ctx(factions, []));
    expect(second.base).toBeNull();
    expect(g.ships.length).toBe(1);
  });

  it('cannot be deployed inside a peace partner territory either (same rule at war and peace)', () => {
    const factions = makeFactions();
    startPeace(factions[0], factions[1], 0);
    const systems = [system('vex', 30, 30, 'enemy1')];
    const f = fleet(1, 'player', 33, 30, [OUTPOST_SHIP_TYPE]);
    const result = bases.deploy(f, ctx(factions, systems));
    expect(result.base).toBeNull();
  });

  it('is a sensor source for its player owner', () => {
    const factions = makeFactions();
    const sensors = TestBed.inject(StarMapSensorService);
    const layer = sensors.computeGalaxySensorCells([], [], factions, W, H, [{ id: 1, name: 'B', factionId: 'player', x: 60, y: 40 }]);
    expect(layer.cells.has('60-40')).toBe(true);
    expect(layer.cells.has(`${60 + SPACE_BASE_CONFIG.sensorRange}-40`)).toBe(true);
    const foreign = sensors.computeGalaxySensorCells([], [], factions, W, H, [{ id: 2, name: 'C', factionId: 'enemy1', x: 60, y: 40 }]);
    expect(foreign.cells.size).toBe(0);
  });

  it('builds an immobile defense roster (core + turrets) with a shared shield', () => {
    const b: SpaceBase = { id: 4, name: 'B', factionId: 'enemy1', x: 60, y: 40, shieldPoolCurrent: 40 };
    const defense = buildBaseDefenseFleet(b);
    expect(defense.id).toBe(spaceBaseDefenseFleetId(b));
    expect(defense.id).toBeLessThan(-1_000_000);
    expect(defense.ships.map((s) => s.type)).toEqual([SPACE_BASE_CONFIG.coreTypeId, ...SPACE_BASE_CONFIG.turretTypeIds]);
    expect(defense.shieldPool).toBe(40);
    expect(defense.shieldPoolMax).toBe(SPACE_BASE_CONFIG.shield);
  });

  describe('base battles', () => {
    it('AI vs AI: a strong attacker at war destroys the base and its territory claim disappears', () => {
      const factions = makeFactions();
      bases.restore([{ id: 1, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40 }]);
      expect(territory.get([], factions).ownerAt(60, 40)).toBe('enemy1');
      const attacker = fleet(5, 'enemy2', 60.5, 40.5, Array(8).fill('dreadnought'));
      const detection = TestBed.inject(StarMapBattleDetectionService);
      const resolved = vi.fn();
      const triggered = new Set<string>();

      const interactive = detection.checkBaseBattles([attacker], factions, vi.fn(), triggered, resolved);
      expect(interactive).toBe(false);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(bases.bases).toEqual([]);
      expect(territory.get([], factions).ownerAt(60, 40)).toBeNull();
      expect(attacker.destroyed).not.toBe(true);
    });

    it('no battle at peace; a player attack opens the battle screen as a static-defense battle', () => {
      const factions = makeFactions();
      bases.restore([{ id: 3, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40 }]);
      const detection = TestBed.inject(StarMapBattleDetectionService);
      const enter = vi.fn();
      const f = fleet(5, 'player', 60.2, 40.2, ['cruiser']);

      startPeace(factions[0], factions[1], 0);
      expect(detection.checkBaseBattles([f], factions, enter, new Set())).toBe(false);
      expect(enter).not.toHaveBeenCalled();

      startWar(factions[0], factions[1], 0);
      expect(detection.checkBaseBattles([f], factions, enter, new Set())).toBe(true);
      expect(enter).toHaveBeenCalledTimes(1);
      const battle = TestBed.inject(BattleService).getBattle()!;
      expect(battle.type).toBe('planet');
      expect(battle.spaceBaseId).toBe(3);
      expect(battle.planetId).toBeUndefined();
      expect(battle.attackerId).toBe(5);
    });

    it('the battle-screen result removes a destroyed base from the snapshot and keeps a surviving base shield', () => {
      const factions = makeFactions();
      const outcomeService = TestBed.inject(BattleOutcomeService);
      const attacker = fleet(5, 'player', 60, 40, ['cruiser']);
      const outcome = (winnerSide: 'attacker' | 'defender'): BattleOutcome => ({
        winnerSide,
        winnerFleetId: 0,
        loserFleetId: 0,
        rounds: 3,
        battleType: 'planet',
        spaceBaseId: 3,
        attacker: {
          fleetId: 5, side: 'attacker', factionId: 'player', wipedOut: winnerSide === 'defender',
          ships: [{ shipId: 500, typeId: 'cruiser', name: 'cruiser', hp: winnerSide === 'defender' ? 0 : 120, destroyed: winnerSide === 'defender' }],
          survivors: [],
        },
        defender: { fleetId: -10_000_003, side: 'defender', factionId: 'enemy1', ships: [], survivors: [], wipedOut: false, shieldPoolCurrent: 33 },
      });

      const won = { fleets: [attacker], factions, spaceBases: [{ id: 3, name: 'B', factionId: 'enemy1', x: 60, y: 40 }] };
      expect(outcomeService.applySpaceBaseBattleOutcome(won, outcome('attacker'))).toBe(true);
      expect(won.spaceBases).toEqual([]);
      expect(attacker.ships[0].currentHp).toBe(120);

      const lost = { fleets: [fleet(5, 'player', 60, 40, ['cruiser'])], factions, spaceBases: [{ id: 3, name: 'B', factionId: 'enemy1', x: 60, y: 40 } as SpaceBase] };
      expect(outcomeService.applySpaceBaseBattleOutcome(lost, outcome('defender'))).toBe(false);
      expect(lost.spaceBases[0].shieldPoolCurrent).toBe(33);
      expect(lost.fleets[0].destroyed).toBe(true);
    });
  });

  describe('save / load', () => {
    const baseSave = (overrides: Partial<StarMapData> = {}): StarMapData => ({
      factions: makeFactions(),
      map: { width: W, height: H, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [system('home', 30, 30, 'player')],
      fleets: [],
      ...overrides,
    });

    it('older saves load with no bases and the current save version', () => {
      const migrated = TestBed.inject(SaveGameService).migrateSave(baseSave({ saveVersion: 6 }));
      expect(migrated.spaceBases).toEqual([]);
      expect(migrated.saveVersion).toBe(SAVE_VERSION);
      expect(SAVE_VERSION).toBe(8);
    });

    it('bases survive a save slot round trip and restore the same territory', () => {
      const saves = TestBed.inject(SaveGameService);
      const data = baseSave({ spaceBases: [{ id: 2, name: 'home Outpost', factionId: 'player', x: 60, y: 40, shieldPoolCurrent: 12 }] });
      saves.saveToSlot(1, data);
      const loaded = saves.loadFromSlot(1)!;
      expect(loaded.spaceBases).toEqual(data.spaceBases);
      bases.restore(loaded.spaceBases);
      expect(bases.serialize()).toEqual(data.spaceBases);
      expect(territory.get(loaded.starSystems, loaded.factions).ownerAt(60, 40)).toBe('player');
      saves.clearSlot(1);
    });

    it('validation rejects a non-array, warns about and drops malformed bases', () => {
      expect(validateSaveData({ ...baseSave(), spaceBases: 'x' as unknown as SpaceBase[] }).ok).toBe(false);
      const malformed = { ...baseSave(), spaceBases: [{ id: 'a' } as unknown as SpaceBase, { id: 1, name: 'ok', factionId: 'player', x: 60, y: 40 }] };
      const result = validateSaveData(malformed);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.code === 'space_base_invalid')).toBe(true);
      bases.restore(malformed.spaceBases);
      expect(bases.bases.map((b) => b.id)).toEqual([1]);
    });
  });
});

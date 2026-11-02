import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, Fleet, PlanetTile, StarMapData, StarSystem, SystemAsteroid } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { TerritoryService } from './territory.service';
import { StarMapMovementService } from './star-map-movement.service';
import { EconomyService } from '../../services/economy.service';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';
import { normalizeRelations } from './diplomacy';
import { OUTPOST_SHIP_TYPE } from './space-base';
import { STATION_CONSTRUCTION_SECONDS, advanceMiningStationConstruction } from './station-construction';
import { systemCellCenterVw } from './system-grid';
import {
  MINING_STATION_CONFIG,
  deployMiningStation,
  describeAsteroidForFaction,
  miningRatePerSecond,
  validateMiningStationDeployment,
} from './mining-station';

/*
 * Asteroid mining stations (docs/territory.md, "Mining stations"): the
 * outpost ship's second deployment target. Deployment rules and mutation,
 * one station per asteroid, ownership, extraction in the economy tick,
 * hover feedback, save/load — and the space base deployment staying as it was.
 */

const W = 120;
const H = 80;
const RICH = { col: 10, row: 5 };
const BARREN = { col: 12, row: 5 };
const UNSURVEYED = { col: 14, row: 5 };

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: { rawmaterials: 0 } },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: { rawmaterials: 0 } },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

function makeSystem(id: string, x: number, y: number, owner: string | null): StarSystem {
  const planets = owner
    ? [{ id: x * 1000 + y, index: 0, name: 'P', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 50, buildings: [], explored: true } as PlanetTile]
    : [];
  const asteroids: SystemAsteroid[] = [
    { ...RICH, rawMaterials: 3000, surveyed: true },
    { ...BARREN, rawMaterials: 0, surveyed: true },
    { ...UNSURVEYED, rawMaterials: 2500, surveyed: false },
  ];
  return {
    id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true,
    asteroidBelt: { version: 1, radiusVw: 40, asteroids },
  };
}

function fleet(id: number, factionId: string, types: string[], systemId: string | null, cell = RICH): Fleet {
  const center = systemCellCenterVw(cell.col, cell.row);
  return {
    id, name: `Fleet ${id}`, factionId, x: 30, y: 30, targetX: null, targetY: null, speed: 1,
    system: systemId ? { id: systemId, x: center.x, y: center.y, targetX: null, targetY: null } : null,
    ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
  };
}

const asteroidAt = (system: StarSystem, cell: { col: number; row: number }) =>
  system.asteroidBelt!.asteroids.find((a) => a.col === cell.col && a.row === cell.row)!;

describe('asteroid mining stations', () => {
  let territory: TerritoryService;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    territory = TestBed.inject(TerritoryService);
    TestBed.inject(SpaceBaseService).restore([]);
  });

  const input = (f: Fleet, factions: Faction[], systems: StarSystem[]) => ({
    fleet: f,
    factions,
    starSystems: systems,
    territory: territory.get(systems, factions),
  });

  describe('deployment rules', () => {
    it('accepts a stopped outpost fleet on a surveyed deposit in its own system', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const check = validateMiningStationDeployment(input(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home'), factions, systems));
      expect(check.ok).toBe(true);
    });

    it('accepts an unclaimed system and rejects each rule violation with its reason', () => {
      const factions = makeFactions();
      const systems = [makeSystem('free', 30, 30, null)];
      const reason = (f: Fleet) => {
        const check = validateMiningStationDeployment(input(f, factions, systems));
        return check.ok ? 'ok' : check.reason;
      };
      expect(reason(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free'))).toBe('ok');
      expect(reason(fleet(1, 'player', ['frigate'], 'free'))).toBe('no_outpost_ship');
      expect(reason(fleet(1, 'player', [OUTPOST_SHIP_TYPE], null))).toBe('not_in_system');
      expect(reason(fleet(1, 'unhabited', [OUTPOST_SHIP_TYPE], 'free'))).toBe('neutral_faction');
      expect(reason(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free', { col: 20, row: 9 }))).toBe('no_asteroid');
      expect(reason(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free', BARREN))).toBe('no_deposit');
      expect(reason(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free', UNSURVEYED))).toBe('not_surveyed');

      const moving = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free');
      moving.system!.targetX = 50;
      moving.system!.targetY = 10;
      expect(reason(moving)).toBe('fleet_moving');

      const destroyedOutpost = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'free');
      destroyedOutpost.ships[0].destroyed = true;
      expect(reason(destroyedOutpost)).toBe('no_outpost_ship');
    });

    it("rejects another empire's system", () => {
      const factions = makeFactions();
      const systems = [makeSystem('vex', 30, 30, 'enemy1')];
      const check = validateMiningStationDeployment(input(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'vex'), factions, systems));
      expect(check.ok ? 'ok' : check.reason).toBe('foreign_territory');
    });
  });

  describe('deployment', () => {
    it('consumes one outpost ship and puts a player-owned station on that asteroid of that system', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player'), makeSystem('other', 60, 30, null)];
      const f = fleet(1, 'player', [OUTPOST_SHIP_TYPE, OUTPOST_SHIP_TYPE, 'frigate'], 'home');
      const result = deployMiningStation(input(f, factions, systems));

      expect(result.ok).toBe(true);
      expect(f.ships.filter((s) => s.type === OUTPOST_SHIP_TYPE)).toHaveLength(1);
      expect(f.destroyed).toBeFalsy();
      // The station starts as a construction site.
      expect(asteroidAt(systems[0], RICH).miningStation).toEqual({
        factionId: 'player',
        constructionRemaining: STATION_CONSTRUCTION_SECONDS.miningStation,
      });
      // No other asteroid, and no other system's same cell, got a station.
      expect(systems[0].asteroidBelt!.asteroids.filter((a) => a.miningStation)).toHaveLength(1);
      expect(asteroidAt(systems[1], RICH).miningStation).toBeUndefined();
    });

    it('an asteroid holds at most one station: a second outpost fleet is refused and keeps its ship', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const first = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home');
      expect(deployMiningStation(input(first, factions, systems)).ok).toBe(true);
      expect(first.destroyed).toBe(true); // left without ships → retired

      const second = fleet(2, 'player', [OUTPOST_SHIP_TYPE], 'home');
      const result = deployMiningStation(input(second, factions, systems));
      expect(result.ok).toBe(false);
      if (!result.ok && !result.check.ok) expect(result.check.reason).toBe('occupied');
      expect(second.ships).toHaveLength(1);
    });

    it('a barren asteroid gets no station and nothing is consumed', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const f = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home', BARREN);
      expect(deployMiningStation(input(f, factions, systems)).ok).toBe(false);
      expect(f.ships).toHaveLength(1);
      expect(asteroidAt(systems[0], BARREN).miningStation).toBeUndefined();
    });

    it('the station belongs to the deploying faction (same rules for the AI)', () => {
      const factions = makeFactions();
      const systems = [makeSystem('vex', 30, 30, 'enemy1')];
      // The AI may only use deposits it surveyed itself.
      asteroidAt(systems[0], RICH).surveyedBy = ['enemy1'];
      const result = deployMiningStation(input(fleet(1, 'enemy1', [OUTPOST_SHIP_TYPE], 'vex'), factions, systems));
      expect(result.ok).toBe(true);
      expect(asteroidAt(systems[0], RICH).miningStation?.factionId).toBe('enemy1');
    });

    it('a deposit surveyed only by the player is unknown to an AI faction', () => {
      const factions = makeFactions();
      const systems = [makeSystem('vex', 30, 30, 'enemy1')];
      expect(asteroidAt(systems[0], RICH).surveyed).toBe(true);
      const check = validateMiningStationDeployment(input(fleet(1, 'enemy1', [OUTPOST_SHIP_TYPE], 'vex'), factions, systems));
      expect(check.ok ? 'ok' : check.reason).toBe('not_surveyed');
    });
  });

  describe('space base deployment is unchanged', () => {
    it('an outpost fleet in open space still deploys a space base, and mining reports it is not in a system', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const f = fleet(1, 'player', [OUTPOST_SHIP_TYPE], null);
      f.x = 60.4;
      f.y = 40.7;
      const mining = validateMiningStationDeployment(input(f, factions, systems));
      expect(mining.ok ? 'ok' : mining.reason).toBe('not_in_system');

      const bases = TestBed.inject(SpaceBaseService);
      const result = bases.deploy(f, { factions, starSystems: systems, territory: territory.get(systems, factions), width: W, height: H });
      expect(result.base).not.toBeNull();
      expect(bases.bases).toHaveLength(1);
      expect(f.destroyed).toBe(true);
    });
  });

  describe('extraction', () => {
    it('stations add raw materials to their owner in the economy tick and deplete the deposit', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const economy = TestBed.inject(EconomyService);
      const without = economy.calculateEconomy('player', factions, systems, []).net['rawmaterials'] ?? 0;
      deployMiningStation(input(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home'), factions, systems));
      // A construction site extracts nothing and pays no upkeep.
      expect(miningRatePerSecond('player', systems, 1)).toBe(0);
      expect(economy.calculateEconomy('player', factions, systems, []).net['rawmaterials']).toBeCloseTo(without);
      expect(economy.calculateEconomy('player', factions, systems, []).stationUpkeepPerSecond).toBe(0);
      expect(advanceMiningStationConstruction(systems, STATION_CONSTRUCTION_SECONDS.miningStation - 1)).toHaveLength(0);
      expect(advanceMiningStationConstruction(systems, 1)).toHaveLength(1);
      expect(economy.calculateEconomy('player', factions, systems, []).stationUpkeepPerSecond).toBeGreaterThan(0);

      const rate = MINING_STATION_CONFIG.extractionPerSecond;
      expect(miningRatePerSecond('player', systems, 1)).toBe(rate);
      expect(economy.calculateEconomy('player', factions, systems, []).net['rawmaterials']).toBeCloseTo(without + rate);

      const before = factions[0].currencies['rawmaterials'] ?? 0;
      economy.applyEconomyDelta('player', factions, systems, [], 10);
      const gained = (factions[0].currencies['rawmaterials'] ?? 0) - before;
      expect(gained).toBeCloseTo(without * 10 + rate * 10, 3);
      expect(asteroidAt(systems[0], RICH).rawMaterials).toBeCloseTo(3000 - rate * 10);

      // The other faction gets nothing from the player's station.
      const enemyBefore = factions[1].currencies['rawmaterials'] ?? 0;
      economy.applyEconomyDelta('enemy1', factions, systems, [], 10);
      expect(factions[1].currencies['rawmaterials']).toBeCloseTo(enemyBefore);
    });

    it('never takes more than the deposit holds; a depleted station stays and produces nothing', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const economy = TestBed.inject(EconomyService);
      deployMiningStation(input(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home'), factions, systems));
      advanceMiningStationConstruction(systems, STATION_CONSTRUCTION_SECONDS.miningStation);
      asteroidAt(systems[0], RICH).rawMaterials = 7;
      const without = economy.calculateEconomy('player', factions, systems, []).net['rawmaterials']! - MINING_STATION_CONFIG.extractionPerSecond;

      const before = factions[0].currencies['rawmaterials'] ?? 0;
      economy.applyEconomyDelta('player', factions, systems, [], 10);
      expect((factions[0].currencies['rawmaterials'] ?? 0) - before).toBeCloseTo(without * 10 + 7, 3);
      expect(asteroidAt(systems[0], RICH).rawMaterials).toBe(0);
      expect(asteroidAt(systems[0], RICH).miningStation).toEqual({ factionId: 'player' });
      expect(miningRatePerSecond('player', systems, 1)).toBe(0);
    });
  });

  describe('hover feedback', () => {
    const hint = (systems: StarSystem[], factions: Faction[], fleets: Fleet[], cell: { col: number; row: number }) =>
      describeAsteroidForFaction({
        factionId: 'player',
        system: systems[0],
        asteroid: asteroidAt(systems[0], cell),
        territory: territory.get(systems, factions),
        fleets,
        factionName: (id) => factions.find((f) => f.id === id)?.name ?? id,
      });

    it('tells valid targets, barren, unsurveyed, occupied and missing-ship cases apart', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      const outpostElsewhere = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home', { col: 20, row: 9 });

      expect(hint(systems, factions, [], RICH).tone).toBe('invalid');
      expect(hint(systems, factions, [], RICH).detail).toContain('Outpost Ship');
      expect(hint(systems, factions, [outpostElsewhere], RICH).tone).toBe('valid');
      expect(hint(systems, factions, [outpostElsewhere], RICH).title).toContain('3,000');
      expect(hint(systems, factions, [outpostElsewhere], BARREN).tone).toBe('invalid');
      const unknown = hint(systems, factions, [outpostElsewhere], UNSURVEYED);
      expect(unknown.tone).toBe('neutral');
      expect(unknown.title + unknown.detail).not.toContain('2,500');

      asteroidAt(systems[0], RICH).miningStation = { factionId: 'player' };
      expect(hint(systems, factions, [outpostElsewhere], RICH).tone).toBe('own');
      asteroidAt(systems[0], RICH).miningStation = { factionId: 'enemy1' };
      const foreign = hint(systems, factions, [outpostElsewhere], RICH);
      expect(foreign.tone).toBe('invalid');
      expect(foreign.title).toContain('Vex');
    });

    it("marks a deposit in another empire's territory as invalid", () => {
      const factions = makeFactions();
      const systems = [makeSystem('vex', 30, 30, 'enemy1')];
      const outpost = fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'vex', { col: 20, row: 9 });
      const result = hint(systems, factions, [outpost], RICH);
      expect(result.tone).toBe('invalid');
      expect(result.detail).toContain('Vex territory');
    });
  });

  describe('save / load', () => {
    const save = (systems: StarSystem[]): StarMapData => ({
      saveVersion: SAVE_VERSION,
      factions: makeFactions(),
      map: { width: W, height: H, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: systems,
      fleets: [],
    });

    it('stations and the remaining deposit survive a save slot round trip', () => {
      const factions = makeFactions();
      const systems = [makeSystem('home', 30, 30, 'player')];
      deployMiningStation(input(fleet(1, 'player', [OUTPOST_SHIP_TYPE], 'home'), factions, systems));
      advanceMiningStationConstruction(systems, 30);
      asteroidAt(systems[0], RICH).rawMaterials = 2412.5;

      const saves = TestBed.inject(SaveGameService);
      saves.saveToSlot(1, save(systems));
      const loaded = saves.loadFromSlot(1)!;
      const asteroid = asteroidAt(loaded.starSystems[0], RICH);
      // The construction timer survives the round trip.
      expect(asteroid.miningStation).toEqual({
        factionId: 'player',
        constructionRemaining: STATION_CONSTRUCTION_SECONDS.miningStation - 30,
      });
      expect(asteroid.rawMaterials).toBe(2412.5);
      saves.clearSlot(1);
    });

    it('a malformed station is dropped on load without regenerating the belt', () => {
      const systems = [makeSystem('home', 30, 30, 'player')];
      asteroidAt(systems[0], RICH).miningStation = { factionId: 42 } as unknown as { factionId: string };
      asteroidAt(systems[0], BARREN).miningStation = { factionId: 'player' };
      const migrated = TestBed.inject(SaveGameService).normalizeSave(save(systems));
      const belt = migrated.starSystems[0].asteroidBelt!;
      expect(belt.radiusVw).toBe(40); // the hand-made belt was kept
      expect(asteroidAt(migrated.starSystems[0], RICH).miningStation).toBeUndefined();
      expect(asteroidAt(migrated.starSystems[0], BARREN).miningStation).toEqual({ factionId: 'player' });
    });
  });
});

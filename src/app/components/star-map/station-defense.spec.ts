import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction, Fleet, PlanetTile, SpaceBase, StarMapData, StarSystem, SystemAsteroid } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { TerritoryService } from './territory.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { StarMapSensorService } from './star-map-sensor.service';
import { BattleService } from '../../services/battle.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { ResearchService } from '../../services/research.service';
import { SaveGameService } from '../../services/save-game.service';
import { normalizeRelations, startPeace } from './diplomacy';
import { OUTPOST_SHIP_TYPE, SPACE_BASE_CONFIG } from './space-base';
import { deployMiningStation, describeAsteroidForFaction, extractMiningStations } from './mining-station';
import { systemCellCenterVw } from './system-grid';
import {
  MAX_STATION_TURRETS,
  STATION_CORE_STATS,
  STATION_CORE_UNIT_ID,
  STATION_DEFENSE_CONFIG,
  buildStationDefenseFleet,
  stationTurretCount,
} from './station-defense';
import { Battle, BattleOutcome } from '../battle-screen/battle/battle.types';

/*
 * Unified station defense (docs/territory.md, "Station defense"): space
 * bases (the radar / observation posts) and asteroid mining stations share
 * one defense model — core hull, 0–3 turrets from Turret Research I–III,
 * shared shield pool, one combat path and one outcome path — while their
 * primary functions (sensors + territory vs extraction) stay separate.
 */

const W = 120;
const H = 80;
const ROCK_A = { col: 10, row: 5 };
const ROCK_B = { col: 12, row: 5 };
const TURRET_TECHS = ['turret_research_1', 'turret_research_2', 'turret_research_3'];

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: { rawmaterials: 0 } },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: { rawmaterials: 0 } },
    { id: 'enemy2', name: 'Orn', color: '#fc4', team: 3, ai: true, currencies: { rawmaterials: 0 } },
    { id: 'enemy3', name: 'Kai', color: '#4f4', team: 4, ai: true, currencies: { rawmaterials: 0 } },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

const byId = (factions: Faction[], id: string) => factions.find((f) => f.id === id)!;

function research(faction: Faction, level: number): void {
  faction.researchedTechnologies = TURRET_TECHS.slice(0, level);
}

function makeSystem(id: string, x: number, y: number, stations: Record<string, string> = {}, planetOwner: string | null = null): StarSystem {
  const asteroids: SystemAsteroid[] = [ROCK_A, ROCK_B].map((cell) => {
    const owner = stations[`${cell.col},${cell.row}`];
    return {
      ...cell,
      rawMaterials: 3000,
      totalRawMaterials: 3000,
      extractionRate: 5,
      surveyed: true,
      surveyedBy: ['enemy1', 'enemy2', 'enemy3'],
      ...(owner ? { miningStation: { factionId: owner } } : {}),
    };
  });
  const planets = planetOwner
    ? [{ id: 777, index: 0, name: 'P', factionId: planetOwner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 50, buildings: [], explored: true } as PlanetTile]
    : [];
  return {
    id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true,
    asteroidBelt: { version: 2, radiusVw: 40, asteroids },
  };
}

function fleet(id: number, factionId: string, x: number, y: number, types: string[]): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, system: null,
    ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
  };
}

const rock = (system: StarSystem, cell: { col: number; row: number }) =>
  system.asteroidBelt!.asteroids.find((a) => a.col === cell.col && a.row === cell.row)!;

describe('unified station defense', () => {
  let bases: SpaceBaseService;
  let detection: StarMapBattleDetectionService;
  let battles: BattleService;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    bases = TestBed.inject(SpaceBaseService);
    bases.restore([]);
    detection = TestBed.inject(StarMapBattleDetectionService);
    battles = TestBed.inject(BattleService);
  });

  /* The defense fleet of the last interactive station battle. */
  const lastDefense = (): Battle['fleet2'] => battles.getBattle()!.fleet2;
  const turretTypes = (f: Battle['fleet2']) => f.ships.filter((s) => s.type !== STATION_DEFENSE_CONFIG.coreTypeId).map((s) => s.type);

  /* Starts a player attack on an enemy1 base and returns the defense roster. */
  function attackBase(factions: Faction[], base: SpaceBase): Battle['fleet2'] {
    const f = fleet(9, 'player', base.x + 0.3, base.y + 0.3, ['cruiser']);
    expect(detection.checkBaseBattles([f], factions, vi.fn(), new Set())).toBe(true);
    return lastDefense();
  }

  /* Starts a player attack on enemy1's mining station(s) in `system`. */
  function attackMiningStation(factions: Faction[], system: StarSystem): Battle['fleet2'] {
    const f = fleet(9, 'player', system.x + 0.4, system.y + 0.4, ['cruiser']);
    expect(detection.checkMiningStationBattles([f], factions, [system], vi.fn(), new Set())).toBe(true);
    return lastDefense();
  }

  describe('turret research (one progression for every station type)', () => {
    it('exists exactly once: three technologies with the stationTurrets bonus, no per-type variants', () => {
      const researchService = TestBed.inject(ResearchService);
      const turretTechs = researchService.getAllTechnologies().filter((t) => (t.bonuses ?? []).some((b) => b.type === 'stationTurrets'));
      expect(turretTechs.map((t) => t.id)).toEqual(TURRET_TECHS);
      expect(turretTechs[1].prerequisites).toContain('turret_research_1');
      expect(turretTechs[2].prerequisites).toContain('turret_research_2');
      expect(researchService.describeEffects(turretTechs[0]).join(' ')).toContain('space base and mining station');
    });

    it('levels 0–III give 0–3 turrets to existing bases and mining stations alike', () => {
      const factions = makeFactions();
      bases.restore([{ id: 1, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40 }]);
      const system = makeSystem('S', 30, 30, { '10,5': 'enemy1' });
      const expected = [[], ['laser_turret'], ['laser_turret', 'laser_turret'], ['laser_turret', 'laser_turret', 'missile_turret']];
      for (let level = 0; level <= 3; level++) {
        research(byId(factions, 'enemy1'), level);
        expect(turretTypes(attackBase(factions, bases.bases[0]))).toEqual(expected[level]);
        expect(turretTypes(attackMiningStation(factions, system))).toEqual(expected[level]);
        // The marker count follows the same rule.
        expect(detection.stationTurretsOf(byId(factions, 'enemy1'))).toBe(level);
      }
      // Turret stats are the planet turret building stats for both types.
      expect(STATION_DEFENSE_CONFIG.turretTypeIds.length).toBe(MAX_STATION_TURRETS);
    });

    it('turrets come from the owner, never from the attacker', () => {
      const factions = makeFactions();
      research(byId(factions, 'player'), 3);
      bases.restore([{ id: 1, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40 }]);
      expect(turretTypes(attackBase(factions, bases.bases[0]))).toEqual([]);
    });

    it('newly deployed bases and mining stations start with the current level', () => {
      const factions = makeFactions();
      research(byId(factions, 'enemy1'), 2);
      const territory = TestBed.inject(TerritoryService);
      const outposts = fleet(1, 'enemy1', 60, 40, [OUTPOST_SHIP_TYPE]);
      const deployed = bases.deploy(outposts, { factions, starSystems: [], territory: territory.get([], factions), width: W, height: H });
      expect(deployed.base).not.toBeNull();
      expect(turretTypes(attackBase(factions, deployed.base!))).toHaveLength(2);

      const system = makeSystem('S', 30, 30);
      const center = systemCellCenterVw(ROCK_A.col, ROCK_A.row);
      const miner = fleet(2, 'enemy1', 30, 30, [OUTPOST_SHIP_TYPE]);
      miner.system = { id: 'S', x: center.x, y: center.y, targetX: null, targetY: null };
      const result = deployMiningStation({ fleet: miner, factions, starSystems: [system], territory: territory.get([system], factions) });
      expect(result.ok).toBe(true);
      expect(turretTypes(attackMiningStation(factions, system))).toHaveLength(2);
    });
  });

  describe('combat', () => {
    it('roster: core with persisted hull + turrets under the persisted shield pool', () => {
      const defense = buildStationDefenseFleet({ fleetId: -5, name: 'X', factionId: 'enemy1', x: 1, y: 1, turretCount: 2, hullCurrent: 400, shieldPoolCurrent: 90 });
      expect(defense.ships[0]).toMatchObject({ id: STATION_CORE_UNIT_ID, type: STATION_CORE_STATS.id, currentHp: 400 });
      expect(defense.ships).toHaveLength(3);
      expect(defense.shieldPool).toBe(90);
      expect(stationTurretCount(7)).toBe(MAX_STATION_TURRETS);
      expect(stationTurretCount(undefined)).toBe(0);
    });

    it('AI vs AI: a strong fleet destroys a mining station; extraction stops, the asteroid and deposit stay', () => {
      const factions = makeFactions();
      research(byId(factions, 'enemy1'), 3);
      const system = makeSystem('S', 30, 30, { '10,5': 'enemy1' });
      const attacker = fleet(5, 'enemy2', 30.5, 30.5, Array(8).fill('dreadnought'));
      const resolved = vi.fn();

      expect(detection.checkMiningStationBattles([attacker], factions, [system], vi.fn(), new Set(), resolved)).toBe(false);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(rock(system, ROCK_A).miningStation).toBeUndefined();
      expect(rock(system, ROCK_A).rawMaterials).toBe(3000);
      expect(extractMiningStations('enemy1', [system], 10, 1)).toBe(0);
      expect(attacker.destroyed).not.toBe(true);
    });

    it('a station that holds keeps its remaining shield and hull; the attacker is wiped out', () => {
      const factions = makeFactions();
      research(byId(factions, 'enemy1'), 3);
      const system = makeSystem('S', 30, 30, { '10,5': 'enemy1' });
      const attacker = fleet(5, 'enemy2', 30.5, 30.5, ['fighter']);
      detection.checkMiningStationBattles([attacker], factions, [system], vi.fn(), new Set());
      const station = rock(system, ROCK_A).miningStation!;
      expect(station).toBeDefined();
      expect(attacker.destroyed).toBe(true);
      expect(station.shieldPoolCurrent).toBeLessThanOrEqual(STATION_DEFENSE_CONFIG.shield);
      expect(station.hullCurrent).toBeGreaterThan(0);
    });

    it('only stopped fleets with a warship, at war, in the station system attack it', () => {
      const factions = makeFactions();
      const system = makeSystem('S', 30, 30, { '10,5': 'enemy1' });
      const enter = vi.fn();
      const civilian = fleet(1, 'player', 30.2, 30.2, ['colonizer', OUTPOST_SHIP_TYPE, 'scout']);
      const passing = fleet(2, 'player', 30.2, 30.2, ['cruiser']);
      passing.targetX = 80;
      passing.targetY = 30;
      const elsewhere = fleet(3, 'player', 50, 30, ['cruiser']);
      expect(detection.checkMiningStationBattles([civilian, passing, elsewhere], factions, [system], enter, new Set())).toBe(false);

      const parked = fleet(4, 'player', 30.2, 30.2, ['cruiser']);
      startPeace(byId(factions, 'player'), byId(factions, 'enemy1'), 0);
      expect(detection.checkMiningStationBattles([parked], factions, [system], enter, new Set())).toBe(false);
      expect(enter).not.toHaveBeenCalled();
    });

    it('an AI attack on a player station opens the battle screen as a station battle', () => {
      const factions = makeFactions();
      const system = makeSystem('S', 30, 30, { '12,5': 'player' });
      const enter = vi.fn();
      expect(detection.checkMiningStationBattles([fleet(5, 'enemy1', 30.4, 30.4, ['destroyer'])], factions, [system], enter, new Set())).toBe(true);
      expect(enter).toHaveBeenCalledTimes(1);
      const battle = battles.getBattle()!;
      expect(battle.type).toBe('planet');
      expect(battle.miningStation).toEqual({ systemId: 'S', col: 12, row: 5 });
      expect(battle.spaceBaseId).toBeUndefined();
      expect(battle.planetId).toBeUndefined();
    });

    it('destroying one station leaves other stations, bases and planets untouched', () => {
      const factions = makeFactions();
      startPeace(byId(factions, 'enemy2'), byId(factions, 'enemy3'), 0);
      bases.restore([{ id: 1, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40 }]);
      const system = makeSystem('S', 30, 30, { '10,5': 'enemy1', '12,5': 'enemy3' }, 'enemy1');
      const attacker = fleet(5, 'enemy2', 30.5, 30.5, Array(8).fill('dreadnought'));
      detection.checkMiningStationBattles([attacker], factions, [system], vi.fn(), new Set());

      expect(rock(system, ROCK_A).miningStation).toBeUndefined();
      expect(rock(system, ROCK_B).miningStation).toEqual({ factionId: 'enemy3' });
      expect(system.planetsTiles[0].factionId).toBe('enemy1');
      expect(bases.bases.map((b) => b.id)).toEqual([1]);
    });
  });

  describe('destruction removes the station-specific function', () => {
    function stationOutcome(winnerSide: 'attacker' | 'defender', station: Partial<BattleOutcome>, coreHp = 900): BattleOutcome {
      return {
        winnerSide, winnerFleetId: 0, loserFleetId: 0, rounds: 3, battleType: 'planet', ...station,
        attacker: { fleetId: 5, side: 'attacker', factionId: 'enemy1', wipedOut: winnerSide === 'defender', survivors: [],
          ships: [{ shipId: 500, typeId: 'cruiser', name: 'cruiser', hp: winnerSide === 'defender' ? 0 : 200, destroyed: winnerSide === 'defender' }] },
        defender: { fleetId: -1, side: 'defender', factionId: 'player', wipedOut: winnerSide === 'attacker', survivors: [], shieldPoolCurrent: 40,
          ships: [{ shipId: STATION_CORE_UNIT_ID, typeId: STATION_CORE_STATS.id, name: 'Core', hp: coreHp, destroyed: coreHp <= 0 }] },
      };
    }

    it("a destroyed player base stops being a sensor source at once (battle-screen path)", () => {
      const factions = makeFactions();
      const sensors = TestBed.inject(StarMapSensorService);
      const playerBase: SpaceBase = { id: 2, name: 'Home Outpost', factionId: 'player', x: 60, y: 40 };
      bases.restore([playerBase]);
      const edge = `${60 + SPACE_BASE_CONFIG.sensorRange}-40`;
      expect(sensors.computeGalaxySensorCells([], [], factions, W, H, bases.bases).cells.has(edge)).toBe(true);

      // An AI fleet at war attacks it: the player defends on the battle screen.
      expect(detection.checkBaseBattles([fleet(5, 'enemy1', 60.5, 40.5, ['cruiser'])], factions, vi.fn(), new Set())).toBe(true);
      const snapshot = { fleets: [fleet(5, 'enemy1', 60, 40, ['cruiser'])], factions, spaceBases: bases.serialize() };
      expect(TestBed.inject(BattleOutcomeService).applyStationBattleOutcome(snapshot, stationOutcome('attacker', { spaceBaseId: 2 }, 0))).toBe(true);
      const revision = bases.revision;
      bases.restore(snapshot.spaceBases); // the reload after the battle
      expect(bases.revision).toBeGreaterThan(revision);
      expect(sensors.computeGalaxySensorCells([], [], factions, W, H, bases.bases).cells.size).toBe(0);
    });

    it('a destroyed player mining station is removed from the snapshot; a surviving one keeps shield and hull', () => {
      const factions = makeFactions();
      const outcomes = TestBed.inject(BattleOutcomeService);
      const lost = makeSystem('S', 30, 30, { '10,5': 'player', '12,5': 'player' });
      const data = { fleets: [fleet(5, 'enemy1', 30, 30, ['cruiser'])], factions, starSystems: [lost] };
      expect(outcomes.applyStationBattleOutcome(data, stationOutcome('attacker', { miningStation: { systemId: 'S', col: 10, row: 5 } }, 0))).toBe(true);
      expect(rock(lost, ROCK_A).miningStation).toBeUndefined();
      expect(rock(lost, ROCK_B).miningStation).toEqual({ factionId: 'player' });

      expect(outcomes.applyStationBattleOutcome(data, stationOutcome('defender', { miningStation: { systemId: 'S', col: 12, row: 5 } }, 420))).toBe(false);
      expect(rock(lost, ROCK_B).miningStation).toEqual({ factionId: 'player', shieldPoolCurrent: 40, hullCurrent: 420 });
    });

    it('a mining station gets no sensor coverage and a base no extraction (functions stay separate)', () => {
      const factions = makeFactions();
      const sensors = TestBed.inject(StarMapSensorService);
      const system = makeSystem('S', 30, 30, { '10,5': 'player' });
      system.planetsTiles = [];
      expect(sensors.computeGalaxySensorCells([], [system], factions, W, H, []).cells.size).toBe(0);
      bases.restore([{ id: 1, name: 'B', factionId: 'player', x: 60, y: 40 }]);
      expect(extractMiningStations('player', [], 10, 1)).toBe(0);
      expect(extractMiningStations('player', [system], 10, 1)).toBe(50);
    });

    it('the hover card of a station shows its turrets and hull', () => {
      const factions = makeFactions();
      const system = makeSystem('S', 30, 30, { '10,5': 'player' });
      rock(system, ROCK_A).miningStation!.hullCurrent = 450;
      const hint = describeAsteroidForFaction({
        factionId: 'player', system, asteroid: rock(system, ROCK_A),
        territory: TestBed.inject(TerritoryService).get([system], factions), fleets: [],
        factionName: (id) => id, stationTurrets: () => 2,
      });
      expect(hint.detail).toContain(`Turrets 2/${MAX_STATION_TURRETS} · Hull 450/${STATION_CORE_STATS.hitPoints}`);
    });
  });

  it('save / load keeps every station defense state; turrets follow the saved research', () => {
    const saves = TestBed.inject(SaveGameService);
    const factions = makeFactions();
    research(byId(factions, 'enemy1'), 2);
    const system = makeSystem('S', 30, 30, { '10,5': 'enemy1' });
    rock(system, ROCK_A).miningStation = { factionId: 'enemy1', shieldPoolCurrent: 77, hullCurrent: 512 };
    const data: StarMapData = {
      factions,
      map: { width: W, height: H, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [system],
      fleets: [],
      spaceBases: [{ id: 3, name: 'Vex Outpost', factionId: 'enemy1', x: 60, y: 40, shieldPoolCurrent: 12, hullCurrent: 300 }],
    };
    saves.saveToSlot(1, data);
    const loaded = saves.loadFromSlot(1)!;
    saves.clearSlot(1);

    expect(loaded.spaceBases).toEqual(data.spaceBases);
    expect(loaded.starSystems[0].asteroidBelt!.asteroids.find((a) => a.col === 10)!.miningStation).toEqual({ factionId: 'enemy1', shieldPoolCurrent: 77, hullCurrent: 512 });

    bases.restore(loaded.spaceBases);
    const base = attackBase(loaded.factions, bases.bases[0]);
    expect(base.ships[0].currentHp).toBe(300);
    expect(turretTypes(base)).toHaveLength(2);
    const mine = attackMiningStation(loaded.factions, loaded.starSystems[0]);
    expect(mine.ships[0].currentHp).toBe(512);
    expect(turretTypes(mine)).toHaveLength(2);
  });
});

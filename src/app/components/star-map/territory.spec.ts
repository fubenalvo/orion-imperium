import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, Fleet, PlanetTile, SpaceBase, StarSystem } from './star-map.models';
import { buildTerritoryShapes, computeTerritory, systemClaimOwner, TERRITORY_CONFIG } from './territory';
import { TerritoryService } from './territory.service';
import { SpaceBaseService } from './space-base.service';
import { StarMapMovementService } from './star-map-movement.service';
import { BorderService, BORDER_CONFIG } from './border.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { StarMapPlanetArrivalService } from './star-map-planet-arrival.service';
import { EnemyGoalService } from './enemy-goal.service';
import { areFactionsHostile, getOpinion, normalizeRelations, startPeace, startWar } from './diplomacy';

/*
 * Territory (docs/territory.md): derived ownership, the overlap rule,
 * event-driven caching, border violations and the colonization rule.
 */

const W = 120;
const H = 80;

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: {} },
    { id: 'enemy2', name: 'Orn', color: '#fc4', team: 3, ai: true, currencies: {} },
    { id: 'independent', name: 'Rebels', color: '#999', team: 0, currencies: {} },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

let planetId = 1;
function planet(factionId: string, population = 100): PlanetTile {
  return {
    id: planetId++, index: 0, name: `P${planetId}`, factionId, x: 1, y: 1, type: 'earthlike', size: 'medium',
    population, buildings: [], explored: true,
  } as PlanetTile;
}

function system(id: string, x: number, y: number, planets: PlanetTile[]): StarSystem {
  return { id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true };
}

function fleet(id: number, factionId: string, x: number, y: number, types: string[]): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, system: null,
    ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
  };
}

function base(id: number, factionId: string, x: number, y: number): SpaceBase {
  return { id, name: `Base ${id}`, factionId, x, y };
}

describe('territory (pure)', () => {
  it('a system belongs to the faction with the most planets there; ties by population, then id', () => {
    const factions = makeFactions();
    expect(systemClaimOwner(system('a', 10, 10, [planet('player'), planet('player'), planet('enemy1')]), factions)).toBe('player');
    expect(systemClaimOwner(system('b', 10, 10, [planet('player', 50), planet('enemy1', 80)]), factions)).toBe('enemy1');
    expect(systemClaimOwner(system('c', 10, 10, [planet('player', 50), planet('enemy1', 50)]), factions)).toBe('enemy1');
    expect(systemClaimOwner(system('d', 10, 10, [planet('unhabited'), planet('independent')]), factions)).toBeNull();
  });

  it('claims a disc around an owned star; neutral space has no owner', () => {
    const factions = makeFactions();
    const map = computeTerritory([system('home', 30, 30, [planet('player')])], [], factions, W, H);
    const r = TERRITORY_CONFIG.systemClaimRadius;
    expect(map.ownerAt(30, 30)).toBe('player');
    expect(map.ownerAt(30 + r, 30)).toBe('player');
    expect(map.ownerAt(30 + r + 1, 30)).toBeNull();
    expect(map.ownerAtPoint(30.9, 30.2)).toBe('player');
  });

  it('gives every cell exactly one owner: system beats base, otherwise nearest, then older', () => {
    const factions = makeFactions();
    const systems = [system('s', 30, 30, [planet('player')])];
    // Enemy base whose claim reaches into the player's system disc.
    const bases = [base(1, 'enemy1', 30 + TERRITORY_CONFIG.systemClaimRadius + 3, 30)];
    const map = computeTerritory(systems, bases, factions, W, H);
    expect(map.ownerAt(30 + TERRITORY_CONFIG.systemClaimRadius, 30)).toBe('player');
    expect(map.ownerAt(30 + TERRITORY_CONFIG.systemClaimRadius + 1, 30)).toBe('enemy1');

    // Two bases: nearest wins; on the exact midpoint the older (lower id) wins.
    const duel = computeTerritory([], [base(5, 'enemy2', 60, 40), base(2, 'enemy1', 68, 40)], factions, W, H);
    expect(duel.ownerAt(63, 40)).toBe('enemy2');
    expect(duel.ownerAt(65, 40)).toBe('enemy1');
    expect(duel.ownerAt(64, 40)).toBe('enemy1');

    let owned = 0;
    duel.forEachCell(() => owned++);
    expect(owned).toBe(duel.cellCount);
  });

  it('builds fill and border paths per faction', () => {
    const factions = makeFactions();
    const map = computeTerritory([system('s', 30, 30, [planet('player')])], [base(1, 'enemy1', 60, 30)], factions, W, H);
    const shapes = buildTerritoryShapes(map);
    expect(shapes.map((s) => s.factionId)).toEqual(['enemy1', 'player']);
    for (const shape of shapes) {
      expect(shape.fill.length).toBeGreaterThan(0);
      expect(shape.border).toMatch(/^M/);
    }
  });
});

describe('TerritoryService (event-driven cache)', () => {
  let service: TerritoryService;
  let bases: SpaceBaseService;
  let ownership: PlanetOwnershipService;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    service = TestBed.inject(TerritoryService);
    bases = TestBed.inject(SpaceBaseService);
    ownership = TestBed.inject(PlanetOwnershipService);
    bases.restore([]);
  });

  it('returns the cached map until a planet changes owner, then follows the new owner', () => {
    const factions = makeFactions();
    const p = planet('player');
    const systems = [system('s', 30, 30, [p])];
    const first = service.get(systems, factions);
    expect(service.get(systems, factions)).toBe(first);
    expect(first.ownerAt(30, 30)).toBe('player');

    ownership.transferPlanet({ factions, production: [] }, p, 'enemy1', 'battle_won');
    const second = service.get(systems, factions);
    expect(second).not.toBe(first);
    expect(second.ownerAt(30, 30)).toBe('enemy1');
  });

  it('adds a base claim on restore/deploy and removes it when the base is destroyed', () => {
    const factions = makeFactions();
    bases.restore([base(1, 'enemy1', 60, 40)]);
    expect(service.get([], factions).ownerAt(60, 40)).toBe('enemy1');
    bases.destroy(1);
    expect(service.get([], factions).ownerAt(60, 40)).toBeNull();
  });
});

describe('colonization rule', () => {
  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(SpaceBaseService).restore([]);
  });

  function setup() {
    const factions = makeFactions();
    const free = { ...planet('unhabited', 0), x: 5, y: 4 };
    const center = TestBed.inject(StarMapMovementService).getPlanetCellCenter(free);
    const sys = system('contested', 30, 30, [planet('enemy1'), free]);
    const colonizer = fleet(9, 'player', 30, 30, ['colonizer']);
    colonizer.system = { id: 'contested', x: center.x, y: center.y, targetX: null, targetY: null };
    return { factions, free, sys, colonizer };
  }

  it("forbids colonizing in another empire's territory at peace and allows it at war", () => {
    const { factions, free, sys, colonizer } = setup();
    const arrival = TestBed.inject(StarMapPlanetArrivalService);
    const territory = TestBed.inject(TerritoryService);
    const player = factions[0];
    const enemy = factions[1];

    startPeace(player, enemy, 0);
    expect(territory.canColonizeIn(player, sys, [sys], factions)).toBe(false);
    expect(arrival.getColonizablePlanet(colonizer, [sys], factions)).toBeNull();
    expect(arrival.getTerritoryBlocker(colonizer, [sys], factions)?.id).toBe('enemy1');
    expect(arrival.colonize(colonizer, free, { factions, production: [], starSystems: [sys] })).toBeNull();
    expect(free.factionId).toBe('unhabited');

    startWar(player, enemy, 0);
    expect(arrival.getColonizablePlanet(colonizer, [sys], factions)).toBe(free);
    expect(arrival.colonize(colonizer, free, { factions, production: [], starSystems: [sys] })).not.toBeNull();
    expect(free.factionId).toBe('player');
  });

  it('the AI never targets a planet in a peace partner territory, but does at war', () => {
    const factions = makeFactions();
    const [player, vex] = factions;
    const goals = TestBed.inject(EnemyGoalService);
    const near = { ...planet('unhabited', 0), x: 5, y: 4 };
    const far = { ...planet('unhabited', 0), x: 5, y: 4 };
    const claimed = system('claimed', 20, 20, [planet('player'), near]);
    const open = system('open', 60, 20, [far]);
    const vexHome = system('vexHome', 15, 15, [planet('enemy1')]);
    const fleets = [fleet(1, 'enemy1', 15, 15, ['colonizer'])];

    startPeace(player, vex, 0);
    goals.tick(3, 'expand', 'enemy1', fleets, factions, [claimed, open, vexHome]);
    expect((goals.getGoal('enemy1') as { targetPlanetId?: number })?.targetPlanetId).toBe(far.id);

    goals.reset();
    startWar(player, vex, 0);
    goals.tick(3, 'expand', 'enemy1', fleets, factions, [claimed, open, vexHome]);
    expect((goals.getGoal('enemy1') as { targetPlanetId?: number })?.targetPlanetId).toBe(near.id);
  });

  it('own and neutral space is always open', () => {
    const factions = makeFactions();
    const territory = TestBed.inject(TerritoryService);
    const own = system('own', 30, 30, [planet('player'), planet('unhabited', 0)]);
    const empty = system('empty', 80, 30, [planet('unhabited', 0)]);
    expect(territory.canColonizeIn(factions[0], own, [own, empty], factions)).toBe(true);
    expect(territory.canColonizeIn(factions[0], empty, [own, empty], factions)).toBe(true);
  });
});

describe('BorderService (border violations)', () => {
  let border: BorderService;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(SpaceBaseService).restore([]);
    border = TestBed.inject(BorderService);
    border.reset();
  });

  function scene() {
    const factions = makeFactions();
    const [player, enemy] = factions;
    startPeace(player, enemy, 0);
    const systems = [system('home', 30, 30, [planet('player')])];
    return { factions, player, enemy, systems };
  }

  /* First tick after a reset only registers fleets already inside (load safety). */
  function seed(factions: Faction[], fleets: Fleet[], systems: StarSystem[]) {
    border.tick(BORDER_CONFIG.checkInterval, { factions, fleets, starSystems: systems });
  }

  it('an at-peace fleet entering foreign territory lowers the owner opinion, scaled by fleet value, without war', () => {
    const { factions, player, enemy, systems } = scene();
    const small = fleet(1, 'enemy1', 90, 70, ['scout']);
    const big = fleet(2, 'enemy1', 90, 70, Array(10).fill('cruiser'));
    seed(factions, [small, big], systems);

    small.x = 31;
    small.y = 30;
    border.tick(BORDER_CONFIG.checkInterval, { factions, fleets: [small, big], starSystems: systems });
    const afterSmall = getOpinion(player, enemy);
    expect(afterSmall).toBeLessThan(0);
    expect(border.drainEvents()).toEqual([{ ownerId: 'player', intruderId: 'enemy1', fleetId: 1, fleetName: 'Fleet 1' }]);

    big.x = 32;
    big.y = 31;
    border.tick(BORDER_CONFIG.checkInterval, { factions, fleets: [small, big], starSystems: systems });
    const bigIncident = getOpinion(player, enemy) - afterSmall;
    // The big fleet's incident costs more than the scout's whole stay so far.
    expect(bigIncident).toBeLessThan(afterSmall);
    expect(player.relations!['enemy1'].borderIncidents).toBeCloseTo(2, 1);

    // Staying inside keeps costing opinion; it never declares war.
    const beforeStay = getOpinion(player, enemy);
    for (let i = 0; i < 60; i++) border.tick(1, { factions, fleets: [small, big], starSystems: systems });
    expect(getOpinion(player, enemy)).toBeLessThan(beforeStay - 5);
    expect(areFactionsHostile(player, enemy)).toBe(false);
    expect(player.relations!['enemy1'].state).toBe('peace');
    // The intruder's own view is untouched.
    expect(getOpinion(enemy, player)).toBe(0);
  });

  it('repeated incidents cost more than the first one', () => {
    const { factions, player, enemy, systems } = scene();
    const f = fleet(1, 'enemy1', 90, 70, Array(3).fill('frigate'));
    seed(factions, [f], systems);
    const enterAndLeave = () => {
      const before = getOpinion(player, enemy);
      f.x = 31;
      f.y = 30;
      border.tick(1, { factions, fleets: [f], starSystems: systems });
      const cost = before - getOpinion(player, enemy);
      f.x = 90;
      f.y = 70;
      border.tick(1, { factions, fleets: [f], starSystems: systems });
      return cost;
    };
    const first = enterAndLeave();
    const second = enterAndLeave();
    expect(second).toBeGreaterThan(first);
  });

  it('is no violation at war, for own territory, or with passage rights', () => {
    const { factions, player, enemy, systems } = scene();
    const f = fleet(1, 'enemy1', 31, 30, ['cruiser']);
    const own = fleet(2, 'player', 30, 30, ['cruiser']);
    seed(factions, [], systems);

    player.relations!['enemy1'].passageRights = true;
    border.tick(1, { factions, fleets: [f, own], starSystems: systems });
    expect(getOpinion(player, enemy)).toBe(0);
    expect(border.violatedTerritoryOf(f.id)).toBeNull();

    startWar(player, enemy, 0);
    expect(player.relations!['enemy1'].passageRights).toBeUndefined();
    border.tick(1, { factions, fleets: [f, own], starSystems: systems });
    expect(border.violatedTerritoryOf(f.id)).toBeNull();
    expect(border.drainEvents()).toEqual([]);
  });

  it('a load (reset) never creates an incident for a fleet already inside', () => {
    const { factions, player, enemy, systems } = scene();
    const f = fleet(1, 'enemy1', 31, 30, ['cruiser']);
    border.tick(1, { factions, fleets: [f], starSystems: systems });
    expect(getOpinion(player, enemy)).toBe(0);
    expect(border.drainEvents()).toEqual([]);
    expect(border.violatedTerritoryOf(f.id)).toBe('player');
  });

  it('remembered incidents fade over time and survive load normalization', () => {
    const { factions, player } = scene();
    player.relations!['enemy1'].borderIncidents = 1;
    normalizeRelations(factions);
    expect(player.relations!['enemy1'].borderIncidents).toBe(1);
    border.tick(60, { factions, fleets: [], starSystems: [] });
    expect(player.relations!['enemy1'].borderIncidents).toBeCloseTo(1 - BORDER_CONFIG.incidentDecayPerMinute, 5);
  });
});

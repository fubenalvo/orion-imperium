import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PlanetArrivalContext, StarMapPlanetArrivalService } from './star-map-planet-arrival.service';
import { StarMapMovementService } from './star-map-movement.service';
import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';

/*
 * Player colonization is an explicit command (fleet panel COLONIZE button):
 * arriving on an uninhabited planet only parks the fleet. Covers the
 * button's availability, the command itself (colonizer consumed, ownership
 * transferred, emptied fleet retired) and the planet panel's carrier lookup.
 */
describe('StarMapPlanetArrivalService colonization', () => {
  let service: StarMapPlanetArrivalService;
  let movement: StarMapMovementService;

  const factions = [
    { id: 'player', name: 'Player', color: '#fff', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Enemy', color: '#f00', team: 2, currencies: {} },
    { id: 'unhabited', name: 'Uninhabited', color: '#888', team: 0, currencies: {} },
  ] as unknown as Faction[];

  const makePlanet = (id: number, factionId: string, x: number, y: number): PlanetTile =>
    ({ id, index: 0, name: `P${id}`, factionId, x, y, type: 'terran', size: 'medium', population: 0, buildings: [], explored: true }) as unknown as PlanetTile;

  const makeSystem = (planets: PlanetTile[]): StarSystem =>
    ({ id: 7, name: 'Sol', x: 10, y: 10, planetsTiles: planets }) as unknown as StarSystem;

  const makeFleet = (id: number, factionId: string, at: { x: number; y: number }, types: string[]): Fleet =>
    ({
      id,
      name: `Fleet ${id}`,
      factionId,
      x: 10,
      y: 10,
      targetX: null,
      targetY: null,
      ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
      system: { id: 7, x: at.x, y: at.y, targetX: null, targetY: null },
    }) as unknown as Fleet;

  const viewing = (fleets: Fleet[], system: StarSystem): PlanetArrivalContext => ({
    fleets,
    currentView: 'system',
    selectedSystem: system,
    factions,
    production: [],
    saveGame: vi.fn(),
    enterBattleScreen: vi.fn(),
  });

  beforeEach(() => {
    service = TestBed.inject(StarMapPlanetArrivalService);
    movement = TestBed.inject(StarMapMovementService);
    service.reset();
  });

  it('does not colonize on arrival; the fleet just parks', () => {
    const planet = makePlanet(1, 'unhabited', 5, 4);
    const system = makeSystem([planet]);
    const fleet = makeFleet(1, 'player', movement.getPlanetCellCenter(planet), ['colonizer']);

    service.checkFleetPlanetArrivals(viewing([fleet], system));

    expect(planet.factionId).toBe('unhabited');
    expect(fleet.ships.length).toBe(1);
    expect(service.getColonizablePlanet(fleet, [system])).toBe(planet);
  });

  it('offers colonization only to a stopped fleet with a living colonizer on an uninhabited planet', () => {
    const empty = makePlanet(1, 'unhabited', 5, 4);
    const owned = makePlanet(2, 'enemy1', 9, 6);
    const system = makeSystem([empty, owned]);

    const warship = makeFleet(1, 'player', movement.getPlanetCellCenter(empty), ['frigate']);
    expect(service.getColonizablePlanet(warship, [system])).toBeNull();

    const onOwned = makeFleet(2, 'player', movement.getPlanetCellCenter(owned), ['colonizer']);
    expect(service.getColonizablePlanet(onOwned, [system])).toBeNull();

    const inSpace = makeFleet(3, 'player', { x: 2.5, y: 2.5 }, ['colonizer']);
    expect(service.getColonizablePlanet(inSpace, [system])).toBeNull();

    const moving = makeFleet(4, 'player', movement.getPlanetCellCenter(empty), ['colonizer']);
    moving.system!.targetX = 2.5;
    moving.system!.targetY = 2.5;
    expect(service.getColonizablePlanet(moving, [system])).toBeNull();

    const wrecked = makeFleet(5, 'player', movement.getPlanetCellCenter(empty), ['colonizer']);
    wrecked.ships[0].destroyed = true;
    expect(service.getColonizablePlanet(wrecked, [system])).toBeNull();
  });

  it('colonize consumes the colonizer, transfers the planet and retires an emptied fleet', () => {
    const planet = makePlanet(1, 'unhabited', 5, 4);
    const fleet = makeFleet(1, 'player', movement.getPlanetCellCenter(planet), ['colonizer']);

    const result = service.colonize(fleet, planet, { production: [], factions });

    expect(result).toEqual({ fleetRetired: true });
    expect(planet.factionId).toBe('player');
    expect(fleet.destroyed).toBe(true);
  });

  it('colonize keeps a fleet that still has ships', () => {
    const planet = makePlanet(1, 'unhabited', 5, 4);
    const fleet = makeFleet(1, 'player', movement.getPlanetCellCenter(planet), ['frigate', 'colonizer']);

    const result = service.colonize(fleet, planet, { production: [], factions });

    expect(result).toEqual({ fleetRetired: false });
    expect(fleet.destroyed).toBeFalsy();
    expect(fleet.ships.map((s) => s.type)).toEqual(['frigate']);
  });

  it('colonize refuses an already owned planet or a fleet without a colonizer', () => {
    const owned = makePlanet(1, 'enemy1', 5, 4);
    const carrier = makeFleet(1, 'player', movement.getPlanetCellCenter(owned), ['colonizer']);
    expect(service.colonize(carrier, owned, { production: [], factions })).toBeNull();
    expect(owned.factionId).toBe('enemy1');
    expect(carrier.ships.length).toBe(1);

    const empty = makePlanet(2, 'unhabited', 5, 4);
    const warship = makeFleet(2, 'player', movement.getPlanetCellCenter(empty), ['frigate']);
    expect(service.colonize(warship, empty, { production: [], factions })).toBeNull();
    expect(empty.factionId).toBe('unhabited');
  });

  it('finds the parked, en-route and other player colonizer fleets for the planet panel', () => {
    const planet = makePlanet(1, 'unhabited', 5, 4);
    const system = makeSystem([planet]);
    const center = movement.getPlanetCellCenter(planet);
    const elsewhere = makeFleet(1, 'player', { x: 87.5, y: 47.5 }, ['colonizer']);
    const warship = makeFleet(2, 'player', center, ['frigate']);
    const enemy = makeFleet(3, 'enemy1', center, ['colonizer']);

    let result = service.getColonizationCarriers([elsewhere, warship, enemy], system, planet);
    expect(result.carriers.map((f) => f.id)).toEqual([1]);
    expect(result.parked).toBeNull();
    expect(result.enRoute).toBeNull();

    elsewhere.system!.targetX = center.x;
    elsewhere.system!.targetY = center.y;
    result = service.getColonizationCarriers([elsewhere], system, planet);
    expect(result.enRoute?.id).toBe(1);

    elsewhere.system = { ...elsewhere.system!, x: center.x, y: center.y, targetX: null, targetY: null };
    result = service.getColonizationCarriers([elsewhere], system, planet);
    expect(result.parked?.id).toBe(1);
    expect(result.enRoute).toBeNull();
  });
});

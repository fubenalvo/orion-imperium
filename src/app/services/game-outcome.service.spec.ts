import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { GameOutcomeService } from './game-outcome.service';
import { Faction, Fleet, StarMapData } from '../components/star-map/star-map.models';

describe('GameOutcomeService', () => {
  let service: GameOutcomeService;

  const makeFaction = (id: string, team: number, ai: boolean): Faction => ({
    id,
    name: id,
    color: '#fff',
    team,
    ai,
    currencies: { credits: 0, rawmaterials: 0, research: 0 },
  } as Faction);

  const makePlanet = (id: number, factionId: string, population = 100) => ({
    id,
    index: 0,
    name: 'P' + id,
    factionId,
    x: 1,
    y: 1,
    type: 'earthlike',
    size: 'medium',
    population,
    buildings: [],
    explored: true,
  } as any);

  const makeFleet = (id: number, factionId: string, destroyed = false) => ({
    id,
    name: 'F' + id,
    factionId,
    x: 1,
    y: 1,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships: [{ id: id * 10, name: 's', type: 'fighter', destroyed: false }],
    destroyed,
  } as Fleet);

  const makeData = (overrides: Partial<StarMapData> = {}): StarMapData => ({
    factions: [makeFaction('player', 1, false), makeFaction('enemy1', 2, true)],
    map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [
      {
        id: 'sol',
        name: 'Sol',
        x: 1,
        y: 1,
        planets: 1,
        color: '#fff',
        planetsTiles: [makePlanet(1, 'player')],
      } as any,
    ],
    fleets: [],
    ...overrides,
  } as StarMapData);

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameOutcomeService);
    service.reset();
  });

  it('player controls all inhabited planets and no hostile AI remains: victory', () => {
    const data = makeData();
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('victory');
  });

  it('hostile AI retains an inhabited planet: no victory', () => {
    const data = makeData({
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 1,
          color: '#fff',
          planetsTiles: [makePlanet(1, 'player'), makePlanet(2, 'enemy1')],
        } as any,
      ],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('inProgress');
  });

  it('hostile fleet remains and faction capable of war: no premature victory', () => {
    const data = makeData({
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 1,
          color: '#fff',
          planetsTiles: [makePlanet(1, 'player')],
        } as any,
      ],
      fleets: [makeFleet(99, 'enemy1')],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('inProgress');
  });

  it('uninhabited planets remain: do not prevent victory', () => {
    const data = makeData({
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 2,
          color: '#fff',
          planetsTiles: [makePlanet(1, 'player'), { ...makePlanet(2, 'unhabited'), factionId: 'unhabited', population: 0 } as any],
        } as any,
      ],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('victory');
  });

  it('explicitly allied factions control planets: count toward victory', () => {
    const factions = [makeFaction('player', 1, false), makeFaction('ally1', 1, false)];
    const data = makeData({
      factions,
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 2,
          color: '#fff',
          planetsTiles: [makePlanet(1, 'player'), makePlanet(2, 'ally1')],
        } as any,
      ],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('victory');
  });

  it('neutral or independent factions are not automatically treated as allies', () => {
    const factions = [makeFaction('player', 1, false), makeFaction('independent', 0, false)];
    const data = makeData({
      factions,
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 2,
          color: '#fff',
          planetsTiles: [makePlanet(1, 'player'), makePlanet(2, 'independent')],
        } as any,
      ],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('inProgress');
  });

  it('player has no planets but still has a surviving fleet: no defeat', () => {
    const data = makeData({
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 0,
          color: '#fff',
          planetsTiles: [],
        } as any,
      ],
      fleets: [makeFleet(1, 'player')],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('inProgress');
  });

  it('player has neither inhabited planets nor surviving fleets: defeat', () => {
    const data = makeData({
      starSystems: [
        {
          id: 's1',
          name: 'S1',
          x: 1,
          y: 1,
          planets: 0,
          color: '#fff',
          planetsTiles: [],
        } as any,
      ],
      fleets: [],
    });
    expect(service.evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('defeat');
  });

  it('outcome triggers exactly once via service state', () => {
    const data = makeData();
    const r1 = service.evaluate(data);
    const r2 = service.evaluate(data);
    expect(r1).toBe('victory');
    expect(r2).toBe('victory');
  });
});

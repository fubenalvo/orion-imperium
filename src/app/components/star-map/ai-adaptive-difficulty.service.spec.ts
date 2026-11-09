import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AiAdaptiveDifficultyService, EmpirePower, empirePowerRatio } from './ai-adaptive-difficulty.service';
import { ADAPTIVE_STEP, setAdaptiveDifficultyEnabled } from './ai-difficulty';
import { ShipService } from '../../services/ship.service';
import { Faction, Fleet, StarSystem } from './star-map.models';

const faction = (id: string, ai: boolean, aiAdaptiveFactor?: number): Faction => ({
  id,
  name: id,
  color: '#fff',
  team: ai ? 2 : 1,
  ai,
  aiDifficulty: ai ? 'normal' : undefined,
  aiAdaptiveFactor,
  currencies: {},
  researchedTechnologies: [],
});

const system = (owners: string[]): StarSystem => ({
  id: 'sys',
  name: 'SYS',
  x: 1,
  y: 1,
  planets: owners.length,
  color: '#fff',
  planetsTiles: owners.map((factionId, i) => ({
    id: i + 1,
    index: i + 1,
    name: `P${i}`,
    factionId,
    x: 0,
    y: 0,
    type: 'earthlike',
    size: 'medium',
    population: 1000,
    explored: true,
    buildings: [],
  })),
});

const fleet = (id: number, factionId: string, frigates: number): Fleet => ({
  id,
  name: `F${id}`,
  factionId,
  x: 0,
  y: 0,
  targetX: null,
  targetY: null,
  speed: 5,
  system: null,
  destroyed: false,
  ships: Array.from({ length: frigates }, (_, i) => ({ id: id * 100 + i, name: `s${i}`, type: 'frigate' })),
});

describe('AiAdaptiveDifficultyService', () => {
  beforeEach(() => setAdaptiveDifficultyEnabled(true));
  afterEach(() => setAdaptiveDifficultyEnabled(false));

  it('measures a symmetric power ratio', () => {
    const a: EmpirePower = { planets: 6, population: 8000, military: 900, technologies: 12 };
    const b: EmpirePower = { planets: 2, population: 2000, military: 200, technologies: 6 };
    expect(empirePowerRatio(a, b)).toBeGreaterThan(1.5);
    expect(empirePowerRatio(a, b) * empirePowerRatio(b, a)).toBeCloseTo(1, 9);
    expect(empirePowerRatio(a, a)).toBeCloseTo(1, 9);
  });

  it('slows a runaway AI once per game minute, starting a missing factor at 1', () => {
    const service = new AiAdaptiveDifficultyService(new ShipService());
    const runaway = faction('enemy1', true, 1);
    const fresh = faction('enemy2', true);
    const data = {
      factions: [faction('player', false), runaway, fresh],
      starSystems: [system(['player', 'enemy1', 'enemy1', 'enemy1', 'enemy1', 'enemy2'])],
      fleets: [fleet(1, 'player', 1), fleet(2, 'enemy1', 12)],
      shipStock: [],
    };
    expect(service.tick(59, data)).toBe(false);
    expect(runaway.aiAdaptiveFactor).toBe(1);
    expect(service.tick(1, data)).toBe(true);
    expect(runaway.aiAdaptiveFactor).toBeCloseTo(1 - ADAPTIVE_STEP, 6);
    expect(fresh.aiAdaptiveFactor).toBeDefined();
  });

  it('changes nothing while the option is off', () => {
    setAdaptiveDifficultyEnabled(false);
    const service = new AiAdaptiveDifficultyService(new ShipService());
    const runaway = faction('enemy1', true, 1);
    const data = {
      factions: [faction('player', false), runaway],
      starSystems: [system(['player', 'enemy1', 'enemy1', 'enemy1'])],
      fleets: [fleet(1, 'player', 1), fleet(2, 'enemy1', 12)],
      shipStock: [],
    };
    expect(service.tick(120, data)).toBe(false);
    expect(runaway.aiAdaptiveFactor).toBe(1);
  });

  it('speeds up a trailing AI and pauses while the player owns no planet', () => {
    const service = new AiAdaptiveDifficultyService(new ShipService());
    const trailing = faction('enemy1', true, 1);
    const data = {
      factions: [faction('player', false), trailing],
      starSystems: [system(['player', 'player', 'player', 'player', 'enemy1'])],
      fleets: [fleet(1, 'player', 12), fleet(2, 'enemy1', 1)],
      shipStock: [],
    };
    service.tick(60, data);
    expect(trailing.aiAdaptiveFactor).toBeCloseTo(1 + ADAPTIVE_STEP, 6);

    for (const p of data.starSystems[0].planetsTiles) p.factionId = 'enemy1';
    expect(service.tick(60, data)).toBe(false);
    expect(trailing.aiAdaptiveFactor).toBeCloseTo(1 + ADAPTIVE_STEP, 6);
  });
});

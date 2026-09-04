import { TestBed } from '@angular/core/testing';
import { EnemyAiService } from './enemy-ai.service';
import { Fleet, Faction } from './star-map.models';

describe('EnemyAiService', () => {
  let service: EnemyAiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyAiService);
  });

  const createFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
    id: 1,
    name: 'FLEET',
    factionId: 'player',
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    speed: 5,
    system: null,
    ships: [],
    destroyed: false,
    ...overrides,
  });

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, currencies: {} },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, currencies: {} },
    { id: 'independent', name: 'Independent', color: '#ffcc00', team: 0, currencies: {} },
    { id: 'unhabited', name: 'Unhabited', color: '#666666', team: 0, currencies: {} },
  ];

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return false when deltaTime is 0 (paused)', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5 }),
    ];

    const result = service.tick(0, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should return false when deltaTime is negative', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5 }),
    ];

    const result = service.tick(-1, fleets, factions);
    expect(result).toBe(false);
  });

  it('should select nearest player fleet', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'player', name: 'NEAR', x: 1, y: 1 }),
      createFleet({ factionId: 'player', name: 'FAR', x: 10, y: 10 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);
  });

  it('should keep existing target when fleet already has one', () => {
    const fleets = [
      createFleet({
        factionId: 'enemy1',
        name: 'RAIDER',
        x: 0,
        y: 0,
        targetX: 3,
        targetY: 3,
      }),
      createFleet({ factionId: 'player', name: 'ORION', x: 1, y: 1 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBe(3);
    expect(fleets[0].targetY).toBe(3);
  });

  it('should ignore destroyed enemy fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, destroyed: true }),
      createFleet({ factionId: 'player', name: 'ORION', x: 1, y: 1 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should do nothing when there are no player fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should not target another enemy fleet', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 1, y: 1 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should allow multiple enemy fleets to independently select targets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 0, y: 0 }),
      createFleet({ factionId: 'player', name: 'NEAR', x: 1, y: 1 }),
      createFleet({ factionId: 'player', name: 'FAR', x: 10, y: 10 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);
    expect(fleets[1].targetX).toBeCloseTo(1, 5);
    expect(fleets[1].targetY).toBeCloseTo(1, 5);
  });

  it('should not modify player fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, targetX: null, targetY: null }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[1].targetX).toBeNull();
    expect(fleets[1].targetY).toBeNull();
  });

  it('should not modify independent or unhabited fleets', () => {
    const fleets = [
      createFleet({ factionId: 'independent', name: 'INDEP', x: 0, y: 0 }),
      createFleet({ factionId: 'unhabited', name: 'UNHAB', x: 0, y: 0 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
  });
});

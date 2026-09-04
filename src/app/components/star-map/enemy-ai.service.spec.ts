import { TestBed } from '@angular/core/testing';
import { EnemyAiService } from './enemy-ai.service';
import { Fleet, Faction } from './star-map.models';

describe('EnemyAiService', () => {
  let service: EnemyAiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyAiService);
  });

  afterEach(() => {
    service.reset();
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
    ships: [{ id: 1, name: 'Ship', type: 'frigate', currentHp: 10, destroyed: false }],
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
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 2 }),
    ];

    const result = service.tick(0, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should return false when deltaTime is negative', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 2 }),
    ];

    const result = service.tick(-1, fleets, factions);
    expect(result).toBe(false);
  });

  it('should select nearest player fleet when all targets have equal strength', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'NEAR', x: 1, y: 1, id: 2 }),
      createFleet({ factionId: 'player', name: 'FAR', x: 10, y: 10, id: 3 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);
  });

  it('should keep valid target across ticks', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(3, 5);
    expect(fleets[0].targetY).toBeCloseTo(3, 5);

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeCloseTo(3, 5);
    expect(fleets[0].targetY).toBeCloseTo(3, 5);
  });

  it('should keep valid target even when another player fleet becomes closer', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10 }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 1, y: 1, id: 11 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);

    fleets[2].x = 0;
    fleets[2].y = 0;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeCloseTo(0, 5);
    expect(fleets[0].targetY).toBeCloseTo(0, 5);
  });

  it('should retarget when the current target is destroyed', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 1, y: 1, id: 10 }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 10, y: 10, id: 11 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);

    fleets[1].destroyed = true;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(10, 5);
    expect(fleets[0].targetY).toBeCloseTo(10, 5);
  });

  it('should retarget when the current target has no ships', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 1, y: 1, id: 10 }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 10, y: 10, id: 11 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);

    fleets[1].ships = [];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(10, 5);
    expect(fleets[0].targetY).toBeCloseTo(10, 5);
  });

  it('should clear target when all player fleets are destroyed', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);

    fleets[1].destroyed = true;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should ignore destroyed enemy fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, destroyed: true, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 1, y: 1, id: 2 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should do nothing when there are no player fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should not target another enemy fleet', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 1, y: 1, id: 2 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeNull();
    expect(fleets[0].targetY).toBeNull();
  });

  it('should allow multiple enemy fleets to independently select and maintain targets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 0, y: 0, id: 2 }),
      createFleet({ factionId: 'player', name: 'NEAR', x: 1, y: 1, id: 10 }),
      createFleet({ factionId: 'player', name: 'FAR', x: 10, y: 10, id: 11 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);
    expect(fleets[1].targetX).toBeCloseTo(1, 5);
    expect(fleets[1].targetY).toBeCloseTo(1, 5);

    fleets[2].destroyed = true;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(10, 5);
    expect(fleets[0].targetY).toBeCloseTo(10, 5);
    expect(fleets[1].targetX).toBeCloseTo(10, 5);
    expect(fleets[1].targetY).toBeCloseTo(10, 5);
  });

  it('should not modify player fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, targetX: null, targetY: null, id: 2 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[1].targetX).toBeNull();
    expect(fleets[1].targetY).toBeNull();
  });

  it('should not modify independent or unhabited fleets', () => {
    const fleets = [
      createFleet({ factionId: 'independent', name: 'INDEP', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'unhabited', name: 'UNHAB', x: 0, y: 0, id: 2 }),
    ];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
  });

  it('should follow a moving valid target', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10 }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);

    fleets[1].x = 8;
    fleets[1].y = 8;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeCloseTo(8, 5);
    expect(fleets[0].targetY).toBeCloseTo(8, 5);
  });

  it('should prefer weak target over closer strong target', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10, ships: [{ id: 1, name: 'F', type: 'frigate', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 1, y: 1, id: 11, ships: [{ id: 1, name: 'C', type: 'cruiser', currentHp: 10, destroyed: false }] }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);
  });

  it('should select comparable target by distance', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 1, y: 1, id: 11, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);
  });

  it('should select strong target when no weak or comparable targets exist', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10, ships: [{ id: 1, name: 'B', type: 'battleship', currentHp: 10, destroyed: false }] }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);
  });

  it('should not retarget when another fleet becomes weaker but current target is still valid', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10, ships: [{ id: 1, name: 'F', type: 'frigate', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 1, y: 1, id: 11, ships: [{ id: 1, name: 'C', type: 'cruiser', currentHp: 10, destroyed: false }] }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);

    fleets[2].ships = [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }];

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(false);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);
  });

  it('should retarget to weak target when current strong target is destroyed', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 10, ships: [{ id: 1, name: 'B', type: 'battleship', currentHp: 10, destroyed: false }] }),
      createFleet({ factionId: 'player', name: 'PEGASUS', x: 1, y: 1, id: 11, ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }] }),
    ];

    service.tick(1, fleets, factions);
    expect(fleets[0].targetX).toBeCloseTo(1, 5);
    expect(fleets[0].targetY).toBeCloseTo(1, 5);

    fleets[2].destroyed = true;

    const result = service.tick(1, fleets, factions);
    expect(result).toBe(true);
    expect(fleets[0].targetX).toBeCloseTo(5, 5);
    expect(fleets[0].targetY).toBeCloseTo(5, 5);
  });
});

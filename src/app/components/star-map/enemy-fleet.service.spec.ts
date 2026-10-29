import { TestBed } from '@angular/core/testing';
import { EnemyFleetService } from './enemy-fleet.service';
import { Faction, Fleet, StarSystem } from './star-map.models';

/*
 * Unit tests for AI fleet operations with the real ShipService strength
 * formula and SpaceportService. One tick with dt = 2 is one decision.
 */
describe('EnemyFleetService', () => {
  let service: EnemyFleetService;

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, aiDifficulty: 'normal', currencies: {} },
  ];
  const ai = factions[1];

  // Home system with a Spaceport at (10,10); a colony system at (40,10).
  const systems = (): StarSystem[] => [
    {
      id: 'home',
      name: 'Home',
      x: 10,
      y: 10,
      planets: 1,
      color: '#fff',
      planetsTiles: [
        {
          id: 1, index: 0, name: 'H', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'medium',
          population: 1000, explored: true, buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }],
        },
      ],
    },
    {
      id: 'colony',
      name: 'Colony',
      x: 40,
      y: 10,
      planets: 1,
      color: '#fff',
      planetsTiles: [
        { id: 2, index: 0, name: 'C', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'small', population: 0, explored: true, buildings: [] },
      ],
    },
  ];

  let nextShip = 1;
  const fleet = (id: number, factionId: string, x: number, y: number, types: string[]): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships: types.map((type) => ({ id: nextShip++, name: type, type })),
  });

  const decide = (fleets: Fleet[], sys: StarSystem[], pipeline: number[] = []) =>
    service.tick(2, ai, factions, sys, fleets, new Set(pipeline));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyFleetService);
  });

  it('sends an idle fleet to garrison its home Spaceport system', () => {
    const f = fleet(1, 'enemy1', 30, 30, ['frigate']);
    const changed = decide([f], systems());

    expect(changed).toBe(true);
    expect(service.getAssignment(1)?.role).toBe('garrison');
    expect([f.targetX, f.targetY]).toEqual([10, 10]);
  });

  it('retreats an exposed fleet from a stronger hostile fleet', () => {
    const exposed = fleet(1, 'enemy1', 30, 30, ['frigate']);
    const hostile = fleet(50, 'player', 36, 30, ['battleship', 'battleship']);
    decide([exposed, hostile], systems());

    expect(service.getAssignment(1)?.role).toBe('retreat');
    expect([exposed.targetX, exposed.targetY]).toEqual([10, 10]);
  });

  it('intercepts a weak intruder with just enough strength and leaves other fleets on post', () => {
    const near = fleet(1, 'enemy1', 10, 10, ['destroyer']);
    const other = fleet(2, 'enemy1', 10, 10, ['destroyer']);
    const intruder = fleet(50, 'player', 18, 10, ['scout']);
    decide([near, other, intruder], systems());

    const roles = [service.getAssignment(1)?.role, service.getAssignment(2)?.role];
    expect(roles.filter((r) => r === 'intercept')).toHaveLength(1);
    const hunter = service.getAssignment(1)?.role === 'intercept' ? near : other;
    expect([hunter.targetX, hunter.targetY]).toEqual([18, 10]);

    // The next decision does not pull the second fleet in as well.
    decide([near, other, intruder], systems());
    expect([service.getAssignment(1)?.role, service.getAssignment(2)?.role].filter((r) => r === 'intercept')).toHaveLength(1);
  });

  it('does not intercept a hostile fleet stronger than its available fleets', () => {
    const guard = fleet(1, 'enemy1', 10, 10, ['fighter']);
    const raider = fleet(50, 'player', 25, 10, ['cruiser', 'cruiser']);
    decide([guard, raider], systems());

    expect(service.getAssignment(1)?.role).not.toBe('intercept');
    expect(guard.targetX).toBeNull();
  });

  it('sends a fleet that lost most of its strength home to regroup', () => {
    const f = fleet(1, 'enemy1', 40, 10, ['destroyer', 'destroyer', 'destroyer', 'destroyer']);
    decide([f], systems());
    // Battle losses as StarMap.applyBattleResult writes them.
    f.ships.slice(0, 3).forEach((s) => (s.destroyed = true));
    f.targetX = null;
    f.targetY = null;
    decide([f], systems());

    expect(service.getAssignment(1)?.role).toBe('regroup');
    expect([f.targetX, f.targetY]).toEqual([10, 10]);
  });

  it('never touches colonizer carriers or fleets commanded by the pipeline', () => {
    const carrier = fleet(1, 'enemy1', 30, 30, ['colonizer', 'frigate']);
    carrier.targetX = 40;
    carrier.targetY = 10;
    const commanded = fleet(2, 'enemy1', 20, 20, ['destroyer']);
    commanded.targetX = 25;
    commanded.targetY = 25;
    decide([carrier, commanded], systems(), [2]);

    expect(service.getManagedFleetIds().size).toBe(0);
    expect([carrier.targetX, carrier.targetY]).toEqual([40, 10]);
    expect([commanded.targetX, commanded.targetY]).toEqual([25, 25]);
  });

  it('does nothing while paused', () => {
    const f = fleet(1, 'enemy1', 30, 30, ['frigate']);
    expect(service.tick(0, ai, factions, systems(), [f], new Set())).toBe(false);
    expect(f.targetX).toBeNull();
  });
});

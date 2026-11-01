import { TestBed } from '@angular/core/testing';
import {
  CAPTURE_MIN_SATISFACTION,
  CAPTURE_REBELLION_GRACE_SECONDS,
  PlanetOwnershipService,
} from './planet-ownership.service';
import { Faction, FactionProduction, PlanetTile } from '../components/star-map/star-map.models';

describe('PlanetOwnershipService', () => {
  let service: PlanetOwnershipService;

  const planet = (): PlanetTile => ({
    id: 7, index: 0, name: 'P', factionId: 'player', x: 1, y: 1, type: 'earthlike', size: 'medium',
    population: 100, explored: true, buildings: [{ name: 'Spaceship Factory', size: 3, x: 0, y: 0 }],
  });
  const factions = (): Faction[] => [
    { id: 'player', name: 'P', color: '#fff', team: 1, ai: false, currencies: { credits: 0 } },
    { id: 'enemy1', name: 'E', color: '#f00', team: 2, ai: true, currencies: { credits: 0 } },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlanetOwnershipService);
  });

  it('transfers ownership, bumps the revision and cancels the old owner\'s orders on that planet with a refund', () => {
    const p = planet();
    const f = factions();
    const production: FactionProduction[] = [
      { factionId: 'player', ordersByPlanet: { 7: [{ id: 1, shipTypeId: 'fighter', quantity: 2, progress: 0.5, startedAtTick: 0 }], 8: [{ id: 2, shipTypeId: 'fighter', quantity: 1, progress: 0, startedAtTick: 0 }] } },
    ];
    const revision = service.revision;

    expect(service.transferPlanet({ production, factions: f }, p, 'enemy1', 'battle_won')).toBe(true);

    expect(p.factionId).toBe('enemy1');
    expect(service.revision).toBe(revision + 1);
    expect(production[0].ordersByPlanet[7]).toBeUndefined();
    expect(production[0].ordersByPlanet[8]).toHaveLength(1);
    // Half of 2 × 75 credits was not built yet.
    expect(f[0].currencies['credits']).toBe(75);
  });

  it('ignores a transfer to the current owner (a repeated rule cannot apply twice)', () => {
    const p = planet();
    const revision = service.revision;
    expect(service.transferPlanet({}, p, 'player', 'captured')).toBe(false);
    expect(service.revision).toBe(revision);
  });

  it('keeps population and buildings with the planet', () => {
    const p = planet();
    const before = [...p.buildings];
    service.transferPlanet({}, p, 'enemy1', 'captured');
    expect(p.population).toBe(100);
    // The old buildings stay; a planet without a core also gets a Colony Center.
    expect(p.buildings.slice(0, before.length)).toEqual(before);
    expect(p.buildings.map((b) => b.name)).toContain('Colony Center');
  });

  it('a capture raises satisfaction to the minimum and starts the rebellion grace', () => {
    for (const reason of ['captured', 'battle_won'] as const) {
      const p = { ...planet(), factionId: 'independent', satisfaction: 0 };
      service.transferPlanet({}, p, 'player', reason);
      expect(p.satisfaction).toBe(CAPTURE_MIN_SATISFACTION);
      expect(p.rebellionGraceSeconds).toBe(CAPTURE_REBELLION_GRACE_SECONDS);
    }
  });

  it('a capture never lowers a higher satisfaction', () => {
    const p = { ...planet(), satisfaction: 90 };
    service.transferPlanet({}, p, 'enemy1', 'captured');
    expect(p.satisfaction).toBe(90);
  });

  it('colonization and rebellion leave satisfaction alone and clear any grace', () => {
    const p = { ...planet(), satisfaction: 0, rebellionGraceSeconds: 50 };
    service.transferPlanet({}, p, 'independent', 'rebellion');
    expect(p.satisfaction).toBe(0);
    expect(p.rebellionGraceSeconds).toBeUndefined();

    const q = { ...planet(), factionId: 'unhabited', satisfaction: 100 };
    service.transferPlanet({}, q, 'player', 'colonized');
    expect(q.satisfaction).toBe(100);
    expect(q.rebellionGraceSeconds).toBeUndefined();
  });
});

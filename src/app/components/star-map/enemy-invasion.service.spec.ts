import { TestBed } from '@angular/core/testing';
import { EnemyInvasionService, InvasionData } from './enemy-invasion.service';
import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';

/* AI planet capture with the real planet defenses, resolver and ownership service. */
describe('EnemyInvasionService', () => {
  let service: EnemyInvasionService;

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, currencies: {} },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, ai: true, currencies: {} },
    { id: 'independent', name: 'Independent', color: '#ffcc00', team: 0, ai: false, currencies: {} },
    { id: 'unhabited', name: 'Unhabited', color: '#666666', team: 0, ai: false, currencies: {} },
  ];

  let shipId = 1;
  const fleet = (id: number, types: string[], x = 10, y = 10): Fleet => ({
    id, name: `F${id}`, factionId: 'enemy1', x, y, targetX: null, targetY: null, speed: 4, system: null,
    ships: types.map((type) => ({ id: shipId++, name: type, type })),
  });
  const planet = (owner: string, turrets: number): PlanetTile => ({
    id: 3, index: 0, name: 'T', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'huge', population: 200, explored: false,
    buildings: Array.from({ length: turrets }, (_, i) => ({ name: 'Laser Turret', size: 1, x: i, y: 0 })),
  });
  const system = (p: PlanetTile): StarSystem => ({ id: 'tgt', name: 'Target', x: 10, y: 10, planets: 1, color: '#fff', planetsTiles: [p], explored: false });
  const data = (sys: StarSystem, fleets: Fleet[]): InvasionData => ({ factions, starSystems: [sys], fleets, production: [] });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyInvasionService);
  });

  it('treats only other teams\' planets as hostile', () => {
    const ai = factions[1];
    expect(service.isHostilePlanet(planet('player', 0), ai, factions)).toBe(true);
    expect(service.isHostilePlanet(planet('independent', 0), ai, factions)).toBe(true);
    expect(service.isHostilePlanet(planet('enemy2', 0), ai, factions)).toBe(false);
    expect(service.isHostilePlanet(planet('enemy1', 0), ai, factions)).toBe(false);
    expect(service.isHostilePlanet(planet('unhabited', 0), ai, factions)).toBe(false);
  });

  it('captures an undefended planet on arrival', () => {
    const target = planet('independent', 0);
    const sys = system(target);
    expect(service.launch([fleet(1, ['frigate'])], target, sys, data(sys, []))).toBe('captured');
    expect(target.factionId).toBe('enemy1');
  });

  it('wins a defended planet by battle and writes the attacker roster back', () => {
    const target = planet('independent', 1);
    const sys = system(target);
    const attacker = fleet(1, ['cruiser', 'cruiser', 'destroyer']);
    expect(service.launch([attacker], target, sys, data(sys, [attacker]))).toBe('captured');
    expect(target.factionId).toBe('enemy1');
    expect(attacker.destroyed).toBeFalsy();
    expect(attacker.ships.every((s) => s.currentHp !== undefined)).toBe(true);
  });

  it('is repelled by strong defenses: the planet keeps its owner and the attacker is lost', () => {
    const target = planet('independent', 8);
    const sys = system(target);
    const attacker = fleet(1, ['scout']);
    expect(service.launch([attacker], target, sys, data(sys, [attacker]))).toBe('repelled');
    expect(target.factionId).toBe('independent');
    expect(attacker.destroyed).toBe(true);
  });

  it('queues a battle for the player when the defender is the human player', () => {
    const target = planet('player', 1);
    const sys = system(target);
    const attacker = fleet(1, ['cruiser']);
    expect(service.launch([attacker], target, sys, data(sys, [attacker]))).toBe('pending_player');
    expect(target.factionId).toBe('player');
    expect(service.hasPendingBattleFor(target.id)).toBe(true);
    // A second launch does not queue a duplicate battle.
    expect(service.launch([attacker], target, sys, data(sys, [attacker]))).toBe('pending_player');
    const battle = service.takePendingPlayerBattle()!;
    expect(battle.type).toBe('planet');
    expect(battle.attackerId).toBe(attacker.id);
    expect(service.takePendingPlayerBattle()).toBeUndefined();
  });

  it('merges a co-located assault group into one attacker and ignores fleets not in the system', () => {
    const target = planet('independent', 1);
    const sys = system(target);
    const a = fleet(1, ['destroyer']);
    const b = fleet(2, ['destroyer', 'destroyer']);
    const away = fleet(3, ['cruiser'], 40, 40);
    service.launch([a, b, away], target, sys, data(sys, [a, b, away]));

    expect(a.ships.length).toBe(3);
    expect(b.destroyed).toBe(true);
    expect(away.destroyed).toBeFalsy();
    expect(away.ships).toHaveLength(1);
  });

  it('refuses invalid targets', () => {
    const own = planet('enemy2', 0);
    const sys = system(own);
    expect(service.launch([fleet(1, ['frigate'])], own, sys, data(sys, []))).toBe('invalid');
    expect(own.factionId).toBe('enemy2');
  });

  it('forecasts with the battle rules: strong group wins, lone scout does not', () => {
    const defended = planet('independent', 2);
    expect(service.forecast([fleet(1, ['cruiser', 'cruiser', 'cruiser'])], defended, factions).win).toBe(true);
    expect(service.forecast([fleet(2, ['scout'])], defended, factions).win).toBe(false);
  });
});

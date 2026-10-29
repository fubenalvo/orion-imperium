import { TestBed } from '@angular/core/testing';
import { EnemyPlanService } from './enemy-plan.service';
import { AiPersonality, Faction, Fleet, StarSystem } from './star-map.models';

/* Strategic assessment with the real economy, ship and research services. */
describe('EnemyPlanService', () => {
  let service: EnemyPlanService;

  const faction = (personality?: AiPersonality, research = 0): Faction => ({
    id: 'enemy1', name: 'E', color: '#f00', team: 2, ai: true, aiPersonality: personality,
    currencies: { credits: 0, research }, researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'],
  });
  const player: Faction = { id: 'player', name: 'P', color: '#00f', team: 1, ai: false, currencies: {} };

  const planet = (id: number, owner: string, buildings: { name: string; size: number; x: number; y: number }[] = [
    { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
    { name: 'Fusion Power Plant', size: 3, x: 3, y: 0 },
  ]) => ({ id, index: 0, name: `P${id}`, factionId: owner, x: 1, y: 1, type: 'earthlike' as const, size: 'medium' as const, population: 700, buildings, explored: true });
  const system = (id: string, x: number, planets: ReturnType<typeof planet>[]): StarSystem => ({ id, name: id, x, y: 10, planets: planets.length, color: '#fff', planetsTiles: planets });

  let shipId = 1;
  const fleet = (factionId: string, x: number, types: string[]): Fleet => ({
    id: shipId++, name: 'F', factionId, x, y: 10, targetX: null, targetY: null, speed: 4, system: null,
    ships: types.map((type) => ({ id: shipId++, name: type, type })),
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyPlanService);
  });

  it('scores expansion and allows a parallel colonization objective when safe', () => {
    const f = faction();
    const systems = [system('home', 10, [planet(1, 'enemy1')]), system('near', 40, [planet(2, 'unhabited', []), planet(3, 'unhabited', [])])];
    const posture = service.assess(f, [f, player], systems, [fleet('enemy1', 10, ['cruiser'])]);
    expect(posture.scores.expansion).toBeGreaterThan(0);
    expect(posture.primary).toBe('expand');
    expect(posture.allowParallelColonization).toBe(true);
  });

  it('a strong threat raises defense, keeps more strength home and blocks assaults', () => {
    const f = faction();
    const systems = [system('home', 10, [planet(1, 'enemy1')]), system('p', 50, [planet(2, 'player')])];
    const calm = service.assess(f, [f, player], systems, [fleet('enemy1', 10, ['cruiser', 'cruiser'])]);
    const threatened = service.assess(f, [f, player], systems, [
      fleet('enemy1', 10, ['cruiser', 'cruiser']),
      fleet('player', 15, ['battleship', 'battleship']),
    ]);
    expect(threatened.scores.defense).toBeGreaterThan(1);
    expect(threatened.primary).toBe('defend');
    expect(threatened.homeGuardFraction).toBeGreaterThan(calm.homeGuardFraction);
    expect(threatened.militaryTargetMultiplier).toBeGreaterThan(calm.militaryTargetMultiplier);
    expect(threatened.allowAssault).toBe(false);
    expect(calm.allowAssault).toBe(true);
  });

  it('an energy-short economy becomes the priority and pauses expansion', () => {
    const f = faction();
    const shortPlanet = planet(1, 'enemy1', [{ name: 'Large Residential Block', size: 3, x: 0, y: 0 }, { name: 'Research Laboratory', size: 2, x: 3, y: 0 }]);
    const systems = [system('home', 10, [shortPlanet]), system('near', 40, [planet(2, 'unhabited', [])])];
    const posture = service.assess(f, [f, player], systems, [fleet('enemy1', 10, ['frigate'])]);
    expect(posture.scores.economy).toBe(1);
    expect(posture.primary).toBe('stabilize');
    expect(posture.allowParallelColonization).toBe(false);
  });

  it('personalities change the primary priority for the same situation', () => {
    const systems = [
      system('home', 10, [planet(1, 'enemy1')]),
      // Three colonizable planets (expansion score 1) and a reachable hostile planet.
      system('near', 40, [planet(2, 'unhabited', []), planet(4, 'unhabited', []), planet(5, 'unhabited', [])]),
      system('p', 50, [planet(3, 'player')]),
    ];
    const fleets = [fleet('enemy1', 10, ['cruiser', 'cruiser', 'cruiser'])];
    const militarist = faction('militarist');
    const expansionist = faction('expansionist');
    expect(service.assess(militarist, [militarist, player], systems, fleets).primary).toBe('attack');
    expect(service.assess(expansionist, [expansionist, player], systems, fleets).primary).toBe('expand');
  });

  it('the balanced posture without threats keeps the Phase 4 constants', () => {
    const f = faction('balanced');
    const posture = service.assess(f, [f, player], [system('home', 10, [planet(1, 'enemy1')])], [fleet('enemy1', 10, ['frigate'])]);
    expect(posture.militaryTargetMultiplier).toBe(1);
    expect(posture.homeGuardFraction).toBeCloseTo(0.3);
    expect(posture.assaultMinSurvival).toBe(0.5);
  });
});

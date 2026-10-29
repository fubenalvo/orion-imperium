import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EnemyResearchService } from './enemy-research.service';
import { ResearchService } from '../../services/research.service';
import { Faction } from './star-map.models';

/* Unit tests for AI research using the real research tree and ResearchService. */
describe('EnemyResearchService', () => {
  let service: EnemyResearchService;
  let research: ResearchService;

  const faction = (points: number): Faction => ({
    id: 'enemy1',
    name: 'Enemy 1',
    color: '#d65757',
    team: 2,
    ai: true,
    currencies: { credits: 0, research: points },
    researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyResearchService);
    research = TestBed.inject(ResearchService);
  });

  it('buys an affordable technology whose prerequisites are met and pays its cost', () => {
    const f = faction(1000);
    const changed = service.tick(1 / 60, f, [f], [], []);

    expect(changed).toBe(true);
    const [techId] = service.getResearchHistory('enemy1');
    const tech = research.getTechnology(techId)!;
    expect(tech.prerequisites.every((p) => ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'].includes(p))).toBe(true);
    expect(f.researchedTechnologies).toContain(techId);
    expect(f.currencies['research']).toBe(1000 - tech.researchCost);
  });

  it('researches one technology per decision interval and continues down the tree', () => {
    const f = faction(100000);
    for (let i = 0; i < 60 * 31; i++) {
      service.tick(1 / 60, f, [f], [], []);
    }
    const history = service.getResearchHistory('enemy1');
    // First decision at t=0, then every 5 s: 7 decisions in 31 s.
    expect(history).toHaveLength(7);
    expect(new Set(history).size).toBe(7);
    const known = new Set(['basic_engineering', 'basic_science', 'basic_industry', 'basic_power']);
    for (const id of history) {
      expect(research.getTechnology(id)!.prerequisites.every((p) => known.has(p))).toBe(true);
      known.add(id);
    }
  });

  it('waits without attempting research when nothing is affordable', () => {
    const f = faction(10);
    const spy = vi.spyOn(research, 'researchTechnology');
    const changed = service.tick(1 / 60, f, [f], [], []);

    expect(changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(f.currencies['research']).toBe(10);
  });

  it('prefers unlocking a stronger warship when hostile fleets threaten its systems', () => {
    // Enough points for the military-path technologies (research-tree.json costs).
    const f = faction(2400);
    f.researchedTechnologies!.push('military_engineering');
    const systems = [
      { id: 'home', name: 'Home', x: 10, y: 10, planets: 1, color: '#fff',
        planetsTiles: [{ id: 1, index: 0, name: 'H', factionId: 'enemy1', x: 1, y: 1, type: 'earthlike' as const, size: 'medium' as const, population: 1, buildings: [], explored: true }] },
    ];
    const player: Faction = { id: 'player', name: 'P', color: '#fff', team: 1, ai: false, currencies: {} };
    const threat = [{
      id: 9, name: 'T', factionId: 'player', x: 15, y: 10, targetX: null, targetY: null, speed: 4, system: null,
      ships: Array.from({ length: 6 }, (_, k) => ({ id: 100 + k, name: 'c', type: 'cruiser' })),
    }];

    const calm = service.selectTechnology(f, [f, player], systems, []);
    const threatened = service.selectTechnology(f, [f, player], systems, threat);

    // Military path: unlocks a warship or improves warships in battle
    // (shipAttack/shipShield bonuses), or is the prerequisite of such a
    // technology (e.g. military_engineering → advanced_weapons).
    const unlocksWarship = (id: string) =>
      research.getTechnology(id)!.unlocksShips.some((s) => s !== 'colonizer' && s !== 'scout' && s !== 'fighter')
      || (research.getTechnology(id)!.bonuses ?? []).some((b) => b.type === 'shipAttack' || b.type === 'shipShield');
    const onMilitaryPath = (id: string) =>
      unlocksWarship(id) || research.getAllTechnologies().some((t) => t.prerequisites.includes(id) && unlocksWarship(t.id));
    expect(threatened).toBeDefined();
    expect(onMilitaryPath(threatened!.id), threatened!.id).toBe(true);
    expect(calm).toBeDefined();
  });

  it('does nothing while paused', () => {
    const f = faction(1000);
    expect(service.tick(0, f, [f], [], [])).toBe(false);
    expect(service.getResearchHistory('enemy1')).toHaveLength(0);
  });
});

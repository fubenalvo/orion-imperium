import { describe, it, expect, vi, afterEach } from 'vitest';
import { AiDifficulty, Faction, Fleet, StarSystem } from './star-map.models';
import { AI_DIFFICULTY_PROFILES, getAiDifficultyProfile } from './ai-difficulty';
import { EnemyStrategyService } from './enemy-strategy.service';
import { ShipService } from '../../services/ship.service';
import { EconomyService } from '../../services/economy.service';

const faction = (id: string, ai: boolean, aiDifficulty?: AiDifficulty): Faction => ({
  id,
  name: id,
  color: '#ffffff',
  team: ai ? 2 : 1,
  ai,
  aiDifficulty,
  currencies: { credits: 1000, rawmaterials: 0, research: 0 },
});

const fleet = (id: number, factionId: string, frigates: number, x: number): Fleet => ({
  id,
  name: `F${id}`,
  factionId,
  x,
  y: 10,
  targetX: null,
  targetY: null,
  speed: 5,
  system: null,
  destroyed: false,
  ships: Array.from({ length: frigates }, (_, i) => ({ id: id * 100 + i, name: `s${i}`, type: 'frigate' })),
});

describe('AI difficulty', () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats missing difficulty and non-AI factions as the neutral 'normal' profile", () => {
    expect(getAiDifficultyProfile(faction('enemy1', true))).toBe(AI_DIFFICULTY_PROFILES.normal);
    expect(getAiDifficultyProfile(faction('player', false, 'hard'))).toBe(AI_DIFFICULTY_PROFILES.normal);
    expect(AI_DIFFICULTY_PROFILES.normal.incomeMultiplier).toBe(1);
    expect(AI_DIFFICULTY_PROFILES.normal.attackStrengthAdvantage).toBe(1.2);
  });

  it('changes when the strategy layer decides to attack', () => {
    const strategyFor = (difficulty: AiDifficulty, aiFrigates: number) => {
      const service = new EnemyStrategyService(new ShipService());
      const factions = [faction('player', false), faction('enemy1', true, difficulty)];
      const fleets = [fleet(1, 'player', 10, 10), fleet(2, 'enemy1', aiFrigates, 14)];
      service.tick(2, fleets, factions, [] as StarSystem[]);
      return service.getStrategy('enemy1');
    };
    // 1.1× stronger: only Hard (advantage 1.0) attacks.
    expect(strategyFor('hard', 11)).toBe('attack');
    expect(strategyFor('normal', 11)).toBe('develop');
    // 1.5× stronger: Normal attacks, Easy (advantage 1.6) still holds back.
    expect(strategyFor('normal', 15)).toBe('attack');
    expect(strategyFor('easy', 15)).toBe('develop');
  });

  it('scales positive AI income and leaves humans untouched', () => {
    const economy = new EconomyService(new ShipService());
    const researchGain = (f: Faction) => {
      const system: StarSystem = {
        id: 'sys',
        name: 'SYS',
        x: 1,
        y: 1,
        planets: 1,
        color: '#fff',
        planetsTiles: [
          {
            id: 1,
            index: 1,
            name: 'Testworld',
            factionId: f.id,
            x: 12,
            y: 3,
            type: 'earthlike',
            size: 'medium',
            population: 700,
            explored: true,
            buildings: [
              { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
              { name: 'Solar Array', size: 2, x: 3, y: 0 },
              { name: 'Small Research Laboratory', size: 1, x: 5, y: 0 },
            ],
          },
        ],
      };
      economy.applyEconomyDelta(f.id, [f], [system], [], 1);
      return f.currencies['research'];
    };
    const normal = researchGain(faction('enemy1', true, 'normal'));
    const hard = researchGain(faction('enemy1', true, 'hard'));
    const easy = researchGain(faction('enemy1', true, 'easy'));
    const human = researchGain(faction('player', false));
    expect(normal).toBeGreaterThan(0);
    expect(hard).toBeCloseTo(normal * AI_DIFFICULTY_PROFILES.hard.incomeMultiplier, 6);
    expect(easy).toBeCloseTo(normal * AI_DIFFICULTY_PROFILES.easy.incomeMultiplier, 6);
    expect(human).toBeCloseTo(normal, 6);
  });
});

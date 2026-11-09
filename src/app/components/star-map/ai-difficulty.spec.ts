import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AiDifficulty, Faction, Fleet, StarSystem } from './star-map.models';
import {
  ADAPTIVE_STEP,
  AI_DIFFICULTY_PROFILES,
  getAiAdaptiveFactor,
  getAiColonizationCooldown,
  getAiDifficultyProfile,
  getAiMilitaryMultiplier,
  nextAdaptiveFactor,
  setAdaptiveDifficultyEnabled,
} from './ai-difficulty';
import { isSparedByOpeningGrace } from './opening-grace';
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
    const adaptive = { ...faction('enemy1', true, 'normal'), aiAdaptiveFactor: 0.8 };
    // The saved factor only counts while the global ADAPTIVE AI option is on.
    expect(researchGain(adaptive)).toBeCloseTo(normal, 6);
    setAdaptiveDifficultyEnabled(true);
    try {
      expect(researchGain({ ...faction('enemy1', true, 'normal'), aiAdaptiveFactor: 0.8 })).toBeCloseTo(normal * 0.8, 6);
    } finally {
      setAdaptiveDifficultyEnabled(false);
    }
  });

  it('keeps Easy below Normal below Hard on every tempo value', () => {
    const { easy, normal, hard } = AI_DIFFICULTY_PROFILES;
    expect(easy.militaryTargetMultiplier).toBeLessThan(normal.militaryTargetMultiplier);
    expect(normal.militaryTargetMultiplier).toBeLessThanOrEqual(hard.militaryTargetMultiplier);
    expect(easy.colonizationCooldownSeconds).toBeGreaterThan(normal.colonizationCooldownSeconds);
    expect(normal.colonizationCooldownSeconds).toBeGreaterThan(hard.colonizationCooldownSeconds);
    expect(easy.openingGraceSeconds).toBeGreaterThan(normal.openingGraceSeconds);
    expect(normal.openingGraceSeconds).toBeGreaterThan(hard.openingGraceSeconds);
    expect(easy.adaptiveRange[1]).toBeLessThanOrEqual(normal.adaptiveRange[1]);
    expect(normal.adaptiveRange[1]).toBeLessThanOrEqual(hard.adaptiveRange[1]);
  });

  it('spares the player for the attacking AI difficulty opening grace', () => {
    const easyGrace = AI_DIFFICULTY_PROFILES.easy.openingGraceSeconds;
    const hardGrace = AI_DIFFICULTY_PROFILES.hard.openingGraceSeconds;
    expect(isSparedByOpeningGrace(faction('enemy1', true, 'easy'), 'player', hardGrace + 1)).toBe(true);
    expect(isSparedByOpeningGrace(faction('enemy1', true, 'hard'), 'player', hardGrace + 1)).toBe(false);
    expect(isSparedByOpeningGrace(faction('enemy1', true, 'easy'), 'player', easyGrace)).toBe(false);
  });
});

describe('AI adaptive difficulty factor', () => {
  const adaptive = (difficulty: AiDifficulty, factor?: number): Faction => ({ ...faction('enemy1', true, difficulty), aiAdaptiveFactor: factor });
  beforeEach(() => setAdaptiveDifficultyEnabled(true));
  afterEach(() => setAdaptiveDifficultyEnabled(false));

  it('is 1 while the option is off or the factor is missing, and is clamped to the difficulty band', () => {
    expect(getAiAdaptiveFactor(adaptive('normal'))).toBe(1);
    setAdaptiveDifficultyEnabled(false);
    expect(getAiAdaptiveFactor(adaptive('normal', 0.8))).toBe(1);
    setAdaptiveDifficultyEnabled(true);
    expect(getAiAdaptiveFactor(adaptive('normal', 0.8))).toBe(0.8);
    expect(getAiAdaptiveFactor({ ...faction('player', false), aiAdaptiveFactor: 0.5 })).toBe(1);
    expect(getAiAdaptiveFactor(adaptive('easy', 1.5))).toBe(AI_DIFFICULTY_PROFILES.easy.adaptiveRange[1]);
    expect(getAiAdaptiveFactor(adaptive('hard', 0.3))).toBe(AI_DIFFICULTY_PROFILES.hard.adaptiveRange[0]);
  });

  it('scales the navy target and stretches the colonization pause', () => {
    expect(getAiMilitaryMultiplier(adaptive('normal', 0.8))).toBeCloseTo(AI_DIFFICULTY_PROFILES.normal.militaryTargetMultiplier * 0.8, 6);
    expect(getAiColonizationCooldown(adaptive('normal', 0.75))).toBeCloseTo(AI_DIFFICULTY_PROFILES.normal.colonizationCooldownSeconds / 0.75, 6);
    expect(getAiColonizationCooldown(adaptive('hard', 1.2))).toBe(0);
  });

  it('steps down when the AI leads, up when it trails, and holds inside the dead band', () => {
    const target = AI_DIFFICULTY_PROFILES.normal.adaptiveTargetRatio;
    expect(nextAdaptiveFactor(adaptive('normal', 1), target * 2)).toBeCloseTo(1 - ADAPTIVE_STEP, 6);
    expect(nextAdaptiveFactor(adaptive('normal', 1), target / 2)).toBeCloseTo(1 + ADAPTIVE_STEP, 6);
    expect(nextAdaptiveFactor(adaptive('normal', 1), target * 1.05)).toBe(1);
    const [min, max] = AI_DIFFICULTY_PROFILES.easy.adaptiveRange;
    expect(nextAdaptiveFactor(adaptive('easy', min), 10)).toBe(min);
    expect(nextAdaptiveFactor(adaptive('easy', max), 0.1)).toBe(max);
  });
});

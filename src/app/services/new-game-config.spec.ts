import { describe, it, expect } from 'vitest';
import {
  addPlayer,
  canRemovePlayer,
  colorsTooSimilar,
  createDefaultNewGameConfig,
  removePlayer,
  setGalaxySize,
  setPlayerController,
  validateNewGameConfig,
} from './new-game-config';
import {
  GALAXY_SIZE_PRESETS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NEUTRAL_FACTION_COLORS,
  NewGameConfig,
  PLAYER_COLOR_PALETTE,
} from './new-game.models';

function fill(config: NewGameConfig, count: number): NewGameConfig {
  let next = config;
  while (next.players.length < count) next = addPlayer(next);
  return next;
}

describe('new game configuration', () => {
  it('creates a valid default: one human vs two AIs on a large galaxy', () => {
    const config = createDefaultNewGameConfig();
    expect(config.galaxySize).toBe('large');
    expect(config.players.map((p) => p.controller)).toEqual(['human', 'ai', 'ai']);
    expect(new Set(config.players.map((p) => p.color)).size).toBe(3);
    expect(new Set(config.players.map((p) => p.name)).size).toBe(3);
    expect(validateNewGameConfig(config).ok).toBe(true);
  });

  it('keeps every pair of palette colors distinguishable and clear of neutral colors', () => {
    for (const a of PLAYER_COLOR_PALETTE) {
      for (const b of PLAYER_COLOR_PALETTE) {
        if (a !== b) expect(colorsTooSimilar(a.value, b.value)).toBe(false);
      }
      for (const neutral of NEUTRAL_FACTION_COLORS) {
        expect(colorsTooSimilar(a.value, neutral)).toBe(false);
      }
    }
  });

  it('accepts the minimum and maximum player counts for each size', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const base = setGalaxySize(createDefaultNewGameConfig(size), size);
      const min = { ...base, players: base.players.slice(0, MIN_PLAYERS) };
      expect(validateNewGameConfig(min).ok).toBe(true);
      const max = fill(base, GALAXY_SIZE_PRESETS[size].maxPlayers);
      expect(max.players).toHaveLength(GALAXY_SIZE_PRESETS[size].maxPlayers);
      expect(validateNewGameConfig(max).ok).toBe(true);
      // addPlayer refuses to exceed the limit.
      expect(addPlayer(max).players).toHaveLength(GALAXY_SIZE_PRESETS[size].maxPlayers);
    }
    expect(MAX_PLAYERS).toBe(6);
  });

  it('rejects too few or too many players', () => {
    const config = createDefaultNewGameConfig('small');
    const tooFew = { ...config, players: config.players.slice(0, 1) };
    expect(validateNewGameConfig(tooFew).errors.join()).toContain('At least 2');

    const large = fill(createDefaultNewGameConfig('large'), 6);
    const tooMany = { ...large, galaxySize: 'small' as const };
    expect(validateNewGameConfig(tooMany).errors.join()).toContain('at most 3');
  });

  it('requires exactly one human player', () => {
    const config = createDefaultNewGameConfig();
    const noHuman = { ...config, players: config.players.map((p) => ({ ...p, controller: 'ai' as const })) };
    const twoHumans = { ...config, players: config.players.map((p, i) => ({ ...p, controller: i < 2 ? ('human' as const) : ('ai' as const) })) };
    expect(validateNewGameConfig(noHuman).ok).toBe(false);
    expect(validateNewGameConfig(twoHumans).ok).toBe(false);
  });

  it('rejects empty, too long and duplicate names', () => {
    const config = createDefaultNewGameConfig();
    const withName = (i: number, name: string) => ({
      ...config,
      players: config.players.map((p, j) => (j === i ? { ...p, name } : p)),
    });
    expect(validateNewGameConfig(withName(1, '   ')).errors.join()).toContain('name is required');
    expect(validateNewGameConfig(withName(1, 'x'.repeat(21))).errors.join()).toContain('at most 20');
    expect(validateNewGameConfig(withName(1, config.players[0].name.toUpperCase())).errors.join()).toContain('already used');
  });

  it('rejects duplicate, near-identical, neutral and malformed colors', () => {
    const config = createDefaultNewGameConfig();
    const withColor = (color: string) => ({
      ...config,
      players: config.players.map((p, j) => (j === 1 ? { ...p, color } : p)),
    });
    expect(validateNewGameConfig(withColor(config.players[0].color)).ok).toBe(false);
    expect(validateNewGameConfig(withColor('#8dc5fe')).ok).toBe(false);
    expect(validateNewGameConfig(withColor('#ffcc00')).errors.join()).toContain('neutral');
    expect(validateNewGameConfig(withColor('blue')).errors.join()).toContain('invalid');
  });

  it('rejects an AI without a valid difficulty and invalid seeds', () => {
    const config = createDefaultNewGameConfig();
    const badDifficulty = {
      ...config,
      players: config.players.map((p, j) => (j === 1 ? { ...p, difficulty: 'insane' as never } : p)),
    };
    expect(validateNewGameConfig(badDifficulty).errors.join()).toContain('difficulty');
    expect(validateNewGameConfig({ ...config, seed: -1 }).ok).toBe(false);
    expect(validateNewGameConfig({ ...config, seed: 1.5 }).ok).toBe(false);
    expect(validateNewGameConfig({ ...config, seed: 2 ** 32 }).ok).toBe(false);
    expect(validateNewGameConfig({ ...config, seed: 123 }).ok).toBe(true);
    expect(validateNewGameConfig(null).ok).toBe(false);
  });

  it('switching another player to human demotes the previous human', () => {
    const config = createDefaultNewGameConfig();
    const next = setPlayerController(config, 2, 'human');
    expect(next.players.map((p) => p.controller)).toEqual(['ai', 'ai', 'human']);
    // Demoting the only human is ignored.
    expect(setPlayerController(next, 2, 'ai')).toBe(next);
  });

  it('never removes the human player or drops below the minimum', () => {
    const config = createDefaultNewGameConfig();
    expect(canRemovePlayer(config, 0)).toBe(false);
    const two = removePlayer(config, 2);
    expect(two.players).toHaveLength(2);
    expect(removePlayer(two, 1).players).toHaveLength(2);
  });

  it('shrinking the galaxy trims AI players but keeps the human', () => {
    const config = setPlayerController(fill(createDefaultNewGameConfig('large'), 6), 5, 'human');
    const small = setGalaxySize(config, 'small');
    expect(small.players).toHaveLength(3);
    expect(small.players.filter((p) => p.controller === 'human')).toHaveLength(1);
    expect(small.players.some((p) => p.name === config.players[5].name)).toBe(true);
    expect(validateNewGameConfig(small).ok).toBe(true);
  });
});

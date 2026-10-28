import { GalaxySize } from '../components/star-map/star-map.models';
import { DEFAULT_AI_DIFFICULTY, isAiDifficulty } from '../components/star-map/ai-difficulty';
import {
  DEFAULT_AI_NAMES,
  GALAXY_SIZE_PRESETS,
  MAX_PLAYER_NAME_LENGTH,
  MIN_PLAYERS,
  NEUTRAL_FACTION_COLORS,
  NewGameConfig,
  PLAYER_COLOR_PALETTE,
  PlayerSetup,
} from './new-game.models';

/*
 * Pure helpers for building and validating a NewGameConfig.
 *
 * Rules enforced here (shared by the setup UI and NewGameService):
 * - player count within [MIN_PLAYERS, preset.maxPlayers] for the galaxy size;
 * - exactly ONE human player. The game is single-player: the human always
 *   becomes the faction with id 'player', which every gameplay system
 *   (sensors, economy HUD, outcome evaluation…) treats as the local player.
 * - names non-empty, at most MAX_PLAYER_NAME_LENGTH chars, unique
 *   (case-insensitive);
 * - colors valid hex, unique, and not visually too close to each other or to
 *   the neutral faction colors;
 * - AI players have a valid difficulty;
 * - optional seed is a non-negative integer that fits in uint32.
 */

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
}

export const DEFAULT_HUMAN_NAME = 'Terran Empire';

export function createDefaultNewGameConfig(galaxySize: GalaxySize = 'large'): NewGameConfig {
  const players: PlayerSetup[] = [
    {
      name: DEFAULT_HUMAN_NAME,
      color: PLAYER_COLOR_PALETTE[0].value,
      controller: 'human',
      difficulty: DEFAULT_AI_DIFFICULTY,
    },
  ];
  let config: NewGameConfig = { galaxySize, players, seed: null };
  // Matches the legacy map: one human against two AI empires.
  config = addPlayer(config);
  config = addPlayer(config);
  return config;
}

export function getMaxPlayers(galaxySize: GalaxySize): number {
  return GALAXY_SIZE_PRESETS[galaxySize].maxPlayers;
}

export function canAddPlayer(config: NewGameConfig): boolean {
  return config.players.length < getMaxPlayers(config.galaxySize);
}

export function canRemovePlayer(config: NewGameConfig, index: number): boolean {
  const player = config.players[index];
  return !!player && player.controller !== 'human' && config.players.length > MIN_PLAYERS;
}

/* Adds an AI player with the first unused default name and color. */
export function addPlayer(config: NewGameConfig): NewGameConfig {
  if (!canAddPlayer(config)) {
    return config;
  }
  const usedNames = new Set(config.players.map((p) => p.name.trim().toLowerCase()));
  const name =
    DEFAULT_AI_NAMES.find((n) => !usedNames.has(n.toLowerCase())) ??
    `AI Empire ${config.players.length + 1}`;
  const color = nextFreeColor(config.players.map((p) => p.color)) ?? PLAYER_COLOR_PALETTE[0].value;
  return {
    ...config,
    players: [
      ...config.players,
      { name, color, controller: 'ai', difficulty: DEFAULT_AI_DIFFICULTY },
    ],
  };
}

export function removePlayer(config: NewGameConfig, index: number): NewGameConfig {
  if (!canRemovePlayer(config, index)) {
    return config;
  }
  return { ...config, players: config.players.filter((_, i) => i !== index) };
}

/*
 * Making a player human demotes the previous human to AI, so the
 * "exactly one human" invariant holds after every UI interaction.
 * Demoting the only human is ignored for the same reason.
 */
export function setPlayerController(
  config: NewGameConfig,
  index: number,
  controller: PlayerSetup['controller'],
): NewGameConfig {
  if (!config.players[index]) {
    return config;
  }
  if (controller === 'ai') {
    return config;
  }
  return {
    ...config,
    players: config.players.map((p, i) => ({
      ...p,
      controller: i === index ? 'human' : 'ai',
    })),
  };
}

/*
 * Changing the galaxy size trims surplus AI players (never the human) so
 * the configuration stays within the new size's player limit.
 */
export function setGalaxySize(config: NewGameConfig, galaxySize: GalaxySize): NewGameConfig {
  const max = getMaxPlayers(galaxySize);
  const players = [...config.players];
  while (players.length > max) {
    const lastAi = players.map((p) => p.controller).lastIndexOf('ai');
    if (lastAi < 0) break;
    players.splice(lastAi, 1);
  }
  return { ...config, galaxySize, players };
}

export function nextFreeColor(usedColors: string[]): string | null {
  const used = new Set(usedColors.map((c) => c.toLowerCase()));
  return PLAYER_COLOR_PALETTE.find((c) => !used.has(c.value.toLowerCase()))?.value ?? null;
}

export function validateNewGameConfig(config: NewGameConfig | null | undefined): ConfigValidationResult {
  const errors: string[] = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['Configuration is missing.'] };
  }

  const preset = GALAXY_SIZE_PRESETS[config.galaxySize];
  if (!preset) {
    errors.push('Select a valid galaxy size.');
  }

  const players = Array.isArray(config.players) ? config.players : [];
  const max = preset?.maxPlayers ?? MIN_PLAYERS;
  if (players.length < MIN_PLAYERS) {
    errors.push(`At least ${MIN_PLAYERS} players are required.`);
  }
  if (preset && players.length > max) {
    errors.push(`A ${preset.label} galaxy supports at most ${max} players.`);
  }

  const humans = players.filter((p) => p.controller === 'human').length;
  if (humans !== 1) {
    errors.push('Exactly one player must be human-controlled.');
  }

  const seenNames = new Set<string>();
  const seenColors: string[] = [];
  players.forEach((player, i) => {
    const label = `Player ${i + 1}`;
    const name = typeof player.name === 'string' ? player.name.trim() : '';
    if (!name) {
      errors.push(`${label}: name is required.`);
    } else if (name.length > MAX_PLAYER_NAME_LENGTH) {
      errors.push(`${label}: name must be at most ${MAX_PLAYER_NAME_LENGTH} characters.`);
    } else if (seenNames.has(name.toLowerCase())) {
      errors.push(`${label}: name "${name}" is already used.`);
    } else {
      seenNames.add(name.toLowerCase());
    }

    if (player.controller !== 'human' && player.controller !== 'ai') {
      errors.push(`${label}: controller must be Human or AI.`);
    }
    if (player.controller === 'ai' && !isAiDifficulty(player.difficulty)) {
      errors.push(`${label}: select an AI difficulty.`);
    }

    const rgb = parseHexColor(player.color);
    if (!rgb) {
      errors.push(`${label}: color is invalid.`);
    } else if (NEUTRAL_FACTION_COLORS.some((c) => colorsTooSimilar(c, player.color))) {
      errors.push(`${label}: color is reserved for neutral factions.`);
    } else if (seenColors.some((c) => colorsTooSimilar(c, player.color))) {
      errors.push(`${label}: color is too similar to another player's color.`);
    } else {
      seenColors.push(player.color);
    }
  });

  if (config.seed !== undefined && config.seed !== null) {
    if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
      errors.push('Seed must be a whole number between 0 and 4294967295.');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function parseHexColor(color: unknown): [number, number, number] | null {
  if (typeof color !== 'string') return null;
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/*
 * Euclidean RGB distance below this threshold counts as "visually
 * indistinguishable". Coarse, but enough to reject identical or
 * near-identical picks; every pair in PLAYER_COLOR_PALETTE is far above it.
 */
const MIN_COLOR_DISTANCE = 60;

export function colorsTooSimilar(a: string, b: string): boolean {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca || !cb) return false;
  const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
  return d < MIN_COLOR_DISTANCE;
}

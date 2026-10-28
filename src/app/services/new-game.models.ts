import { AiDifficulty, GalaxySize } from '../components/star-map/star-map.models';

/*
 * New Game configuration types and galaxy size presets.
 *
 * The LARGE preset is derived from the legacy `star-map-data.json` map
 * (300×180 grid, 14 star systems, ~35 planets, 1–6 planets per system) and
 * must stay its reference scale. SMALL and MEDIUM keep the same 5:3 aspect
 * ratio — the minimap is a fixed 240×144 px widget — and a similar system
 * density, so movement times and sensor coverage feel the same per system.
 *
 * Map widths must never be 200: SaveGameService.migrateSave treats
 * `map.width === 200` as the pre-grid legacy format and would rescale it.
 *
 * See docs/new-game-generation.md for the full generation rules.
 */

export type ControllerType = 'human' | 'ai';

export interface PlayerSetup {
  name: string;
  color: string;
  controller: ControllerType;
  /* Ignored for human players but kept so toggling the controller keeps the choice. */
  difficulty: AiDifficulty;
}

export interface NewGameConfig {
  galaxySize: GalaxySize;
  players: PlayerSetup[];
  /* Optional uint32 seed; a random seed is chosen when null/undefined. */
  seed?: number | null;
}

export interface GalaxySizePreset {
  id: GalaxySize;
  label: string;
  width: number;
  height: number;
  systemCount: number;
  /* Relative weights for 1..N planets per non-home system (N = array length). */
  planetCountWeights: number[];
  /* Minimum planets in a starting (home) system, so every faction has room to expand. */
  homeSystemMinPlanets: number;
  maxPlayers: number;
  /* No system may be placed closer than this to the black hole center (grid cells). */
  blackHoleClearance: number;
  /* Minimum distance between any two star systems (grid cells). */
  minSystemSpacing: number;
  /* Cells kept free along every map edge. */
  edgeMargin: number;
}

/*
 * Planet-count weights for 1..6 planets mirror the distribution of the
 * reference map: 4×1, 4×2, 3×3, 2×4, 0×5, 1×6 (5 gets a small weight so
 * the distribution is not lumpy).
 */
const REFERENCE_PLANET_WEIGHTS = [4, 4, 3, 2, 1, 1];

export const GALAXY_SIZE_PRESETS: Readonly<Record<GalaxySize, GalaxySizePreset>> = {
  small: {
    id: 'small',
    label: 'Small',
    width: 180,
    height: 108,
    systemCount: 8,
    planetCountWeights: REFERENCE_PLANET_WEIGHTS.slice(0, 4),
    homeSystemMinPlanets: 3,
    maxPlayers: 3,
    blackHoleClearance: 14,
    minSystemSpacing: 22,
    edgeMargin: 8,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    width: 240,
    height: 144,
    systemCount: 11,
    planetCountWeights: REFERENCE_PLANET_WEIGHTS.slice(0, 5),
    homeSystemMinPlanets: 3,
    maxPlayers: 4,
    blackHoleClearance: 16,
    minSystemSpacing: 26,
    edgeMargin: 10,
  },
  large: {
    id: 'large',
    label: 'Large',
    width: 300,
    height: 180,
    systemCount: 14,
    planetCountWeights: REFERENCE_PLANET_WEIGHTS,
    homeSystemMinPlanets: 3,
    maxPlayers: 6,
    blackHoleClearance: 18,
    minSystemSpacing: 30,
    edgeMargin: 12,
  },
};

export const GALAXY_SIZES: readonly GalaxySize[] = ['small', 'medium', 'large'];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = Math.max(...GALAXY_SIZES.map((s) => GALAXY_SIZE_PRESETS[s].maxPlayers));
export const MAX_PLAYER_NAME_LENGTH = 20;

/*
 * Selectable faction colors. Chosen to be mutually distinguishable on the
 * dark map background and distinct from the neutral faction colors
 * (independent #ffcc00, unhabited #666666). The first three match the
 * legacy map's player / enemy1 / enemy2 colors.
 */
export const PLAYER_COLOR_PALETTE: readonly { value: string; label: string }[] = [
  { value: '#8cc4ff', label: 'Sky' },
  { value: '#d65757', label: 'Crimson' },
  { value: '#39b8a8', label: 'Teal' },
  { value: '#b07cff', label: 'Violet' },
  { value: '#7bd66b', label: 'Lime' },
  { value: '#ff9a3c', label: 'Amber' },
  { value: '#ff6fcf', label: 'Rose' },
  { value: '#e6e6e6', label: 'Silver' },
];

export const NEUTRAL_FACTION_COLORS: readonly string[] = ['#ffcc00', '#666666'];

export const DEFAULT_AI_NAMES: readonly string[] = [
  'Vega Dominion',
  'Rigel Concord',
  'Altair Syndicate',
  'Draco Hegemony',
  'Lyra Collective',
  'Cygnus Pact',
];

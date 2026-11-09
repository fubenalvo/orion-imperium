import { Injectable } from '@angular/core';
import {
  AiDifficulty,
  AsteroidBelt,
  AsteroidEventState,
  Faction,
  Fleet,
  Nebula,
  PlanetBuilding,
  PlanetSize,
  PlanetTile,
  PlanetType,
  SpecialObject,
  StarMapData,
  StarSystem,
} from '../components/star-map/star-map.models';
import { createMulberry32, generateResourceTilesForPlanet } from '../components/star-map/star-map-resources.util';
import { ensurePlanetDeposits } from '../components/star-map/raw-deposits';
import { buildNavObstacles } from '../components/star-map/fleet-navigation';
import { NEBULA_CONFIG, generateNebulae } from '../components/star-map/nebula';
import { ASTEROID_BELT_CONFIG, generateAsteroidBelts } from '../components/star-map/asteroid-belts';
import { createInitialAsteroidState } from '../components/star-map/drifting-asteroids';
import { AI_DIFFICULTY_PROFILES } from '../components/star-map/ai-difficulty';
import { AI_PERSONALITIES } from '../components/star-map/ai-personality';
import { centerLayout, generatePlanetSurface } from '../components/star-map/planet-surface/planet-surface-generator';
import { getPlanetGridSize } from '../components/star-map/planet-surface/planet-surface';
import { SAVE_VERSION } from './save-validation';
import { GAME_VERSION } from '../game-version';
import { ensureSystemAsteroidBelts } from '../components/star-map/system-asteroids';
import { GALAXY_SIZE_PRESETS, GalaxySizePreset, NewGameConfig, PlayerSetup } from './new-game.models';
import { normalizeRelations } from '../components/star-map/diplomacy';
import { generateCivilizationSystems } from '../components/star-map/civilizations';
import { planetFootprintCenterVw, systemCellAtVw } from '../components/star-map/system-grid';

/*
 * =========================================================
 * GALAXY GENERATOR SERVICE
 * =========================================================
 *
 * Builds a complete, ready-to-play StarMapData snapshot from a
 * NewGameConfig and a seed. The output uses exactly the schema of the
 * legacy star-map-data.json (see docs/data-models.md) so the Star Map,
 * Battle, economy, AI and save systems consume it unchanged.
 *
 * Determinism: every random decision comes from one Mulberry32 stream
 * seeded with `seed`, so the same (config, seed) pair always produces
 * the same galaxy. Never call Math.random() in here.
 *
 * Layout rules (see docs/new-game-generation.md):
 * - the black hole is a 'blackhole' SpecialObject whose cell span is
 *   centered exactly on the map midpoint ((W+1)/2, (H+1)/2);
 * - home systems sit on an ellipse around the black hole at evenly
 *   spaced angles, so every faction is roughly equidistant from the
 *   center and from its neighbours;
 * - the remaining systems use best-candidate (Mitchell) sampling, which
 *   spreads systems evenly without a visible grid pattern;
 * - no system is closer than preset.minSystemSpacing to another or than
 *   preset.blackHoleClearance to the black hole center;
 * - nebulae (generateGalaxyNebulae) are spread over the map and never
 *   cover a home system or touch the black hole's no-fly zone. They use a
 *   separate rng stream derived from the seed, so adding them did not
 *   change the systems/fleets any existing seed produces;
 * - asteroid belts (generateGalaxyAsteroidBelts) are impassable walls kept
 *   clear of systems, starting fleets, the black hole and each other, and
 *   never disconnect a home system from any other system. Own rng stream.
 * - independent civilizations (generateCivilizationSystems) are EXTRA star
 *   systems placed after everything else from their own rng stream, so the
 *   preset's regular systems, fleets, nebulae and belts stay as they were;
 * - every system gets its in-system asteroid belt
 *   (generateSystemAsteroidBelt), derived from the seed and the system id;
 * - settled planets get their surface terrain (generatePlanetSurface)
 *   here, derived arithmetically from the seed and the planet id, so it does
 *   not consume the layout stream; starting buildings are centered on the
 *   grid and kept clear of obstacles. Other planets receive the identical
 *   terrain on first load (StarMap.ensurePlanetSurfaces).
 *
 * Faction ids: the human player is always 'player' (the id every
 * gameplay system treats as the local player); AI players become
 * 'enemy1', 'enemy2', … in config order. The neutral 'independent' and
 * 'unhabited' factions are always present.
 *
 * The generator throws GalaxyGenerationError when it cannot satisfy the
 * layout constraints. Callers (NewGameService) validate the result and
 * retry with a derived seed rather than starting a broken game.
 */

/*
 * 1: initial version (only the human home system started `explored`, which
 *    hid every other star — see the visibility rule at the end of this file).
 * 2: every star system starts `explored` (positions known); planets stay unexplored.
 * 3: nebulae and the drifting-asteroid event state are generated.
 * 4: impassable asteroid belts are generated.
 * 5: belts curve as gentle arcs instead of a single kink.
 * 6: planet surfaces: doubled grids, centered starting layouts and the
 *    persisted `PlanetTile.surface` terrain (docs/planet-surface.md).
 * 7: independent civilizations in extra star systems (civilizations.ts);
 *    everything else is unchanged for a seed.
 * 8: nebulae keep clear of the Dyson ring zone around the black hole
 *    (dyson-ring.ts), so a seed's nebulae may differ from version 7.
 * 9: the human's starting fleet is stationed at the homeworld (inside the
 *    home system) instead of 3–6 cells away, and every planet of the human's
 *    home system starts explored. AI fleets keep their version 8 cells for
 *    a seed.
 */
export const GALAXY_GENERATOR_VERSION = 9;
/* Derives the civilization rng stream from the seed (keeps the main stream untouched). */
const CIVILIZATION_RNG_SALT = 0x6c1b7a55;
export const BLACK_HOLE_SIZE = { width: 4, height: 4 } as const;
export const PLAYER_FACTION_ID = 'player';

export class GalaxyGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalaxyGenerationError';
  }
}

type Rng = () => number;

interface Point {
  x: number;
  y: number;
}

/*
 * Planet positions by planet index: top-left cell of each planet's 2×2 block
 * on the system grid (system-grid.ts). Same screen positions as the legacy
 * map's 18×10 layout ({12,3}, {10,5}, {8,4}, {6,2}, {4,6}, {2,3}).
 */
export const PLANET_SYSTEM_LAYOUT: readonly Point[] = [
  { x: 23, y: 5 },
  { x: 19, y: 9 },
  { x: 15, y: 7 },
  { x: 11, y: 3 },
  { x: 7, y: 11 },
  { x: 3, y: 5 },
];

const PLANET_TYPES: readonly PlanetType[] = ['earthlike', 'marslike', 'venuslike', 'gasgiant', 'ice', 'desert'];
const PLANET_SIZES: readonly PlanetSize[] = ['tiny', 'small', 'medium', 'big', 'huge'];
export const STAR_COLORS: readonly string[] = ['#ffcc00', '#5ca8ff', '#f3f3f3', '#39b8a8', '#d65757', '#888888'];

const STAR_NAMES: readonly string[] = [
  'SOL', 'VEGA', 'SIRIUS', 'ARCTURUS', 'RIGEL', 'ALTAIR', 'BETELGEUSE', 'PROCYON', 'DENEB',
  'ANTARES', 'LYRA', 'TAURUS', 'DRACO', 'CYGNUS', 'CAPELLA', 'ALDEBARAN', 'SPICA', 'POLLUX',
  'CASTOR', 'REGULUS', 'BELLATRIX', 'MIRA', 'ACHERNAR', 'CANOPUS', 'FOMALHAUT', 'ALNILAM',
  'MINTAKA', 'SAIPH', 'ELNATH', 'ALCOR', 'MIZAR', 'THUBAN', 'KOCHAB', 'SHAULA', 'NUNKI',
  'HADAR', 'MENKAR', 'ALPHARD', 'ZANIAH', 'TARAZED',
];

const PLANET_NAME_PREFIXES = [
  'Ka', 'Ve', 'Ny', 'Or', 'Sy', 'Te', 'Mi', 'Ob', 'El', 'Kh', 'Ar', 'Br', 'Il', 'Mo', 'Ce',
  'Sa', 'Ko', 'Yd', 'Du', 'Cr', 'Va', 'Lu', 'Ze', 'Qu', 'Ra', 'Th', 'Ul', 'Xe', 'Ae', 'No',
];
const PLANET_NAME_MIDDLES = ['la', 'ri', 'ra', 'no', 've', 'li', 'tha', 'ma', 'do', 'ry', 'si', '', '', ''];
const PLANET_NAME_ENDINGS = ['ra', 'is', 'th', 'on', 'ia', 'ix', 'os', 'ar', 'en', 'um', 'ys', 'a', 'ion', 'ara'];

const FLEET_NAMES: readonly string[] = [
  'RAIDER', 'HUNTER', 'REAVER', 'STALKER', 'MARAUDER', 'VIPER', 'TEMPEST', 'SPECTER',
  'WARDEN', 'NOMAD', 'CORSAIR', 'TALON', 'HARBINGER', 'ZEALOT', 'SENTINEL', 'NEMESIS',
];

export const STARTING_TECHNOLOGIES = ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'];
/*
 * Starting stock. Raw materials cover the first Spaceship Factory and
 * Mining Complex (750 + 375) with room to spare, because the factory no
 * longer produces raw materials and every raw source is a finite deposit
 * (docs/economy.md, "Economic safety").
 */
const BASE_CURRENCIES = { credits: 1000, rawmaterials: 2500, research: 1000 } as const;
/* Homeworld population equals the template's capacity (Capital 500 + Large Residential 700). */
const HOMEWORLD_POPULATION = 1200;
const COLONY_POPULATION = 100;

/*
 * Homeworld: the Capital (core building, colony-core.ts) in the middle of a
 * 9×9 block, with one Large Residential Block, a Fusion Power Plant, a
 * Laser Turret and a Research Laboratory around it. The second Large
 * Residential Block of the old layout was replaced by the Capital, which
 * holds fewer people (1200 instead of 1400): a slower start is intended
 * (docs/economy.md, "Colony cores"). Energy 120 vs 42 used, so every faction
 * starts energy-positive with room for a Mining Complex and a factory.
 * Authored at the origin; centerLayout moves it to the middle of the grid.
 */
export const HOMEWORLD_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
  { name: 'Fusion Power Plant', size: 3, x: 6, y: 0 },
  { name: 'Capital', size: 3, x: 3, y: 3 },
  { name: 'Research Laboratory', size: 2, x: 0, y: 7 },
  { name: 'Laser Turret', size: 1, x: 8, y: 8 },
];

/* Extra AI colonies (difficulty bonus). Centered like the homeworld layout. */
export const COLONY_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Small Residential Block', size: 1, x: 0, y: 0 },
  { name: 'Colony Center', size: 2, x: 1, y: 0 },
  { name: 'Solar Array', size: 2, x: 3, y: 0 },
];

interface FleetTemplate {
  ships: { shipType: string; count: number }[];
  speed: number;
}

/*
 * Starting fleets, one entry per fleet. The AI's preset follows its
 * difficulty ('standard' = Normal). The human starts with 'player': one small
 * scouting fleet (2 scouts + 1 fighter). It keeps the starting upkeep low —
 * the empire's money should go into its own build-up, not into a navy it
 * did not choose — and the homeworld's turret is the early defense.
 */
const FLEET_PRESETS: Readonly<Record<'player' | 'reduced' | 'standard' | 'reinforced', FleetTemplate[]>> = {
  player: [{ ships: [{ shipType: 'scout', count: 2 }, { shipType: 'fighter', count: 1 }], speed: 8 }],
  reduced: [{ ships: [{ shipType: 'frigate', count: 2 }], speed: 8 }],
  standard: [
    { ships: [{ shipType: 'frigate', count: 2 }], speed: 8 },
    { ships: [{ shipType: 'cruiser', count: 3 }], speed: 6 },
  ],
  reinforced: [
    { ships: [{ shipType: 'frigate', count: 2 }], speed: 8 },
    { ships: [{ shipType: 'cruiser', count: 3 }], speed: 6 },
    { ships: [{ shipType: 'destroyer', count: 4 }], speed: 7 },
  ],
};
const PLAYER_FLEET_NAMES = ['ORION', 'PEGASUS', 'PHOENIX'];

/* Neutral factions copied from the legacy map. */
export const NEUTRAL_FACTIONS: readonly Faction[] = [
  {
    id: 'independent',
    name: 'Independent',
    color: '#ffcc00',
    team: 0,
    ai: false,
    currencies: { credits: 1, rawmaterials: 1, research: 1 },
  },
  {
    id: 'unhabited',
    name: 'Unhabited',
    color: '#666666',
    team: 0,
    ai: false,
    currencies: { credits: 1, rawmaterials: 1, research: 1 },
  },
];

export interface ParticipantAssignment {
  factionId: string;
  setup: PlayerSetup;
}

/*
 * Maps config players to faction ids. Shared with galaxy validation so both
 * agree on which faction belongs to which configured player.
 */
export function assignFactionIds(players: PlayerSetup[]): ParticipantAssignment[] {
  let aiIndex = 0;
  return players.map((setup) => ({
    factionId: setup.controller === 'human' ? PLAYER_FACTION_ID : `enemy${++aiIndex}`,
    setup,
  }));
}

/* Integer cell span of the black hole, centered on the map midpoint. */
export function blackHoleObject(width: number, height: number): SpecialObject {
  return {
    x: (width - BLACK_HOLE_SIZE.width) / 2 + 1,
    y: (height - BLACK_HOLE_SIZE.height) / 2 + 1,
    type: 'blackhole',
    width: BLACK_HOLE_SIZE.width,
    height: BLACK_HOLE_SIZE.height,
    component: 'blackhole',
  };
}

export function mapCenter(width: number, height: number): Point {
  return { x: (width + 1) / 2, y: (height + 1) / 2 };
}

/*
 * Nebulae for a galaxy. Shared by the generator and by save migration
 * (older saves get the set once and then persist it), so both produce the
 * same clouds for the same seed and map. `homes` are kept clear.
 */
export function generateGalaxyNebulae(
  seed: number,
  width: number,
  height: number,
  size: string,
  homes: readonly Point[],
  specialObjects: readonly SpecialObject[],
): Nebula[] {
  // Own stream (seed-derived) so the galaxy layout stream is not consumed.
  const rng = createMulberry32(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  return generateNebulae(rng, {
    width,
    height,
    count: NEBULA_CONFIG.countBySize[size] ?? NEBULA_CONFIG.countBySize['large'],
    homes,
    obstacles: buildNavObstacles(specialObjects),
  });
}

/*
 * Asteroid belts for a galaxy (generator v4). Separate seed-derived rng
 * stream, so belts do not alter systems, fleets or nebulae of a seed.
 */
export function generateGalaxyAsteroidBelts(
  seed: number,
  width: number,
  height: number,
  size: string,
  systems: readonly Point[],
  homes: readonly Point[],
  fleets: readonly Point[],
  specialObjects: readonly SpecialObject[],
): AsteroidBelt[] {
  const rng = createMulberry32(((seed >>> 0) ^ 0x85ebca6b) >>> 0);
  return generateAsteroidBelts(rng, {
    width,
    height,
    count: ASTEROID_BELT_CONFIG.countBySize[size] ?? ASTEROID_BELT_CONFIG.countBySize['large'],
    systems,
    homes,
    fleets,
    obstacles: buildNavObstacles(specialObjects),
  });
}

export function initialAsteroidEvents(seed: number): AsteroidEventState {
  return createInitialAsteroidState(seed >>> 0);
}

@Injectable({ providedIn: 'root' })
export class GalaxyGeneratorService {
  /*
   * `options.civilizations` (default true) is for headless simulations that
   * study the regular galaxy; New Game always generates civilizations.
   */
  generate(config: NewGameConfig, seed: number, options: { civilizations?: boolean } = {}): StarMapData {
    const preset = GALAXY_SIZE_PRESETS[config.galaxySize];
    if (!preset) {
      throw new GalaxyGenerationError(`Unknown galaxy size "${config.galaxySize}"`);
    }
    const participants = assignFactionIds(config.players);
    if (participants.length > preset.systemCount) {
      throw new GalaxyGenerationError('More players than star systems');
    }

    const rng = createMulberry32(seed >>> 0);
    const center = mapCenter(preset.width, preset.height);

    const homePositions = this.placeHomeSystems(rng, preset, center, participants.length);
    const otherPositions = this.placeRemainingSystems(rng, preset, center, homePositions);

    const starNames = shuffle(rng, [...STAR_NAMES]);
    const planetNames = new PlanetNameGenerator(rng);
    let nextPlanetId = 1;

    const factions = this.buildFactions(participants, seed);
    const factionById = new Map(factions.map((f) => [f.id, f]));

    const starSystems: StarSystem[] = [];
    const homeSystems: StarSystem[] = [];
    const positions = [...homePositions, ...otherPositions];

    positions.forEach((pos, i) => {
      const isHome = i < participants.length;
      const name = starNames[i] ?? `SYSTEM-${i + 1}`;
      const planetCount = isHome
        ? Math.max(preset.homeSystemMinPlanets, weightedCount(rng, preset.planetCountWeights))
        : weightedCount(rng, preset.planetCountWeights);

      const planetsTiles: PlanetTile[] = [];
      for (let index = 1; index <= planetCount; index++) {
        const layout = PLANET_SYSTEM_LAYOUT[index - 1];
        planetsTiles.push({
          id: nextPlanetId++,
          index,
          name: planetNames.next(),
          factionId: 'unhabited',
          x: layout.x,
          y: layout.y,
          type: pick(rng, PLANET_TYPES),
          size: pick(rng, PLANET_SIZES),
          population: 0,
          buildings: [],
          explored: false,
        });
      }

      const system: StarSystem = {
        id: name.toLowerCase(),
        name,
        x: pos.x,
        y: pos.y,
        planets: planetsTiles.length,
        color: pick(rng, STAR_COLORS),
        // Star positions are known from the start; see the visibility rule at the end of this file.
        explored: true,
        planetsTiles,
      };
      starSystems.push(system);
      if (isHome) homeSystems.push(system);
    });

    participants.forEach((participant, i) => {
      this.settleHomeSystem(homeSystems[i], participant, factionById.get(participant.factionId)!);
    });

    // Settled planets need their terrain now (it must be generated around
    // the starting buildings, which are already placed). Unsettled planets
    // get theirs on first load (StarMap.ensurePlanetSurfaces): the result is
    // identical either way, and doing ~100 planets here would make galaxy
    // generation (run many times by retries and tests) needlessly slow.
    for (const planet of starSystems.flatMap((s) => s.planetsTiles)) {
      if (planet.buildings.length > 0) {
        planet.surface = generatePlanetSurface(planet, seed);
      }
    }
    // Every homeworld starts with a raw-material deposit next to free ground,
    // so no empire depends on luck for its first mine (docs/economy.md,
    // "Economic safety"). Other planets get theirs on first load
    // (StarMap.ensureResourceTiles), which keeps these tiles.
    for (const system of homeSystems) {
      const homeworld = system.planetsTiles[0];
      homeworld.resourceTiles = generateResourceTilesForPlanet(homeworld, getPlanetGridSize);
    }
    ensurePlanetDeposits(homeSystems.map((s) => s.planetsTiles[0]));

    // In-system asteroid belts: derived from (seed, system id), no layout rng.
    ensureSystemAsteroidBelts(starSystems, seed);

    const fleets = this.buildFleets(rng, preset, center, participants, homeSystems, starSystems);

    const playerIndex = participants.findIndex((p) => p.factionId === PLAYER_FACTION_ID);
    const playerHome = homeSystems[playerIndex];
    if (!playerHome) {
      throw new GalaxyGenerationError('No human player configured');
    }

    const specialObjects = [blackHoleObject(preset.width, preset.height)];
    const nebulae = generateGalaxyNebulae(seed, preset.width, preset.height, preset.id, homePositions, specialObjects);
    const asteroidBelts = generateGalaxyAsteroidBelts(
      seed,
      preset.width,
      preset.height,
      preset.id,
      starSystems.map((s) => ({ x: s.x, y: s.y })),
      homePositions,
      fleets.map((f) => ({ x: f.x, y: f.y })),
      specialObjects,
    );

    // Independent civilizations: extra systems placed last, from their own
    // rng stream, so everything above is identical to generator v6 for a seed.
    const civilizationRng = createMulberry32(((seed >>> 0) ^ CIVILIZATION_RNG_SALT) >>> 0);
    const civilizationNames = new PlanetNameGenerator(
      civilizationRng,
      starSystems.flatMap((s) => s.planetsTiles.map((p) => p.name)),
    );
    const civilizationSystems = options.civilizations === false ? [] : generateCivilizationSystems({
      rng: civilizationRng,
      width: preset.width,
      height: preset.height,
      center,
      minSystemSpacing: preset.minSystemSpacing,
      blackHoleClearance: preset.blackHoleClearance,
      edgeMargin: preset.edgeMargin,
      galaxySize: preset.id,
      starSystems,
      homeSystems,
      fleets,
      asteroidBelts,
      specialObjects,
      starNames: starNames.slice(positions.length),
      nextPlanetId,
      planetName: () => civilizationNames.next(),
      planetLayout: PLANET_SYSTEM_LAYOUT,
      planetTypes: PLANET_TYPES,
      planetSizes: PLANET_SIZES,
      starColors: STAR_COLORS,
    });
    for (const planet of civilizationSystems.flatMap((s) => s.planetsTiles)) {
      if (planet.buildings.length > 0) planet.surface = generatePlanetSurface(planet, seed);
    }
    ensureSystemAsteroidBelts(civilizationSystems, seed);
    starSystems.push(...civilizationSystems);

    return {
      saveVersion: SAVE_VERSION,
      gameVersion: GAME_VERSION,
      galaxy: {
        size: preset.id,
        seed: seed >>> 0,
        requestedSeed: config.seed ?? null,
        generatorVersion: GALAXY_GENERATOR_VERSION,
      },
      defaultView: { type: 'planet', systemId: playerHome.id, planetId: playerHome.planetsTiles[0].id },
      factions,
      specialObjects,
      nebulae,
      asteroidBelts,
      asteroidEvents: initialAsteroidEvents(seed),
      map: { width: preset.width, height: preset.height, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems,
      fleets,
      // An empty (not missing) explored set opts the game into fog of war;
      // StarMap.loadGame treats a missing field as a legacy all-explored save.
      exploredGridCells: [],
      shipStock: [],
      production: [],
      gameOutcome: 'inProgress',
    };
  }

  /*
   * AI personalities cycle through AI_PERSONALITIES from a seed-derived
   * offset, so a game mixes different strategic styles while staying
   * reproducible. Derived arithmetically from the seed — the Mulberry32
   * stream is not consumed, so galaxy layout for a seed is unchanged.
   */
  /*
   * Every participant gets its own team (human 1, AIs 2, 3, …), so no two
   * participants are permanent allies; who fights whom is decided by
   * treaties instead. All participants start at war with each other, with
   * the opening war lock (docs/diplomacy.md). Older saves keep their
   * shared AI team 2 and therefore their AI alliance.
   */
  private buildFactions(participants: ParticipantAssignment[], seed: number): Faction[] {
    let aiIndex = 0;
    let nextAiTeam = 2;
    const factions: Faction[] = participants.map(({ factionId, setup }) => {
      const isAi = setup.controller === 'ai';
      const difficulty: AiDifficulty | undefined = isAi ? setup.difficulty : undefined;
      const resourceMultiplier = isAi
        ? AI_DIFFICULTY_PROFILES[setup.difficulty].startingResourceMultiplier
        : 1;
      const faction: Faction = {
        id: factionId,
        name: setup.name.trim(),
        color: setup.color,
        team: isAi ? nextAiTeam++ : 1,
        ai: isAi,
        currencies: {
          credits: Math.round(BASE_CURRENCIES.credits * resourceMultiplier),
          rawmaterials: Math.round(BASE_CURRENCIES.rawmaterials * resourceMultiplier),
          research: Math.round(BASE_CURRENCIES.research * resourceMultiplier),
        },
        researchedTechnologies: [...STARTING_TECHNOLOGIES],
      };
      if (difficulty) {
        faction.aiDifficulty = difficulty;
        faction.aiPersonality = AI_PERSONALITIES[((seed >>> 0) + aiIndex++) % AI_PERSONALITIES.length];
      }
      return faction;
    });
    const all = [...factions, ...NEUTRAL_FACTIONS.map((f) => structuredClone(f))];
    // First contact (docs/first-contact.md): no participant has met another.
    // Un-met pairs are at peace without a lock; the contact decides war or
    // peace when they meet.
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const a = factions[i];
        const b = factions[j];
        (a.relations ??= {})[b.id] = { state: 'peace', lockRemaining: 0, contact: false };
        (b.relations ??= {})[a.id] = { state: 'peace', lockRemaining: 0, contact: false };
      }
    }
    normalizeRelations(all, 0);
    return all;
  }

  /*
   * Turns planet 1 of the home system into the faction homeworld and, for
   * AI factions, colonizes difficulty-dependent extra planets in the same
   * system. Every planet of the human's home system starts explored.
   */
  private settleHomeSystem(system: StarSystem, participant: ParticipantAssignment, faction: Faction): void {
    const homeworld = system.planetsTiles[0];
    homeworld.factionId = faction.id;
    homeworld.type = 'earthlike';
    homeworld.size = 'medium';
    homeworld.population = HOMEWORLD_POPULATION;
    homeworld.buildings = centerLayout(HOMEWORLD_BUILDINGS, getPlanetGridSize(homeworld));

    if (faction.ai) {
      const extra = AI_DIFFICULTY_PROFILES[participant.setup.difficulty].extraColonies;
      for (const planet of system.planetsTiles.slice(1, 1 + extra)) {
        planet.factionId = faction.id;
        if (planet.size === 'tiny') planet.size = 'small';
        planet.population = COLONY_POPULATION;
        planet.buildings = centerLayout(COLONY_BUILDINGS, getPlanetGridSize(planet));
      }
    }

    // The human knows its own home system: every planet in it starts
    // explored. AI factions do not use PlanetTile.explored (it is the
    // player's fog), so it stays false for them.
    if (faction.id === PLAYER_FACTION_ID) {
      for (const planet of system.planetsTiles) planet.explored = true;
    }
  }

  /*
   * Home systems on an ellipse around the black hole at evenly spaced
   * angles with a small random jitter. The ellipse radius keeps homes away
   * from both the center and the map edge.
   */
  private placeHomeSystems(rng: Rng, preset: GalaxySizePreset, center: Point, count: number): Point[] {
    const rx = (preset.width / 2 - preset.edgeMargin - 4) * (0.8 + rng() * 0.08);
    const ry = (preset.height / 2 - preset.edgeMargin - 2) * (0.8 + rng() * 0.08);
    const baseAngle = rng() * Math.PI * 2;
    const step = (Math.PI * 2) / count;
    const homes: Point[] = [];
    for (let i = 0; i < count; i++) {
      const jitter = (rng() - 0.5) * step * 0.2;
      const angle = baseAngle + i * step + jitter;
      const pos = this.clampToMap(
        { x: Math.round(center.x + rx * Math.cos(angle)), y: Math.round(center.y + ry * Math.sin(angle)) },
        preset,
      );
      if (homes.some((h) => distance(h, pos) < preset.minSystemSpacing)) {
        throw new GalaxyGenerationError('Home systems too close together');
      }
      homes.push(pos);
    }
    return homes;
  }

  /*
   * Best-candidate sampling: for each new system, draw several random
   * candidates and keep the one farthest from every existing system.
   * This avoids both clustering and large empty regions.
   */
  private placeRemainingSystems(rng: Rng, preset: GalaxySizePreset, center: Point, existing: Point[]): Point[] {
    const placed: Point[] = [...existing];
    const result: Point[] = [];
    const remaining = preset.systemCount - existing.length;
    const candidatesPerSystem = 40;

    for (let n = 0; n < remaining; n++) {
      let best: Point | null = null;
      let bestScore = -Infinity;
      for (let attempt = 0; attempt < candidatesPerSystem * 5 && (attempt < candidatesPerSystem || !best); attempt++) {
        const candidate = {
          x: randomInt(rng, preset.edgeMargin + 1, preset.width - preset.edgeMargin),
          y: randomInt(rng, preset.edgeMargin + 1, preset.height - preset.edgeMargin),
        };
        if (distance(candidate, center) < preset.blackHoleClearance) continue;
        const nearest = Math.min(...placed.map((p) => distance(p, candidate)));
        if (nearest < preset.minSystemSpacing) continue;
        if (nearest > bestScore) {
          bestScore = nearest;
          best = candidate;
        }
      }
      if (!best) {
        throw new GalaxyGenerationError('Could not place all star systems with the required spacing');
      }
      placed.push(best);
      result.push(best);
    }
    return result;
  }

  /*
   * The human's starting fleets are stationed at the homeworld: on the home
   * system's galaxy cell, inside the system at the homeworld's system-grid
   * cell — the same placement FleetAssemblyService gives a fleet assembled
   * at a Spaceport — so the game opens with the fleet next to the homeworld.
   *
   * AI starting fleets deliberately stay on a free cell 3–6 cells from home.
   * EnemyFleetService treats the strongest fleet on the home cell as the
   * home guard and never sends a faction's only fleet away from there, and
   * EnemyEconomyService merges new ships into a fleet parked at the
   * Spaceport. An AI fleet starting on the home cell therefore never
   * explored or expanded (the AI simulation specs caught it).
   */
  private buildFleets(
    rng: Rng,
    preset: GalaxySizePreset,
    center: Point,
    participants: ParticipantAssignment[],
    homeSystems: StarSystem[],
    starSystems: StarSystem[],
  ): Fleet[] {
    const fleets: Fleet[] = [];
    let nextFleetId = 1;
    let nextShipId = 1;
    const aiFleetNames = shuffle(rng, [...FLEET_NAMES]);
    let aiNameIndex = 0;
    const occupied = new Set(starSystems.map((s) => `${s.x}-${s.y}`));

    participants.forEach((participant, i) => {
      const home = homeSystems[i];
      const isAi = participant.setup.controller === 'ai';
      const presetName = isAi
        ? AI_DIFFICULTY_PROFILES[participant.setup.difficulty].startingFleetPreset
        : 'player';

      FLEET_PRESETS[presetName].forEach((template, fleetIndex) => {
        const name = isAi
          ? (aiFleetNames[aiNameIndex++] ?? `FLEET-${nextFleetId}`)
          : (PLAYER_FLEET_NAMES[fleetIndex] ?? `FLEET-${nextFleetId}`);
        const types = template.ships.flatMap((group) => Array.from({ length: group.count }, () => group.shipType));
        const ships = types.map((type, k) => ({
          id: nextShipId++,
          name: `${name}-${k + 1}`,
          type,
        }));
        const fleet: Fleet = {
          id: nextFleetId++,
          name,
          factionId: participant.factionId,
          x: home.x,
          y: home.y,
          targetX: null,
          targetY: null,
          speed: template.speed,
          system: null,
          destroyed: false,
          sensorRange: 3,
          ships,
        };
        // The near-home cell is drawn for the human's fleet too (and then
        // left unused) so the rng stream and the occupied cells stay as
        // they were: AI fleet cells for a seed match generator version 8,
        // and the seeded AI simulation specs keep their scenarios.
        const pos = this.placeFleetNearHome(rng, preset, center, home, occupied);
        occupied.add(`${pos.x}-${pos.y}`);
        if (isAi) {
          fleet.x = pos.x;
          fleet.y = pos.y;
        } else {
          const spawn = planetFootprintCenterVw(home.planetsTiles[0]);
          const spawnCell = systemCellAtVw(spawn.x, spawn.y);
          fleet.system = { id: home.id, x: spawn.x, y: spawn.y, targetX: null, targetY: null };
          fleet.gridCol = spawnCell.col;
          fleet.gridRow = spawnCell.row;
        }
        fleets.push(fleet);
      });
    });
    return fleets;
  }

  /* A free cell 3–6 cells from the home system, inside the map and clear of the black hole. */
  private placeFleetNearHome(
    rng: Rng,
    preset: GalaxySizePreset,
    center: Point,
    home: StarSystem,
    occupied: Set<string>,
  ): Point {
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = 3 + rng() * 3;
      const pos = this.clampToMap(
        { x: Math.round(home.x + radius * Math.cos(angle)), y: Math.round(home.y + radius * Math.sin(angle)) },
        preset,
      );
      if (occupied.has(`${pos.x}-${pos.y}`)) continue;
      if (distance(pos, center) < preset.blackHoleClearance) continue;
      return pos;
    }
    throw new GalaxyGenerationError(`Could not place a starting fleet near ${home.name}`);
  }

  private clampToMap(pos: Point, preset: GalaxySizePreset): Point {
    return {
      x: Math.max(preset.edgeMargin / 2, Math.min(preset.width - preset.edgeMargin / 2, pos.x)),
      y: Math.max(preset.edgeMargin / 2, Math.min(preset.height - preset.edgeMargin / 2, pos.y)),
    };
  }
}

/*
 * Produces unique pronounceable planet names. Uniqueness across the whole
 * galaxy is required, not cosmetic: EconomyService resolves planets by name.
 */
class PlanetNameGenerator {
  private readonly used: Set<string>;

  /* `taken`: names already in the galaxy (a second generator must not repeat them). */
  constructor(private readonly rng: Rng, taken: Iterable<string> = []) {
    this.used = new Set(taken);
  }

  next(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const name = pick(this.rng, PLANET_NAME_PREFIXES) + pick(this.rng, PLANET_NAME_MIDDLES) + pick(this.rng, PLANET_NAME_ENDINGS);
      if (!this.used.has(name)) {
        this.used.add(name);
        return name;
      }
    }
    let suffix = 2;
    const base = pick(this.rng, PLANET_NAME_PREFIXES) + pick(this.rng, PLANET_NAME_ENDINGS);
    while (this.used.has(`${base} ${suffix}`)) suffix++;
    const name = `${base} ${suffix}`;
    this.used.add(name);
    return name;
  }
}

/*
 * Visibility rule for generated galaxies: every star SYSTEM is `explored`
 * (its position and name are rendered and selectable), while fog of war
 * still applies to grid cells (`exploredGridCells` starts empty), enemy
 * fleets (sensor range) and planet details (`PlanetTile.explored`).
 *
 * Why: StarSystem.explored gates whether a system is drawn at all, on the
 * galaxy view and the minimap. Every game on the legacy map ran with all
 * systems revealed (its JSON has no exploredGridCells, so StarMap.loadGame
 * marks them all explored). Generator v1 hid all but the home system; with
 * sensor ranges of 3–5 cells and systems 20+ cells apart, the player could
 * not find any other system.
 */

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/* Returns 1..weights.length, chosen proportionally to weights. */
function weightedCount(rng: Rng, weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + 1;
  }
  return weights.length;
}

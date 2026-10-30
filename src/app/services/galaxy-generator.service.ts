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
import { createMulberry32 } from '../components/star-map/star-map-resources.util';
import { buildNavObstacles } from '../components/star-map/fleet-navigation';
import { NEBULA_CONFIG, generateNebulae } from '../components/star-map/nebula';
import { ASTEROID_BELT_CONFIG, generateAsteroidBelts } from '../components/star-map/asteroid-belts';
import { createInitialAsteroidState } from '../components/star-map/drifting-asteroids';
import { AI_DIFFICULTY_PROFILES } from '../components/star-map/ai-difficulty';
import { AI_PERSONALITIES } from '../components/star-map/ai-personality';
import { centerLayout, generatePlanetSurface } from '../components/star-map/planet-surface/planet-surface-generator';
import { getPlanetGridSize } from '../components/star-map/planet-surface/planet-surface';
import { SAVE_VERSION } from './save-validation';
import { GALAXY_SIZE_PRESETS, GalaxySizePreset, NewGameConfig, PlayerSetup } from './new-game.models';

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
 *    hid every other star — see markStarPositionsKnown).
 * 2: every star system starts `explored` (positions known); planets stay unexplored.
 * 3: nebulae and the drifting-asteroid event state are generated.
 * 4: impassable asteroid belts are generated.
 * 5: belts curve as gentle arcs instead of a single kink.
 * 6: planet surfaces: doubled grids, centered starting layouts and the
 *    persisted `PlanetTile.surface` terrain (docs/planet-surface.md).
 */
export const GALAXY_GENERATOR_VERSION = 6;
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

/* Planet positions on the 18×10 system grid, by planet index (matches the legacy map). */
const PLANET_SYSTEM_LAYOUT: readonly Point[] = [
  { x: 12, y: 3 },
  { x: 10, y: 5 },
  { x: 8, y: 4 },
  { x: 6, y: 2 },
  { x: 4, y: 6 },
  { x: 2, y: 3 },
];

const PLANET_TYPES: readonly PlanetType[] = ['earthlike', 'marslike', 'venuslike', 'gasgiant', 'ice', 'desert'];
const PLANET_SIZES: readonly PlanetSize[] = ['tiny', 'small', 'medium', 'big', 'huge'];
const STAR_COLORS: readonly string[] = ['#ffcc00', '#5ca8ff', '#f3f3f3', '#39b8a8', '#d65757', '#888888'];

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

const STARTING_TECHNOLOGIES = ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'];
const BASE_CURRENCIES = { credits: 1000, rawmaterials: 1000, research: 1000 } as const;
/* Homeworld population equals the template's residential capacity (2 × 700). */
const HOMEWORLD_POPULATION = 1400;
const COLONY_POPULATION = 100;

/*
 * Homeworld = the legacy Earth layout plus a Fusion Power Plant. The
 * legacy Earth started energy-negative, which every AI homeworld would
 * have inherited and rebelled from before its develop action ran; the
 * plant makes every faction start energy-positive (100 vs 54).
 * Authored at the origin; centerLayout moves it to the middle of the grid.
 */
const HOMEWORLD_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
  { name: 'Large Residential Block', size: 3, x: 3, y: 0 },
  { name: 'Fusion Power Plant', size: 3, x: 6, y: 0 },
  { name: 'Laser Turret', size: 1, x: 0, y: 3 },
  { name: 'Research Laboratory', size: 2, x: 0, y: 6 },
];

/* Extra AI colonies (difficulty bonus). Centered like the homeworld layout. */
const COLONY_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Small Residential Block', size: 1, x: 0, y: 0 },
  { name: 'Solar Array', size: 2, x: 1, y: 0 },
];

interface FleetTemplate {
  shipType: string;
  count: number;
  speed: number;
}

/*
 * Starting fleets. 'standard' is the legacy player roster (ORION: 2
 * frigates, PEGASUS: 3 cruisers) and is used for the human and for
 * Normal AI so the start is symmetric. Speeds match the legacy map.
 */
const FLEET_PRESETS: Readonly<Record<'reduced' | 'standard' | 'reinforced', FleetTemplate[]>> = {
  reduced: [{ shipType: 'frigate', count: 2, speed: 8 }],
  standard: [
    { shipType: 'frigate', count: 2, speed: 8 },
    { shipType: 'cruiser', count: 3, speed: 6 },
  ],
  reinforced: [
    { shipType: 'frigate', count: 2, speed: 8 },
    { shipType: 'cruiser', count: 3, speed: 6 },
    { shipType: 'destroyer', count: 4, speed: 7 },
  ],
};
const PLAYER_FLEET_NAMES = ['ORION', 'PEGASUS', 'PHOENIX'];

/* Neutral factions copied from the legacy map. */
const NEUTRAL_FACTIONS: readonly Faction[] = [
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
  generate(config: NewGameConfig, seed: number): StarMapData {
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
        // Star positions are known from the start; see markStarPositionsKnown.
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

    return {
      saveVersion: SAVE_VERSION,
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
  private buildFactions(participants: ParticipantAssignment[], seed: number): Faction[] {
    let aiIndex = 0;
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
        team: isAi ? 2 : 1,
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
    return [...factions, ...NEUTRAL_FACTIONS.map((f) => structuredClone(f))];
  }

  /*
   * Turns planet 1 of the home system into the faction homeworld and, for
   * AI factions, colonizes difficulty-dependent extra planets in the same
   * system. The human's home system and homeworld start explored, matching
   * the legacy SOL/Earth start.
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

    if (faction.id === PLAYER_FACTION_ID) {
      homeworld.explored = true;
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
        : 'standard';

      FLEET_PRESETS[presetName].forEach((template, fleetIndex) => {
        const name = isAi
          ? (aiFleetNames[aiNameIndex++] ?? `FLEET-${nextFleetId}`)
          : (PLAYER_FLEET_NAMES[fleetIndex] ?? `FLEET-${nextFleetId}`);
        const pos = this.placeFleetNearHome(rng, preset, center, home, occupied);
        occupied.add(`${pos.x}-${pos.y}`);
        const ships = Array.from({ length: template.count }, (_, k) => ({
          id: nextShipId++,
          name: `${name}-${k + 1}`,
          type: template.shipType,
        }));
        fleets.push({
          id: nextFleetId++,
          name,
          factionId: participant.factionId,
          x: pos.x,
          y: pos.y,
          targetX: null,
          targetY: null,
          speed: template.speed,
          system: null,
          destroyed: false,
          sensorRange: 3,
          ships,
        });
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
  private readonly used = new Set<string>();

  constructor(private readonly rng: Rng) {}

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
 * not find any other system. Also used by SaveGameService to repair v1 saves.
 */
export function markStarPositionsKnown(starSystems: StarSystem[]): void {
  for (const system of starSystems) {
    system.explored = true;
  }
}

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

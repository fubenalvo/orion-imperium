import researchTreeData from '../components/star-map/research-tree.json';
import {
  AiDifficulty,
  Faction,
  FactionRelation,
  Fleet,
  GalaxySize,
  PlanetTile,
  StarMapData,
  StarSystem,
} from '../components/star-map/star-map.models';
import {
  COLONY_BUILDINGS,
  GALAXY_GENERATOR_VERSION,
  HOMEWORLD_BUILDINGS,
  NEUTRAL_FACTIONS,
  PLANET_SYSTEM_LAYOUT,
  STARTING_TECHNOLOGIES,
  blackHoleObject,
  initialAsteroidEvents,
} from '../services/galaxy-generator.service';
import { centerLayout, generatePlanetSurface } from '../components/star-map/planet-surface/planet-surface-generator';
import { getPlanetGridSize } from '../components/star-map/planet-surface/planet-surface';
import { generateResourceTilesForPlanet } from '../components/star-map/star-map-resources.util';
import { ensurePlanetDeposits } from '../components/star-map/raw-deposits';
import { ensureSystemAsteroidBelts } from '../components/star-map/system-asteroids';
import { normalizeRelations } from '../components/star-map/diplomacy';
import { CAPITAL_BUILDINGS } from '../components/star-map/civilizations';
import { planetFootprintCenterVw, systemCellAtVw } from '../components/star-map/system-grid';
import { ANOMALY_CONFIG } from '../components/star-map/anomalies';
import { Anomaly } from '../components/star-map/star-map.models';
import { SAVE_VERSION } from '../services/save-validation';
import { GAME_VERSION } from '../game-version';
import {
  CampaignSessionState,
  MissionCarry,
  MissionDefinition,
  MissionFactionSpec,
  MissionPlanetSpec,
  ObjectiveState,
} from './campaign.models';

/*
 * =========================================================
 * MISSION BUILDER (pure)
 * =========================================================
 *
 * Turns a MissionDefinition into an ordinary StarMapData save
 * (docs/campaign-design.md §12). Loading the result is loading a save:
 * nothing in the simulation needs to know it came from a mission.
 *
 * Deterministic: the same definition, carry and difficulty always give the
 * same save (surfaces, deposits, in-system belts and drifting asteroids are
 * all derived from the mission's fixed seed). Planet surfaces of unsettled
 * planets, deposits of other planets and colony cores are completed on the
 * first load by StarMap, exactly as for a generated galaxy.
 *
 * What the builder deliberately leaves out (state the mission must not get
 * from the random generators):
 * - `anomalies` is written as an empty, valid state, so
 *   SaveGameService.normalizeSave never generates random anomalies;
 * - no black hole unless the map asks for one (`blackHole`: the generator's
 *   centred black hole, which brings the Dyson ring, dyson-ring.ts); without
 *   it the Dyson Swarm stays off.
 */

const ANCIENT_TECHNOLOGIES: ReadonlySet<string> = new Set(
  (researchTreeData as { technologies: { id: string; ancient?: boolean }[] }).technologies.filter((t) => t.ancient).map((t) => t.id),
);

export interface MissionBuildOptions {
  difficulty: AiDifficulty;
  carry: MissionCarry;
}

const DEFAULT_FLEET_SPEED = 4;

export function buildMission(mission: MissionDefinition, options: MissionBuildOptions): StarMapData {
  const seed = mission.seed >>> 0;
  const spec = mission.map;
  const factions = buildFactions(mission, options);

  let nextPlanetId = 1;
  const planetsByName = new Map<string, { planet: PlanetTile; system: StarSystem }>();
  const starSystems: StarSystem[] = spec.systems.map((systemSpec) => {
    const system: StarSystem = {
      id: systemSpec.id,
      name: systemSpec.name,
      x: systemSpec.x,
      y: systemSpec.y,
      planets: systemSpec.planets.length,
      color: systemSpec.color,
      // Star positions are known (the generator's visibility rule) unless the
      // mission hides a system; StarMap reveals it once sensors reach it.
      // "Charted" for objectives means the cell was explored.
      explored: systemSpec.hidden !== true,
      planetsTiles: [],
    };
    systemSpec.planets.forEach((planetSpec, i) => {
      const planet = buildPlanet(planetSpec, nextPlanetId++, i + 1);
      system.planetsTiles.push(planet);
      planetsByName.set(planet.name, { planet, system });
    });
    return system;
  });

  // Surfaces of settled planets now (around their buildings), then the
  // starting deposits; the rest follows on first load.
  for (const system of starSystems) {
    for (const planet of system.planetsTiles) {
      if (planet.buildings.length > 0) planet.surface = generatePlanetSurface(planet, seed);
    }
  }
  const depositPlanets: PlanetTile[] = [];
  spec.systems.forEach((systemSpec, si) => {
    systemSpec.planets.forEach((planetSpec, pi) => {
      if (!planetSpec.deposit) return;
      const planet = starSystems[si].planetsTiles[pi];
      planet.resourceTiles = generateResourceTilesForPlanet(planet, getPlanetGridSize);
      depositPlanets.push(planet);
    });
  });
  ensurePlanetDeposits(depositPlanets);
  ensureSystemAsteroidBelts(starSystems, seed);
  // Resource-rich belts: authored deposits on the first asteroids of the deterministic belt.
  spec.systems.forEach((systemSpec, si) => {
    const asteroids = starSystems[si].asteroidBelt?.asteroids ?? [];
    (systemSpec.richAsteroids ?? []).forEach((amount, i) => {
      const asteroid = asteroids[i];
      if (!asteroid) return;
      asteroid.rawMaterials = amount;
      asteroid.totalRawMaterials = amount;
    });
  });

  const fleetTags: Record<string, number[]> = {};
  let nextShipId = 1;
  const fleets: Fleet[] = spec.fleets.map((fleetSpec, i) => {
    const id = i + 1;
    const ships = fleetSpec.ships.map((type, k) => ({ id: nextShipId++, name: `${fleetSpec.name}-${k + 1}`, type }));
    const fleet: Fleet = {
      id,
      name: fleetSpec.name,
      factionId: fleetSpec.factionId,
      x: fleetSpec.x ?? 1,
      y: fleetSpec.y ?? 1,
      targetX: null,
      targetY: null,
      speed: fleetSpec.speed ?? DEFAULT_FLEET_SPEED,
      system: null,
      destroyed: false,
      sensorRange: 3,
      ships,
    };
    if (fleetSpec.atPlanet) {
      // The generator's player placement: on the system cell, next to the planet in the system view.
      const entry = planetsByName.get(fleetSpec.atPlanet);
      if (entry) {
        fleet.x = entry.system.x;
        fleet.y = entry.system.y;
        const spawn = planetFootprintCenterVw(entry.planet);
        const cell = systemCellAtVw(spawn.x, spawn.y);
        fleet.system = { id: entry.system.id, x: spawn.x, y: spawn.y, targetX: null, targetY: null };
        fleet.gridCol = cell.col;
        fleet.gridRow = cell.row;
      }
    }
    if (fleetSpec.tag) (fleetTags[fleetSpec.tag] ??= []).push(id);
    return fleet;
  });

  const view = planetsByName.get(spec.defaultView.planetName);

  return {
    saveVersion: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    galaxy: { size: nearestGalaxySize(spec.width), seed, requestedSeed: seed, generatorVersion: GALAXY_GENERATOR_VERSION },
    defaultView: { type: 'planet', systemId: spec.defaultView.systemId, planetId: view?.planet.id ?? 1 },
    factions,
    specialObjects: spec.blackHole ? [blackHoleObject(spec.width, spec.height)] : [],
    nebulae: structuredClone(spec.nebulae ?? []),
    asteroidBelts: structuredClone(spec.asteroidBelts ?? []),
    asteroidEvents: initialAsteroidEvents(seed),
    anomalies: { version: ANOMALY_CONFIG.generatorVersion, nextSeq: 1, anomalies: buildAnomalies(mission, starSystems) },
    ...(spec.wormholes && spec.wormholes.length > 0 ? { wormholes: structuredClone(spec.wormholes) } : {}),
    ...(spec.spaceBases && spec.spaceBases.length > 0
      ? { spaceBases: spec.spaceBases.map((b, i) => ({ id: i + 1, name: b.name, factionId: b.factionId, x: b.x, y: b.y })) }
      : {}),
    ...(mission.rules.tutorial ? { tutorial: { enabled: true, done: [] } } : {}),
    map: { width: spec.width, height: spec.height, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems,
    fleets,
    exploredGridCells: [],
    shipStock: [],
    production: [],
    gameOutcome: 'inProgress',
    gameSeconds: 0,
    campaign: initialSession(mission, options, fleetTags),
  };
}

/*
 * Player start: the four basics, the baseline, and what was carried that
 * exists in this mission. Ancient technologies are never in a horizon (they
 * are only granted), so a carried ancient one is always kept.
 */
export function playerStartingTechnologies(mission: MissionDefinition, carried: readonly string[]): string[] {
  const horizon = new Set(mission.researchHorizon);
  const result = [...STARTING_TECHNOLOGIES];
  const add = (id: string) => { if (!result.includes(id)) result.push(id); };
  for (const id of mission.map.factions.find((f) => f.kind === 'player')?.technologies ?? []) add(id);
  for (const id of mission.baselineTechnologies) add(id);
  for (const id of carried) if (horizon.has(id) || ANCIENT_TECHNOLOGIES.has(id)) add(id);
  return result;
}

function buildFactions(mission: MissionDefinition, options: MissionBuildOptions): Faction[] {
  let nextAiTeam = 2;
  const factions: Faction[] = mission.map.factions.map((spec) => buildFaction(spec, mission, options, spec.kind === 'ai' ? nextAiTeam++ : 0));
  const all = [...factions, ...NEUTRAL_FACTIONS.map((f) => structuredClone(f))];
  const byId = new Map(all.map((f) => [f.id, f]));
  for (const relation of mission.map.relations) {
    const a = byId.get(relation.a);
    const b = byId.get(relation.b);
    if (!a || !b) continue;
    const contact = relation.contact === false ? { contact: false } : {};
    (a.relations ??= {})[b.id] = { state: relation.state, lockRemaining: 0, opinion: relation.opinion ?? 0, ...contact } as FactionRelation;
    (b.relations ??= {})[a.id] = { state: relation.state, lockRemaining: 0, opinion: relation.opinionBA ?? relation.opinion ?? 0, ...contact } as FactionRelation;
  }
  // Fills every field; mission validation guarantees no pair is left to the
  // "missing = war" default.
  normalizeRelations(all, 0);
  return all;
}

function buildFaction(spec: MissionFactionSpec, mission: MissionDefinition, options: MissionBuildOptions, aiTeam: number): Faction {
  const technologies = spec.kind === 'player'
    ? playerStartingTechnologies(mission, options.carry.technologies)
    : [...new Set([...STARTING_TECHNOLOGIES, ...(spec.technologies ?? [])])];
  const faction: Faction = {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    team: spec.kind === 'player' ? 1 : spec.kind === 'ai' ? aiTeam : 0,
    ai: spec.kind === 'ai',
    currencies: { ...spec.currencies },
    researchedTechnologies: technologies,
  };
  if (spec.kind === 'ai') {
    faction.aiDifficulty = spec.difficulty ?? options.difficulty;
    faction.aiPersonality = spec.personality ?? 'balanced';
  }
  if (spec.kind === 'outlaw') faction.outlaw = true;
  return faction;
}

/* The homeworld block (9×9) with a Spaceport and a Spaceship Factory beside it: 15×9, fits medium planets and up. */
const STRONGHOLD_BUILDINGS = [
  ...HOMEWORLD_BUILDINGS,
  { name: 'Spaceport', size: 4, x: 11, y: 0 },
  { name: 'Spaceship Factory', size: 3, x: 11, y: 5 },
];

function buildPlanet(spec: MissionPlanetSpec, id: number, index: number): PlanetTile {
  const layout = PLANET_SYSTEM_LAYOUT[index - 1] ?? PLANET_SYSTEM_LAYOUT[PLANET_SYSTEM_LAYOUT.length - 1];
  const planet: PlanetTile = {
    id,
    index,
    name: spec.name,
    factionId: spec.owner ?? 'unhabited',
    x: layout.x,
    y: layout.y,
    type: spec.type,
    size: spec.size,
    population: spec.population ?? 0,
    buildings: [],
    explored: spec.explored ?? false,
  };
  if (spec.civilization) planet.civilization = spec.civilization;
  if (spec.satisfaction !== undefined) planet.satisfaction = spec.satisfaction;
  const template = spec.layout === 'homeworld' ? HOMEWORLD_BUILDINGS
    : spec.layout === 'colony' ? COLONY_BUILDINGS
    : spec.layout === 'civilization_capital' ? CAPITAL_BUILDINGS
    : spec.layout === 'stronghold' ? STRONGHOLD_BUILDINGS
    : [];
  planet.buildings = centerLayout(template, getPlanetGridSize(planet));
  return planet;
}

function protectedPlanets(mission: MissionDefinition): { planetName: string }[] {
  return mission.map.systems.flatMap((s) => s.planets.filter((p) => p.protected).map((p) => ({ planetName: p.name })));
}

function initialSession(mission: MissionDefinition, options: MissionBuildOptions, fleetTags: Record<string, number[]>): CampaignSessionState {
  const objectives: Record<string, ObjectiveState> = {};
  for (const def of mission.objectives) objectives[def.id] = { status: 'locked' };
  return {
    version: 1,
    missionId: mission.id,
    missionVersion: mission.version,
    difficulty: options.difficulty,
    carry: structuredClone(options.carry),
    rules: { ...mission.rules },
    flags: { ...(mission.carryIn ?? {}), ...options.carry.flags },
    ...(protectedPlanets(mission).length > 0 ? { protectedPlanets: protectedPlanets(mission) } : {}),
    values: {},
    counters: {},
    objectives,
    heldTimers: {},
    firedEvents: [],
    pendingEvents: [],
    fleetTags,
    researchHorizon: [...mission.researchHorizon],
    horizonExtras: structuredClone(mission.horizonExtras ?? {}),
  };
}

/* Authored campaign anomalies, hidden until the player's sensors explore their cell. */
function buildAnomalies(mission: MissionDefinition, starSystems: StarSystem[]): Anomaly[] {
  return (mission.map.anomalies ?? []).map((spec, i) => {
    const system = spec.systemId ? starSystems.find((s) => s.id === spec.systemId) : undefined;
    const site = system
      ? { kind: 'system' as const, x: Math.floor(system.x), y: Math.floor(system.y), systemId: system.id }
      : { kind: 'space' as const, x: Math.floor(spec.x ?? 1), y: Math.floor(spec.y ?? 1) };
    return { id: i + 1, key: spec.key, type: spec.type, site, status: 'hidden' as const, ...(spec.factionId ? { factionId: spec.factionId } : {}) };
  });
}

function nearestGalaxySize(width: number): GalaxySize {
  if (width <= 180) return 'small';
  if (width <= 240) return 'medium';
  return 'large';
}

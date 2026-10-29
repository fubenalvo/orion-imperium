import { StarMapData, PLANET_SIZE_MAP, PlanetSize, PlanetType } from '../components/star-map/star-map.models';
import { isAiDifficulty } from '../components/star-map/ai-difficulty';
import planetData from '../components/star-map/planet-data.json';
import { KNOWN_SHIP_TYPES, validateSaveData } from './save-validation';
import { GALAXY_SIZE_PRESETS, NewGameConfig } from './new-game.models';
import { assignFactionIds, mapCenter, PLAYER_FACTION_ID } from './galaxy-generator.service';
import { isPointInNebula } from '../components/star-map/nebula';
import { areSystemsConnected, beltAxisDistance, beltNavigationRadius } from '../components/star-map/asteroid-belts';
import { buildNavObstacles } from '../components/star-map/fleet-navigation';

/*
 * Strict validation of a freshly generated galaxy.
 *
 * `validateSaveData` (save-validation.ts) is intentionally permissive so old
 * saves keep loading. A brand-new galaxy has no such excuse, so this layer
 * adds the referential and gameplay checks a playable start needs: unique
 * ids/names, valid faction references, a homeworld and fleet for every
 * participant, coordinates inside the map and outside the black hole, and
 * factions that match the requested configuration.
 *
 * Planet names must be unique because EconomyService looks planets up by name.
 */

export interface GalaxyValidationResult {
  ok: boolean;
  errors: string[];
}

const PLANET_TYPES = new Set<PlanetType>(['earthlike', 'marslike', 'venuslike', 'gasgiant', 'ice', 'desert']);
const BUILDING_NAMES = new Set((planetData as { buildings: { name: string }[] }).buildings.map((b) => b.name));

export function validateGeneratedGalaxy(data: StarMapData, config?: NewGameConfig): GalaxyValidationResult {
  const errors: string[] = [];

  const base = validateSaveData(data);
  if (!base.ok) {
    return { ok: false, errors: base.errors.map((e) => `${e.path}: ${e.message}`) };
  }

  const { width, height } = data.map;
  const preset = data.galaxy ? GALAXY_SIZE_PRESETS[data.galaxy.size] : undefined;
  if (!data.galaxy || !preset) {
    errors.push('galaxy metadata is missing or has an unknown size');
  } else {
    if (width !== preset.width || height !== preset.height) {
      errors.push(`map is ${width}×${height}, expected ${preset.width}×${preset.height}`);
    }
    if (!Number.isInteger(data.galaxy.seed)) {
      errors.push('galaxy seed must be an integer');
    }
  }
  if (config && data.galaxy && data.galaxy.size !== config.galaxySize) {
    errors.push(`galaxy size is ${data.galaxy.size}, expected ${config.galaxySize}`);
  }

  // Black hole: exactly one, centered exactly on the map midpoint.
  const center = mapCenter(width, height);
  const blackHoles = (data.specialObjects ?? []).filter((o) => o.type === 'blackhole');
  if (blackHoles.length !== 1) {
    errors.push(`expected exactly one black hole, found ${blackHoles.length}`);
  } else {
    const bh = blackHoles[0];
    const bhCenterX = bh.x + (bh.width - 1) / 2;
    const bhCenterY = bh.y + (bh.height - 1) / 2;
    if (bhCenterX !== center.x || bhCenterY !== center.y) {
      errors.push(`black hole center (${bhCenterX}, ${bhCenterY}) is not the map center (${center.x}, ${center.y})`);
    }
    if (bh.component !== 'blackhole') {
      errors.push('black hole must use the blackhole renderer component');
    }
  }

  const inMap = (x: number, y: number) => x >= 1 && x <= width && y >= 1 && y <= height;
  const clearance = preset?.blackHoleClearance ?? 0;

  // Factions.
  const factionIds = new Set<string>();
  for (const faction of data.factions) {
    if (factionIds.has(faction.id)) errors.push(`duplicate faction id "${faction.id}"`);
    factionIds.add(faction.id);
  }
  const player = data.factions.find((f) => f.id === PLAYER_FACTION_ID);
  if (!player || player.ai !== false || player.team !== 1) {
    errors.push('the local human faction "player" must exist with ai=false and team=1');
  }
  if (data.factions.filter((f) => f.ai === false && f.team === 1).length !== 1) {
    errors.push('exactly one human faction is required');
  }
  for (const neutral of ['independent', 'unhabited']) {
    if (!factionIds.has(neutral)) errors.push(`neutral faction "${neutral}" is missing`);
  }
  for (const faction of data.factions) {
    if (faction.ai && !isAiDifficulty(faction.aiDifficulty)) {
      errors.push(`AI faction "${faction.id}" has no valid difficulty`);
    }
  }
  const participants = data.factions.filter((f) => f.team !== 0);

  // Systems and planets.
  const systemIds = new Set<string>();
  const systemNames = new Set<string>();
  const planetIds = new Set<number>();
  const planetNames = new Set<string>();
  const ownedPlanetCount = new Map<string, number>();
  for (const system of data.starSystems) {
    if (systemIds.has(system.id)) errors.push(`duplicate system id "${system.id}"`);
    systemIds.add(system.id);
    if (systemNames.has(system.name)) errors.push(`duplicate system name "${system.name}"`);
    systemNames.add(system.name);
    if (!Number.isInteger(system.x) || !Number.isInteger(system.y) || !inMap(system.x, system.y)) {
      errors.push(`system ${system.id} has invalid coordinates (${system.x}, ${system.y})`);
    }
    if (Math.hypot(system.x - center.x, system.y - center.y) < clearance) {
      errors.push(`system ${system.id} is inside the black hole clearance`);
    }
    if (system.planets !== system.planetsTiles.length) {
      errors.push(`system ${system.id} planet count does not match its planets`);
    }
    if (system.planetsTiles.length === 0) {
      errors.push(`system ${system.id} has no planets`);
    }
    for (const planet of system.planetsTiles) {
      if (planetIds.has(planet.id)) errors.push(`duplicate planet id ${planet.id}`);
      planetIds.add(planet.id);
      if (planetNames.has(planet.name)) errors.push(`duplicate planet name "${planet.name}"`);
      planetNames.add(planet.name);
      if (!factionIds.has(planet.factionId)) {
        errors.push(`planet ${planet.id} references unknown faction "${planet.factionId}"`);
      }
      ownedPlanetCount.set(planet.factionId, (ownedPlanetCount.get(planet.factionId) ?? 0) + 1);
      if (!PLANET_TYPES.has(planet.type)) errors.push(`planet ${planet.id} has invalid type "${planet.type}"`);
      const numericSize = PLANET_SIZE_MAP[planet.size as PlanetSize];
      if (!numericSize) {
        errors.push(`planet ${planet.id} has invalid size "${planet.size}"`);
        continue;
      }
      validateBuildings(planet.id, planet.buildings, numericSize * 2 + 3, errors);
    }
  }
  if (preset && data.starSystems.length !== preset.systemCount) {
    errors.push(`expected ${preset.systemCount} systems, found ${data.starSystems.length}`);
  }
  if (preset) {
    for (let i = 0; i < data.starSystems.length; i++) {
      for (let j = i + 1; j < data.starSystems.length; j++) {
        const a = data.starSystems[i];
        const b = data.starSystems[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < preset.minSystemSpacing) {
          errors.push(`systems ${a.id} and ${b.id} are closer than ${preset.minSystemSpacing} cells`);
        }
      }
    }
  }

  // Fleets.
  const fleetIds = new Set<number>();
  const shipIds = new Set<number>();
  const fleetCount = new Map<string, number>();
  for (const fleet of data.fleets) {
    if (fleetIds.has(fleet.id)) errors.push(`duplicate fleet id ${fleet.id}`);
    fleetIds.add(fleet.id);
    if (!factionIds.has(fleet.factionId)) {
      errors.push(`fleet ${fleet.id} references unknown faction "${fleet.factionId}"`);
    }
    fleetCount.set(fleet.factionId, (fleetCount.get(fleet.factionId) ?? 0) + 1);
    if (!inMap(fleet.x, fleet.y)) errors.push(`fleet ${fleet.id} is outside the map`);
    if (Math.hypot(fleet.x - center.x, fleet.y - center.y) < clearance) {
      errors.push(`fleet ${fleet.id} starts inside the black hole clearance`);
    }
    if (fleet.ships.length === 0) errors.push(`fleet ${fleet.id} has no ships`);
    for (const ship of fleet.ships) {
      if (shipIds.has(ship.id)) errors.push(`duplicate ship id ${ship.id}`);
      shipIds.add(ship.id);
      if (!KNOWN_SHIP_TYPES.has(ship.type)) errors.push(`ship ${ship.id} has unknown type "${ship.type}"`);
    }
  }

  for (const faction of participants) {
    if (!ownedPlanetCount.get(faction.id)) errors.push(`faction "${faction.id}" has no homeworld`);
    if (!fleetCount.get(faction.id)) errors.push(`faction "${faction.id}" has no starting fleet`);
  }

  // Default view must open on the human's homeworld.
  const view = data.defaultView;
  const viewSystem = data.starSystems.find((s) => s.id === view?.systemId);
  const viewPlanet = viewSystem?.planetsTiles.find((p) => p.id === view?.planetId);
  if (!viewPlanet || viewPlanet.factionId !== PLAYER_FACTION_ID) {
    errors.push('defaultView must reference the human player homeworld');
  }
  if (!Array.isArray(data.exploredGridCells)) {
    errors.push('exploredGridCells must be initialized');
  }

  // Terrain and events (generator v3+): nebulae exist, are well-formed and
  // never cover a homeworld system; the asteroid event state is initialized.
  if (!Array.isArray(data.nebulae) || data.nebulae.length === 0) {
    errors.push('nebulae must be generated');
  } else {
    for (const nebula of data.nebulae) {
      for (const system of data.starSystems) {
        const isHome = system.planetsTiles.some((p) => participants.some((f) => f.id === p.factionId));
        if (isHome && isPointInNebula(nebula, system.x, system.y)) {
          errors.push(`nebula ${nebula.id} covers home system ${system.id}`);
        }
      }
    }
  }
  // Asteroid belts (generator v4+): no system or starting fleet inside a
  // belt's no-fly zone, and every home system reaches every system.
  if (!Array.isArray(data.asteroidBelts)) {
    errors.push('asteroidBelts must be generated');
  } else if (data.asteroidBelts.length > 0) {
    for (const belt of data.asteroidBelts) {
      const r = beltNavigationRadius(belt);
      for (const system of data.starSystems) {
        if (beltAxisDistance(belt, system) < r) errors.push(`asteroid belt ${belt.id} covers system ${system.id}`);
      }
      for (const fleet of data.fleets) {
        if (beltAxisDistance(belt, fleet) < r) errors.push(`asteroid belt ${belt.id} covers fleet ${fleet.id}`);
      }
    }
    const homes = data.starSystems.filter((s) => s.planetsTiles.some((p) => participants.some((f) => f.id === p.factionId)));
    if (!areSystemsConnected(data.asteroidBelts, {
      width,
      height,
      systems: data.starSystems,
      homes,
      obstacles: buildNavObstacles(data.specialObjects),
    })) {
      errors.push('asteroid belts cut a home system off from another system');
    }
  }
  if (!data.asteroidEvents || !Array.isArray(data.asteroidEvents.active)) {
    errors.push('asteroidEvents must be initialized');
  }

  // Configuration must be reflected exactly in the factions.
  if (config) {
    const expected = assignFactionIds(config.players);
    if (participants.length !== expected.length) {
      errors.push(`expected ${expected.length} participating factions, found ${participants.length}`);
    }
    for (const { factionId, setup } of expected) {
      const faction = data.factions.find((f) => f.id === factionId);
      if (!faction) {
        errors.push(`configured player "${setup.name}" has no faction`);
        continue;
      }
      if (faction.name !== setup.name.trim()) errors.push(`faction ${factionId} name mismatch`);
      if (faction.color !== setup.color) errors.push(`faction ${factionId} color mismatch`);
      if (faction.ai !== (setup.controller === 'ai')) errors.push(`faction ${factionId} controller mismatch`);
      if (setup.controller === 'ai' && faction.aiDifficulty !== setup.difficulty) {
        errors.push(`faction ${factionId} difficulty mismatch`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateBuildings(
  planetId: number,
  buildings: StarMapData['starSystems'][number]['planetsTiles'][number]['buildings'],
  gridSize: number,
  errors: string[],
): void {
  const occupied = new Set<string>();
  for (const building of buildings) {
    if (!BUILDING_NAMES.has(building.name)) {
      errors.push(`planet ${planetId} has unknown building "${building.name}"`);
    }
    if (building.x < 0 || building.y < 0 || building.x + building.size > gridSize || building.y + building.size > gridSize) {
      errors.push(`planet ${planetId} building "${building.name}" is outside the surface grid`);
    }
    for (let dx = 0; dx < building.size; dx++) {
      for (let dy = 0; dy < building.size; dy++) {
        const key = `${building.x + dx}-${building.y + dy}`;
        if (occupied.has(key)) errors.push(`planet ${planetId} has overlapping buildings`);
        occupied.add(key);
      }
    }
  }
}

import researchTreeData from '../components/star-map/research-tree.json';
import shipData from '../components/star-map/ship-data.json';
import { isAiPersonality } from '../components/star-map/ai-personality';
import { beltObstacles } from '../components/star-map/asteroid-belts';
import { NavGraph } from '../components/star-map/fleet-navigation';
import { STARTING_TECHNOLOGIES } from '../services/galaxy-generator.service';
import { buildingNameForId } from './campaign-objectives';
import { ANOMALY_DEFINITIONS } from '../components/star-map/anomalies';
import { TUTORIAL_STEPS } from '../components/tutorial/tutorial-steps';
import { Condition, Effect, MissionDefinition } from './campaign.models';

/*
 * =========================================================
 * MISSION VALIDATION (pure)
 * =========================================================
 *
 * Mission maps are handcrafted, so the generator's validation
 * (galaxy-validation.ts: preset sizes, one centred black hole, …) does not
 * apply. These are the rules a mission must pass instead
 * (docs/campaign-design.md §12). Every mission has a spec that runs this,
 * plus validateSaveData on the built save.
 *
 * The relation rule matters most: `normalizeRelations` turns any missing
 * treaty pair into war, so a forgotten pair would silently start a war.
 */

/* Labels stay readable and systems distinct at this distance (generated maps use 22–30). */
export const MIN_MISSION_SYSTEM_SPACING = 15;
const MAX_PLANETS_PER_SYSTEM = 6;

interface TechnologyData {
  id: string;
  prerequisites: string[];
}

const TECHNOLOGIES = new Map(
  (researchTreeData as { technologies: TechnologyData[] }).technologies.map((t) => [t.id, t]),
);
const SHIP_TYPES = new Set((shipData as { shipTypes: { id: string }[] }).shipTypes.map((s) => s.id));
const NEUTRAL_IDS = new Set(['independent', 'unhabited']);

export function validateMission(mission: MissionDefinition): string[] {
  const errors: string[] = [];
  const err = (message: string) => errors.push(`${mission.id}: ${message}`);
  const map = mission.map;

  // --- Factions ---
  const factionIds = new Set<string>();
  for (const faction of map.factions) {
    if (factionIds.has(faction.id) || NEUTRAL_IDS.has(faction.id)) err(`duplicate or reserved faction id "${faction.id}"`);
    factionIds.add(faction.id);
    if (faction.kind === 'ai' && faction.personality !== undefined && !isAiPersonality(faction.personality)) {
      err(`faction "${faction.id}" has an unknown personality`);
    }
    if ((faction.kind === 'player') !== (faction.id === 'player')) err(`the player faction must be the one with id "player"`);
  }
  if (map.factions.filter((f) => f.kind === 'player').length !== 1) err('exactly one player faction is required');
  const knownFaction = (id: string) => factionIds.has(id) || NEUTRAL_IDS.has(id);

  // --- Map and systems ---
  if (!(map.width > 0 && map.height > 0) || map.width * 3 !== map.height * 5) {
    err(`map ${map.width}×${map.height} must be positive and 5:3 (the minimap is fixed)`);
  }
  const systemIds = new Set<string>();
  const planetNames = new Set<string>();
  for (const system of map.systems) {
    if (systemIds.has(system.id)) err(`duplicate system id "${system.id}"`);
    systemIds.add(system.id);
    if (system.x < 1 || system.y < 1 || system.x > map.width || system.y > map.height) err(`system "${system.id}" is outside the map`);
    if (system.planets.length < 1 || system.planets.length > MAX_PLANETS_PER_SYSTEM) {
      err(`system "${system.id}" needs 1–${MAX_PLANETS_PER_SYSTEM} planets`);
    }
    for (const planet of system.planets) {
      if (planetNames.has(planet.name)) err(`duplicate planet name "${planet.name}" (EconomyService resolves planets by name)`);
      planetNames.add(planet.name);
      if (planet.owner !== undefined && !knownFaction(planet.owner)) err(`planet "${planet.name}" has an unknown owner`);
      if (planet.civilization !== undefined && planet.owner !== 'independent') err(`civilization planet "${planet.name}" must be independent`);
      if (planet.layout && planet.layout !== 'none' && planet.owner === undefined) err(`planet "${planet.name}" has buildings but no owner`);
    }
  }
  for (let i = 0; i < map.systems.length; i++) {
    for (let j = i + 1; j < map.systems.length; j++) {
      const a = map.systems[i];
      const b = map.systems[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_MISSION_SYSTEM_SPACING) err(`systems "${a.id}" and "${b.id}" are too close`);
    }
  }
  if (!systemIds.has(map.defaultView.systemId) || !planetNames.has(map.defaultView.planetName)) err('defaultView must name an existing system and planet');

  // --- Fleets ---
  const fleetTags = new Set<string>();
  for (const fleet of map.fleets) {
    if (!factionIds.has(fleet.factionId)) err(`fleet "${fleet.name}" has an unknown faction`);
    for (const type of fleet.ships) if (!SHIP_TYPES.has(type)) err(`fleet "${fleet.name}" has an unknown ship type "${type}"`);
    if (fleet.ships.length === 0) err(`fleet "${fleet.name}" has no ships`);
    if (fleet.atPlanet !== undefined) {
      if (!planetNames.has(fleet.atPlanet)) err(`fleet "${fleet.name}" is at an unknown planet`);
    } else if (fleet.x === undefined || fleet.y === undefined || fleet.x < 1 || fleet.y < 1 || fleet.x > map.width || fleet.y > map.height) {
      err(`fleet "${fleet.name}" needs a cell inside the map or atPlanet`);
    }
    if (fleet.tag) fleetTags.add(fleet.tag);
  }

  // --- Anomalies and wormholes ---
  const anomalyKeys = new Set<string>();
  for (const anomaly of map.anomalies ?? []) {
    if (anomalyKeys.has(anomaly.key)) err(`duplicate anomaly key "${anomaly.key}"`);
    anomalyKeys.add(anomaly.key);
    if (!(anomaly.type in ANOMALY_DEFINITIONS)) err(`anomaly "${anomaly.key}" has an unknown type`);
    if (anomaly.systemId !== undefined) {
      if (!systemIds.has(anomaly.systemId)) err(`anomaly "${anomaly.key}" is in an unknown system`);
    } else if (anomaly.x === undefined || anomaly.y === undefined || anomaly.x < 1 || anomaly.y < 1 || anomaly.x > map.width || anomaly.y > map.height) {
      err(`anomaly "${anomaly.key}" needs a system or a cell inside the map`);
    }
  }
  const systemCells = new Set(map.systems.map((s) => `${Math.floor(s.x)}-${Math.floor(s.y)}`));
  const wormholeIds = new Set<string>();
  for (const wormhole of map.wormholes ?? []) {
    if (wormholeIds.has(wormhole.id)) err(`duplicate wormhole id "${wormhole.id}"`);
    wormholeIds.add(wormhole.id);
    for (const mouth of wormhole.mouths) {
      if (mouth.x < 1 || mouth.y < 1 || mouth.x > map.width || mouth.y > map.height) err(`wormhole "${wormhole.id}" has a mouth outside the map`);
      if (systemCells.has(`${Math.floor(mouth.x)}-${Math.floor(mouth.y)}`)) err(`wormhole "${wormhole.id}" has a mouth on a star system cell`);
    }
  }
  const tutorialIds = new Set(TUTORIAL_STEPS.map((s) => s.id));
  for (const id of mission.tutorialExcludedSteps ?? []) if (!tutorialIds.has(id)) err(`unknown tutorial step "${id}"`);

  // --- Relations: every treaty pair exactly once ---
  const treatyFactions = map.factions.filter((f) => f.kind !== 'outlaw').map((f) => f.id);
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const listed = new Set<string>();
  for (const relation of map.relations) {
    const key = pairKey(relation.a, relation.b);
    if (relation.a === relation.b || !treatyFactions.includes(relation.a) || !treatyFactions.includes(relation.b)) {
      err(`relation ${relation.a}–${relation.b} is not a pair of player/AI factions`);
    }
    if (listed.has(key)) err(`relation ${relation.a}–${relation.b} is listed twice`);
    listed.add(key);
  }
  for (let i = 0; i < treatyFactions.length; i++) {
    for (let j = i + 1; j < treatyFactions.length; j++) {
      if (!listed.has(pairKey(treatyFactions[i], treatyFactions[j]))) {
        err(`relation ${treatyFactions[i]}–${treatyFactions[j]} is missing (it would default to war)`);
      }
    }
  }

  // --- Research horizon ---
  const horizon = new Set(mission.researchHorizon);
  for (const id of STARTING_TECHNOLOGIES) if (!horizon.has(id)) err(`research horizon lacks the starting technology "${id}"`);
  const checkHorizon = (ids: Iterable<string>, label: string, extra: Set<string> = new Set()) => {
    for (const id of ids) {
      const tech = TECHNOLOGIES.get(id);
      if (!tech) { err(`${label}: unknown technology "${id}"`); continue; }
      for (const prerequisite of tech.prerequisites) {
        if (!horizon.has(prerequisite) && !extra.has(prerequisite)) err(`${label}: "${id}" needs "${prerequisite}", which is outside the horizon`);
      }
    }
  };
  checkHorizon(horizon, 'research horizon');
  for (const id of mission.baselineTechnologies) if (!horizon.has(id)) err(`baseline technology "${id}" is outside the horizon`);
  for (const [factionId, extras] of Object.entries(mission.horizonExtras ?? {})) {
    if (!factionIds.has(factionId)) err(`horizon extras for unknown faction "${factionId}"`);
    checkHorizon(extras, `horizon extras of ${factionId}`, new Set(extras));
  }
  for (const faction of map.factions) {
    const allowed = new Set([...horizon, ...(mission.horizonExtras?.[faction.id] ?? [])]);
    for (const id of faction.technologies ?? []) if (!allowed.has(id)) err(`faction "${faction.id}" starts with "${id}" outside its horizon`);
  }

  // --- Objectives, events, endings and their references ---
  const objectiveIds = new Set<string>();
  for (const objective of mission.objectives) {
    if (objectiveIds.has(objective.id)) err(`duplicate objective id "${objective.id}"`);
    objectiveIds.add(objective.id);
  }
  const eventIds = new Set<string>();
  for (const event of mission.events ?? []) {
    if (eventIds.has(event.id)) err(`duplicate event id "${event.id}"`);
    eventIds.add(event.id);
  }
  const endingIds = new Set<string>();
  for (const ending of mission.endings) {
    if (endingIds.has(ending.id)) err(`duplicate ending id "${ending.id}"`);
    endingIds.add(ending.id);
  }
  if (mission.endings.length === 0) err('a mission needs at least one ending');

  const heldIds = new Set<string>();
  const refs = { factionIds, systemIds, planetNames, objectiveIds, eventIds, endingIds, fleetTags, heldIds, anomalyKeys, wormholeIds };
  for (const objective of mission.objectives) {
    for (const id of objective.after ?? []) if (!objectiveIds.has(id)) err(`objective "${objective.id}" waits for unknown "${id}"`);
    checkCondition(objective.condition, refs, err);
    if (objective.failIf) checkCondition(objective.failIf, refs, err);
    checkEffects(objective.onComplete, refs, err);
    checkEffects(objective.onFail, refs, err);
  }
  for (const event of mission.events ?? []) {
    if (event.trigger) checkCondition(event.trigger, refs, err);
    for (const choice of event.choices ?? []) {
      checkEffects(choice.effects, refs, err);
      if (choice.requires) checkCondition(choice.requires, refs, err);
    }
  }
  for (const ending of mission.endings) checkCondition(ending.condition, refs, err);
  for (const defeat of mission.defeat ?? []) checkCondition(defeat.condition, refs, err);

  // --- Connectivity: every start reaches every system around the belts ---
  const graph = new NavGraph(beltObstacles(map.asteroidBelts ?? []), { width: map.width, height: map.height });
  const starts = map.systems.filter((s) => s.planets.some((p) => p.owner !== undefined && factionIds.has(p.owner)));
  for (const start of starts) {
    for (const target of map.systems) {
      if (target === start) continue;
      if (!graph.plan({ x: start.x, y: start.y }, { x: target.x, y: target.y }).ok) {
        err(`no route from "${start.id}" to "${target.id}" (asteroid belts)`);
      }
    }
  }
  return errors;
}

/* Campaign-wide rules: requirements exist and come earlier; horizons only grow. */
export function validateCampaign(missions: readonly MissionDefinition[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, MissionDefinition>();
  for (const mission of missions) {
    if (seen.has(mission.id)) errors.push(`duplicate mission id "${mission.id}"`);
    for (const id of mission.requires) {
      const required = seen.get(id);
      if (!required) {
        errors.push(`${mission.id}: requires "${id}", which is not an earlier mission`);
        continue;
      }
      const horizon = new Set(mission.researchHorizon);
      for (const tech of required.researchHorizon) {
        if (!horizon.has(tech)) errors.push(`${mission.id}: research horizon drops "${tech}" from ${id} (horizons must be cumulative)`);
      }
    }
    seen.set(mission.id, mission);
  }
  return errors;
}

interface Refs {
  factionIds: Set<string>;
  systemIds: Set<string>;
  planetNames: Set<string>;
  objectiveIds: Set<string>;
  eventIds: Set<string>;
  endingIds: Set<string>;
  fleetTags: Set<string>;
  heldIds: Set<string>;
  anomalyKeys: Set<string>;
  wormholeIds: Set<string>;
}

function checkCondition(condition: Condition, refs: Refs, err: (message: string) => void): void {
  const faction = (id: string | undefined) => {
    if (id !== undefined && !refs.factionIds.has(id) && !NEUTRAL_IDS.has(id)) err(`condition references unknown faction "${id}"`);
  };
  switch (condition.kind) {
    case 'all':
    case 'any':
      condition.of.forEach((c) => checkCondition(c, refs, err));
      return;
    case 'not':
      checkCondition(condition.of, refs, err);
      return;
    case 'objective_done':
      if (!refs.objectiveIds.has(condition.id)) err(`condition references unknown objective "${condition.id}"`);
      return;
    case 'system_charted':
      if (!refs.systemIds.has(condition.systemId)) err(`condition references unknown system "${condition.systemId}"`);
      return;
    case 'planets_owned':
      faction(condition.factionId);
      return;
    case 'planet_owned_by':
      if (!refs.planetNames.has(condition.planetName)) err(`condition references unknown planet "${condition.planetName}"`);
      faction(condition.factionId);
      return;
    case 'population_at_least':
      if (condition.planetName !== undefined && !refs.planetNames.has(condition.planetName)) err(`condition references unknown planet "${condition.planetName}"`);
      return;
    case 'building_complete':
      if (!buildingNameForId(condition.buildingId)) err(`condition references unknown building "${condition.buildingId}"`);
      if (condition.planetName !== undefined && !refs.planetNames.has(condition.planetName)) err(`condition references unknown planet "${condition.planetName}"`);
      return;
    case 'technology':
      if (!TECHNOLOGIES.has(condition.technologyId)) err(`condition references unknown technology "${condition.technologyId}"`);
      faction(condition.factionId);
      return;
    case 'fleet_tag_destroyed':
      if (!refs.fleetTags.has(condition.tag)) err(`condition references unknown fleet tag "${condition.tag}"`);
      return;
    case 'fleet_at':
    case 'fleet_with':
      faction(condition.factionId);
      for (const type of Object.keys(condition.ships ?? {})) if (!SHIP_TYPES.has(type)) err(`condition references unknown ship type "${type}"`);
      return;
    case 'opinion_at_least':
      faction(condition.holder);
      faction(condition.of);
      return;
    case 'relation':
      faction(condition.a);
      faction(condition.b);
      return;
    case 'mining_station':
      if (condition.systemId !== undefined && !refs.systemIds.has(condition.systemId)) err(`condition references unknown system "${condition.systemId}"`);
      return;
    case 'anomaly_resolved':
      if (!refs.anomalyKeys.has(condition.key)) err(`condition references unknown anomaly "${condition.key}"`);
      return;
    case 'held_for':
      // Timers are keyed by id: two conditions sharing one would share a timer.
      if (refs.heldIds.has(condition.id)) err(`held_for id "${condition.id}" is used twice`);
      refs.heldIds.add(condition.id);
      checkCondition(condition.condition, refs, err);
      return;
    default:
      return;
  }
}

function checkEffects(effects: readonly Effect[] | undefined, refs: Refs, err: (message: string) => void): void {
  for (const effect of effects ?? []) {
    switch (effect.kind) {
      case 'event':
        if (!refs.eventIds.has(effect.eventId)) err(`effect references unknown event "${effect.eventId}"`);
        break;
      case 'reveal_objective':
        if (!refs.objectiveIds.has(effect.id)) err(`effect references unknown objective "${effect.id}"`);
        break;
      case 'resources':
      case 'grant_technology':
        if (!refs.factionIds.has(effect.factionId)) err(`effect references unknown faction "${effect.factionId}"`);
        if (effect.kind === 'grant_technology' && !TECHNOLOGIES.has(effect.technologyId)) err(`effect grants unknown technology "${effect.technologyId}"`);
        break;
      case 'reveal_technology':
        for (const id of effect.technologyIds) if (!TECHNOLOGIES.has(id)) err(`effect reveals unknown technology "${id}"`);
        if (effect.factionId !== undefined && !refs.factionIds.has(effect.factionId)) err(`effect references unknown faction "${effect.factionId}"`);
        break;
      case 'wormhole_state':
        if (!refs.wormholeIds.has(effect.wormholeId)) err(`effect references unknown wormhole "${effect.wormholeId}"`);
        break;
      case 'end_mission':
        if (!refs.endingIds.has(effect.endingId)) err(`effect references unknown ending "${effect.endingId}"`);
        break;
      default:
        break;
    }
  }
}

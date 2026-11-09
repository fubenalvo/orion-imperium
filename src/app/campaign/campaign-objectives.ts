import { Anomaly, Faction, Fleet, StarSystem } from '../components/star-map/star-map.models';
import { isCombatShipType } from '../components/star-map/ai-queries';
import shipData from '../components/star-map/ship-data.json';
import { getRelationKind } from '../components/star-map/diplomacy';
import planetData from '../components/star-map/planet-data.json';
import { CampaignSessionState, Condition, ObjectiveDef, ProgressDef } from './campaign.models';

/*
 * =========================================================
 * CAMPAIGN OBJECTIVES (pure rules)
 * =========================================================
 *
 * Evaluates mission conditions against a world snapshot and the saved
 * session state (docs/campaign-design.md §12–§13). Called by CampaignService
 * once per economy tick and after events; nothing here runs per frame.
 *
 * The only mutation is `held_for` timers in `session.heldTimers`, which is
 * why evaluation takes the elapsed seconds. Composite conditions evaluate
 * every child (no short-circuit) so every nested timer advances on the same
 * ticks whatever the order of the children; the cost is irrelevant at 1 Hz.
 */

export interface CampaignWorld {
  gameSeconds: number;
  factions: readonly Faction[];
  starSystems: readonly StarSystem[];
  fleets: readonly Fleet[];
  /* Player-explored galaxy cells ("col-row"), StarMap.exploredGridCells. */
  exploredGridCells: ReadonlySet<string>;
  /* The session's anomalies (AnomalyService), for `anomaly_resolved`. */
  anomalies?: readonly Anomaly[];
}

export interface EvaluationContext {
  world: CampaignWorld;
  session: CampaignSessionState;
  /* Game seconds since the last evaluation (0 = evaluate without advancing timers). */
  dt: number;
}

const SHIP_TYPES: ReadonlyMap<string, { role: string }> = new Map(
  (shipData as { shipTypes: { id: string; role: string }[] }).shipTypes.map((s) => [s.id, s]),
);

const BUILDING_NAME_BY_ID: ReadonlyMap<string, string> = new Map(
  (planetData as { buildings: { id: string; name: string }[] }).buildings.map((b) => [b.id, b.name]),
);

export function buildingNameForId(id: string): string | undefined {
  return BUILDING_NAME_BY_ID.get(id);
}

export function systemCellKey(system: StarSystem): string {
  return `${system.gridCol ?? Math.floor(system.x)}-${system.gridRow ?? Math.floor(system.y)}`;
}

export function isSystemCharted(world: CampaignWorld, system: StarSystem): boolean {
  return world.exploredGridCells.has(systemCellKey(system));
}

export function evaluateCondition(condition: Condition, ctx: EvaluationContext): boolean {
  const { world, session } = ctx;
  switch (condition.kind) {
    case 'all': {
      const results = condition.of.map((c) => evaluateCondition(c, ctx));
      return results.every(Boolean);
    }
    case 'any': {
      const results = condition.of.map((c) => evaluateCondition(c, ctx));
      return results.some(Boolean);
    }
    case 'not':
      return !evaluateCondition(condition.of, ctx);
    case 'flag': {
      const value = session.flags[condition.flag];
      return condition.equals === undefined ? value !== undefined && value !== false : value === condition.equals;
    }
    case 'value_at_least':
      return (session.values[condition.key] ?? 0) >= condition.value;
    case 'objective_done':
      return session.objectives[condition.id]?.status === 'done';
    case 'game_time_at_least':
      return world.gameSeconds >= condition.seconds;
    case 'event_count':
      return (session.counters[condition.event] ?? 0) >= condition.atLeast;
    case 'system_charted': {
      const system = world.starSystems.find((s) => s.id === condition.systemId);
      return !!system && isSystemCharted(world, system);
    }
    case 'systems_charted':
      return chartedSystemCount(world) >= condition.count;
    case 'planets_owned':
      return ownedPlanetCount(world, condition.factionId ?? 'player') >= condition.count;
    case 'planet_owned_by':
      return findPlanet(world, condition.planetName)?.factionId === condition.factionId;
    case 'population_at_least':
      return playerPopulation(world, condition.planetName) >= condition.value;
    case 'building_complete':
      return completeBuildingCount(world, condition.buildingId, condition.planetName) >= (condition.count ?? 1);
    case 'technology': {
      const faction = world.factions.find((f) => f.id === (condition.factionId ?? 'player'));
      return !!faction?.researchedTechnologies?.includes(condition.technologyId);
    }
    case 'fleet_tag_destroyed': {
      const ids = session.fleetTags[condition.tag] ?? [];
      // A tag without fleets cannot be "destroyed": that is a data error, not a win.
      return ids.length > 0 && ids.every((id) => {
        const fleet = world.fleets.find((f) => f.id === id);
        return !fleet || fleet.destroyed === true || !fleet.ships.some((s) => s.destroyed !== true);
      });
    }
    case 'fleet_at':
      return world.fleets.some((fleet) => fleetMatches(fleet, condition));
    case 'fleet_with':
      return world.fleets.some((fleet) => fleetMatches(fleet, condition));
    case 'anomaly_resolved': {
      const anomaly = world.anomalies?.find((a) => a.key === condition.key);
      return anomaly?.status === 'resolved' && (condition.choiceId === undefined || anomaly.choiceId === condition.choiceId);
    }
    case 'opinion_at_least': {
      const holder = world.factions.find((f) => f.id === condition.holder);
      return (holder?.relations?.[condition.of]?.opinion ?? -Infinity) >= condition.value;
    }
    case 'relation': {
      const a = world.factions.find((f) => f.id === condition.a);
      const b = world.factions.find((f) => f.id === condition.b);
      return !!a && !!b && getRelationKind(a, b) === condition.state;
    }
    case 'held_for': {
      const holds = evaluateCondition(condition.condition, ctx);
      const held = holds ? (session.heldTimers[condition.id] ?? 0) + ctx.dt : 0;
      session.heldTimers[condition.id] = held;
      return holds && held >= condition.seconds;
    }
  }
}

/* "current / target" for the objective tracker; null when the objective has no progress. */
export function objectiveProgress(def: ObjectiveDef, world: CampaignWorld, session: CampaignSessionState): { current: number; target: number } | null {
  const progress: ProgressDef | undefined = def.progress;
  if (!progress) return null;
  let current: number;
  if (progress.metric === 'population') current = Math.floor(playerPopulation(world));
  else if (progress.metric === 'planets_owned') current = ownedPlanetCount(world, 'player');
  else if (progress.metric === 'systems_charted') current = chartedSystemCount(world);
  else current = session.values[progress.metric.value] ?? 0;
  return { current: Math.min(current, progress.target), target: progress.target };
}

function chartedSystemCount(world: CampaignWorld): number {
  return world.starSystems.filter((s) => isSystemCharted(world, s)).length;
}

function ownedPlanetCount(world: CampaignWorld, factionId: string): number {
  let count = 0;
  for (const system of world.starSystems) {
    for (const planet of system.planetsTiles) if (planet.factionId === factionId) count++;
  }
  return count;
}

function findPlanet(world: CampaignWorld, name: string) {
  for (const system of world.starSystems) {
    const planet = system.planetsTiles.find((p) => p.name === name);
    if (planet) return planet;
  }
  return undefined;
}

function playerPopulation(world: CampaignWorld, planetName?: string): number {
  let total = 0;
  for (const system of world.starSystems) {
    for (const planet of system.planetsTiles) {
      if (planet.factionId !== 'player') continue;
      if (planetName !== undefined && planet.name !== planetName) continue;
      total += planet.population ?? 0;
    }
  }
  return total;
}

/* Completed buildings of the player (construction sites do not count). */
function completeBuildingCount(world: CampaignWorld, buildingId: string, planetName?: string): number {
  const name = BUILDING_NAME_BY_ID.get(buildingId);
  if (!name) return 0;
  let count = 0;
  for (const system of world.starSystems) {
    for (const planet of system.planetsTiles) {
      if (planet.factionId !== 'player') continue;
      if (planetName !== undefined && planet.name !== planetName) continue;
      for (const building of planet.buildings ?? []) {
        if (building.name === name && !((building.constructionRemaining ?? 0) > 0)) count++;
      }
    }
  }
  return count;
}

function fleetMatches(fleet: Fleet, condition: Extract<Condition, { kind: 'fleet_at' | 'fleet_with' }>): boolean {
  if (fleet.destroyed || fleet.factionId !== (condition.factionId ?? 'player')) return false;
  if (condition.kind === 'fleet_at') {
    const radius = condition.radius ?? 0;
    if (Math.hypot(Math.floor(fleet.x) - condition.x, Math.floor(fleet.y) - condition.y) > radius) return false;
  }
  for (const [type, count] of Object.entries(condition.ships ?? {})) {
    const living = fleet.ships.filter((s) => s.type === type && s.destroyed !== true).length;
    if (living < count) return false;
  }
  if (condition.minCombatShips !== undefined) {
    const warships = fleet.ships.filter((s) => s.destroyed !== true && isCombatShipType(SHIP_TYPES.get(s.type))).length;
    if (warships < condition.minCombatShips) return false;
  }
  return true;
}

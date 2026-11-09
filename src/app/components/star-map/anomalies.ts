import {
  Anomaly,
  AnomalySite,
  AnomalyState,
  AnomalyType,
  AsteroidBelt,
  Faction,
  Fleet,
  SpecialObject,
  StarSystem,
} from './star-map.models';
import { StatefulRng } from './drifting-asteroids';
import { NavObstacle, buildNavObstacles, distanceToObstacleAxis } from './fleet-navigation';
import { beltObstacles } from './asteroid-belts';
import { systemCellAtVw } from './system-grid';
import { OUTPOST_SHIP_TYPE } from './space-base';
import type { Effect as CampaignEffect } from '../../campaign/campaign.models';

/*
 * =========================================================
 * EXPLORATION ANOMALIES (pure rules)
 * =========================================================
 *
 * Hidden anomalies wait in star systems, on in-system asteroids and in open
 * space. Full rules: docs/exploration-anomalies.md. This module holds the
 * data (event definitions, tuning) and the pure rules; AnomalyService owns
 * the live state and StarMap wires it into the game loop and the UI.
 *
 * - Generation is deterministic from the galaxy seed (own rng stream) and
 *   runs once per game: a new game gets it from SaveGameService.normalizeSave
 *   on its first load; afterwards the saved state is
 *   authoritative.
 * - Lifecycle: hidden → discovered → active → resolved (see AnomalyStatus).
 *   Only the human player discovers and triggers anomalies; AI fleets never
 *   touch them, so they can never open a player popup.
 * - An anomaly triggers exactly once: activation moves it out of the
 *   hidden/discovered states, and a choice can only be applied to an
 *   active anomaly, which it moves to resolved in the same step.
 * - Event content is data (ANOMALY_DEFINITIONS): each choice is a list of
 *   effects. New event types or choices only need new data, plus a new
 *   effect kind when they do something no existing effect does.
 */

export type AnomalyResource = 'credits' | 'rawmaterials' | 'research';

export type AnomalyEffect =
  /* Positive amount = reward, negative = cost (must be affordable). */
  | { kind: 'resource'; resource: AnomalyResource; amount: number }
  /* Opinion of the anomaly's AI empire (`Anomaly.factionId`) about the player. */
  | { kind: 'opinion'; amount: number }
  /* A ship of an existing type, handed over as a new player fleet at the triggering fleet. */
  | { kind: 'grant_ship'; shipTypeId: string }
  /* An ambush: the triggering fleet fights ANOMALY_CONFIG.pirateFleet on the battle screen. */
  | { kind: 'pirate_battle' }
  /*
   * Every living ship of the triggering fleet loses `fraction` of its type's
   * hull points, but keeps at least 1 HP: the effect never destroys a ship,
   * so it can be a cost without a resource check. The damage stays on the
   * ship (`Ship.currentHp`) until it is repaired at a Spaceport.
   */
  | { kind: 'fleet_damage'; fraction: number }
  /*
   * Campaign story effects (flags, granted technologies, revealed areas, …),
   * applied by CampaignService after the anomaly resolved. `summary` is the
   * player-facing consequence line. Only campaign anomalies use it.
   */
  | { kind: 'campaign'; effects: CampaignEffect[]; summary: string };

export interface AnomalyChoiceDef {
  id: string;
  label: string;
  effects: AnomalyEffect[];
  /* Short line shown after the choice was made. */
  outcome: string;
}

export interface AnomalyDefinition {
  name: string;
  /* Event category shown in the dialog. */
  category: string;
  description: string;
  choices: AnomalyChoiceDef[];
}

/*
 * Frequency and balance tuning. Changing a chance or weight changes which
 * anomalies new games get; saved games keep the anomalies they already have.
 */
export const ANOMALY_CONFIG = {
  generatorVersion: 1,
  /*
   * Densities raised on 2026-11-03 (system 0.2, asteroid 0.12, one space
   * anomaly per 4500 cells, max 14) because the early game had long empty
   * stretches between scouting arrivals. A small map now has ~10 open-space
   * anomalies instead of ~4.
   */
  /* Chance that an unclaimed star system hides an anomaly. */
  systemChance: 0.4,
  /* Chance that an unclaimed system's asteroid belt hides one (on one asteroid). */
  asteroidChance: 0.25,
  /* Open-space anomalies: one per this many map cells, clamped to the range below. */
  cellsPerSpaceAnomaly: 2000,
  spaceCount: { min: 4, max: 24 },
  /* Open-space anomalies keep this many cells from systems, obstacles and each other. */
  spaceSystemClearance: 3,
  spaceObstacleMargin: 2,
  spaceSpacing: 6,
  /* Relative type weights per site kind. */
  weights: {
    system: { ancient_wreck: 3, distress_signal: 3, pirate_trap: 2, derelict_outpost: 2 },
    asteroid: { ancient_wreck: 4, distress_signal: 1, pirate_trap: 2, derelict_outpost: 2 },
    space: { ancient_wreck: 2, distress_signal: 3, pirate_trap: 3, derelict_outpost: 1 },
  } as Record<AnomalySite['kind'], Partial<Record<AnomalyType, number>>>,
  /* Pirate ambush: a small fleet of existing ship types. */
  pirateFleet: ['fighter', 'fighter', 'corvette'] as readonly string[],
  pirateFactionName: 'Pirates',
  pirateFactionColor: '#c0392b',
  /*
   * Paid to the player when the ambush is beaten. Was 300 / 300, which was
   * worth less than a single lost frigate (180 credits / 540 raw).
   */
  pirateLoot: { credits: 2500, rawmaterials: 500 },
  /* Hull share every ship of the finder loses when it flees the ambush. */
  pirateFleeDamage: 0.4,
} as const;

export const ANOMALY_DEFINITIONS: Record<AnomalyType, AnomalyDefinition> = {
  /*
   * Campaign, Mission 1 (docs/campaign-design.md): the lost survey probe.
   * Both choices chart the lens at Kepler Deep (reveal_area) and set the
   * flag the mission's objective chain reads.
   */
  /*
   * Campaign, Mission 2: a repeating signal in open space. Triangulating it
   * charts the hidden Tessaly system; recording it is worth research.
   */
  echo_beacon: {
    name: 'Echo Beacon',
    category: 'Story',
    description:
      'A faint signal repeats every few seconds, too regular to be natural and too old to be human. ' +
      'Its echoes come back from somewhere inside the nebula to the north-east.',
    choices: [
      {
        id: 'triangulate',
        label: 'Triangulate the echoes',
        effects: [
          {
            kind: 'campaign',
            summary: 'Charts the source of the echoes',
            effects: [
              { kind: 'flag', flag: 'm2_echo_triangulated', value: true },
              { kind: 'reveal_area', x: 112, y: 22, radius: 7 },
            ],
          },
        ],
        outcome: 'The echoes converge on a star hidden in the nebula. Someone lives there.',
      },
      {
        id: 'record',
        label: 'Record it for analysis',
        effects: [{ kind: 'resource', resource: 'research', amount: 300 }],
        outcome: 'The science teams take the recording apart. Its structure is unlike any human code.',
      },
    ],
  },
  /*
   * Campaign, Mission 2 finale: the relay at Far Echo. Decoding it ends the
   * mission (an objective reads the resolved anomaly); both choices decode.
   */
  relay_signal: {
    name: 'The Relay',
    category: 'Story',
    description:
      'An ancient relay buoy hangs at the edge of Far Echo, still transmitting. Part of its message is new: ' +
      'a survey code that is not Remnant. Someone else has been here, and recently.',
    choices: [
      {
        id: 'decode',
        label: 'Decode the transmission',
        effects: [
          {
            kind: 'campaign',
            summary: 'Decodes the relay (mission objective)',
            effects: [{ kind: 'flag', flag: 'm2_relay_decoded', value: true }],
          },
        ],
        outcome: 'The survey code resolves into a name: the Concordium. We are not alone, and the gate was built.',
      },
      {
        id: 'study',
        label: 'Study the buoy itself',
        effects: [
          { kind: 'resource', resource: 'research', amount: 400 },
          {
            kind: 'campaign',
            summary: 'Decodes the relay (mission objective)',
            effects: [{ kind: 'flag', flag: 'm2_relay_decoded', value: true }],
          },
        ],
        outcome: 'The buoy is Remnant work, but its newest message was written by someone else: the Concordium.',
      },
    ],
  },
  probe_wreck: {
    name: 'Wreck of the Far Reach',
    category: 'Story',
    description:
      'The survey probe Far Reach drifts without power, its hull scored by something it flew too close to. ' +
      'Its last transmission is still in the buffer: a gravitational lens at Kepler Deep that should not exist.',
    choices: [
      {
        id: 'download',
        label: 'Download the flight logs',
        effects: [
          { kind: 'resource', resource: 'research', amount: 200 },
          {
            kind: 'campaign',
            summary: 'Charts the lens at Kepler Deep',
            effects: [
              { kind: 'flag', flag: 'm1_probe_logs', value: true },
              { kind: 'reveal_area', x: 82, y: 39, radius: 6 },
            ],
          },
        ],
        outcome: 'The logs map the lens in detail. Whatever it is, it is not natural.',
      },
      {
        id: 'recover',
        label: 'Recover the probe for parts',
        effects: [
          { kind: 'resource', resource: 'rawmaterials', amount: 300 },
          {
            kind: 'campaign',
            summary: 'Charts the lens at Kepler Deep',
            effects: [{ kind: 'reveal_area', x: 82, y: 39, radius: 6 }],
          },
        ],
        outcome: 'The salvage crews strip the probe. Its navigation core still points at Kepler Deep.',
      },
    ],
  },
  ancient_wreck: {
    name: 'Ancient Wreck',
    category: 'Derelict',
    description:
      'Sensors detect the remains of a vast vessel of unknown origin. Judging by its structure, ' +
      'the wreck could be thousands of years old.',
    choices: [
      {
        id: 'salvage',
        label: 'Salvage the wreck',
        effects: [{ kind: 'resource', resource: 'rawmaterials', amount: 800 }],
        outcome: 'Salvage crews strip the hull for usable materials.',
      },
      {
        id: 'study',
        label: 'Study it scientifically',
        effects: [{ kind: 'resource', resource: 'research', amount: 400 }],
        outcome: 'The science teams catalogue the alien technology.',
      },
    ],
  },
  distress_signal: {
    name: 'Distress Signal',
    category: 'Encounter',
    description:
      'The fleet picks up a faint distress call. A stranded crew of a foreign empire is running out ' +
      'of air and power and begs for help.',
    choices: [
      {
        id: 'assist',
        label: 'Send assistance',
        effects: [
          { kind: 'resource', resource: 'credits', amount: -200 },
          { kind: 'opinion', amount: 15 },
        ],
        outcome: 'The survivors are rescued and sent home.',
      },
      {
        id: 'ignore',
        label: 'Ignore the signal',
        effects: [],
        outcome: 'The fleet moves on. The signal fades behind it.',
      },
    ],
  },
  pirate_trap: {
    name: 'Pirate Ambush',
    category: 'Hostile',
    description:
      'The suspicious beacon was bait. Pirate raiders drop their stealth screens and close in on the fleet.',
    choices: [
      {
        id: 'fight',
        label: 'Battle stations!',
        effects: [{ kind: 'pirate_battle' }],
        outcome: 'The fleet turns to face the raiders.',
      },
      {
        id: 'flee',
        label: 'Break off and flee',
        effects: [{ kind: 'fleet_damage', fraction: ANOMALY_CONFIG.pirateFleeDamage }],
        outcome: 'The fleet escapes under fire, its hulls scorched. The pirates keep their loot.',
      },
    ],
  },
  derelict_outpost: {
    name: 'Abandoned Outpost Ship',
    category: 'Derelict',
    description:
      'An outpost ship drifts silently, its crew long gone. Its systems still respond: with a ' +
      'prize crew it could fly again.',
    choices: [
      {
        id: 'claim',
        label: 'Claim the ship',
        effects: [{ kind: 'grant_ship', shipTypeId: OUTPOST_SHIP_TYPE }],
        outcome: 'A prize crew brings the outpost ship back online.',
      },
      {
        id: 'leave',
        label: 'Leave it adrift',
        effects: [],
        outcome: 'The fleet leaves the derelict behind.',
      },
    ],
  },
};

/* The random exploration events. Campaign story anomalies are never generated. */
export const ANOMALY_TYPES: readonly AnomalyType[] = ['ancient_wreck', 'distress_signal', 'pirate_trap', 'derelict_outpost'];

/* ---------- Generation ---------- */

export interface AnomalyGenerationInput {
  seed: number;
  width: number;
  height: number;
  starSystems: StarSystem[];
  factions: Faction[];
  fleets?: Fleet[];
  specialObjects?: readonly SpecialObject[];
  asteroidBelts?: readonly AsteroidBelt[];
}

/* AI empires that can send a distress signal. */
function distressSenders(factions: Faction[]): Faction[] {
  return factions
    .filter((f) => f && f.ai === true && f.team !== 0 && typeof f.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id));
}

function pickType(rng: StatefulRng, kind: AnomalySite['kind'], allowDistress: boolean): AnomalyType {
  const weights = ANOMALY_CONFIG.weights[kind];
  const types = ANOMALY_TYPES.filter((t) => (weights[t] ?? 0) > 0 && (allowDistress || t !== 'distress_signal'));
  const total = types.reduce((sum, t) => sum + (weights[t] ?? 0), 0);
  let roll = rng.next() * total;
  for (const type of types) {
    roll -= weights[type] ?? 0;
    if (roll < 0) return type;
  }
  return types[types.length - 1];
}

/*
 * The deterministic anomaly set of a galaxy. Systems with a planet of a major
 * (non-neutral) faction are skipped, so nobody starts next to one, and so
 * are cells where a fleet already stands (a backfilled save must not fire
 * an event the moment it loads).
 */
export function generateAnomalies(input: AnomalyGenerationInput): AnomalyState {
  const cfg = ANOMALY_CONFIG;
  const rng = new StatefulRng(((input.seed >>> 0) ^ 0x6a09e667) | 0);
  const majors = new Set(input.factions.filter((f) => f && f.team !== 0).map((f) => f.id));
  const occupied = new Set(
    (input.fleets ?? []).filter((f) => f && !f.destroyed).map((f) => `${Math.floor(f.x)}-${Math.floor(f.y)}`),
  );
  const senders = distressSenders(input.factions);
  const anomalies: Anomaly[] = [];

  const add = (type: AnomalyType, site: AnomalySite): void => {
    const anomaly: Anomaly = { id: anomalies.length + 1, type, site, status: 'hidden' };
    if (type === 'distress_signal') {
      anomaly.factionId = senders[Math.floor(rng.next() * senders.length)].id;
    }
    anomalies.push(anomaly);
  };

  const systems = [...input.starSystems]
    .filter((s) => s && typeof s.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const system of systems) {
    // Both rolls happen for every system so one system's outcome never
    // shifts the stream of the next.
    const systemRoll = rng.next();
    const asteroidRoll = rng.next();
    const asteroidPick = rng.next();
    const claimed = (system.planetsTiles ?? []).some((p) => majors.has(p.factionId));
    const x = Math.floor(system.x);
    const y = Math.floor(system.y);
    if (claimed || occupied.has(`${x}-${y}`)) continue;
    if (systemRoll < cfg.systemChance) {
      add(pickType(rng, 'system', senders.length > 0), { kind: 'system', x, y, systemId: system.id });
    }
    const rocks = system.asteroidBelt?.asteroids ?? [];
    if (asteroidRoll < cfg.asteroidChance && rocks.length > 0) {
      const rock = rocks[Math.floor(asteroidPick * rocks.length)];
      add(pickType(rng, 'asteroid', senders.length > 0), {
        kind: 'asteroid',
        x,
        y,
        systemId: system.id,
        col: rock.col,
        row: rock.row,
      });
    }
  }

  const obstacles: NavObstacle[] = [...buildNavObstacles(input.specialObjects), ...beltObstacles(input.asteroidBelts)];
  const target = Math.round(
    Math.min(cfg.spaceCount.max, Math.max(cfg.spaceCount.min, (input.width * input.height) / cfg.cellsPerSpaceAnomaly)),
  );
  const placed: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < target * 30 && placed.length < target && input.width > 4 && input.height > 4; attempt++) {
    const x = 2 + Math.floor(rng.next() * (input.width - 3));
    const y = 2 + Math.floor(rng.next() * (input.height - 3));
    const p = { x: x + 0.5, y: y + 0.5 };
    if (occupied.has(`${x}-${y}`)) continue;
    if (systems.some((s) => Math.hypot(s.x - x, s.y - y) < cfg.spaceSystemClearance)) continue;
    if (obstacles.some((o) => distanceToObstacleAxis(p, o) < o.radius + cfg.spaceObstacleMargin)) continue;
    if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < cfg.spaceSpacing)) continue;
    placed.push({ x, y });
    add(pickType(rng, 'space', senders.length > 0), { kind: 'space', x, y });
  }

  return { version: cfg.generatorVersion, nextSeq: 1, anomalies };
}

/* ---------- Save restore ---------- */

const STATUSES = new Set(['hidden', 'discovered', 'active', 'resolved']);
const SITE_KINDS = new Set(['system', 'asteroid', 'space']);

export function isWellFormedAnomaly(value: unknown): value is Anomaly {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<Anomaly>;
  const site = a.site as Partial<AnomalySite> | undefined;
  return (
    Number.isInteger(a.id) &&
    typeof a.type === 'string' &&
    a.type in ANOMALY_DEFINITIONS &&
    typeof a.status === 'string' &&
    STATUSES.has(a.status) &&
    !!site &&
    typeof site === 'object' &&
    typeof site.kind === 'string' &&
    SITE_KINDS.has(site.kind) &&
    Number.isFinite(site.x) &&
    Number.isFinite(site.y) &&
    (site.kind !== 'asteroid' || (typeof site.systemId === 'string' && Number.isInteger(site.col) && Number.isInteger(site.row))) &&
    (site.kind !== 'system' || typeof site.systemId === 'string')
  );
}

/*
 * Cleans a saved state: malformed anomalies are dropped (they can not be
 * repaired meaningfully), an active anomaly without a fleet id falls back to
 * discovered. Returns null when the value is not an anomaly state at all.
 */
export function sanitizeAnomalyState(saved: unknown): AnomalyState | null {
  if (!saved || typeof saved !== 'object' || !Array.isArray((saved as AnomalyState).anomalies)) return null;
  const state = saved as AnomalyState;
  const anomalies = state.anomalies.filter(isWellFormedAnomaly).map((a) => structuredClone(a));
  for (const anomaly of anomalies) {
    if (anomaly.status === 'active' && !Number.isInteger(anomaly.fleetId)) {
      anomaly.status = 'discovered';
      delete anomaly.fleetId;
      delete anomaly.activatedSeq;
    }
  }
  const maxSeq = anomalies.reduce((max, a) => Math.max(max, a.activatedSeq ?? 0), 0);
  return {
    version: Number.isInteger(state.version) ? state.version : ANOMALY_CONFIG.generatorVersion,
    nextSeq: Number.isInteger(state.nextSeq) && state.nextSeq > maxSeq ? state.nextSeq : maxSeq + 1,
    anomalies,
  };
}

/* ---------- Discovery and activation ---------- */

export function isAnomalyOpen(anomaly: Anomaly): boolean {
  return anomaly.status === 'hidden' || anomaly.status === 'discovered';
}

/*
 * Marks hidden anomalies whose galaxy cell the player has explored (cell
 * keys `${col}-${row}`, the explored-cell format of StarMapSensorService).
 * Returns the newly discovered ones.
 */
export function discoverAnomalies(state: AnomalyState, exploredCells: ReadonlySet<string>): Anomaly[] {
  const found: Anomaly[] = [];
  for (const anomaly of state.anomalies) {
    if (anomaly.status === 'hidden' && exploredCells.has(`${anomaly.site.x}-${anomaly.site.y}`)) {
      anomaly.status = 'discovered';
      found.push(anomaly);
    }
  }
  return found;
}

/*
 * Has this fleet reached the anomaly's site? (rules: AnomalySite)
 * - system: the fleet stands on the system cell with no galaxy order left
 *   (passing through does not count);
 * - asteroid: the fleet is inside that system on the asteroid's cell (same
 *   rule as surveying, system-asteroids.ts);
 * - space: the fleet is on the cell, moving or not.
 */
export function isFleetAtAnomaly(fleet: Fleet, anomaly: Anomaly): boolean {
  const site = anomaly.site;
  const onCell = Math.floor(fleet.x) === site.x && Math.floor(fleet.y) === site.y;
  switch (site.kind) {
    case 'space':
      return onCell;
    case 'system':
      return onCell && ((fleet.targetX === null && fleet.targetY === null) || fleet.system?.id === site.systemId);
    case 'asteroid': {
      if (!fleet.system || fleet.system.id !== site.systemId) return false;
      const cell = systemCellAtVw(fleet.system.x, fleet.system.y);
      return cell.col === site.col && cell.row === site.row;
    }
  }
}

function canTrigger(fleet: Fleet, playerFactionId: string): boolean {
  return fleet.factionId === playerFactionId && !fleet.destroyed && (fleet.ships ?? []).some((s) => !s.destroyed);
}

/*
 * Activates every open anomaly a living player fleet has reached (lowest
 * fleet id wins when several are there). Returns the newly activated ones.
 */
export function activateAnomalies(state: AnomalyState, fleets: Fleet[], playerFactionId = 'player'): Anomaly[] {
  const candidates = fleets.filter((f) => canTrigger(f, playerFactionId)).sort((a, b) => a.id - b.id);
  if (candidates.length === 0) return [];
  const activated: Anomaly[] = [];
  for (const anomaly of state.anomalies) {
    if (!isAnomalyOpen(anomaly)) continue;
    const fleet = candidates.find((f) => isFleetAtAnomaly(f, anomaly));
    if (!fleet) continue;
    anomaly.status = 'active';
    anomaly.fleetId = fleet.id;
    anomaly.activatedSeq = state.nextSeq++;
    activated.push(anomaly);
  }
  return activated;
}

/*
 * An active event whose fleet is gone (destroyed, disbanded, merged away)
 * returns to discovered, so another fleet can trigger it later.
 */
export function releaseOrphanedAnomalies(state: AnomalyState, fleets: Fleet[], playerFactionId = 'player'): Anomaly[] {
  const released: Anomaly[] = [];
  for (const anomaly of state.anomalies) {
    if (anomaly.status !== 'active') continue;
    const fleet = fleets.find((f) => f.id === anomaly.fleetId);
    if (fleet && canTrigger(fleet, playerFactionId)) continue;
    anomaly.status = 'discovered';
    delete anomaly.fleetId;
    delete anomaly.activatedSeq;
    released.push(anomaly);
  }
  return released;
}

/* The pending event to show: the oldest active anomaly. */
export function nextActiveAnomaly(state: AnomalyState): Anomaly | null {
  let best: Anomaly | null = null;
  for (const anomaly of state.anomalies) {
    if (anomaly.status !== 'active') continue;
    if (!best || (anomaly.activatedSeq ?? 0) < (best.activatedSeq ?? 0)) best = anomaly;
  }
  return best;
}

/* ---------- Choices ---------- */

/* What a choice costs (the negative resource effects, as positive amounts). */
export function choiceCost(choice: AnomalyChoiceDef): Partial<Record<AnomalyResource, number>> {
  const cost: Partial<Record<AnomalyResource, number>> = {};
  for (const effect of choice.effects) {
    if (effect.kind === 'resource' && effect.amount < 0) {
      cost[effect.resource] = (cost[effect.resource] ?? 0) - effect.amount;
    }
  }
  return cost;
}

export const RESOURCE_LABELS: Record<AnomalyResource, string> = {
  credits: 'credits',
  rawmaterials: 'raw materials',
  research: 'RP',
};

/* Why the faction can not pay for this choice, or null when it can. */
export function choiceBlockReason(choice: AnomalyChoiceDef, faction: Faction | undefined): string | null {
  if (!faction) return 'No player empire.';
  for (const [resource, amount] of Object.entries(choiceCost(choice)) as [AnomalyResource, number][]) {
    const have = faction.currencies[resource] ?? 0;
    if (have < amount) {
      return `Not enough ${RESOURCE_LABELS[resource]}: needs ${amount.toLocaleString('en-US')}, ` +
        `you have ${Math.floor(have).toLocaleString('en-US')}.`;
    }
  }
  return null;
}

/*
 * Is the anomaly's AI empire still in the game? A distress signal improves
 * relations only with an empire that exists and still holds a planet or a
 * living fleet; otherwise the "assist" choice has no diplomatic effect.
 */
export function anomalySender(
  anomaly: Anomaly,
  factions: Faction[],
  starSystems: StarSystem[],
  fleets: Fleet[],
): Faction | null {
  if (!anomaly.factionId) return null;
  const faction = factions.find((f) => f.id === anomaly.factionId && f.ai === true);
  if (!faction) return null;
  const hasPlanet = starSystems.some((s) => (s.planetsTiles ?? []).some((p) => p.factionId === faction.id));
  const hasFleet = fleets.some((f) => f.factionId === faction.id && !f.destroyed && f.ships.some((s) => !s.destroyed));
  return hasPlanet || hasFleet ? faction : null;
}

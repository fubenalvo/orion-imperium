import {
  AiDifficulty,
  AiPersonality,
  AnomalyType,
  AsteroidBelt,
  Nebula,
  PlanetSize,
  PlanetType,
  Wormhole,
} from '../components/star-map/star-map.models';

/*
 * =========================================================
 * STORY CAMPAIGN — DATA MODEL
 * =========================================================
 *
 * Design: docs/campaign-design.md (§12–§14). Three kinds of data:
 *
 * - MissionDefinition: authored, typed mission data in campaign/missions/.
 *   Data only (no functions), so missions stay declarative and testable.
 * - CampaignSessionState: the running mission's state, saved in
 *   StarMapData.campaign. It is everything the engine needs at runtime
 *   besides the definition (statuses, flags, timers, rules copied at build
 *   time), so save/load and the battle-screen round trip need nothing else.
 * - CampaignProgress: unlocks and results across missions, stored outside
 *   save slots (CampaignProgressService).
 *
 * Objective and event definitions are looked up from the mission registry
 * by id; the save only holds their state. A save made with an older mission
 * definition keeps loading: unknown ids are dropped, new ones start from
 * their default status (CampaignService.restore).
 */

export type FlagValue = string | number | boolean;

/* Counted events (CampaignService.notify) that conditions can read later. */
export type CampaignEventKind =
  | 'battle_won'
  | 'battle_lost'
  | 'technology_researched'
  | 'building_placed'
  | 'fleet_assembled'
  | 'planet_colonized'
  | 'war_declared'
  | 'peace_signed';

/*
 * Conditions are evaluated once per economy tick (1 s of game time) and on
 * events, never per frame. State conditions read the live world; event
 * conditions read the saved counters. `held_for` keeps a timer in the
 * session (keyed by its `id`) that advances while its inner condition holds
 * and resets when it fails.
 */
export type Condition =
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; of: Condition }
  | { kind: 'flag'; flag: string; equals?: FlagValue }
  | { kind: 'value_at_least'; key: string; value: number }
  | { kind: 'objective_done'; id: string }
  | { kind: 'game_time_at_least'; seconds: number }
  | { kind: 'event_count'; event: CampaignEventKind; atLeast: number }
  | { kind: 'system_charted'; systemId: string }
  | { kind: 'systems_charted'; count: number }
  | { kind: 'planets_owned'; count: number; factionId?: string }
  | { kind: 'planet_owned_by'; planetName: string; factionId: string }
  | { kind: 'population_at_least'; value: number; planetName?: string }
  | { kind: 'building_complete'; buildingId: string; count?: number; planetName?: string }
  | { kind: 'technology'; technologyId: string; factionId?: string }
  | { kind: 'fleet_tag_destroyed'; tag: string }
  /* `minCombatShips`: living warships (not scouts, colonizers or outpost ships) in the fleet. */
  | { kind: 'fleet_at'; x: number; y: number; radius?: number; ships?: Record<string, number>; minCombatShips?: number; factionId?: string }
  /* A player fleet anywhere with at least these ships / warships. */
  | { kind: 'fleet_with'; ships?: Record<string, number>; minCombatShips?: number; factionId?: string }
  /* The player owns a mining station (complete or under construction), optionally in a given system. */
  | { kind: 'mining_station'; systemId?: string }
  /* A campaign anomaly (by its mission key) was resolved, optionally with this choice. */
  | { kind: 'anomaly_resolved'; key: string; choiceId?: string }
  | { kind: 'opinion_at_least'; holder: string; of: string; value: number }
  | { kind: 'relation'; a: string; b: string; state: 'war' | 'peace' }
  | { kind: 'held_for'; id: string; seconds: number; condition: Condition };

export type Effect =
  | { kind: 'notice'; text: string }
  | { kind: 'event'; eventId: string }
  | { kind: 'flag'; flag: string; value: FlagValue }
  | { kind: 'value'; key: string; delta: number }
  | { kind: 'reveal_objective'; id: string }
  | { kind: 'resources'; factionId: string; credits?: number; rawmaterials?: number; research?: number }
  | { kind: 'grant_technology'; factionId: string; technologyId: string }
  | { kind: 'reveal_technology'; technologyIds: string[]; factionId?: string }
  /* Marks the galaxy cells within `radius` of (x, y) as explored by the player. */
  | { kind: 'reveal_area'; x: number; y: number; radius: number }
  | { kind: 'end_mission'; endingId: string }
  | { kind: 'fail_mission'; reason: string };

export interface ProgressDef {
  label: string;
  /* What the tracker shows as "current / target"; computed from the world. */
  metric: 'population' | 'planets_owned' | 'systems_charted' | { value: string };
  target: number;
}

export interface ObjectiveDef {
  id: string;
  title: string;
  description?: string;
  /* Active only once all of these are done (sequential chains). */
  after?: string[];
  optional?: boolean;
  /* Not listed until revealed by an effect or by becoming active. */
  hidden?: boolean;
  condition: Condition;
  progress?: ProgressDef;
  /* Fails when it is still open this long after it became active. */
  timeLimitSeconds?: number;
  failIf?: Condition;
  onComplete?: Effect[];
  onFail?: Effect[];
}

export interface StoryChoiceDef {
  id: string;
  label: string;
  consequences: string;
  effects: Effect[];
  requires?: Condition;
}

export interface StoryEventDef {
  id: string;
  /* Fires once when true; without a trigger only an `event` effect fires it. */
  trigger?: Condition;
  speaker: string;
  /* Overrides for speakers that are not factions (a civilization, a station). */
  speakerName?: string;
  speakerColor?: string;
  title: string;
  text: string;
  /* Modal dialog (pauses) vs a map notice. Choices force a dialog. */
  pause: boolean;
  choices?: StoryChoiceDef[];
}

export interface EndingDef {
  id: string;
  title: string;
  debrief: string;
  condition: Condition;
  /* Written to the campaign progress on victory; read by later missions. */
  records?: Record<string, FlagValue>;
  /* Session flags copied into the records when set (choices made during the mission). */
  recordFlags?: string[];
  /* Session values copied into the records (e.g. a standing), under the same key. */
  recordValues?: string[];
}

export interface MissionRules {
  /* Conquest / diplomatic victory also ends the mission (as an extra ending). */
  standardVictory: boolean;
  /* Pirate incursions (PirateIncursionService) on or off. */
  pirates: boolean;
  /* Tutorial hints on at the start (the player can still turn them off). */
  tutorial?: boolean;
}

/* An authored campaign anomaly; the builder turns it into an AnomalyState entry. */
export interface MissionAnomalySpec {
  key: string;
  type: AnomalyType;
  /* A star system site (its cell) or an open-space cell. */
  systemId?: string;
  x?: number;
  y?: number;
}

/* ---------- Map spec ---------- */

export interface MissionFactionSpec {
  id: string;
  name: string;
  color: string;
  kind: 'player' | 'ai' | 'outlaw';
  personality?: AiPersonality;
  /* Pinned difficulty; otherwise the campaign difficulty chosen at start. */
  difficulty?: AiDifficulty;
  currencies: { credits: number; rawmaterials: number; research: number };
  /* Technologies besides the four basics (the player: the baseline set). */
  technologies?: string[];
}

/* Starting buildings: the generator's templates, or an independent civilization's capital. */
export type MissionPlanetLayout = 'homeworld' | 'colony' | 'civilization_capital' | 'none';

export interface MissionPlanetSpec {
  name: string;
  type: PlanetType;
  size: PlanetSize;
  owner?: string;
  civilization?: string;
  population?: number;
  /* Starting buildings (centered on the surface). */
  layout?: MissionPlanetLayout;
  /* Satisfaction at start (civilizations use 60); missing = 100. */
  satisfaction?: number;
  /* A raw-material deposit next to free ground from the start (like homeworlds). */
  deposit?: boolean;
  explored?: boolean;
}

export interface MissionSystemSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  planets: MissionPlanetSpec[];
  /* Not drawn until the player's sensors reach it (StarSystem.explored false). */
  hidden?: boolean;
  /*
   * A resource-rich in-system belt: the first asteroids of the system's
   * deterministic belt get these deposits (raw materials each).
   */
  richAsteroids?: number[];
}

export interface MissionFleetSpec {
  name: string;
  factionId: string;
  /* Galaxy cell, or the homeworld spot of `atPlanet` (the generator's player placement). */
  x?: number;
  y?: number;
  atPlanet?: string;
  ships: string[];
  speed?: number;
  /* Objectives refer to authored fleets by tag (fleet ids are assigned by the builder). */
  tag?: string;
}

export interface MissionRelationSpec {
  a: string;
  b: string;
  state: 'war' | 'peace';
  /* Opinion both ways unless `opinionBA` is given. */
  opinion?: number;
  opinionBA?: number;
}

export interface MissionMapSpec {
  width: number;
  height: number;
  factions: MissionFactionSpec[];
  systems: MissionSystemSpec[];
  fleets: MissionFleetSpec[];
  nebulae?: Nebula[];
  asteroidBelts?: AsteroidBelt[];
  wormholes?: Wormhole[];
  anomalies?: MissionAnomalySpec[];
  /* Every pair of non-neutral, non-outlaw factions, symmetric (validated). */
  relations: MissionRelationSpec[];
  defaultView: { systemId: string; planetName: string };
}

export interface MissionDefinition {
  id: string;
  /* Bumped when objectives or the map change; stored in saves. */
  version: number;
  /* Developer / test missions: never listed on the campaign screen. */
  devOnly?: boolean;
  title: string;
  subtitle: string;
  briefing: string[];
  /* Fixed: the same map and terrain on every replay. */
  seed: number;
  /* Missions that must be completed first (any ending). */
  requires: string[];
  map: MissionMapSpec;
  rules: MissionRules;
  objectives: ObjectiveDef[];
  events?: StoryEventDef[];
  endings: EndingDef[];
  /* In addition to the standard elimination defeat. */
  defeat?: { condition: Condition; reason: string }[];
  /* Technologies that exist in this mission (cumulative, prerequisite-closed). */
  researchHorizon: string[];
  /* Every player start includes these, whatever was carried. */
  baselineTechnologies: string[];
  /* Per-faction extra horizon entries. */
  horizonExtras?: Record<string, string[]>;
  /* Flags this mission reads, with defaults so it is playable standalone. */
  carryIn?: Record<string, FlagValue>;
  /* Tutorial steps that make no sense here (tutorial-steps.ts ids), e.g. 'diplomacy' without empires. */
  tutorialExcludedSteps?: string[];
}

/* ---------- Runtime state (saved) ---------- */

export type ObjectiveStatus = 'locked' | 'active' | 'done' | 'failed';

export interface ObjectiveState {
  status: ObjectiveStatus;
  revealed?: boolean;
  /* Seconds since the objective became active (timed objectives). */
  elapsed?: number;
}

export interface CampaignOutcome {
  kind: 'victory' | 'defeat';
  endingId?: string;
  reason?: string;
}

/* StarMapData.campaign — optional and additive (no SAVE_VERSION bump). */
export interface CampaignSessionState {
  version: 1;
  missionId: string;
  missionVersion: number;
  difficulty: AiDifficulty;
  /* What the start took from earlier missions; RESTART MISSION rebuilds with it. */
  carry: MissionCarry;
  rules: MissionRules;
  flags: Record<string, FlagValue>;
  values: Record<string, number>;
  counters: Partial<Record<CampaignEventKind, number>>;
  objectives: Record<string, ObjectiveState>;
  heldTimers: Record<string, number>;
  firedEvents: string[];
  /* Modal events waiting to be shown, oldest first. */
  pendingEvents: string[];
  fleetTags: Record<string, number[]>;
  researchHorizon: string[];
  horizonExtras: Record<string, string[]>;
  outcome?: CampaignOutcome;
}

/* ---------- Progress (outside saves) ---------- */

export interface MissionRecord {
  completedAt: string;
  endingId: string;
  difficulty: AiDifficulty;
  records: Record<string, FlagValue>;
  /* The player's technologies at the end, carried into later missions. */
  researchedTechnologies: string[];
}

export interface CampaignProgress {
  version: 1;
  lastDifficulty: AiDifficulty;
  missions: Record<string, MissionRecord>;
}

/* What a mission start takes from earlier missions. */
export interface MissionCarry {
  flags: Record<string, FlagValue>;
  technologies: string[];
}

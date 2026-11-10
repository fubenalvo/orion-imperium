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
import type { DemandKind } from '../components/star-map/diplomatic-demand';
import type { DysonPlan } from '../components/star-map/enemy-dyson.service';

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

/*
 * Counted events (CampaignService.notify) that conditions can read later.
 * Events about another empire are also counted per empire under
 * "<kind>:<factionId>" (battle_won:varkon, demand_paid:varkon), so a
 * condition can ask for either the total or one empire's count.
 * - battle_won / battle_lost: the opponent's faction;
 * - war_declared / peace_signed: the other side of the player's treaty;
 * - demand_paid / demand_refused: the empire that demanded from the player;
 * - planet_lost: the player's planet now owned by that faction (any reason);
 * - trader_lost: a player trader destroyed in a raid, by the raider's faction;
 * - site_claimed: a campaign site claimed, by the claimant (any faction).
 */
export type CampaignEventKind =
  | 'battle_won'
  | 'battle_lost'
  | 'technology_researched'
  | 'building_placed'
  | 'fleet_assembled'
  | 'planet_colonized'
  | 'war_declared'
  | 'peace_signed'
  | 'demand_paid'
  | 'demand_refused'
  | 'planet_lost'
  | 'trader_lost'
  | 'site_claimed';

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
  /* `factionId`: only the events about that empire (see CampaignEventKind). */
  | { kind: 'event_count'; event: CampaignEventKind; atLeast: number; factionId?: string }
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
  /* The player owns `count` (default 1) mining stations (complete or under construction), optionally in one system. */
  | { kind: 'mining_station'; systemId?: string; count?: number }
  /* No space base with this name exists any more (bases are removed when destroyed). */
  | { kind: 'base_destroyed'; name: string }
  /*
   * At least `count` of these systems are controlled by the faction: its
   * territory claims the system (planet majority, or a space base's claim
   * over an unsettled system; TerritoryMap.systemTerritoryOwner).
   */
  | { kind: 'systems_controlled'; systemIds: string[]; count: number; factionId?: string }
  /* `holder`'s war exhaustion in its war with `against` (0 at peace). */
  | { kind: 'war_exhaustion_at_least'; holder: string; against: string; value: number }
  /* A campaign site was claimed (by this faction, or by anyone). */
  | { kind: 'site_claimed'; siteId: string; factionId?: string }
  /* At least `count` of these sites are claimed by the faction (default the player), any of `factionIds`, or any AI. */
  | { kind: 'sites_claimed'; siteIds: string[]; count: number; factionId?: string; factionIds?: string[]; anyAi?: boolean }
  /*
   * The Dyson warm-up (dyson-victory.ts): running or completed, by `holder`
   * (a faction id or `coalition:<id>`), or by anyone not in `notHolders`.
   */
  | { kind: 'dyson_warmup'; state: 'running' | 'completed'; holder?: string; notHolders?: string[] }
  /*
   * Completed Dyson anchors on the ring, of these factions (default: any):
   * openers, Dampeners or both; at least / at most this many.
   */
  | { kind: 'anchors'; factionIds?: string[]; anchorKind?: 'opener' | 'dampener' | 'any'; atLeast?: number; atMost?: number }
  /* A campaign anomaly (by its mission key) was resolved, optionally with this choice. */
  | { kind: 'anomaly_resolved'; key: string; choiceId?: string }
  | { kind: 'opinion_at_least'; holder: string; of: string; value: number }
  | { kind: 'relation'; a: string; b: string; state: 'war' | 'peace' }
  /* The two empires have met (docs/first-contact.md). */
  | { kind: 'in_contact'; a: string; b: string }
  /* The player pays this empire a running tribute pact. */
  | { kind: 'tribute_pact'; receiver: string }
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
  /* Wakes or closes a wormhole (routes planned afterwards follow it; a transit under way still ends). */
  | { kind: 'wormhole_state'; wormholeId: string; state: 'dormant' | 'active' }
  /* Marks the galaxy cells within `radius` of (x, y) as explored by the player. */
  | { kind: 'reveal_area'; x: number; y: number; radius: number }
  /*
   * Diplomacy (docs/campaign-design.md §13). `contact`: the player meets
   * this empire now (its envoy arrives) — the contact dialogue opens even
   * without a sighting, and again after a reload until it is answered.
   * `start_war` goes through the war declaration (by `declarer`, or a
   * declarer-less war); `start_peace` through a white-peace treaty;
   * `force_demand` through the ordinary demand path, ignoring the
   * demander's cooldowns (the amount is capped by the target's credits; a
   * demand that is impossible — war, too little money — is skipped).
   */
  | { kind: 'contact'; factionId: string }
  | { kind: 'start_war'; a: string; b: string; declarer?: string }
  | { kind: 'start_peace'; a: string; b: string }
  | { kind: 'opinion'; holder: string; of: string; delta: number }
  | { kind: 'force_demand'; demander: string; target: string; demandKind: DemandKind; amount: number }
  /*
   * The player pays `receiver` `amount` credits every `intervalSeconds`;
   * while it runs, the receiver's AI neither declares war on the player nor
   * demands from it. A payment the player cannot make ends the pact
   * (flag `tribute_pact_broken`) and the receiver declares war.
   */
  | { kind: 'tribute_pact'; receiver: string; amount: number; intervalSeconds: number }
  | { kind: 'end_tribute_pact'; receiver: string }
  /*
   * AI assault protection of a planet (docs/campaign-design.md, Mission 4):
   * while protected, no AI empire plans or launches an assault on it, except
   * the empires in `except`. `protect: false` lifts it for everyone.
   */
  | { kind: 'protect_planet'; planetName: string; protect: boolean; except?: string[] }
  /* A new fleet appears (Remnant sentinels at a gate); `tag` names it for conditions. */
  | { kind: 'spawn_fleet'; factionId: string; name: string; x: number; y: number; ships: string[]; tag?: string }
  | { kind: 'end_mission'; endingId: string }
  | { kind: 'fail_mission'; reason: string };

export interface ProgressDef {
  label: string;
  /* What the tracker shows as "current / target"; computed from the world. */
  /* `{ site }`: the player's hold progress at a campaign site, in seconds. */
  metric: 'population' | 'planets_owned' | 'systems_charted' | { value: string } | { site: string };
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
  /* Applied once when the event fires (before any choice): an envoy arrives, a demand is made. */
  effects?: Effect[];
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
  /* The empire a distress signal comes from. */
  factionId?: string;
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

/*
 * Starting buildings: the generator's templates, an independent
 * civilization's capital, or a developed capital (`stronghold`: the
 * homeworld plus a Spaceport and a Spaceship Factory, for a finale fought
 * by established empires).
 */
export type MissionPlanetLayout = 'homeworld' | 'colony' | 'civilization_capital' | 'stronghold' | 'none';

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
  /* No AI empire may assault it from the start (until a `protect_planet` effect lifts it). */
  protected?: boolean;
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
  /* false: the empires have not met yet (docs/first-contact.md); missing = met. */
  contact?: boolean;
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
  /* The generator's centred black hole (the Lacuna Heart): it brings the Dyson ring. */
  blackHole?: boolean;
  /* Authored space bases (an outlaw free port); names are unique, conditions refer to them by name. */
  spaceBases?: { name: string; factionId: string; x: number; y: number }[];
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
  /*
   * Scripted first contacts (docs/first-contact.md#campaign-hooks): the
   * mission replaces the evaluation's result for meetings with these
   * empires. `outcome` forces the treaty state; `maxOpinion` caps the
   * starting opinion (both ways).
   */
  contactOverrides?: Record<string, ContactOverride>;
  /*
   * Scripted relations: the AI empire `factionId` makes no demands of
   * `target` (default the player) and declares no war on it on its own
   * until `untilFlag` is set — for the whole mission without a flag. The
   * mission's events act instead. Mission 3: Varkon spares the player until
   * its ultimatum (so the tribute → ultimatum story is not pre-empted) and
   * the Concordium for the whole mission (their war belongs to Mission 5).
   */
  aiRestraint?: { factionId: string; target?: string; untilFlag?: string }[];
  /*
   * Where a mission value comes from besides effects (Mission 4's League
   * standing). CampaignService applies them when StarMap reports the event;
   * `cap` is the highest value a source can raise the key to.
   */
  valueSources?: ValueSource[];
  /* Claimable places (Mission 6's Remnant archives and the Lacuna core). */
  sites?: CampaignSiteDef[];
  /* AI behavior toward the sites (EnemyCampaignService). */
  aiDirectives?: CampaignAiDirective[];
  /* Campaign Dyson rules (Mission 7; needs `map.blackHole`). */
  dyson?: MissionDysonRules;
  /*
   * Credits per second of game time paid to these AI empires on top of
   * their economy (a war chest, the Observers' old network). For finales
   * whose young empires could not otherwise afford what the story needs;
   * paid in the campaign tick, so it pauses with the game.
   */
  aiStipends?: Record<string, number>;
  /*
   * Per-difficulty replacements of single stipends (an empire listed here
   * gets this amount instead on that difficulty). Mission 7: on Easy every
   * AI income is lower, and the Observers — whose hunts keep Varkon's ring
   * in check — would otherwise park their fleets.
   */
  aiStipendsByDifficulty?: Partial<Record<AiDifficulty, Record<string, number>>>;
  /* Tutorial steps that make no sense here (tutorial-steps.ts ids), e.g. 'diplomacy' without empires. */
  tutorialExcludedSteps?: string[];
}

/*
 * A campaign site (docs/campaign-design.md §13, Mission 6): a place an
 * empire claims by holding it. A faction with a fleet of at least
 * `minWarships` living warships within `radius` cells gains hold seconds
 * while no hostile fleet or hostile space base (a Remnant guardian) is
 * within the radius; absent factions lose progress twice as fast. At
 * `holdSeconds` the faction claims it: `grantTechnology` goes to the
 * claimant, then `onClaim` effects (by claimant id, '*' for anyone).
 * Sites are claimed once; `activeWhen` keeps a site closed until true.
 */
export interface CampaignSiteDef {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  holdSeconds: number;
  minWarships: number;
  activeWhen?: Condition;
  grantTechnology?: string;
  onClaim?: Record<string, Effect[]>;
}

/*
 * What an AI empire does about a campaign site (EnemyCampaignService):
 * 'claim' sends its strongest free fleet with `minWarships` warships once
 * the game clock passes `after` and a battle forecast against the site's
 * guardians leaves at least `minSurvival` of it alive; 'guard' parks a
 * fleet on a site it holds.
 */
/*
 * Campaign Dyson rules (docs/campaign-design.md, Mission 7). Every part is
 * optional and applies only to the mission:
 * - dampener: the Dampener anchor bonus is offered (dyson-anchor.ts);
 * - plans: per-faction overrides of the AI Dyson plan (EnemyDysonService);
 *   the first entry of a faction whose `whenFlag` is set (or that has none)
 *   applies;
 * - coalition: while `whenFlag` is set, these members may fill the ring
 *   together for a coalition warm-up (dyson-victory.ts);
 * - instability: a campaign value moved every second by the anchors on
 *   the ring (per minute: + openerPerMinute per completed opener anchor,
 *   × playerOpenerFactor for the player's own, + warmupPerMinute during a
 *   single-faction warm-up, − dampenerPerMinute per Dampener, −
 *   coalitionWarmupPerMinute during the coalition's warm-up), 0–100.
 */
export interface MissionDysonRules {
  dampener?: boolean;
  /* Scale on the anchor upkeep (dyson-anchor.ts); missing = 1. */
  anchorUpkeepFactor?: number;
  /* Scale on the Swarm Constructor's price (resource-cost.ts shipCost); missing = 1. */
  constructorCostFactor?: number;
  plans?: { factionId: string; whenFlag?: string; plan: Partial<DysonPlan> }[];
  coalition?: { id: string; name: string; members: string[]; maxPerMember: number; whenFlag: string };
  instability?: {
    key: string;
    openerPerMinute: number;
    playerOpenerFactor: number;
    warmupPerMinute: number;
    dampenerPerMinute: number;
    coalitionWarmupPerMinute: number;
  };
}

export interface CampaignAiDirective {
  factionId: string;
  siteId: string;
  mode: 'claim' | 'guard';
  after?: number;
  minWarships?: number;
  minSurvival?: number;
}

export type ValueSource =
  /* A player trader delivers to one of these planets: `amount` per delivery. */
  | { kind: 'delivery'; toPlanets: string[]; key: string; amount: number; cap?: number }
  /* The player wins a battle within `radius` cells of one of these systems (optionally against one empire). */
  | { kind: 'battle_won'; nearSystems: string[]; radius: number; against?: string; key: string; amount: number; cap?: number }
  /* The player trades at the resource exchange: `perThousand` per 1,000 credits of trade volume. */
  | { kind: 'exchange'; key: string; perThousand: number; cap?: number };

export interface ContactOverride {
  outcome?: 'peace' | 'cold_peace' | 'war';
  maxOpinion?: number;
}

/* ---------- Runtime state (saved) ---------- */

export interface CampaignSiteState {
  progress: Record<string, number>;
  claimedBy?: string;
  /* `activeWhen` held at the last tick (sites without it are always active). */
  active?: boolean;
}

export interface TributePactState {
  receiver: string;
  amount: number;
  intervalSeconds: number;
  /* Game seconds until the next payment. */
  untilNext: number;
}

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
  /* CampaignEventKind or "<kind>:<factionId>" → count. */
  counters: Record<string, number>;
  objectives: Record<string, ObjectiveState>;
  heldTimers: Record<string, number>;
  firedEvents: string[];
  /* Modal events waiting to be shown, oldest first. */
  pendingEvents: string[];
  fleetTags: Record<string, number[]>;
  researchHorizon: string[];
  horizonExtras: Record<string, string[]>;
  /* `contact` effects not answered yet (re-queued after every load). */
  forcedContacts?: string[];
  tributePacts?: TributePactState[];
  /* Names of the player's planets at the last tick; a name that left the list counts as `planet_lost`. */
  playerPlanets?: string[];
  /* Planets no AI may assault (`protect_planet`), with the empires exempted. */
  protectedPlanets?: { planetName: string; except?: string[] }[];
  /* Campaign site state by site id: hold seconds per faction, and the claimant once claimed. */
  sites?: Record<string, CampaignSiteState>;
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

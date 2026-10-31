import type { DiplomaticDemand } from './diplomatic-demand';

export interface PlanetBuilding {
  id?: string;
  name: string;
  size: number;
  x: number;
  y: number;
  type?: string;
}

export type PlanetType = 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert';
export type PlanetSize = 'huge' | 'big' | 'medium' | 'small' | 'tiny';

export type PlanetSizeNumber = 1 | 2 | 3 | 4;

export const PLANET_SIZE_MAP: Record<PlanetSize, PlanetSizeNumber> = {
  tiny: 1,
  small: 2,
  medium: 3,
  big: 4,
  huge: 4,
};

export const PLANET_TYPE_COLORS: Record<PlanetType, string> = {
  earthlike: 'rgb(12, 173, 60)',
  marslike: 'rgb(94, 26, 26)',
  venuslike: 'rgb(161, 103, 27)',
  gasgiant: 'rgb(120, 70, 160)',
  ice: 'rgb(187, 218, 218)',
  desert: 'rgb(145, 132, 107)',
};

/*
 * Per-second satisfaction drift imposed by a planet's type when it is owned
 * and populated. Habitable worlds (earthlike, gasgiant) impose no penalty;
 * harsher worlds drain satisfaction and must be offset with social
 * infrastructure. This is a *base* drift — building moraleRate bonuses are
 * added on top in EconomyService.applyEconomyDelta.
 *
 * Units: satisfaction points per second (game time).
 */
export const PLANET_TYPE_HABITABILITY: Record<PlanetType, number> = {
  earthlike: 0,
  marslike: -0.03,
  venuslike: -0.05,
  gasgiant: 0,
  ice: -0.08,
  desert: -0.05,
};

// Side length of one planet surface cell in vw at the CLOSE zoom level (the
// other zoom levels scale it). Cells are contiguous (no gap), so one cell's
// isometric diamond is CELL_VW * sqrt(2) wide on screen.
export const PLANET_SURFACE_CELL_VW = 4.4;

export interface Technology {
  id: string;
  name: string;
  description: string;
  researchCost: number;
  prerequisites: string[];
  unlocksShips: string[];
  unlocksBuildings: string[];
  /* Mechanical effects; aggregated by ResearchService.getModifiers (docs/research.md). */
  bonuses?: TechnologyBonus[];
}

/*
 * One mechanical effect of a technology. Values are additive between
 * technologies of the same type: multipliers become (1 + Σ value), so two
 * +15% energy technologies give ×1.30; reductions use negative values.
 * `shipTypes` restricts ship combat bonuses to those hulls.
 */
export type TechnologyBonusType =
  | 'sensorRange'
  | 'energyOutput'
  | 'researchOutput'
  | 'rawOutput'
  | 'buildingUpkeep'
  | 'shipUpkeep'
  | 'shipBuildSpeed'
  | 'populationGrowth'
  | 'shipAttack'
  | 'shipShield'
  /* Defense turrets on every station of the faction (count, summed; see station-defense.ts). */
  | 'stationTurrets';

export interface TechnologyBonus {
  type: TechnologyBonusType;
  value: number;
  shipTypes?: string[];
}

/*
 * AI difficulty levels. The tuning values behind each level live in
 * `ai-difficulty.ts`; 'normal' reproduces the AI behavior that existed
 * before difficulty was introduced, so factions without the field behave
 * exactly as before.
 */
export type AiDifficulty = 'easy' | 'normal' | 'hard';

/* AI strategic preferences; profiles live in `ai-personality.ts`. */
export type AiPersonality = 'balanced' | 'expansionist' | 'militarist' | 'technologist';

export interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
  ai?: boolean;
  /*
   * Only meaningful when `ai === true`. Missing on older saves and on the
   * legacy star-map-data.json map; treated as 'normal'.
   */
  aiDifficulty?: AiDifficulty;
  /*
   * Only meaningful when `ai === true`. Assigned by the galaxy generator;
   * missing on older saves and the legacy map, treated as 'balanced'.
   */
  aiPersonality?: AiPersonality;
  currencies: Record<string, number>;
  researchedTechnologies?: string[];
  /*
   * Treaty state with every other non-neutral, non-allied faction, keyed by
   * faction id. Symmetric (both sides hold the same state); written only by
   * diplomacy.ts `startWar` / `startPeace`. See docs/diplomacy.md.
   */
  relations?: Record<string, FactionRelation>;
  /*
   * How trustworthy every other empire finds this faction (−100…+100,
   * missing = 0). Changed by war declarations, surprise attacks, broken and
   * honored treaties and long peace (diplomacy.ts).
   */
  reputation?: number;
  /*
   * Game seconds until this faction may make another credit demand of
   * anyone (diplomatic-demand.ts). Missing = 0. Saved, so reloading never
   * skips a cooldown.
   */
  demandCooldown?: number;
  /*
   * Decaying count of refused threats this faction did not carry out
   * (0…EMPTY_THREAT_LIMIT, missing = 0). Public knowledge: it lowers the
   * credibility of its future threats with every empire and pushes it to
   * carry out the next one (docs/diplomacy.md).
   */
  emptyThreats?: number;
}

export type TreatyState = 'war' | 'peace';

/*
 * One faction's entry about another (docs/diplomacy.md). Symmetric fields
 * (same on both sides): state, lockRemaining, truce, warSeconds,
 * declaredBy, surpriseRecorded. Per-side fields describe the holder:
 * opinion, warExhaustion, shipsLostValue, planetsLost. Optional fields are
 * filled with defaults by normalizeRelations on every load.
 */
export interface FactionRelation {
  state: TreatyState;
  /*
   * Game seconds until this relation may change by a normal action: the
   * minimum war duration at war; the truce at peace (while `truce`).
   */
  lockRemaining: number;
  /* At peace: the post-treaty truce is still running. */
  truce?: boolean;
  /* The holder's opinion of the other faction (−100…+100). */
  opinion?: number;
  /* At war: the holder's exhaustion in this war (0…100). */
  warExhaustion?: number;
  /* At war: game seconds since this war started. */
  warSeconds?: number;
  /* At war: who declared it (absent for the opening wars of a new game). */
  declaredBy?: string;
  /* At war: the declarer's surprise-attack penalty was already applied. */
  surpriseRecorded?: boolean;
  /* At war: credit value of the holder's ships lost in this war. */
  shipsLostValue?: number;
  /* At war: planets the holder lost to the other in this war. */
  planetsLost?: number;
  /*
   * Holder's memory of the other's border violations in the holder's
   * territory: a decaying incident count (border.service.ts) that raises
   * the opinion penalty of repeated violations. Per side, kept across war
   * and peace.
   */
  borderIncidents?: number;
  /*
   * The holder grants the other faction free passage through its territory
   * (no border-violation penalty). Prepared for future passage treaties:
   * nothing grants it yet, and a war declaration revokes it.
   */
  passageRights?: boolean;
  /*
   * Credit demands (diplomatic-demand.ts), per side, kept across war and
   * peace. `demandCooldown`: game seconds until the holder may demand from
   * the other again. `demandsReceived`: decaying memory of the other's
   * demands on the holder (repeated demands cost more opinion and are
   * resisted harder). `demandsRefused`: decaying memory of the holder's
   * demands the other refused (an AI escalates or stops asking).
   */
  demandCooldown?: number;
  demandsReceived?: number;
  demandsRefused?: number;
}

export type GalaxySize = 'small' | 'medium' | 'large';

/*
 * Metadata describing how a procedurally generated galaxy was created.
 * Persisted with the save so a game can be identified and its starting
 * galaxy reproduced from `seed`. The galaxy itself (systems, planets,
 * fleets) is always stored in full — loading NEVER regenerates it.
 * Absent on saves started from the legacy star-map-data.json map.
 */
export interface GalaxyInfo {
  size: GalaxySize;
  /* Seed that actually produced this galaxy (after any validation retries). */
  seed: number;
  /* Seed requested by the player/config, if any. */
  requestedSeed?: number | null;
  generatorVersion: number;
}

// Derives the IDs of AI-controlled factions from the live factions array.
// Replaces the previous hardcoded `new Set(['enemy1', 'enemy2'])` pattern,
// so adding/removing/renameing enemy factions is a data-only change.
export function getAiFactionIds(factions: Faction[]): string[] {
  return factions.filter((f) => f.ai === true).map((f) => f.id);
}

/*
 * PlanetTile represents a single planet within a star system.
 *
 * NOTE: x and y are the 1-indexed top-left cell of the planet's 2×2 block
 * on the system view grid (system-grid.ts; save version 8 doubled the grid,
 * older saves are converted by SaveGameService.migrateSave).
 */
export interface PlanetTile {
  id: number;
  index: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  type: PlanetType;
  size: PlanetSize;
  population: number;
  buildings: PlanetBuilding[];
  explored: boolean;
  satisfaction?: number;
  /*
   * Game seconds left in which the planet cannot rebel, set on capture
   * (PlanetOwnershipService) and counted down by the economy tick.
   * Satisfaction may still fall to 0 meanwhile; the planet rebels only once
   * the grace is over. Optional and saved; absent = no grace (old saves).
   */
  rebellionGraceSeconds?: number;
  resourceTiles?: ResourceDeposit[];
  /*
   * Finite raw-material reserve of the planet (raw-deposits.ts,
   * docs/economy.md). Present exactly when `resourceTiles` is non-empty;
   * mining buildings placed next to a deposit tile extract from it.
   * Backfilled on load by ensurePlanetDeposits (no save version bump).
   */
  rawDeposit?: PlanetRawDeposit;
  shieldPoolCurrent?: number;
  /* Environmental terrain of the surface grid (docs/planet-surface.md). */
  surface?: PlanetSurface;
}

/*
 * Persisted planet surface terrain. `blocked` is authoritative for
 * construction (cells covered by water, cliffs, rock or chasms); the visual
 * terrain is regenerated from `seed` and flattened to match `blocked`.
 * `gridSize` pins the record to the grid it was generated for; a mismatch
 * makes the record ignored (no blocked cells) rather than misapplied.
 */
/*
 * A planet's raw-material reserve. `remaining` only ever decreases (economy
 * tick extraction) and may be fractional; 0 means depleted for good.
 * `richness` multiplies the output of the planet's mining buildings, so
 * deposits differ in extraction rate as well as in size.
 */
export interface PlanetRawDeposit {
  total: number;
  remaining: number;
  richness: number;
}

export interface PlanetSurface {
  version: number;
  seed: number;
  gridSize: number;
  /* 0..1 field parameter: how deep terrain may cut into the grid. */
  intrusion: number;
  /* Row-major hex bitmask, see planet-surface.ts encodeBlockedMask. */
  blocked: string;
}

/*
 * StarSystem position on the galaxy map.
 * x/y are 1-indexed grid column/row coordinates (e.g., x=53 means column 53).
 */
export interface StarSystem {
  id: string;
  name: string;
  x: number;
  y: number;
  planets: number;
  color: string;
  planetsTiles: PlanetTile[];
  gridCol?: number;
  gridRow?: number;
  explored?: boolean;
  /*
   * In-system asteroid belt (system-asteroids.ts, docs/game-systems.md).
   * Generated once per system and persisted, because survey results are
   * part of it. Saves without it get the deterministic belt on load.
   */
  asteroidBelt?: SystemAsteroidBelt;
}

export interface SystemAsteroidBelt {
  /* Belt generator version that produced it (SYSTEM_ASTEROID_CONFIG). */
  version: number;
  /* Radius (vw) of the belt's center line around the star; drives the dust band. */
  radiusVw: number;
  asteroids: SystemAsteroid[];
}

/*
 * One asteroid occupying one system-view cell. `rawMaterials` is the hidden
 * deposit (0 = barren). The UI must not reveal it until `surveyed` is true:
 * a cell is surveyed once a human player fleet has been on it. AI factions
 * survey by the same rule and are recorded in `surveyedBy`; the AI only
 * knows deposits it surveyed itself. A mining station
 * (mining-station.ts) extracts the deposit, so `rawMaterials` is the
 * remaining amount and may be fractional while it is being mined.
 */
export interface SystemAsteroid {
  col: number;
  row: number;
  rawMaterials: number;
  /*
   * Original deposit size (0 for barren rocks), for the depletion
   * percentage. Backfilled on load for belts saved before it existed.
   */
  totalRawMaterials?: number;
  /*
   * Raw materials per second a mining station extracts here (before the
   * faction gain multiplier). Differs per asteroid; backfilled on load.
   */
  extractionRate?: number;
  /* The human player's survey (drives what the UI may reveal). */
  surveyed: boolean;
  /*
   * AI factions that surveyed this asteroid, by the same rule as the player
   * (a fleet of theirs on the cell). The AI only targets deposits it knows.
   */
  surveyedBy?: string[];
  /*
   * Mining station built on this asteroid by an outpost ship (at most one
   * per asteroid by construction). Permanent; it stays after the deposit is
   * depleted. Missing = no station. Optional field, no save version bump.
   */
  miningStation?: MiningStation;
}

/*
 * Defense fields (`shieldPoolCurrent`, `hullCurrent`) follow the shared
 * station defense model (station-defense.ts); missing = full. Optional, no
 * save version bump.
 */
export interface MiningStation {
  factionId: string;
  shieldPoolCurrent?: number;
  hullCurrent?: number;
}

export interface FleetShip {
  id: number;
  name: string;
  type: string;
  currentHp?: number;
  destroyed?: boolean;
}

/*
 * Ship stock and production data structures.
 *
 * Stock ships are per-instance records (same shape as FleetShip) so the
 * existing battle / sensor / movement code can read them without changes.
 * The stock is faction-scoped (empire), never planet-scoped, mirroring
 * the IG1 design where factories feed a global reserve.
 */
export interface ShipStockEntry {
  id: number;
  type: string;
  name: string;
  producedAtTick?: number;
  originPlanetId?: number | null;
}

export interface FactionShipStock {
  factionId: string;
  ships: ShipStockEntry[];
}

export interface ProductionOrder {
  id: number;
  shipTypeId: string;
  quantity: number;
  progress: number;
  startedAtTick: number;
  /*
   * Resources actually charged when the order was queued. Refunds are
   * computed from this, not from today's ship price, so a rebalance or an
   * order from a save that predates raw-material costs can never refund
   * more than was paid. Absent on legacy orders: those paid credits only
   * (ship `cost` × quantity).
   */
  paid?: { credits: number; rawmaterials: number };
}

export interface FactionProduction {
  factionId: string;
  ordersByPlanet: Record<number, ProductionOrder[]>;
}

export interface ShipType {
  id: string;
  name: string;
  role: string;
  hitPoints: number;
  shield: number;
  shieldRegen: number;
  attack: number;
  attackType: string;
  weakness: string;
  defense: number;
  speed: number;
  range: number;
  cost: number;
  rawMaterialCost?: number;
  maintenanceCost: number;
}

export interface FleetShipTypeSummary {
  typeId: string;
  typeName: string;
  count: number;
  attack: number;
  defense: number;
}

export interface SpecialObject {
  x: number;
  y: number;
  type: string;
  width: number;
  height: number;
  component?: string;
  /*
   * Black holes only: radius (grid cells) of the circular no-fly zone
   * around the object's center. Fleets are routed around it and may never
   * enter it (docs/star-map-terrain.md). Missing → derived from the cell
   * span (BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS in fleet-navigation.ts).
   */
  navigationRadius?: number;
}

/*
 * Nebula: an irregular cloud of interstellar gas on the galaxy map that
 * slows fleets and degrades sensors (docs/star-map-terrain.md).
 *
 * The boundary is a smooth closed "blob" in polar form around (x, y):
 * the edge distance at angle θ is `radius × lobe(θ)`, where `lobes` are
 * evenly spaced radius multipliers interpolated with a cosine curve.
 * x/y/radius use the same 1-indexed grid coordinates as fleets. Generated
 * once at New Game (or backfilled once by save migration) and persisted;
 * never regenerated on load.
 */
export interface Nebula {
  id: number;
  x: number;
  y: number;
  radius: number;
  lobes: number[];
  /* Angle (radians) of lobes[0]; varies the shape between nebulae. */
  rotation: number;
  color: string;
}

/*
 * Asteroid belt: a long, narrow, permanent and impassable wall of rock
 * (docs/star-map-terrain.md#asteroid-belts). Navigation uses only the
 * geometry: a chain of capsules along `points` with radius
 * `halfWidth + ASTEROID_BELT_CONFIG.safetyMargin`. The visible fragments are
 * not stored; they are rebuilt deterministically from `visualSeed`, always
 * inside `halfWidth`, so the barrier covers every fragment and every gap
 * between them. Coordinates are 1-indexed grid units like fleets.
 */
export interface AsteroidBelt {
  id: number;
  /* Polyline of the belt axis: 2 points (straight) or a sampled gentle arc. */
  points: { x: number; y: number }[];
  /* Half thickness of the rock band in cells (visual extent). */
  halfWidth: number;
  visualSeed: number;
}

export type AsteroidType = 'ore' | 'crystal' | 'mixed';

/*
 * Cargo of a drifting asteroid, in existing faction currencies. Rolled once
 * at spawn so a save/load cannot reroll it.
 */
export interface AsteroidReward {
  rawmaterials?: number;
  research?: number;
}

/*
 * A resource-bearing asteroid crossing the galaxy map on a straight line
 * (docs/star-map-terrain.md#drifting-asteroids). The position is derived,
 * not stored: start + direction × traveled. The asteroid leaves play when
 * `traveled >= length` (it reached the far map edge) or when a fleet
 * collects it. Coordinates are 1-indexed grid units like fleets.
 */
export interface DriftingAsteroid {
  id: number;
  type: AsteroidType;
  startX: number;
  startY: number;
  /* Unit direction vector. */
  dirX: number;
  dirY: number;
  /* Grid cells per game second. */
  speed: number;
  /* Distance already covered from the start point (cells). */
  traveled: number;
  /* Total path length from the entry to the exit point (cells). */
  length: number;
  reward: AsteroidReward;
}

/*
 * Persistent state of the drifting-asteroid event system. `rngState` is the
 * Mulberry32 state so spawns stay deterministic across save/load.
 */
export interface AsteroidEventState {
  nextId: number;
  /* Game seconds until the next spawn attempt. */
  spawnTimer: number;
  rngState: number;
  active: DriftingAsteroid[];
}

/*
 * Space base: a permanent, immobile station deployed by an outpost ship on
 * a galaxy cell (docs/territory.md). It is an observation post and extends
 * its owner's territory by a claim radius; it has no economy, research or
 * production function. In battle it is defended by its own core and
 * turrets (SPACE_BASE_CONFIG in space-base.ts). x/y are the 1-indexed grid
 * column/row of its cell (integers, like star systems). A destroyed base is
 * removed from StarMapData.spaceBases, so every stored base is alive.
 */
export interface SpaceBase {
  id: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  /* Shared shield pool left after a battle (like PlanetTile.shieldPoolCurrent). Missing = full. */
  shieldPoolCurrent?: number;
  /* Station core hit points left after a battle (station-defense.ts). Missing = full. */
  hullCurrent?: number;
}

export interface StarMapData {
  /*
   * Save format version. Missing (older saves) is treated as 0 and
   * migrated on first load; additional future fields must bump this.
   */
  saveVersion?: number;
  galaxy?: GalaxyInfo;
  factions: Faction[];
  /*
   * Map entities with no gameplay ownership (currently the central black
   * hole). Persisted since save version 3; older saves are backfilled from
   * the legacy star-map-data.json by SaveGameService.migrateSave.
   */
  specialObjects?: SpecialObject[];
  /*
   * map: Grid layout configuration.
   * - width/height: Grid dimensions in cells (columns × rows)
   * - cellSizeVw/Vh: Rendering cell size in vw units (2 desktop, 3.5 mobile)
   */
  map: {
    width: number;
    height: number;
    cellSizeVw: number;
    cellSizeVh: number;
  };
  starSystems: StarSystem[];
  fleets: Fleet[];
  currentView?: 'map' | 'system' | 'planet';
  cameraX?: number;
  cameraY?: number;
  selectedSystemId?: string | null;
  selectedFleetId?: number | null;
  selectedPlanetTileId?: number | null;
  selectedFleetAction?: 'move' | null;
  targetX?: number | null;
  targetY?: number | null;
  destroyedFleetId?: number | null;
  exploredGridCells?: string[];
  shipStock?: FactionShipStock[];
  production?: FactionProduction[];
  defaultView?: {
    type: 'map' | 'system' | 'planet';
    systemId?: string;
    planetId?: number;
    cameraX?: number;
    cameraY?: number;
  };
  gameOutcome?: GameOutcome;
  /*
   * Nebula regions (save version 4+). Generated at New Game; older saves
   * get a deterministic set from SaveGameService.migrateSave once.
   */
  nebulae?: Nebula[];
  /* Drifting asteroid events (save version 4+). */
  asteroidEvents?: AsteroidEventState;
  /*
   * Impassable asteroid belts (save version 5+). Generated at New Game and
   * persisted; saves made before belts existed load with none (adding a
   * barrier to a running game could cut off fleets and territory).
   */
  asteroidBelts?: AsteroidBelt[];
  /*
   * Space bases (save version 7+); older saves get []. Territory itself is
   * never stored: it is derived from planet owners and these bases.
   */
  spaceBases?: SpaceBase[];
  /*
   * Open credit demands (save version 9+): AI demands waiting for the
   * human's answer and the human's refused threats waiting for a decision
   * (diplomatic-demand.ts). Older saves get []. Restored by
   * DiplomacyService.restoreDemands, which drops invalid entries.
   */
  diplomaticDemands?: DiplomaticDemand[];
  /*
   * Exploration anomalies (save version 10+; docs/exploration-anomalies.md).
   * Older saves get a deterministic set from SaveGameService.migrateSave
   * once; after that the persisted state (hidden / discovered / active /
   * resolved) is the source of truth and is never regenerated.
   */
  anomalies?: AnomalyState;
}

/* ---------- Exploration anomalies (anomalies.ts) ---------- */

export type AnomalyType = 'ancient_wreck' | 'distress_signal' | 'pirate_trap' | 'derelict_outpost';

/*
 * Where an anomaly waits. `x`/`y` is always the galaxy cell that is checked
 * for discovery (the system cell for system and asteroid sites).
 * - system:   arriving at (stopping in) the star system triggers it;
 * - asteroid: a player fleet on that in-system belt cell (col/row) triggers it;
 * - space:    any player fleet presence on the open-space cell triggers it.
 */
export interface AnomalySite {
  kind: 'system' | 'asteroid' | 'space';
  x: number;
  y: number;
  systemId?: string;
  col?: number;
  row?: number;
}

/*
 * hidden → discovered (cell explored by the player's sensors) → active (a
 * player fleet arrived; the event dialog waits for a choice) → resolved.
 * A hidden anomaly can go straight to active. `active` is persisted so a
 * reload re-opens the pending event instead of losing or replaying it.
 */
export type AnomalyStatus = 'hidden' | 'discovered' | 'active' | 'resolved';

export interface Anomaly {
  id: number;
  type: AnomalyType;
  site: AnomalySite;
  status: AnomalyStatus;
  /* Distress signal: the AI empire whose opinion the "assist" choice improves. */
  factionId?: string;
  /* While active: the player fleet that triggered it. */
  fleetId?: number | null;
  /* While active: activation order (the oldest pending event is shown first). */
  activatedSeq?: number;
  /* Once resolved: the choice taken. */
  choiceId?: string;
  /* Pirate trap: the victory loot was paid out (exactly once). */
  lootClaimed?: boolean;
}

export interface AnomalyState {
  version: number;
  nextSeq: number;
  anomalies: Anomaly[];
}

export type ResourceType = 'credits' | 'rawmaterials' | 'research' | 'energy';
export type ResourceRates = Partial<Record<ResourceType, number>>;

export type AiStrategy = 'expand' | 'attack' | 'defend' | 'develop';

export type GoalType = 'colonize' | 'attack' | 'defend' | 'develop';

export type GameOutcome = 'inProgress' | 'victory' | 'defeat';

export interface ColonizeGoal {
  type: 'colonize';
  targetPlanetId: number;
  targetSystemId: string;
}

export interface AttackGoal {
  type: 'attack';
  targetFleetId: number;
}

export interface DefendGoal {
  type: 'defend';
  targetPlanetId: number;
  targetSystemId: string;
  threateningFleetId?: number;
}

export interface DevelopGoal {
  type: 'develop';
}

export type StrategicGoal = ColonizeGoal | AttackGoal | DefendGoal | DevelopGoal;

export type ResourceDepositType = 'rawmaterial';

export interface ResourceDeposit {
  type: ResourceDepositType;
  x: number;
  y: number;
}

export interface PlanetEconomy {
  production: ResourceRates;
  consumption: ResourceRates;
  net: ResourceRates;
  energyProduction: number;
  energyConsumption: number;
  energyBalance: number;
  efficiency: number;
  satisfaction: number;
  incomeMultiplier: number;
  workforceAvailable: number;
  workforceRequired: number;
  workforceEfficiency: number;
  habitabilityDrift: number;
  buildingMoraleBonus: number;
  /* Energy part of the satisfaction drift (economy.service energySatisfactionDrift), points/s. */
  energySatisfactionDrift: number;
  /*
   * Total satisfaction change per second the economy tick applies before
   * arrears: energy part + habitability + building morale. Negative means
   * the planet is heading toward rebellion at 0%.
   */
  satisfactionDrift: number;
  /*
   * Raw materials/s the planet's mining buildings take from its deposit
   * (workforce, technology and deposit richness applied; before energy
   * efficiency and the faction gain multiplier). Part of production.rawmaterials;
   * 0 without a deposit or once it is depleted.
   */
  depositMining: number;
}

/*
 * Faction economy as produced by EconomyService.calculateEconomy. All
 * rates are effective per-second values (efficiency, satisfaction,
 * difficulty and upkeep already applied); `net[r]` is exactly what one
 * second of the economy tick adds to the stock of resource r.
 */
export interface EconomyBreakdown {
  incomePerSecond: number;
  /* Total upkeep in credits/s (buildings + fleet ships + reserve ships). */
  expensePerSecond: number;
  netPerSecond: number;
  buildingUpkeepPerSecond: number;
  /* Colony administration (EconomyService.administrationShare × planet income). */
  administrationPerSecond: number;
  shipUpkeepPerSecond: number;
  /* Upkeep that could not be paid on the last applied tick (arrears); 0 otherwise. */
  unpaidUpkeepPerSecond: number;
  /*
   * Effective raw/s from finite deposits (planet mines + asteroid stations),
   * included in production.rawmaterials. The economy tick replaces this
   * nominal rate with what is actually extracted (capped by what is left).
   */
  depositMiningPerSecond: number;
  totalPopulation: number;
  planets: PlanetEconomyEntry[];
  fleetExpenses: FleetExpenseEntry[];
  production: ResourceRates;
  consumption: ResourceRates;
  net: ResourceRates;
  efficiency: number;
}

export interface PlanetEconomyEntry {
  planetName: string;
  population: number;
  income: number;
  /* Credits/s this planet costs: building upkeep + administration. */
  expense: number;
  administration?: number;
  net: number;
  production: ResourceRates;
  consumption: ResourceRates;
  netRates: ResourceRates;
  energyProduction: number;
  energyConsumption: number;
  energyBalance: number;
  efficiency: number;
  buildings: BuildingExpenseEntry[];
  satisfaction: number;
  incomeMultiplier: number;
  workforceAvailable: number;
  workforceRequired: number;
  workforceEfficiency: number;
  habitabilityDrift: number;
  buildingMoraleBonus: number;
  /* See PlanetEconomy.satisfactionDrift (arrears not included). */
  satisfactionDrift: number;
  /* Effective raw/s this planet's mines extract from its deposit (included in production). */
  miningRate: number;
}

export interface BuildingExpenseEntry {
  buildingName: string;
  count: number;
  maintenanceCost: number;
  totalCost: number;
}

export interface FleetExpenseEntry {
  fleetName: string;
  shipType: string;
  count: number;
  maintenanceCost: number;
  totalCost: number;
}

export interface BuildingStats {
  id: string;
  name: string;
  role?: string;
  /* Purchase price: credits (`price`) and raw materials (see resource-cost.ts). */
  price?: number;
  rawMaterialCost?: number;
  /* Upkeep points per second; EconomyService converts them to credits. */
  maintenanceCost: number;
  production: ResourceRates;
  consumption: ResourceRates;
  energyProduction: number;
  energyConsumption: number;
  population?: number;
  workforce?: number;
  providesWorkforce?: number;
  moraleRate?: number;
  defense?: {
    type: string;
    attack?: number;
    attackType?: string;
    range?: number;
    weakness?: string;
    shield?: number;
    shieldRegen?: number;
  } | null;
  /*
   * Must touch a deposit tile when placed; its raw-material production is
   * extraction from the planet's finite deposit (raw-deposits.ts).
   */
  requiresOreProximity?: boolean;
}

export interface ContextMenuItem {
  type: 'fleet' | 'system' | 'planet';
  label: string;
  data: Fleet | StarSystem | PlanetTile;
}

export interface SystemLocation {
  id: string | null;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
}

/*
 * A movement trail rendered from a fleet's current position to its target.
 *
 * Coordinates are pre-converted to vw units for the view that will render
 * them, so the template only needs to bind style properties — no coordinate
 * math leaks into the presentational child components.
 *
 * The trail is only emitted for fleets that have an active target
 * (targetX/targetY !== null), i.e. fleets that are actually moving.
 */
export interface FleetTrail {
  fleetId: number;
  /*
   * Index of this leg within the fleet's route. A fleet routed around a
   * black hole produces one trail per leg (current position → waypoints →
   * target), so the drawn line matches the path actually flown.
   */
  segment?: number;
  factionId: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/*
 * Fleet position on the galaxy map.
 * x/y and targetX/Y are 1-indexed grid cell coordinates (floats for smooth movement).
 * Speed is in vw/s; the movement service converts to galaxy cells/s using the fixed
 * GALAXY_MOVEMENT_CELL_SIZE_VW (2), independent of the rendered cell size.
 * systemX/Y and systemTargetX/Y are system view positions in vw units (separate grid).
 */
export interface Fleet {
  id: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  speed: number;
  system: SystemLocation | null;
  gridCol?: number;
  gridRow?: number;
  ships: FleetShip[];
  destroyed?: boolean;
  sensorRange?: number;
  /*
   * Player intercept order: id of the drifting asteroid this fleet chases.
   * While set, DriftingAsteroidService re-aims targetX/targetY at the
   * predicted meeting point; any manual move order clears it. AI fleets
   * never use this field — their salvage role is driven by
   * EnemyFleetService (the single owner of AI fleet targets).
   */
  interceptAsteroidId?: number | null;
  /*
   * Player attack order: id of the hostile fleet this fleet pursues on the
   * galaxy map (see fleet-attack-orders.ts). Re-aimed every frame while the
   * quarry stays visible; cleared by any manual move or intercept order.
   */
  attackFleetId?: number | null;
}

export interface CapabilityRequirement {
  type: string;
  satisfied: boolean;
  reason: string;
  /*
   * Optional numeric context for the requirement. Used by
   * fleet_needs_reinforcement to carry the faction's peak fleet
   * strength so the action layer can target it without
   * re-tracking peak strength in a second service.
   */
  value?: number;
}

export interface CapabilityResult {
  canExecute: boolean;
  goalType: GoalType;
  factionId: string;
  requirements: CapabilityRequirement[];
}

export type ActionType =
  | 'none'
  | 'produce_colonizer'
  | 'produce_combat_ship'
  | 'reinforce_fleet'
  | 'create_fleet'
  | 'assemble_fleet'
  | 'move_to_target'
  | 'colonize'
  | 'attack'
  | 'defend'
  | 'develop';

export interface ActionResult {
  type: ActionType;
  factionId: string;
  goalType: GoalType;
  goal: StrategicGoal | undefined;
  targetId?: number;
  targetSystemId?: string;
  targetPlanetId?: number;
  shipTypeId?: string;
  /*
   * Reinforcement target fleet strength copied from the
   * fleet_needs_reinforcement capability requirement. The executor
   * stops reinforcing once the fleet reaches this strength, which
   * makes reinforcement idempotent across the frame loop and
   * prevents draining the global stock in a single strategy tick.
   */
  targetStrength?: number;
  reason: string;
}

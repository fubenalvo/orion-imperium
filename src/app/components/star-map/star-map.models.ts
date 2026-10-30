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
  | 'shipShield';

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
   * diplomacy.ts `setTreatyState`. See docs/diplomacy.md.
   */
  relations?: Record<string, FactionRelation>;
}

export type TreatyState = 'war' | 'peace';

export interface FactionRelation {
  state: TreatyState;
  /* Game seconds until this relation may change again (0 = may change now). */
  lockRemaining: number;
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
 * NOTE: x and y are 1-indexed system grid cell coordinates used for
 * positioning in the system view.
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
  resourceTiles?: ResourceDeposit[];
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

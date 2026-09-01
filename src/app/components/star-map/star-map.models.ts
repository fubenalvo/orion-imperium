export interface PlanetBuilding {
  name: string;
  size: number;
  x: number;
  y: number;
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
  earthlike: 'rgb(67, 67, 145)',
  marslike: 'rgb(94, 26, 26)',
  venuslike: 'rgb(161, 103, 27)',
  gasgiant: 'rgb(120, 70, 160)',
  ice: 'rgb(187, 218, 218)',
  desert: 'rgb(145, 132, 107)',
};

export const PLANET_SURFACE_CELL_VW = 3;

export interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
  currencies: Record<string, number>;
}

/*
 * PlanetTile represents a single planet within a star system.
 *
 * NOTE: x, y, xOffset, yOffset are loaded from JSON but are NOT used
 * for rendering. Planets are positioned using a hardcoded grid formula
 * in getPlanetGridPosition() and in the template.
 */
export interface PlanetTile {
  id: number;
  index: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  xOffset: number;
  yOffset: number;
  type: PlanetType;
  size: PlanetSize;
  population: number;
  buildings: PlanetBuilding[];
  explored: boolean;
}

/*
 * StarSystem position on the galaxy map.
 * x/y are 1-indexed grid column/row coordinates (e.g., x=53 means column 53).
 */
export interface StarSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  planets: number;
  color: string;
  planetsTiles: PlanetTile[];
  gridCol?: number;
  gridRow?: number;
}

export interface FleetShip {
  id: number;
  name: string;
  type: string;
  currentHp?: number;
  destroyed?: boolean;
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
  maintenanceCost: number;
}

export interface FleetShipTypeSummary {
  typeId: string;
  typeName: string;
  count: number;
  attack: number;
  defense: number;
}

export interface StarMapData {
  factions: Faction[];
  /*
   * map: Grid layout configuration.
   * - width/height: Grid dimensions in cells (columns × rows)
   * - cellSizeVw/Vh: Rendering cell size in vw units (2 desktop, 7 mobile)
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
  selectedSystemId?: number | null;
  selectedFleetId?: number | null;
  selectedPlanetTileId?: number | null;
  selectedFleetAction?: 'move' | 'attack' | null;
  targetX?: number | null;
  targetY?: number | null;
  destroyedFleetId?: number | null;
}

export type ResourceType = 'credits' | 'rawmaterials' | 'research' | 'energy';
export type ResourceRates = Partial<Record<ResourceType, number>>;

export interface PlanetEconomy {
  production: ResourceRates;
  consumption: ResourceRates;
  net: ResourceRates;
  energyProduction: number;
  energyConsumption: number;
  energyBalance: number;
  efficiency: number;
}

export interface EconomyBreakdown {
  incomePerSecond: number;
  expensePerSecond: number;
  netPerSecond: number;
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
  expense: number;
  net: number;
  production: ResourceRates;
  consumption: ResourceRates;
  netRates: ResourceRates;
  efficiency: number;
  buildings: BuildingExpenseEntry[];
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
  maintenanceCost: number;
  production: ResourceRates;
  consumption: ResourceRates;
  energyProduction: number;
  energyConsumption: number;
}

export interface ContextMenuItem {
  type: 'fleet' | 'system' | 'planet';
  label: string;
  data: Fleet | StarSystem | PlanetTile;
}

/*
 * Fleet position on the galaxy map.
 * x/y and targetX/Y are 1-indexed grid cell coordinates (floats for smooth movement).
 * Speed is in vw/s; the movement service converts to cells/s using cellSizeVw.
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
  systemId?: number;
  systemX?: number | null;
  systemY?: number | null;
  systemTargetX?: number | null;
  systemTargetY?: number | null;
  gridCol?: number;
  gridRow?: number;
  ships: FleetShip[];
  destroyed?: boolean;
}

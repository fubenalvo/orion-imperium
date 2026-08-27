export interface PlanetBuilding {
  name: string;
  count: number;
}

export type PlanetType = 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert';
export type PlanetSize = 'huge' | 'big' | 'medium' | 'small' | 'tiny';

export interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
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
}

export interface StarSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  planets: number;
  color: string;
  planetsTiles: PlanetTile[];
  gridCol: number;
  gridRow: number;
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
  map: {
    width: number;
    height: number;
    cellSizeVw: number;
    cellSizeVh: number;
  };
  starSystems: StarSystem[];
  fleets: Fleet[];
  currentView?: 'map' | 'system';
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

export interface ContextMenuItem {
  type: 'fleet' | 'system' | 'planet';
  label: string;
  data: Fleet | StarSystem | PlanetTile;
}

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
  gridCol: number;
  gridRow: number;
  ships: FleetShip[];
  destroyed?: boolean;
}

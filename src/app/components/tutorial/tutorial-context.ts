import planetData from '../star-map/planet-data.json';
import { isBuildingComplete } from '../star-map/building-construction';
import { hasTradingPost } from '../star-map/trade';
import {
  Faction,
  FactionProduction,
  FactionShipStock,
  Fleet,
  StarSystem,
} from '../star-map/star-map.models';
import { TutorialContext, TutorialScene } from './tutorial-steps';

/*
 * Builds the TutorialContext snapshot from live star-map state. Pure, so the
 * tutorial reads the game without ever holding or changing game objects.
 * StarMap supplies what needs its services (hostility, colonization check).
 */

/* Planet buildings are stored by display name; the steps use building ids. */
const BUILDING_ID_BY_NAME = new Map(
  (planetData as { buildings: { id: string; name: string }[] }).buildings.map((b) => [b.name, b.id]),
);

export interface TutorialContextInput {
  scene: TutorialScene;
  paused: boolean;
  gameSeconds: number;
  modalOpen: boolean;
  starSystems: readonly StarSystem[];
  fleets: readonly Fleet[];
  factions: readonly Faction[];
  shipStock: readonly FactionShipStock[];
  production: readonly FactionProduction[];
  selectedFleet: Fleet | null;
  colonizerReady: (fleet: Fleet) => boolean;
  hostileFleetId: number | null;
}

export function buildTutorialContext(input: TutorialContextInput): TutorialContext {
  const buildings: Record<string, { sites: number; complete: number }> = {};
  let constructionSites = 0;
  let playerPlanets = 0;
  let tradingPost = false;
  for (const system of input.starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      if (planet.factionId !== 'player') continue;
      playerPlanets++;
      if (hasTradingPost(planet)) tradingPost = true;
      for (const building of planet.buildings ?? []) {
        // `PlanetBuilding.type` is the catalog's coarse type (e.g. "turret"), not the id.
        const id = BUILDING_ID_BY_NAME.get(building.name) ?? building.name;
        const entry = (buildings[id] ??= { sites: 0, complete: 0 });
        if (isBuildingComplete(building)) {
          entry.complete++;
        } else {
          entry.sites++;
          constructionSites++;
        }
      }
    }
  }

  const playerFleets = input.fleets.filter((f) => f.factionId === 'player' && !f.destroyed);
  const isMoving = (f: Fleet) => f.targetX !== null && f.targetY !== null;
  const colonizerFleet =
    playerFleets.find((f) => f.ships.some((s) => s.type === 'colonizer' && !s.destroyed)) ?? null;

  const playerOrders = input.production.find((p) => p.factionId === 'player');
  const queuedOrders = playerOrders
    ? Object.values(playerOrders.ordersByPlanet).reduce((sum, orders) => sum + orders.length, 0)
    : 0;

  const selected = input.selectedFleet;
  return {
    scene: input.scene,
    paused: input.paused,
    gameSeconds: input.gameSeconds,
    modalOpen: input.modalOpen,
    buildings,
    constructionSites,
    stockShips: input.shipStock.find((s) => s.factionId === 'player')?.ships.length ?? 0,
    queuedOrders,
    playerPlanets,
    playerFleetIds: playerFleets.map((f) => f.id),
    selectedPlayerFleetId: selected && selected.factionId === 'player' && !selected.destroyed ? selected.id : null,
    playerFleetMoving: playerFleets.some(isMoving),
    colonizerFleetId: colonizerFleet?.id ?? null,
    colonizerMoving: colonizerFleet ? isMoving(colonizerFleet) : false,
    colonizerReady: colonizerFleet ? input.colonizerReady(colonizerFleet) : false,
    hostileFleetId: input.hostileFleetId,
    hasTradingPost: tradingPost,
    rawMaterials: input.factions.find((f) => f.id === 'player')?.currencies['rawmaterials'] ?? 0,
  };
}

import planetData from './planet-data.json';
import { Faction, PlanetBuilding, PlanetTile, StarSystem } from './star-map.models';
import { ResourceCost, refundCost } from '../../services/resource-cost';

/*
 * =========================================================
 * PLANETARY BUILDING CONSTRUCTION (pure rules)
 * =========================================================
 *
 * A placed building is a construction site until its construction time has
 * passed (docs/planet-construction.md). The site is a normal PlanetBuilding
 * record with `constructionRemaining` set, so it already occupies its cells,
 * counts toward per-planet limits and counts as "planned" for the AI, but it
 * has NO effect: every consumer of building effects (economy, production,
 * Spaceport, Trading Post, planet defense, mines) reads `operationalBuildings`
 * instead of `planet.buildings`.
 *
 * Time: work is measured in work-seconds at speed 1. StarMap (and the
 * headless simulation) call `advanceBuildingConstruction` with the SCALED game
 * delta, so pause (delta 0) freezes sites and game speed accelerates them;
 * there is no separate clock. Each planet builds at its construction speed:
 *
 *   speed = core factor (Capital / Colony Center) × technology multiplier
 *
 * The technology multiplier is 1 + Σ `buildingConstructionSpeed` bonuses
 * (ResearchService.getModifiers), so technologies add up with each other and
 * multiply with the core. All sites of a planet build in parallel; the price
 * paid up front is the only limit.
 *
 * Money: the full price is paid when the site is placed (resource-cost.ts).
 * Cancelling refunds the unbuilt share of what was paid (rounded down), the
 * same rule as cancelled ship orders. A planet that changes hands cancels
 * its sites with that refund to the previous owner (PlanetOwnershipService).
 *
 * Save: the three construction fields are optional; anything that is not a
 * positive finite `constructionRemaining` means "complete", so saves from
 * before construction time load unchanged (normalizeBuildingConstruction).
 */

interface ConstructionDef {
  id: string;
  name: string;
  constructionSeconds?: number;
  price?: number;
  rawMaterialCost?: number;
}

const DEFS = (planetData as { buildings: ConstructionDef[] }).buildings;
const DEF_BY_NAME = new Map(DEFS.map((d) => [d.name, d]));

/*
 * Construction speed factors. Easy to rebalance: every value lives here or in
 * planet-data.json (`constructionSeconds`) / research-tree.json
 * (`buildingConstructionSpeed` bonuses).
 *
 * coreSpeed: the planet's colony core acts as its construction hub (in the
 * spirit of Imperium Galactica II's Colony Hub): the developed Capital builds
 * faster than a young colony's Colony Center. A planet without a core builds
 * at 1.
 */
export const CONSTRUCTION_SPEED_CONFIG = {
  coreSpeed: { Capital: 1.25, 'Colony Center': 1 } as Readonly<Record<string, number>>,
} as const;

/* Base construction time (work-seconds) of a building type; 0 = completes at once. */
export function constructionSecondsFor(def: { constructionSeconds?: number } | undefined): number {
  const seconds = def?.constructionSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function constructionSecondsForName(name: string): number {
  return constructionSecondsFor(DEF_BY_NAME.get(name));
}

export function isBuildingComplete(building: Pick<PlanetBuilding, 'constructionRemaining'>): boolean {
  const left = building.constructionRemaining;
  return !(typeof left === 'number' && Number.isFinite(left) && left > 0);
}

/* The buildings that work: every effect of a building reads this list. */
export function operationalBuildings(planet: Pick<PlanetTile, 'buildings'> | null | undefined): PlanetBuilding[] {
  return (planet?.buildings ?? []).filter(isBuildingComplete);
}

export function constructionSites(planet: Pick<PlanetTile, 'buildings'> | null | undefined): PlanetBuilding[] {
  return (planet?.buildings ?? []).filter((b) => !isBuildingComplete(b));
}

/*
 * Planning view of a planet: its sites counted as finished. The AI plans with
 * it (energy, workforce, housing, comfort), so a power plant under construction
 * is not built twice and a pending consumer is not forgotten. Never mutates.
 */
export function withConstructionComplete<T extends Pick<PlanetTile, 'buildings'>>(planet: T): T {
  if (planet.buildings.every(isBuildingComplete)) return planet;
  return {
    ...planet,
    buildings: planet.buildings.map((b) => {
      if (isBuildingComplete(b)) return b;
      const { constructionRemaining: _r, constructionTotal: _t, constructionPaid: _p, ...done } = b;
      return done;
    }),
  };
}

/* Construction speed of a planet: core factor × technology multiplier. */
export function planetConstructionSpeed(planet: Pick<PlanetTile, 'buildings'>, technologyMultiplier = 1): number {
  let core = 1;
  for (const b of planet.buildings ?? []) {
    const factor = CONSTRUCTION_SPEED_CONFIG.coreSpeed[b.name];
    if (factor !== undefined) {
      core = factor;
      break;
    }
  }
  const tech = Number.isFinite(technologyMultiplier) && technologyMultiplier > 0 ? technologyMultiplier : 1;
  return core * tech;
}

/* Total work of a site (saved total, or the type's base time for malformed data). */
export function constructionTotal(building: PlanetBuilding): number {
  const total = building.constructionTotal;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) return total;
  return Math.max(constructionSecondsForName(building.name), building.constructionRemaining ?? 0, 1);
}

/* 0 … 1 share of the work done (1 = complete). */
export function buildingConstructionProgress(building: PlanetBuilding): number {
  if (isBuildingComplete(building)) return 1;
  const total = constructionTotal(building);
  return Math.max(0, Math.min(1, 1 - building.constructionRemaining! / total));
}

/* Game seconds until completion at the given construction speed (rounded up). */
export function constructionSecondsLeft(building: PlanetBuilding, speed: number): number {
  if (isBuildingComplete(building)) return 0;
  return Math.ceil(building.constructionRemaining! / (speed > 0 ? speed : 1));
}

/*
 * Places a building that has already been paid for. A type without a
 * construction time (colony cores) is complete at once; every other type
 * becomes a site.
 */
export function startBuildingConstruction(
  planet: PlanetTile,
  def: { name: string; size: number; constructionSeconds?: number },
  x: number,
  y: number,
  paid: ResourceCost,
): PlanetBuilding {
  const seconds = constructionSecondsFor(def);
  const building: PlanetBuilding = { name: def.name, size: def.size, x, y };
  if (seconds > 0) {
    building.constructionRemaining = seconds;
    building.constructionTotal = seconds;
    building.constructionPaid = { credits: paid.credits, rawmaterials: paid.rawmaterials };
  }
  planet.buildings.push(building);
  return building;
}

export interface CompletedConstruction {
  system: StarSystem;
  planet: PlanetTile;
  building: PlanetBuilding;
}

/*
 * Advances every site by `deltaSeconds` of scaled game time × its planet's
 * construction speed, and returns the buildings that completed in this step.
 * Completion only clears the construction fields: the building is then
 * operational and every consumer picks it up on its next read.
 */
export function advanceBuildingConstruction(
  starSystems: readonly StarSystem[],
  deltaSeconds: number,
  speedOf: (planet: PlanetTile) => number,
): CompletedConstruction[] {
  const completed: CompletedConstruction[] = [];
  if (!(deltaSeconds > 0)) return completed;
  for (const system of starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      let speed: number | null = null;
      for (const building of planet.buildings ?? []) {
        if (isBuildingComplete(building)) continue;
        speed ??= speedOf(planet);
        const left = building.constructionRemaining! - deltaSeconds * speed;
        if (left > 0) {
          building.constructionRemaining = left;
        } else {
          finishConstruction(building);
          completed.push({ system, planet, building });
        }
      }
    }
  }
  return completed;
}

function finishConstruction(building: PlanetBuilding): void {
  delete building.constructionRemaining;
  delete building.constructionTotal;
  delete building.constructionPaid;
}

/* Refund for cancelling a site now: the unbuilt share of what was paid, rounded down. */
export function constructionRefund(building: PlanetBuilding): ResourceCost {
  if (isBuildingComplete(building)) return { credits: 0, rawmaterials: 0 };
  const paid = validPaid(building.constructionPaid) ?? paidFromDefinition(building.name);
  const unbuilt = Math.max(0, Math.min(1, building.constructionRemaining! / constructionTotal(building)));
  return {
    credits: Math.floor(paid.credits * unbuilt),
    rawmaterials: Math.floor(paid.rawmaterials * unbuilt),
  };
}

/*
 * Removes a site from its planet and refunds its unbuilt share to `refundTo`
 * (when given). Returns the refund, or null when `building` is not a site of
 * this planet (complete buildings cannot be cancelled).
 */
export function cancelBuildingConstruction(
  planet: PlanetTile,
  building: PlanetBuilding,
  refundTo: Faction | null | undefined,
): ResourceCost | null {
  const index = planet.buildings.indexOf(building);
  if (index < 0 || isBuildingComplete(building)) return null;
  const refund = constructionRefund(building);
  planet.buildings.splice(index, 1);
  if (refundTo) refundCost(refundTo, refund);
  return refund;
}

/* Cancels every site of a planet (ownership change), refunding `refundTo`. */
export function cancelAllConstruction(planet: PlanetTile, refundTo: Faction | null | undefined): number {
  const sites = constructionSites(planet);
  for (const site of sites) cancelBuildingConstruction(planet, site, refundTo);
  return sites.length;
}

/* The site at a grid cell of the planet, if any. */
export function constructionSiteAt(planet: PlanetTile, x: number, y: number): PlanetBuilding | null {
  return constructionSites(planet).find((b) => b.x === x && b.y === y) ?? null;
}

/*
 * Load-time cleanup: a malformed or non-positive `constructionRemaining`
 * becomes "complete" (all construction fields removed); a valid site keeps
 * its timer and gets a sane total. Idempotent.
 */
export function normalizeBuildingConstruction(starSystems: readonly StarSystem[]): void {
  for (const system of starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      for (const building of planet.buildings ?? []) {
        if (isBuildingComplete(building)) {
          finishConstruction(building);
          continue;
        }
        const total = constructionTotal(building);
        building.constructionTotal = Math.max(total, building.constructionRemaining!);
        if (!validPaid(building.constructionPaid)) delete building.constructionPaid;
      }
    }
  }
}

function validPaid(paid: unknown): ResourceCost | null {
  if (!paid || typeof paid !== 'object') return null;
  const { credits, rawmaterials } = paid as Partial<ResourceCost>;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return ok(credits) && ok(rawmaterials) ? { credits: credits!, rawmaterials: rawmaterials! } : null;
}

/* Fallback refund base for a site without a valid paid record: the list price. */
function paidFromDefinition(name: string): ResourceCost {
  const def = DEF_BY_NAME.get(name);
  return { credits: def?.price ?? 0, rawmaterials: def?.rawMaterialCost ?? 0 };
}

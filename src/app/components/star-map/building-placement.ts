import { PlanetTile } from './star-map.models';
import { isFootprintBlocked } from './planet-surface/planet-surface';
import { depositMiningBlocker } from './raw-deposits';

/*
 * Player building placement rule — the single source of truth for whether a
 * building footprint may go at (x, y) on a planet surface. The planet screen
 * uses it for the live preview (and maps the reason to a message), and
 * StarMap.onBuildingConfirmed re-checks it before charging the cost, so a
 * placement can never be accepted that the preview would reject.
 *
 * x is the column and y the row of the footprint's top-left cell; a building
 * of `size` covers size × size cells.
 *
 * The AI uses its own variant (EnemyEconomyService.canPlace): same terrain,
 * overlap and "not on a deposit" rules, but a Mining Complex must cover a
 * deposit cell, while the player's only has to touch one (within 1 cell).
 */
export type PlacementError =
  | 'out_of_grid'
  | 'terrain'
  | 'overlap'
  | 'deposit_depleted'
  | 'needs_deposit'
  | 'on_deposit';

export function checkBuildingPlacement(
  planet: PlanetTile,
  gridSize: number,
  building: { size: number; requiresOreProximity?: boolean },
  x: number,
  y: number,
): PlacementError | null {
  const size = building.size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + size > gridSize || y + size > gridSize) {
    return 'out_of_grid';
  }
  if (isFootprintBlocked(planet, x, y, size)) {
    return 'terrain';
  }
  const overlaps = (planet.buildings ?? []).some(
    (b) => x < b.x + b.size && x + size > b.x && y < b.y + b.size && y + size > b.y,
  );
  if (overlaps) {
    return 'overlap';
  }

  const resourceTiles = planet.resourceTiles ?? [];
  if (building.requiresOreProximity === true) {
    if (depositMiningBlocker(planet) === 'depleted') {
      return 'deposit_depleted';
    }
    const touches = resourceTiles.some(
      (rt) => rt.x >= x - 1 && rt.x <= x + size && rt.y >= y - 1 && rt.y <= y + size,
    );
    return touches ? null : 'needs_deposit';
  }
  const onDeposit = resourceTiles.some((rt) => rt.x >= x && rt.x < x + size && rt.y >= y && rt.y < y + size);
  return onDeposit ? 'on_deposit' : null;
}

export const PLACEMENT_ERROR_MESSAGES: Record<PlacementError, string> = {
  out_of_grid: 'This area does not fit the building.',
  terrain: 'The terrain here is not suitable for construction.',
  overlap: 'Area overlaps with existing buildings.',
  deposit_depleted: 'This deposit is depleted: a new mine would produce nothing.',
  needs_deposit: 'Mining Complex must be placed near a raw material deposit.',
  on_deposit: 'Cannot build directly on a resource deposit.',
};

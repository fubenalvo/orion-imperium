import { Fleet, Wormhole } from './star-map.models';
import { NavPoint, RoutePlan, routeLength } from './fleet-navigation';

/*
 * =========================================================
 * WORMHOLE TRANSIT (pure rules)
 * =========================================================
 *
 * Campaign maps can link two galaxy cells with an active wormhole
 * (docs/campaign-design.md §11). Every route — player and AI fleets,
 * civilian traders — comes from StarMapMovementService.planGalaxyRoute,
 * which asks `planWormholeRoute` here, so everyone uses a wormhole exactly
 * when it is shorter; no AI code knows about them.
 *
 * A route through a wormhole is an ordinary waypoint list whose waypoint on
 * the entry mouth carries `jump`. Whoever follows the route enters transit
 * on that waypoint (hidden, cannot fight or be fought, senses nothing) and
 * comes out on the exit mouth after `transitSeconds`, then flies on.
 *
 * Invariants:
 * - dormant wormholes and exit gates (one mouth) are never routed through;
 * - a route uses at most one wormhole (maps have one or two; chaining them
 *   is not needed and would multiply the planning cost);
 * - the transit state is saved on the fleet / trader, while routes are a
 *   runtime cache: a load mid-transit finishes the jump first and only then
 *   re-plans from the exit, so a jump is never taken twice.
 */

export const WORMHOLE_CONFIG = {
  /* Game seconds inside the wormhole. */
  transitSeconds: 20,
  /*
   * Route cost of a transit in cells, for comparing routes: transitSeconds
   * at the reference fleet speed of 0.2 cells/s (an assembled fleet).
   */
  transitCostCells: 4,
} as const;

export interface WormholeJump {
  wormholeId: string;
  exitX: number;
  exitY: number;
  transitSeconds: number;
}

/* Saved on a fleet (Fleet.transit) or a trader (Trader.transit) while inside a wormhole. */
export interface WormholeTransit {
  wormholeId: string;
  remaining: number;
  exitX: number;
  exitY: number;
}

/* A saved transit is usable: finite numbers and an id. Malformed ones are dropped on load. */
export function isWellFormedTransit(value: unknown): value is WormholeTransit {
  const t = value as WormholeTransit;
  return !!t && typeof t === 'object' && typeof t.wormholeId === 'string'
    && [t.remaining, t.exitX, t.exitY].every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function isInTransit(entity: { transit?: WormholeTransit | null }): boolean {
  return !!entity.transit;
}

/* Fleets that exist on the map right now (not destroyed, not inside a wormhole). */
export function isFleetOnMap(fleet: Fleet): boolean {
  return !fleet.destroyed && !fleet.transit;
}

/*
 * The cheapest route from `from` to `to`: the direct one, or one through an
 * active two-mouth wormhole in either direction. `plan` is the obstacle-only
 * planner (NavGraph.plan).
 */
export function planWormholeRoute(
  plan: (from: NavPoint, to: NavPoint) => RoutePlan,
  from: NavPoint,
  to: NavPoint,
  wormholes: readonly Wormhole[],
): RoutePlan {
  const direct = plan(from, to);
  let best: RoutePlan | null = direct.ok ? direct : null;
  let bestCost = direct.ok ? routeLength(from, direct.waypoints, to) : Infinity;
  for (const wormhole of wormholes) {
    if (wormhole.state !== 'active' || wormhole.mouths.length !== 2) continue;
    const [a, b] = wormhole.mouths as [NavPoint, NavPoint];
    for (const [entry, exit] of [[a, b], [b, a]] as const) {
      const toEntry = plan(from, entry);
      if (!toEntry.ok) continue;
      const fromExit = plan(exit, to);
      if (!fromExit.ok) continue;
      const cost = routeLength(from, toEntry.waypoints, entry) + WORMHOLE_CONFIG.transitCostCells + routeLength(exit, fromExit.waypoints, to);
      if (cost >= bestCost) continue;
      bestCost = cost;
      best = {
        ok: true,
        waypoints: [
          ...toEntry.waypoints,
          {
            x: entry.x,
            y: entry.y,
            jump: { wormholeId: wormhole.id, exitX: exit.x, exitY: exit.y, transitSeconds: WORMHOLE_CONFIG.transitSeconds },
          },
          ...fromExit.waypoints,
        ],
      };
    }
  }
  return best ?? direct;
}

/*
 * Game seconds along a polyline that may contain jump waypoints: the legs
 * on both sides of each jump plus its transit time (the jump itself is not
 * flown). `legSeconds` measures one ordinary polyline (nebula slowdown).
 */
export function routeTravelSeconds(points: readonly NavPoint[], legSeconds: (polyline: NavPoint[]) => number): number {
  let total = 0;
  let leg: NavPoint[] = [];
  for (const point of points) {
    leg.push(point);
    if (point.jump) {
      total += legSeconds(leg) + point.jump.transitSeconds;
      leg = [{ x: point.jump.exitX, y: point.jump.exitY }];
    }
  }
  return total + legSeconds(leg);
}

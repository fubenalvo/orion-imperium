import { SpecialObject } from './star-map.models';

/*
 * =========================================================
 * FLEET NAVIGATION (galaxy map routing around obstacles)
 * =========================================================
 *
 * Pure geometry used by StarMapMovementService to keep fleets out of black
 * holes and asteroid belts. Every galaxy-map order (player clicks, every AI
 * subsystem, asteroid intercepts) only sets `Fleet.targetX/targetY`; the
 * movement service plans a route to that target and flies its legs.
 * Routing is therefore applied identically to the player and the AI
 * without any caller having to know about obstacles. See
 * docs/star-map-terrain.md.
 *
 * Model:
 * - Every obstacle is a capsule: the set of points closer than `radius` to
 *   the segment (x, y)→(x2, y2). Without x2/y2 the segment is a point and
 *   the capsule is a disc (black holes). Asteroid belts are chains of
 *   capsules (one per polyline segment, sharing endpoints, so a belt has no
 *   gaps). A route is valid when no leg comes closer to any obstacle's
 *   segment than its radius.
 * - When the straight line is blocked, the route is the shortest path in a
 *   visibility graph whose nodes are vertices of a polygon circumscribed
 *   around each capsule (slightly inflated). Polygon edges never touch the
 *   capsule, so following the polygon is safe.
 * - NavGraph caches the obstacle vertices and the vertex-to-vertex
 *   visibility for one terrain configuration; a query only tests the start
 *   and target against the vertices. StarMapTerrainService keeps one graph
 *   per loaded galaxy.
 * - Coordinates are the 1-indexed grid coordinates of Fleet.x/y. Waypoints
 *   are kept inside the map bounds; vertices outside the map are dropped, so
 *   an obstacle end too close to the border is not a passage.
 *
 * Edge cases:
 * - A target inside an obstacle is rejected ('target_blocked').
 * - A start inside an obstacle (only possible for saves made before the
 *   obstacle existed) ignores that obstacle so the fleet can leave.
 * - If no path exists ('no_route'), the caller must not move the fleet —
 *   flying straight through is never a fallback.
 */

export interface NavPoint {
  x: number;
  y: number;
}

export type NavObstacleKind = 'blackhole' | 'belt';

export interface NavObstacle {
  x: number;
  y: number;
  radius: number;
  /* Second end of the capsule axis; absent for a disc. */
  x2?: number;
  y2?: number;
  kind?: NavObstacleKind;
}

export interface NavBounds {
  width: number;
  height: number;
}

export type RouteFailure = 'target_blocked' | 'no_route';

export type RoutePlan =
  | { ok: true; waypoints: NavPoint[] }
  | { ok: false; reason: RouteFailure; blockedBy?: NavObstacleKind };

/*
 * Default no-fly radius (grid cells) of a black hole that does not carry an
 * explicit `navigationRadius`. The generated black hole spans 4×4 cells; a
 * radius of 4 makes the obstacle as wide as its rendered event horizon and
 * photon ring, and stays far inside every preset's blackHoleClearance
 * (≥ 14 cells), so no star system or starting fleet is ever cut off.
 */
export const BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS = 4;

/* Number of vertices of a full routing polygon (a capsule cap uses half + 1). */
const ROUTE_POLYGON_SIDES = 16;
/* The polygon is inflated by this fraction so legs keep a safety margin. */
const ROUTE_CLEARANCE_FACTOR = 1.05;
const EPSILON = 1e-6;

export function isBlackHole(obj: SpecialObject): boolean {
  return obj.type === 'blackhole';
}

/*
 * Center of a special object in fleet coordinates. A span starting at cell
 * x with width w covers cells x..x+w-1, whose centers are the coordinates
 * x..x+w-1; the middle is x + (w-1)/2 (same formula galaxy validation uses).
 */
export function specialObjectCenter(obj: SpecialObject): NavPoint {
  return { x: obj.x + (obj.width - 1) / 2, y: obj.y + (obj.height - 1) / 2 };
}

export function blackHoleNavigationRadius(obj: SpecialObject): number {
  if (
    typeof obj.navigationRadius === 'number' &&
    Number.isFinite(obj.navigationRadius) &&
    obj.navigationRadius > 0
  ) {
    return obj.navigationRadius;
  }
  return Math.max(BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS, Math.max(obj.width, obj.height) / 2);
}

export function buildNavObstacles(
  specialObjects: readonly SpecialObject[] | undefined,
): NavObstacle[] {
  return (specialObjects ?? []).filter(isBlackHole).map((obj) => ({
    ...specialObjectCenter(obj),
    radius: blackHoleNavigationRadius(obj),
    kind: 'blackhole' as const,
  }));
}

export function obstacleEnd(o: NavObstacle): NavPoint {
  return { x: o.x2 ?? o.x, y: o.y2 ?? o.y };
}

export function distance(a: NavPoint, b: NavPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* Shortest distance from point p to the segment a→b. */
export function distanceToSegment(p: NavPoint, a: NavPoint, b: NavPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPSILON * EPSILON) {
    return distance(p, a);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

function cross(o: NavPoint, a: NavPoint, b: NavPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/* Shortest distance between the segments a→b and c→d (0 when they cross). */
export function segmentDistance(a: NavPoint, b: NavPoint, c: NavPoint, d: NavPoint): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/* Distance from a point to the obstacle's axis (≤ radius means inside or on it). */
export function distanceToObstacleAxis(p: NavPoint, o: NavObstacle): number {
  return distanceToSegment(p, o, obstacleEnd(o));
}

export function isPointInObstacle(p: NavPoint, obstacle: NavObstacle): boolean {
  return distanceToObstacleAxis(p, obstacle) < obstacle.radius - EPSILON;
}

/* True when the segment a→b enters the obstacle's forbidden area. */
export function segmentIntersectsObstacle(
  a: NavPoint,
  b: NavPoint,
  obstacle: NavObstacle,
): boolean {
  // Cheap bounding-box rejection before the exact test.
  const end = obstacleEnd(obstacle);
  const r = obstacle.radius;
  if (
    Math.max(a.x, b.x) < Math.min(obstacle.x, end.x) - r ||
    Math.min(a.x, b.x) > Math.max(obstacle.x, end.x) + r ||
    Math.max(a.y, b.y) < Math.min(obstacle.y, end.y) - r ||
    Math.min(a.y, b.y) > Math.max(obstacle.y, end.y) + r
  ) {
    return false;
  }
  return segmentDistance(a, b, obstacle, end) < r - EPSILON;
}

export function isSegmentClear(
  a: NavPoint,
  b: NavPoint,
  obstacles: readonly NavObstacle[],
): boolean {
  return obstacles.every((o) => !segmentIntersectsObstacle(a, b, o));
}

/*
 * Routing vertices around one obstacle: a regular polygon for a disc, a
 * "stadium" for a capsule (a half polygon around each end; the straight
 * sides join the outermost vertices, parallel to the axis at distance R).
 */
function obstacleVertices(o: NavObstacle): NavPoint[] {
  const R = (o.radius * ROUTE_CLEARANCE_FACTOR) / Math.cos(Math.PI / ROUTE_POLYGON_SIDES);
  const step = (Math.PI * 2) / ROUTE_POLYGON_SIDES;
  const end = obstacleEnd(o);
  const length = distance(o, end);
  if (length < EPSILON) {
    return Array.from({ length: ROUTE_POLYGON_SIDES }, (_, i) => ({
      x: o.x + R * Math.cos(i * step),
      y: o.y + R * Math.sin(i * step),
    }));
  }
  const axis = Math.atan2(end.y - o.y, end.x - o.x);
  const half = ROUTE_POLYGON_SIDES / 2;
  const vertices: NavPoint[] = [];
  for (let i = 0; i <= half; i++) {
    // Cap around the end point: from -90° to +90° relative to the axis.
    const angle = axis - Math.PI / 2 + i * step;
    vertices.push({ x: end.x + R * Math.cos(angle), y: end.y + R * Math.sin(angle) });
  }
  for (let i = 0; i <= half; i++) {
    // Cap around the start point: from +90° to +270°.
    const angle = axis + Math.PI / 2 + i * step;
    vertices.push({ x: o.x + R * Math.cos(angle), y: o.y + R * Math.sin(angle) });
  }
  return vertices;
}

/*
 * Visibility graph of one terrain configuration. Building costs
 * O(V² × obstacles) once; each `plan` costs O(V × obstacles) visibility
 * tests for the start and target plus an O(V²) Dijkstra.
 */
export class NavGraph {
  private readonly vertices: NavPoint[] = [];
  private readonly adjacency: { to: number; cost: number }[][] = [];

  constructor(
    readonly obstacles: readonly NavObstacle[],
    readonly bounds?: NavBounds,
  ) {
    for (const obstacle of obstacles) {
      for (const vertex of obstacleVertices(obstacle)) {
        if (
          bounds &&
          (vertex.x < 1 || vertex.y < 1 || vertex.x > bounds.width || vertex.y > bounds.height)
        ) {
          continue;
        }
        if (obstacles.some((o) => isPointInObstacle(vertex, o))) {
          continue;
        }
        this.vertices.push(vertex);
      }
    }
    const count = this.vertices.length;
    for (let i = 0; i < count; i++) {
      this.adjacency.push([]);
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = this.vertices[i];
        const b = this.vertices[j];
        if (isSegmentClear(a, b, obstacles)) {
          const cost = distance(a, b);
          this.adjacency[i].push({ to: j, cost });
          this.adjacency[j].push({ to: i, cost });
        }
      }
    }
  }

  get vertexCount(): number {
    return this.vertices.length;
  }

  /*
   * True when every point can reach every other point. Equivalent to
   * `plan(a, b).ok` for all pairs (same nodes and edges), but computed once
   * with union-find over the cached graph: O(points × vertices) visibility
   * tests instead of one Dijkstra per pair. Used by belt generation and
   * galaxy validation.
   */
  arePointsConnected(points: readonly NavPoint[]): boolean {
    if (points.some((p) => this.obstacles.some((o) => isPointInObstacle(p, o)))) {
      return false;
    }
    const v = this.vertices.length;
    const parent = Array.from({ length: v + points.length }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number) => {
      parent[find(a)] = find(b);
    };
    this.adjacency.forEach((edges, i) => edges.forEach((e) => union(i, e.to)));
    points.forEach((p, k) => {
      for (let i = 0; i < v; i++) {
        if (find(v + k) !== find(i) && isSegmentClear(p, this.vertices[i], this.obstacles)) {
          union(v + k, i);
        }
      }
      for (let j = 0; j < k; j++) {
        if (find(v + k) !== find(v + j) && isSegmentClear(p, points[j], this.obstacles)) {
          union(v + k, v + j);
        }
      }
    });
    const root = find(v);
    return points.every((_, k) => find(v + k) === root);
  }

  /*
   * Plans a route from `from` to `to`. Returns the intermediate waypoints
   * (neither the start nor the target); an empty list means a straight
   * flight is safe.
   */
  plan(from: NavPoint, to: NavPoint): RoutePlan {
    const blocking = this.obstacles.find((o) => isPointInObstacle(to, o));
    if (blocking) {
      return { ok: false, reason: 'target_blocked', blockedBy: blocking.kind };
    }
    if (this.obstacles.some((o) => isPointInObstacle(from, o))) {
      // Legacy start inside an obstacle: route without it (uncached, rare).
      const escape = this.obstacles.filter((o) => !isPointInObstacle(from, o));
      return new NavGraph(escape, this.bounds).plan(from, to);
    }
    if (isSegmentClear(from, to, this.obstacles)) {
      return { ok: true, waypoints: [] };
    }

    // Node 0 = start, 1 = target, 2.. = cached obstacle vertices.
    const count = this.vertices.length + 2;
    const node = (i: number): NavPoint => (i === 0 ? from : i === 1 ? to : this.vertices[i - 2]);
    const targetVisible = this.vertices.map((v) => isSegmentClear(v, to, this.obstacles));
    const dist = new Array<number>(count).fill(Infinity);
    const prev = new Array<number>(count).fill(-1);
    const done = new Array<boolean>(count).fill(false);
    dist[0] = 0;
    for (let i = 0; i < this.vertices.length; i++) {
      if (isSegmentClear(from, this.vertices[i], this.obstacles)) {
        dist[i + 2] = distance(from, this.vertices[i]);
        prev[i + 2] = 0;
      }
    }
    done[0] = true;
    for (;;) {
      let current = -1;
      for (let i = 1; i < count; i++) {
        if (!done[i] && dist[i] < Infinity && (current === -1 || dist[i] < dist[current])) {
          current = i;
        }
      }
      if (current === -1 || current === 1) {
        break;
      }
      done[current] = true;
      const vertexIndex = current - 2;
      if (targetVisible[vertexIndex]) {
        const candidate = dist[current] + distance(node(current), to);
        if (candidate < dist[1]) {
          dist[1] = candidate;
          prev[1] = current;
        }
      }
      for (const edge of this.adjacency[vertexIndex]) {
        const next = edge.to + 2;
        if (!done[next] && dist[current] + edge.cost < dist[next]) {
          dist[next] = dist[current] + edge.cost;
          prev[next] = current;
        }
      }
    }

    if (dist[1] === Infinity) {
      return { ok: false, reason: 'no_route' };
    }
    const waypoints: NavPoint[] = [];
    for (let n = prev[1]; n > 0; n = prev[n]) {
      waypoints.unshift({ ...node(n) });
    }
    return { ok: true, waypoints };
  }
}

/* One-off route planning (builds a throwaway graph; prefer a cached NavGraph). */
export function planRoute(
  from: NavPoint,
  to: NavPoint,
  obstacles: readonly NavObstacle[],
  bounds?: NavBounds,
): RoutePlan {
  return new NavGraph(obstacles, bounds).plan(from, to);
}

/* Total length of the path start → waypoints → target. */
export function routeLength(from: NavPoint, waypoints: readonly NavPoint[], to: NavPoint): number {
  let total = 0;
  let cursor = from;
  for (const point of [...waypoints, to]) {
    total += distance(cursor, point);
    cursor = point;
  }
  return total;
}

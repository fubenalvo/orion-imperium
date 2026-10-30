import { PlanetBuilding } from '../star-map.models';

/*
 * =========================================================
 * SETTLEMENT LAYOUT — streets, plots and street lights
 * =========================================================
 *
 * Purely visual, derived from the building list every time it changes;
 * nothing here is persisted or affects gameplay.
 *
 * Streets run on the lattice of cell edges (grid lines), never through
 * cells, so they never claim buildable space: buildings are drawn inset
 * from their footprint and the street occupies the gap between neighbours.
 *
 * - Every building of size ≥ 2 gets a ring street on its footprint border,
 *   so adjacent buildings share a street and clusters read as city blocks.
 * - All buildings are joined into one network: repeated multi-source
 *   shortest paths (Prim-like) from the network to the nearest unconnected
 *   building, with existing streets cheap and turns penalised, which keeps
 *   streets straight and makes them merge into shared avenues.
 * - One access road leaves the grid onto open land (when the renderer can
 *   tell where open land is), tying the colony to its surroundings.
 *
 * Lattice edges are walkable only if at least one adjacent cell is
 * buildable (inside the grid and not terrain-blocked) and the edge is not
 * inside a single building. Coordinates in the output are world cell units
 * (the grid starts at `margin`), matching the ground-plane SVG viewBox.
 */

export interface SettlementLayout {
  /* SVG path data (world cell units) of the street centerlines. */
  streets: string;
  /* Access road(s) outside the grid, drawn fading out. */
  accessRoads: { d: string; opacity: number }[];
  plots: { x: number; y: number; size: number }[];
  lights: { x: number; y: number }[];
}

const STREET_COST = 1;
const REUSE_COST = 0.3;
const TURN_COST = 0.7;
const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function computeSettlementLayout(
  buildings: readonly PlanetBuilding[],
  gridSize: number,
  blocked: Uint8Array | null,
  margin: number,
  isOpenLand?: (u: number, v: number) => boolean,
): SettlementLayout {
  const n = gridSize;
  const side = n + 1;
  const owner = new Int32Array(n * n).fill(-1);
  buildings.forEach((b, index) => {
    for (let y = b.y; y < b.y + b.size; y++) {
      for (let x = b.x; x < b.x + b.size; x++) {
        if (x >= 0 && y >= 0 && x < n && y < n) owner[y * n + x] = index;
      }
    }
  });
  const buildable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && !(blocked && blocked[y * n + x]);
  const ownerAt = (x: number, y: number) => (x >= 0 && y >= 0 && x < n && y < n ? owner[y * n + x] : -1);

  // Edge (node a → node b) is identified by its lower node and orientation.
  const roadH = new Uint8Array(side * side); // (i,j)→(i+1,j)
  const roadV = new Uint8Array(side * side); // (i,j)→(i,j+1)
  const edgeCells = (i: number, j: number, horizontal: boolean): [number, number, number, number] =>
    horizontal ? [i, j - 1, i, j] : [i - 1, j, i, j];
  const passable = (i: number, j: number, horizontal: boolean): boolean => {
    const [ax, ay, bx, by] = edgeCells(i, j, horizontal);
    const oa = ownerAt(ax, ay);
    if (oa >= 0 && oa === ownerAt(bx, by)) return false;
    return buildable(ax, ay) || buildable(bx, by);
  };

  if (buildings.length === 0) {
    return { streets: '', accessRoads: [], plots: [], lights: [] };
  }

  // Ring streets around blocks.
  for (const b of buildings) {
    if (b.size < 2) continue;
    for (let k = 0; k < b.size; k++) {
      markEdge(b.x + k, b.y, true);
      markEdge(b.x + k, b.y + b.size, true);
      markEdge(b.x, b.y + k, false);
      markEdge(b.x + b.size, b.y + k, false);
    }
  }
  function markEdge(i: number, j: number, horizontal: boolean): void {
    if (i < 0 || j < 0 || i > n || j > n) return;
    if (horizontal && i < n) roadH[j * side + i] = 1;
    if (!horizontal && j < n) roadV[j * side + i] = 1;
  }

  // Access nodes of each building: its footprint corners/perimeter nodes.
  const access = buildings.map((b) => {
    const nodes: number[] = [];
    for (let k = 0; k <= b.size; k++) {
      nodes.push(b.y * side + b.x + k, (b.y + b.size) * side + b.x + k);
      nodes.push((b.y + k) * side + b.x, (b.y + k) * side + b.x + b.size);
    }
    return nodes.filter((node) => node >= 0 && node < side * side);
  });

  // Start from the building nearest the grid center (the colony core).
  const center = n / 2;
  const order = buildings
    .map((b, index) => ({ index, d: Math.hypot(b.x + b.size / 2 - center, b.y + b.size / 2 - center) }))
    .sort((a, b) => a.d - b.d);
  const inNetwork = new Uint8Array(side * side);
  const connected = new Uint8Array(buildings.length);
  const addBuilding = (index: number) => {
    connected[index] = 1;
    for (const node of access[index]) inNetwork[node] = 1;
  };
  addBuilding(order[0].index);
  absorbTouching();

  const nodeOwners = new Map<number, number[]>();
  access.forEach((nodes, index) => {
    for (const node of nodes) {
      const list = nodeOwners.get(node);
      if (list) list.push(index);
      else nodeOwners.set(node, [index]);
    }
  });

  for (let guard = 0; guard < buildings.length; guard++) {
    if (connected.every((c) => c === 1)) break;
    const path = shortestPath(
      (node) => inNetwork[node] === 1,
      (node) => (nodeOwners.get(node) ?? []).some((index) => !connected[index]),
    );
    if (!path) break;
    for (const [i, j, horizontal] of path.edges) markEdge(i, j, horizontal);
    for (const node of path.nodes) inNetwork[node] = 1;
    for (const index of nodeOwners.get(path.nodes[path.nodes.length - 1]) ?? []) {
      if (!connected[index]) addBuilding(index);
    }
    absorbTouching();
  }

  // Buildings whose access nodes already touch the network count as joined.
  function absorbTouching(): void {
    let changed = true;
    while (changed) {
      changed = false;
      access.forEach((nodes, index) => {
        if (!connected[index] && nodes.some((node) => inNetwork[node])) {
          addBuilding(index);
          changed = true;
        }
      });
    }
  }

  /*
   * Dijkstra over (node, arrival direction) states so turns can be priced.
   * Returns the cheapest path from any source node to any target node.
   */
  function shortestPath(
    isSource: (node: number) => boolean,
    isTarget: (node: number) => boolean,
  ): { edges: [number, number, boolean][]; nodes: number[] } | null {
    const states = side * side * 5;
    const dist = new Float64Array(states).fill(Infinity);
    const prev = new Int32Array(states).fill(-1);
    const heap = new MinHeap();
    for (let node = 0; node < side * side; node++) {
      if (isSource(node)) {
        dist[node * 5 + 4] = 0;
        heap.push(node * 5 + 4, 0);
      }
    }
    while (heap.size > 0) {
      const [state, cost] = heap.pop();
      if (cost > dist[state]) continue;
      const node = Math.floor(state / 5);
      const dir = state % 5;
      if (isTarget(node) && !isSource(node)) {
        const edges: [number, number, boolean][] = [];
        const nodes: number[] = [node];
        let cur = state;
        while (prev[cur] >= 0) {
          const from = Math.floor(prev[cur] / 5);
          const to = Math.floor(cur / 5);
          const fi = from % side;
          const fj = Math.floor(from / side);
          const ti = to % side;
          const tj = Math.floor(to / side);
          edges.push(fj === tj ? [Math.min(fi, ti), fj, true] : [fi, Math.min(fj, tj), false]);
          nodes.push(from);
          cur = prev[cur];
        }
        return { edges, nodes: nodes.reverse() };
      }
      const i = node % side;
      const j = Math.floor(node / side);
      for (let d = 0; d < 4; d++) {
        const ni = i + DIRS[d][0];
        const nj = j + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni > n || nj > n) continue;
        const horizontal = DIRS[d][1] === 0;
        const ei = horizontal ? Math.min(i, ni) : i;
        const ej = horizontal ? j : Math.min(j, nj);
        if (!passable(ei, ej, horizontal)) continue;
        const existing = horizontal ? roadH[ej * side + ei] : roadV[ej * side + ei];
        let step = existing ? REUSE_COST : STREET_COST;
        if (dir !== 4 && dir !== d) step += TURN_COST;
        const next = (nj * side + ni) * 5 + d;
        const nc = cost + step;
        if (nc < dist[next]) {
          dist[next] = nc;
          prev[next] = state;
          heap.push(next, nc);
        }
      }
    }
    return null;
  }

  const accessRoads = isOpenLand ? buildAccessRoad() : [];

  /*
   * Access road: the cheapest street from the network to a border node whose
   * outward continuation crosses open land for a few cells, then extended
   * straight out of the grid, fading. A street already on a suitable border
   * node is used as is.
   */
  function buildAccessRoad(): { d: string; opacity: number }[] {
    const reach = (i: number, j: number): { dir: [number, number]; len: number } | null => {
      const dir: [number, number] | null =
        i === n ? [1, 0] : j === n ? [0, 1] : i === 0 ? [-1, 0] : j === 0 ? [0, -1] : null;
      if (!dir) return null;
      let len = 0;
      for (let k = 1; k <= margin - 3; k++) {
        if (!isOpenLand!(margin + i + dir[0] * (k - 0.5), margin + j + dir[1] * (k - 0.5))) break;
        len = k;
      }
      return len >= 3 ? { dir, len } : null;
    };
    const exitsGrid = (node: number) => reach(node % side, Math.floor(node / side)) !== null;
    let end = -1;
    for (let node = 0; node < side * side && end < 0; node++) {
      if (inNetwork[node] && exitsGrid(node)) end = node;
    }
    if (end < 0) {
      const path = shortestPath((node) => inNetwork[node] === 1, exitsGrid);
      if (!path) return [];
      for (const [pi, pj, horizontal] of path.edges) markEdge(pi, pj, horizontal);
      end = path.nodes[path.nodes.length - 1];
    }
    const i = end % side;
    const j = Math.floor(end / side);
    const out = reach(i, j)!;
    const roads: { d: string; opacity: number }[] = [];
    const steps = out.len;
    for (let k = 0; k < steps; k++) {
      const x1 = margin + i + out.dir[0] * k;
      const y1 = margin + j + out.dir[1] * k;
      roads.push({
        d: `M${x1} ${y1}L${x1 + out.dir[0]} ${y1 + out.dir[1]}`,
        opacity: 1 - k / (steps + 1),
      });
    }
    return roads;
  }

  // Merge collinear edges into runs for clean dashes and fewer path commands.
  let streets = '';
  for (let j = 0; j <= n; j++) {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && roadH[j * side + i] === 1;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        streets += `M${margin + start} ${margin + j}H${margin + i}`;
        start = -1;
      }
    }
  }
  for (let i = 0; i <= n; i++) {
    let start = -1;
    for (let j = 0; j <= n; j++) {
      const on = j < n && roadV[j * side + i] === 1;
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        streets += `M${margin + i} ${margin + start}V${margin + j}`;
        start = -1;
      }
    }
  }

  // Street lights on junctions and street ends.
  const lights: { x: number; y: number }[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      let degree = 0;
      if (i < n && roadH[j * side + i]) degree++;
      if (i > 0 && roadH[j * side + i - 1]) degree++;
      if (j < n && roadV[j * side + i]) degree++;
      if (j > 0 && roadV[(j - 1) * side + i]) degree++;
      if (degree >= 3 || degree === 1) lights.push({ x: margin + i, y: margin + j });
    }
  }

  return {
    streets,
    accessRoads,
    plots: buildings.map((b) => ({ x: margin + b.x, y: margin + b.y, size: b.size })),
    lights,
  };
}

class MinHeap {
  private readonly items: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, cost: number): void {
    this.items.push(item);
    this.costs.push(cost);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.items[0], this.costs[0]];
    const lastItem = this.items.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.costs[l] < this.costs[smallest]) smallest = l;
        if (r < this.items.length && this.costs[r] < this.costs[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
  }
}

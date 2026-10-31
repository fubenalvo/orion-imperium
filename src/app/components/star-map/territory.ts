import { Faction, SpaceBase, StarSystem } from './star-map.models';

/*
 * =========================================================
 * TERRITORY (pure)
 * =========================================================
 *
 * Empire territory on the galaxy map (docs/territory.md). Territory is
 * DERIVED, never stored: it is recomputed from planet owners and space
 * bases, so it can never disagree with them.
 *
 * Claim sources:
 *  - a star system claims a disc of `systemClaimRadius` cells around its
 *    star for its claim owner (systemClaimOwner: the non-neutral faction
 *    with the most planets there);
 *  - a space base claims a disc of `baseClaimRadius` cells around itself
 *    for its owner.
 *
 * Overlap rule (one owner per cell, deterministic):
 *  1. system claims beat base claims (colonies are the stronger anchor, so
 *     taking a planet always takes the system's space);
 *  2. otherwise the nearest claim source wins (squared cell distance);
 *  3. ties go to the older source: systems by their order in starSystems,
 *     bases by lower id.
 *
 * Neutral factions (team 0: independent rebels, unhabited) never own
 * territory. Cells use the movement grid convention: a position (x, y)
 * lies in cell (floor(x), floor(y)); star systems and bases sit on integer
 * cells, and distances are measured between cell coordinates.
 */
export const TERRITORY_CONFIG = {
  /* Claim radius around a star system with an owner (cells). Systems are 22–30+ cells apart. */
  systemClaimRadius: 7,
  /* Claim radius around a space base (cells); smaller than a system's. */
  baseClaimRadius: 5,
} as const;

export type ClaimKind = 'system' | 'base';

export interface TerritoryClaim {
  kind: ClaimKind;
  /* Star system id, or the base id as a string. */
  sourceId: string;
  factionId: string;
  col: number;
  row: number;
  radius: number;
  /* Tie-break rank inside its kind: lower = older = wins. */
  order: number;
}

/*
 * The faction whose territory a star system is: the non-neutral faction
 * owning the most planets there; ties → higher total population → lower
 * faction id. null when no non-neutral faction owns a planet there.
 */
export function systemClaimOwner(system: StarSystem, factions: readonly Faction[]): string | null {
  const stats = new Map<string, { planets: number; population: number }>();
  for (const planet of system.planetsTiles ?? []) {
    const owner = factions.find((f) => f.id === planet.factionId);
    if (!owner || owner.team === 0) continue;
    const entry = stats.get(owner.id) ?? { planets: 0, population: 0 };
    entry.planets += 1;
    entry.population += planet.population ?? 0;
    stats.set(owner.id, entry);
  }
  let best: string | null = null;
  let bestStats = { planets: 0, population: 0 };
  for (const [id, entry] of stats) {
    const better =
      best === null ||
      entry.planets > bestStats.planets ||
      (entry.planets === bestStats.planets && entry.population > bestStats.population) ||
      (entry.planets === bestStats.planets && entry.population === bestStats.population && id < best);
    if (better) {
      best = id;
      bestStats = entry;
    }
  }
  return best;
}

export function collectClaims(
  starSystems: readonly StarSystem[],
  bases: readonly SpaceBase[],
  factions: readonly Faction[],
): TerritoryClaim[] {
  const claims: TerritoryClaim[] = [];
  starSystems.forEach((system, index) => {
    const owner = systemClaimOwner(system, factions);
    if (owner) {
      claims.push({
        kind: 'system',
        sourceId: system.id,
        factionId: owner,
        col: Math.floor(system.x),
        row: Math.floor(system.y),
        radius: TERRITORY_CONFIG.systemClaimRadius,
        order: index,
      });
    }
  });
  for (const base of bases) {
    const owner = factions.find((f) => f.id === base.factionId);
    if (!owner || owner.team === 0) continue;
    claims.push({
      kind: 'base',
      sourceId: String(base.id),
      factionId: base.factionId,
      col: Math.floor(base.x),
      row: Math.floor(base.y),
      radius: TERRITORY_CONFIG.baseClaimRadius,
      order: base.id,
    });
  }
  return claims;
}

/* true when claim `a` takes a cell from claim `b` at the given squared distances. */
function claimBeats(a: TerritoryClaim, da: number, b: TerritoryClaim, db: number): boolean {
  if (a.kind !== b.kind) return a.kind === 'system';
  if (da !== db) return da < db;
  return a.order < b.order;
}

const cellKey = (col: number, row: number): number => row * 100000 + col;

/*
 * Resolved territory: one owner per cell. Built once per territory change
 * (TerritoryService caches it), so lookups during the frame loop are O(1).
 */
export class TerritoryMap {
  private readonly owners = new Map<number, string>();
  private readonly winningClaim = new Map<number, TerritoryClaim>();
  private readonly systemOwners = new Map<string, string>();

  constructor(
    readonly claims: readonly TerritoryClaim[],
    readonly width: number,
    readonly height: number,
  ) {
    const distances = new Map<number, number>();
    for (const claim of claims) {
      if (claim.kind === 'system') this.systemOwners.set(claim.sourceId, claim.factionId);
      const r = claim.radius;
      for (let row = Math.max(1, claim.row - r); row <= Math.min(height, claim.row + r); row++) {
        for (let col = Math.max(1, claim.col - r); col <= Math.min(width, claim.col + r); col++) {
          const d = (col - claim.col) ** 2 + (row - claim.row) ** 2;
          if (d > r * r) continue;
          const key = cellKey(col, row);
          const current = this.winningClaim.get(key);
          if (current && !claimBeats(claim, d, current, distances.get(key)!)) continue;
          this.winningClaim.set(key, claim);
          distances.set(key, d);
          this.owners.set(key, claim.factionId);
        }
      }
    }
  }

  /* Owner of a grid cell, or null for neutral space. */
  ownerAt(col: number, row: number): string | null {
    return this.owners.get(cellKey(col, row)) ?? null;
  }

  /* Owner of the cell containing a (fractional) grid position. */
  ownerAtPoint(x: number, y: number): string | null {
    return this.ownerAt(Math.floor(x), Math.floor(y));
  }

  /* The claim that won a cell (why the cell has its owner). */
  claimAt(col: number, row: number): TerritoryClaim | null {
    return this.winningClaim.get(cellKey(col, row)) ?? null;
  }

  /* Faction whose territory the system's star cell is (its claim, or a base claim covering it). */
  systemTerritoryOwner(system: StarSystem): string | null {
    return this.systemOwners.get(system.id) ?? this.ownerAt(Math.floor(system.x), Math.floor(system.y));
  }

  get cellCount(): number {
    return this.owners.size;
  }

  /* Every owned cell, in no particular order. */
  forEachCell(fn: (col: number, row: number, factionId: string) => void): void {
    for (const [key, owner] of this.owners) {
      fn(key % 100000, Math.floor(key / 100000), owner);
    }
  }
}

export function computeTerritory(
  starSystems: readonly StarSystem[],
  bases: readonly SpaceBase[],
  factions: readonly Faction[],
  width: number,
  height: number,
): TerritoryMap {
  return new TerritoryMap(collectClaims(starSystems, bases, factions), width, height);
}

/*
 * SVG geometry of one faction's territory in grid units (cell (c, r)
 * covers [c-1, c] × [r-1, r]). `fill` merges each row's consecutive cells
 * into one rectangle; `border` is the set of cell edges facing a cell with
 * a different owner (or the map edge), merged into straight runs. Built
 * only when the territory changes.
 */
export interface TerritoryShape {
  factionId: string;
  fill: string;
  border: string;
}

export function buildTerritoryShapes(
  territory: TerritoryMap,
  isCellShown: (col: number, row: number) => boolean = () => true,
): TerritoryShape[] {
  const byFaction = new Map<string, Set<number>>();
  territory.forEachCell((col, row, owner) => {
    if (!isCellShown(col, row)) return;
    let set = byFaction.get(owner);
    if (!set) byFaction.set(owner, (set = new Set()));
    set.add(cellKey(col, row));
  });

  const shapes: TerritoryShape[] = [];
  for (const [factionId, cells] of [...byFaction].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const has = (col: number, row: number) => cells.has(cellKey(col, row));
    const rows = new Map<number, number[]>();
    for (const key of cells) {
      const row = Math.floor(key / 100000);
      const list = rows.get(row) ?? [];
      list.push(key % 100000);
      rows.set(row, list);
    }

    const fill: string[] = [];
    const horizontal: string[] = [];
    for (const [row, cols] of rows) {
      cols.sort((a, b) => a - b);
      let start = cols[0];
      for (let i = 1; i <= cols.length; i++) {
        if (i < cols.length && cols[i] === cols[i - 1] + 1) continue;
        const end = cols[i - 1];
        fill.push(`M${start - 1} ${row - 1}h${end - start + 1}v1h${-(end - start + 1)}z`);
        if (i < cols.length) start = cols[i];
      }
      // Top / bottom edges: runs of cells whose upper / lower neighbour is foreign.
      for (const [edgeRow, neighbourRow] of [[row - 1, row - 1], [row, row + 1]] as const) {
        let runStart: number | null = null;
        for (let i = 0; i <= cols.length; i++) {
          const col = cols[i];
          const open = i < cols.length && !has(col, neighbourRow);
          const continues = open && runStart !== null && col === cols[i - 1] + 1;
          if (runStart !== null && !continues) {
            horizontal.push(`M${runStart - 1} ${edgeRow}H${cols[i - 1]}`);
            runStart = null;
          }
          if (open && runStart === null) runStart = col;
        }
      }
    }

    // Left / right edges, merged vertically per column.
    const columns = new Map<number, number[]>();
    for (const key of cells) {
      const col = key % 100000;
      const list = columns.get(col) ?? [];
      list.push(Math.floor(key / 100000));
      columns.set(col, list);
    }
    const vertical: string[] = [];
    for (const [col, rowList] of columns) {
      rowList.sort((a, b) => a - b);
      for (const [edgeCol, neighbourCol] of [[col - 1, col - 1], [col, col + 1]] as const) {
        let runStart: number | null = null;
        for (let i = 0; i <= rowList.length; i++) {
          const row = rowList[i];
          const open = i < rowList.length && !has(neighbourCol, row);
          const continues = open && runStart !== null && row === rowList[i - 1] + 1;
          if (runStart !== null && !continues) {
            vertical.push(`M${edgeCol} ${runStart - 1}V${rowList[i - 1]}`);
            runStart = null;
          }
          if (open && runStart === null) runStart = row;
        }
      }
    }

    shapes.push({ factionId, fill: fill.join(''), border: horizontal.join('') + vertical.join('') });
  }
  return shapes;
}

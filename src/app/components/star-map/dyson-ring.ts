import { SpecialObject } from './star-map.models';
import { blackHoleNavigationRadius, isBlackHole, specialObjectCenter } from './fleet-navigation';

/*
 * =========================================================
 * DYSON RING GEOMETRY (pure)
 * =========================================================
 *
 * The ring of Dyson anchor slots around the central black hole
 * (docs/dyson-swarm.md, "Ring geometry"). Everything here is derived from
 * the black hole special object, never saved, so every save of a supported
 * format gets the same ring for the same map.
 *
 * - Slots: DYSON_RING_CONFIG.slotCount (8) fixed cells. The black hole
 *   center lies on a half cell (a 4×4 span is centered on x + 1.5), so the
 *   offsets (±6.5, ±2.5) / (±2.5, ±6.5) land exactly on integer cells, all
 *   √48.5 ≈ 6.96 cells from the center and within 1.5° of an even 45°
 *   spacing. A slot is only meaningful for a centered black hole of the
 *   generated size; a black hole with another span still gets a ring, whose
 *   slots are then rounded to cells.
 * - Wedges: slot i owns the 45° annular sector [45°·i, 45°·(i+1)) measured
 *   with atan2(row − cy, col − cx) (grid rows grow downwards), from the
 *   no-fly edge to `outerRadius`. The 8 wedges tile the ring without gaps.
 *   Because the center is on a half cell, some cells lie exactly on a 45°
 *   diagonal; they always go to the steeper wedge (1, 2, 5 or 6), which
 *   keeps the wedges mirror-symmetric on both axes (plain flooring would
 *   hand the 45° diagonal to wedge 1 but the 135° one to wedge 3).
 * - Ring zone: every cell whose center is within `outerRadius` of the black
 *   hole center (the no-fly disc included). In the ring zone only Dyson
 *   anchors claim territory (territory.ts), ordinary space bases may not be
 *   deployed (space-base.ts), and generation keeps nebulae and asteroid
 *   belts out (nebula.ts; belts already keep minPassage from the no-fly
 *   edge, which ends beyond the outer radius).
 *
 * Distances use the grid cell convention of territory.ts: a cell (col, row)
 * is measured at its integer coordinates.
 */
export const DYSON_RING_CONFIG = {
  slotCount: 8,
  /* Slot offsets from the black hole center, in wedge order (angle 21°, 69°, … 339°). */
  slotOffsets: [
    { dx: 6.5, dy: 2.5 },
    { dx: 2.5, dy: 6.5 },
    { dx: -2.5, dy: 6.5 },
    { dx: -6.5, dy: 2.5 },
    { dx: -6.5, dy: -2.5 },
    { dx: -2.5, dy: -6.5 },
    { dx: 2.5, dy: -6.5 },
    { dx: 6.5, dy: -2.5 },
  ],
  /* Outer edge of the ring zone and of every wedge (cells from the center): slot distance + 3. */
  outerRadius: 10,
  /* Extra open space generation keeps between the ring zone and a nebula edge (cells). */
  generationClearance: 1,
} as const;

export const DYSON_WEDGE_DEGREES = 360 / DYSON_RING_CONFIG.slotCount;

export interface DysonSlot {
  /* 0 … slotCount − 1; also the index of the slot's wedge. */
  index: number;
  col: number;
  row: number;
}

export interface DysonRing {
  /* Black hole center (fleet / cell coordinates, usually on a half cell). */
  cx: number;
  cy: number;
  /* The black hole no-fly radius: the inner edge of every wedge. */
  innerRadius: number;
  outerRadius: number;
  slots: readonly DysonSlot[];
}

/* The ring around the map's black hole, or null when the map has none. */
export function buildDysonRing(specialObjects: readonly SpecialObject[] | undefined): DysonRing | null {
  const hole = (specialObjects ?? []).find(isBlackHole);
  if (!hole) return null;
  const { x: cx, y: cy } = specialObjectCenter(hole);
  const slots = DYSON_RING_CONFIG.slotOffsets.map((o, index) => ({
    index,
    col: Math.round(cx + o.dx),
    row: Math.round(cy + o.dy),
  }));
  return {
    cx,
    cy,
    innerRadius: blackHoleNavigationRadius(hole),
    outerRadius: DYSON_RING_CONFIG.outerRadius,
    slots,
  };
}

/* Is the cell (or fractional grid point) inside the ring zone? */
export function isInDysonRingZone(ring: DysonRing | null, x: number, y: number): boolean {
  return !!ring && Math.hypot(x - ring.cx, y - ring.cy) <= ring.outerRadius;
}

/* Wedge index 0 … 7 of a direction from the ring center. */
export function dysonWedgeIndexAt(ring: DysonRing, x: number, y: number): number {
  const dx = x - ring.cx;
  const dy = y - ring.cy;
  if (dx !== 0 && Math.abs(dx) === Math.abs(dy)) {
    // Exact diagonal: the steeper of the two neighbouring wedges.
    if (dy > 0) return dx > 0 ? 1 : 2;
    return dx < 0 ? 5 : 6;
  }
  const degrees = (Math.atan2(y - ring.cy, x - ring.cx) * 180) / Math.PI;
  const normalized = (degrees + 360) % 360;
  return Math.min(DYSON_RING_CONFIG.slotCount - 1, Math.floor(normalized / DYSON_WEDGE_DEGREES));
}

/*
 * The wedge a cell belongs to: inside the ring zone and outside the no-fly
 * disc. Cells of the no-fly disc are in the ring zone but in no wedge.
 */
export function dysonWedgeAt(ring: DysonRing | null, col: number, row: number): number | null {
  if (!ring) return null;
  const d = Math.hypot(col - ring.cx, row - ring.cy);
  if (d > ring.outerRadius || d < ring.innerRadius) return null;
  return dysonWedgeIndexAt(ring, col, row);
}

/* The slot on this grid cell, if any. */
export function dysonSlotAtCell(ring: DysonRing | null, col: number, row: number): DysonSlot | null {
  return ring?.slots.find((s) => s.col === col && s.row === row) ?? null;
}

/*
 * SVG path of one wedge (annular sector) in grid units, for the galaxy view's
 * territory layer: `offset` shifts cell coordinates to SVG coordinates (the
 * layer draws cell (c, r) centered on (c − 0.5, r − 0.5), offset = −0.5).
 */
export function dysonWedgePath(ring: DysonRing, index: number, offset = -0.5): string {
  const a0 = (index * DYSON_WEDGE_DEGREES * Math.PI) / 180;
  const a1 = ((index + 1) * DYSON_WEDGE_DEGREES * Math.PI) / 180;
  const cx = ring.cx + offset;
  const cy = ring.cy + offset;
  const point = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  const ri = ring.innerRadius;
  const ro = ring.outerRadius;
  return `M ${point(ri, a0)} L ${point(ro, a0)} A ${ro} ${ro} 0 0 1 ${point(ro, a1)} L ${point(ri, a1)} A ${ri} ${ri} 0 0 0 ${point(ri, a0)} Z`;
}

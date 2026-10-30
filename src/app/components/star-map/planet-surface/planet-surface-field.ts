import { PlanetType } from '../star-map.models';

/*
 * =========================================================
 * PLANET SURFACE FIELD — deterministic procedural terrain
 * =========================================================
 *
 * A continuous scalar field f(u, v) over the whole surface "world": the
 * buildable grid (N×N cells) plus PLANET_SURFACE_MARGIN cells of environment
 * on every side. World coordinates are in cell units; the grid occupies
 * [margin, margin + N) on both axes.
 *
 *   |f| <= SURFACE_LAND_LIMIT  → flat, buildable land
 *   f  >  SURFACE_LAND_LIMIT   → highland: terraced rock, cliffs, mountains
 *   f  < -SURFACE_LAND_LIMIT   → lowland: shore, then the biome's "low" kind
 *                                (sea, frozen sea, lava, cloud abyss, canyon)
 *
 * Composition (not random scatter):
 * - A tilt pushes one side of the world up (highlands) and the other down
 *   (coast / chasm). The high side always faces the back of the isometric
 *   view (screen top), so tall terrain never stands in front of the colony.
 * - The grid interior is masked flat. The mask edge is pushed inward by a
 *   low-frequency "intrusion" noise, so a few lobes of terrain (a bay, a
 *   rocky spur) cut into the grid while the rest stays buildable.
 * - Craters / calderas / lakes are stamped outside the grid core.
 *
 * Determinism: the field depends only on (seed, type, gridSize, margin,
 * intrusion). The generator derives the blocked mask from it and the
 * renderer rebuilds the same field for visuals. Changing anything here
 * changes the look of existing saves (gameplay stays safe because the
 * blocked mask is persisted, and the renderer flattens unblocked cells).
 */

export const PLANET_SURFACE_MARGIN = 14;
export const SURFACE_LAND_LIMIT = 0.12;

export type SurfaceLowKind = 'water' | 'ice' | 'lava' | 'clouds' | 'canyon';

export interface SurfaceBiome {
  low: SurfaceLowKind;
  /* Height of the liquid / cloud surface; null when lows are dry canyons. */
  seaLevel: number | null;
  /* Height of the low terrain floor. */
  lowFloor: number;
  /* Shore width in f units and whether it drops as a cliff (vs a beach). */
  shoreWidth: number;
  cliffShore: boolean;
  reliefAmp: number;
  /* Constant offset of the relief: negative = more low terrain. */
  bias: number;
  tiltAmp: number;
  featureFreq: number;
  highScale: number;
  terraceStep: number;
  /* 0..1: small = sharp mesa cliffs, 1 = smooth hills. */
  terraceSharp: number;
  craters: number;
  /* Lakes have no raised rim. */
  craterRim: number;
  craterDepth: number;
}

export const SURFACE_BIOMES: Record<PlanetType, SurfaceBiome> = {
  earthlike: {
    low: 'water', seaLevel: -0.24, lowFloor: -0.9, shoreWidth: 0.22, cliffShore: false,
    reliefAmp: 0.85, bias: 0, tiltAmp: 0.6, featureFreq: 0.105, highScale: 2.6, terraceStep: 0.42,
    terraceSharp: 0.6, craters: 2, craterRim: 0, craterDepth: 0.7,
  },
  ice: {
    low: 'ice', seaLevel: -0.2, lowFloor: -0.85, shoreWidth: 0.2, cliffShore: false,
    reliefAmp: 0.8, bias: 0, tiltAmp: 0.55, featureFreq: 0.1, highScale: 2.4, terraceStep: 0.5,
    terraceSharp: 0.35, craters: 3, craterRim: 0.25, craterDepth: 0.75,
  },
  venuslike: {
    low: 'lava', seaLevel: -0.32, lowFloor: -0.8, shoreWidth: 0.16, cliffShore: false,
    reliefAmp: 0.85, bias: 0, tiltAmp: 0.5, featureFreq: 0.11, highScale: 2.9, terraceStep: 0.38,
    terraceSharp: 0.22, craters: 4, craterRim: 0.45, craterDepth: 0.9,
  },
  gasgiant: {
    low: 'clouds', seaLevel: -1.6, lowFloor: -1.9, shoreWidth: 0.12, cliffShore: true,
    reliefAmp: 0.85, bias: -0.32, tiltAmp: 0.4, featureFreq: 0.085, highScale: 2.1, terraceStep: 0.55,
    terraceSharp: 0.2, craters: 0, craterRim: 0, craterDepth: 0,
  },
  marslike: {
    low: 'canyon', seaLevel: null, lowFloor: -1.5, shoreWidth: 0.12, cliffShore: true,
    reliefAmp: 0.8, bias: 0, tiltAmp: 0.5, featureFreq: 0.08, highScale: 2.6, terraceStep: 0.5,
    terraceSharp: 0.16, craters: 6, craterRim: 0.4, craterDepth: 0.85,
  },
  desert: {
    low: 'canyon', seaLevel: null, lowFloor: -1.1, shoreWidth: 0.14, cliffShore: true,
    reliefAmp: 0.72, bias: 0, tiltAmp: 0.45, featureFreq: 0.075, highScale: 2.4, terraceStep: 0.55,
    terraceSharp: 0.18, craters: 2, craterRim: 0.3, craterDepth: 0.7,
  },
};

export function surfaceBiome(type: PlanetType | string): SurfaceBiome {
  return SURFACE_BIOMES[type as PlanetType] ?? SURFACE_BIOMES.earthlike;
}

export function createSurfaceRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD_X = [1, -1, 1, -1, 1, -1, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 1, -1];

/** Seeded 2D simplex noise, output roughly in [-1, 1]. */
export class SimplexNoise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = createSurfaceRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const perm = this.perm;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = perm[ii + perm[jj]] & 7;
      t0 *= t0;
      n += t0 * t0 * (GRAD_X[g] * x0 + GRAD_Y[g] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = perm[ii + i1 + perm[jj + j1]] & 7;
      t1 *= t1;
      n += t1 * t1 * (GRAD_X[g] * x1 + GRAD_Y[g] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = perm[ii + 1 + perm[jj + 1]] & 7;
      t2 *= t2;
      n += t2 * t2 * (GRAD_X[g] * x2 + GRAD_Y[g] * y2);
    }
    return 70 * n;
  }

  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}

interface Crater {
  x: number;
  y: number;
  r: number;
}

export class PlanetSurfaceField {
  readonly worldSize: number;
  readonly biome: SurfaceBiome;
  private readonly relief: SimplexNoise2D;
  private readonly warpA: SimplexNoise2D;
  private readonly warpB: SimplexNoise2D;
  private readonly intrusionNoise: SimplexNoise2D;
  readonly detail: SimplexNoise2D;
  private readonly ax: number;
  private readonly ay: number;
  private readonly maxIntrusion: number;
  private readonly intrusionFreq: number;
  private readonly craters: Crater[] = [];

  constructor(
    readonly seed: number,
    readonly type: PlanetType | string,
    readonly gridSize: number,
    readonly margin: number = PLANET_SURFACE_MARGIN,
    /* 0..1 scale of how deep terrain may cut into the grid. */
    readonly intrusion: number = 1,
  ) {
    this.worldSize = gridSize + margin * 2;
    this.biome = surfaceBiome(type);
    const rng = createSurfaceRng(seed);
    this.relief = new SimplexNoise2D(Math.floor(rng() * 2 ** 31));
    this.warpA = new SimplexNoise2D(Math.floor(rng() * 2 ** 31));
    this.warpB = new SimplexNoise2D(Math.floor(rng() * 2 ** 31));
    this.intrusionNoise = new SimplexNoise2D(Math.floor(rng() * 2 ** 31));
    this.detail = new SimplexNoise2D(Math.floor(rng() * 2 ** 31));

    // High side points to the back of the iso view (-u, -v) ± 60°.
    const angle = Math.atan2(-1, -1) + (rng() - 0.5) * (Math.PI * 2 / 3);
    this.ax = Math.cos(angle);
    this.ay = Math.sin(angle);

    this.maxIntrusion = Math.max(2, Math.min(5, gridSize * 0.22)) * intrusion;
    this.intrusionFreq = 1 / Math.max(3, gridSize * 0.33);

    const lo = margin + 2;
    const hi = margin + gridSize - 2;
    for (let i = 0, tries = 0; i < this.biome.craters && tries < 60; tries++) {
      const x = rng() * this.worldSize;
      const y = rng() * this.worldSize;
      const r = 1.6 + rng() * 2.6;
      // Keep the grid core clear; craters may overlap the grid edge only.
      if (x + r > lo && x - r < hi && y + r > lo && y - r < hi) continue;
      this.craters.push({ x, y, r });
      i++;
    }
  }

  /*
   * How far inside the grid (in cells) the mask can reach: the deepest
   * intrusion plus the maximum domain-warp displacement. Points deeper than
   * this always have f = 0, which the generator uses to skip work.
   */
  maxReach(): number {
    return this.maxIntrusion + 2.4 * Math.SQRT2;
  }

  /** Signed distance (cells) from a point to the grid rectangle; negative inside. */
  gridDistance(u: number, v: number): number {
    const lo = this.margin;
    const hi = this.margin + this.gridSize;
    const dx = Math.max(lo - u, u - hi);
    const dy = Math.max(lo - v, v - hi);
    if (dx > 0 || dy > 0) {
      const ox = Math.max(dx, 0);
      const oy = Math.max(dy, 0);
      return Math.sqrt(ox * ox + oy * oy);
    }
    return Math.max(dx, dy);
  }

  value(u: number, v: number): number {
    const b = this.biome;
    const half = this.worldSize / 2;
    const qx = u + this.warpA.noise(u * 0.085, v * 0.085) * 2.4;
    const qy = v + this.warpB.noise(u * 0.085, v * 0.085) * 2.4;

    // Intrusion lobes: where positive, the flat-grid mask edge retreats
    // into the grid and the terrain there is pushed away from "land" so the
    // lobe always reads as an obstacle (a bay on low ground, a spur on high).
    const n = this.intrusionNoise.noise(u * this.intrusionFreq, v * this.intrusionFreq);
    let reach = n > 0.22 ? ((n - 0.22) / 0.78) * this.maxIntrusion : (n - 0.22) * 5;
    reach = Math.max(-3.5, reach);
    const w = smoothstep(-reach, -reach + 2.4, this.gridDistance(qx, qy));
    // Fully masked (most of the grid interior): skip the expensive relief.
    if (w === 0) return 0;

    let relief = this.relief.fbm(qx * b.featureFreq, qy * b.featureFreq, 4) * b.reliefAmp;
    relief += (((qx - half) * this.ax + (qy - half) * this.ay) / half) * b.tiltAmp + b.bias;

    for (const c of this.craters) {
      const dx = u - c.x;
      const dy = v - c.y;
      const d = Math.sqrt(dx * dx + dy * dy) / c.r;
      if (d < 1.6) {
        if (d < 1) relief -= b.craterDepth * (1 - d * d);
        const rim = (d - 1) / 0.24;
        relief += b.craterRim * Math.exp(-rim * rim);
      }
    }

    if (reach > 0 && this.maxIntrusion > 0) {
      relief += (relief >= 0 ? 1 : -1) * 0.45 * Math.min(1, reach / this.maxIntrusion);
    }
    return relief * w;
  }

  /** Terrain height (cell units, plateau = 0) for a field value at (u, v). */
  height(f: number, u: number, v: number): number {
    const b = this.biome;
    const L = SURFACE_LAND_LIMIT;
    if (f >= -L && f <= L) return f * 0.3;
    if (f > L) {
      const x = (f - L) * b.highScale;
      const t = x / b.terraceStep;
      const i = Math.floor(t);
      const stepped = (i + smoothstep(1 - b.terraceSharp, 1, t - i)) * b.terraceStep;
      return L * 0.3 + stepped;
    }
    const x = Math.min(1, (-f - L) / b.shoreWidth);
    const e = b.cliffShore ? smoothstep(0, 0.35, x) : x;
    const floorDetail = this.detail.noise(u * 0.4, v * 0.4) * 0.08 * e;
    return -L * 0.3 + (b.lowFloor + L * 0.3) * e + floorDetail;
  }
}

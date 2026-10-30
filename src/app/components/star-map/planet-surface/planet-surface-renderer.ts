import { PlanetSurface, PlanetType } from '../star-map.models';
import { decodeBlockedMask } from './planet-surface';
import {
  PLANET_SURFACE_MARGIN,
  PlanetSurfaceField,
  SimplexNoise2D,
  createSurfaceRng,
  smoothstep,
} from './planet-surface-field';

/*
 * =========================================================
 * PLANET SURFACE RENDERER — baked isometric terrain
 * =========================================================
 *
 * Renders the planet's environment (terrain relief, liquids, cliffs, cast
 * shadows and decor) into one screen-space canvas, once per planet view.
 *
 * Projection (must match the CSS ground plane `rotateX(60deg)
 * rotateZ(45deg)` in star-map-planet-screen.component.scss): for a world
 * point (u, v) at height h, relative to the world center, in cell units:
 *   X = (u - v) / √2
 *   Y = (u + v) / (2√2) - h · sin(60°)
 * The canvas result reports its box in the same cell units relative to the
 * world center; the component multiplies by the cell size in vw.
 *
 * Raster: each pixel column is a line u - v = const in the world. It is
 * walked front to back; every sample paints from its projected top down to
 * the highest pixel painted so far. Steps in height therefore become real
 * vertical cliff faces (shaded and stratified), not just darker slopes.
 *
 * Consistency with gameplay: the height is flattened to the plateau (h = 0)
 * on every buildable grid cell of the persisted mask, so the flat CSS grid,
 * roads and buildings always sit exactly on the rendered ground. Heights in
 * front of the grid are capped so terrain baked under the buildings never
 * visually covers a buildable cell.
 */

type Rgb = [number, number, number];

interface SurfacePalette {
  deep: Rgb;
  shallow: Rgb;
  foam: Rgb;
  shore: Rgb;
  landA: Rgb;
  landB: Rgb;
  landC: Rgb;
  rockA: Rgb;
  rockB: Rgb;
  face: Rgb;
  faceBand: Rgb;
  floor: Rgb;
  peak: Rgb | null;
  peakAbove: number;
  haze: Rgb;
  /* Mixed onto flat terrace tops of highlands (vegetation, sand, snow). */
  terraceCap: Rgb;
}

const PALETTES: Record<PlanetType, SurfacePalette> = {
  earthlike: {
    deep: [14, 50, 82], shallow: [36, 116, 126], foam: [214, 232, 226], shore: [210, 192, 144],
    landA: [70, 108, 50], landB: [100, 134, 60], landC: [128, 126, 72],
    rockA: [124, 116, 102], rockB: [90, 84, 74], face: [102, 90, 76], faceBand: [126, 112, 94],
    floor: [62, 84, 76], peak: [236, 240, 242], peakAbove: 1.55, haze: [44, 66, 72], terraceCap: [84, 116, 58],
  },
  ice: {
    deep: [12, 40, 66], shallow: [164, 204, 222], foam: [228, 242, 250], shore: [204, 220, 234],
    landA: [220, 230, 242], landB: [198, 214, 232], landC: [180, 200, 222],
    rockA: [112, 126, 142], rockB: [84, 98, 116], face: [86, 112, 140], faceBand: [128, 168, 200],
    floor: [70, 96, 120], peak: [246, 250, 255], peakAbove: 0.9, haze: [74, 94, 112], terraceCap: [226, 236, 246],
  },
  venuslike: {
    deep: [255, 134, 36], shallow: [62, 30, 20], foam: [255, 214, 96], shore: [92, 72, 52],
    landA: [146, 118, 56], landB: [120, 98, 52], landC: [94, 82, 68],
    rockA: [78, 68, 62], rockB: [56, 48, 46], face: [52, 44, 42], faceBand: [86, 66, 50],
    floor: [40, 30, 26], peak: null, peakAbove: 99, haze: [84, 62, 32], terraceCap: [132, 112, 58],
  },
  gasgiant: {
    deep: [84, 64, 132], shallow: [196, 182, 228], foam: [232, 224, 248], shore: [108, 100, 132],
    landA: [112, 106, 140], landB: [134, 126, 160], landC: [96, 92, 126],
    rockA: [92, 82, 122], rockB: [68, 60, 96], face: [72, 62, 100], faceBand: [106, 92, 138],
    floor: [58, 48, 90], peak: null, peakAbove: 99, haze: [56, 46, 88], terraceCap: [126, 118, 156],
  },
  marslike: {
    deep: [92, 40, 26], shallow: [118, 56, 36], foam: [140, 70, 44], shore: [130, 60, 38],
    landA: [174, 84, 50], landB: [192, 104, 62], landC: [128, 62, 42],
    rockA: [150, 70, 44], rockB: [114, 52, 34], face: [120, 50, 32], faceBand: [162, 86, 54],
    floor: [96, 42, 28], peak: null, peakAbove: 99, haze: [78, 38, 28], terraceCap: [184, 96, 58],
  },
  desert: {
    deep: [140, 104, 64], shallow: [160, 122, 78], foam: [190, 150, 100], shore: [180, 140, 90],
    landA: [214, 182, 124], landB: [198, 162, 104], landC: [184, 148, 96],
    rockA: [184, 124, 74], rockB: [150, 98, 58], face: [160, 100, 58], faceBand: [204, 148, 94],
    floor: [146, 110, 68], peak: null, peakAbove: 99, haze: [100, 80, 58], terraceCap: [212, 178, 120],
  },
};

const SQ2 = Math.SQRT2;
const RISE = Math.sin(Math.PI / 3);
/* Heightmap samples per cell. */
const RES = 8;
/* World-edge fade width in cells. */
const EDGE_FADE = 4;
/* Max height of obstacles inside the grid (keeps rocks from hiding cells). */
const IN_GRID_CAP = 0.55;

export interface SurfaceRenderInput {
  surface: PlanetSurface;
  type: PlanetType | string;
  /* Canvas pixels per cell unit (screen scale before CSS zoom). */
  pxPerCell: number;
}

export interface SurfaceRenderResult {
  canvas: HTMLCanvasElement;
  /* Canvas box in cell units relative to the world center (screen space). */
  left: number;
  top: number;
  width: number;
  height: number;
  worldSize: number;
  margin: number;
  /* CSS color of the atmospheric haze the world edge fades into. */
  haze: string;
  /* True when a world point is open flat land (roads may run there). */
  isOpenLand(u: number, v: number): boolean;
}

export function surfacePalette(type: PlanetType | string): SurfacePalette {
  return PALETTES[type as PlanetType] ?? PALETTES.earthlike;
}

export function surfaceHazeColor(type: PlanetType | string): string {
  const [r, g, b] = surfacePalette(type).haze;
  return `rgb(${r}, ${g}, ${b})`;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Last few renders are kept so reopening a planet (or switching zoom, which
// does not re-render) is instant. Keyed by everything the image depends on.
const renderCache = new Map<string, SurfaceRenderResult>();
const RENDER_CACHE_SIZE = 3;

export function renderPlanetSurface(input: SurfaceRenderInput): SurfaceRenderResult | null {
  const { surface, type } = input;
  const p = Math.round(input.pxPerCell);
  const key = `${type}|${surface.seed}|${surface.gridSize}|${surface.intrusion}|${surface.blocked}|${p}`;
  const cached = renderCache.get(key);
  if (cached) {
    renderCache.delete(key);
    renderCache.set(key, cached);
    return cached;
  }
  const result = new SurfaceRaster(surface, type, p).render();
  if (!result) return null;
  renderCache.set(key, result);
  while (renderCache.size > RENDER_CACHE_SIZE) {
    renderCache.delete(renderCache.keys().next().value as string);
  }
  return result;
}

const enum Kind {
  Land = 0,
  Shore = 1,
  Liquid = 2,
  Rock = 3,
  Floor = 4,
}

class SurfaceRaster {
  private readonly field: PlanetSurfaceField;
  private readonly palette: SurfacePalette;
  private readonly n: number;
  private readonly m: number;
  private readonly s: number;
  private readonly a: number;
  /* Terrain height (below liquids: the floor). */
  private readonly h: Float32Array;
  /* Visible top height (liquid surface where submerged). */
  private readonly top: Float32Array;
  private readonly kind: Uint8Array;
  private readonly slope: Float32Array;
  private readonly topRgb: Float32Array;
  private readonly faceRgb: Float32Array;
  /* Distance (cells) to the nearest buildable grid cell. */
  private readonly clearDist: Float32Array;
  private readonly blocked: Uint8Array;
  private readonly micro: SimplexNoise2D;
  private hMin = 0;
  private hMax = 0;

  constructor(
    private readonly surface: PlanetSurface,
    private readonly type: PlanetType | string,
    private readonly p: number,
  ) {
    this.n = surface.gridSize;
    this.m = PLANET_SURFACE_MARGIN;
    this.field = new PlanetSurfaceField(surface.seed, type, this.n, this.m, surface.intrusion);
    this.palette = surfacePalette(type);
    this.s = this.field.worldSize;
    this.a = this.s * RES + 1;
    const count = this.a * this.a;
    this.h = new Float32Array(count);
    this.top = new Float32Array(count);
    this.kind = new Uint8Array(count);
    this.slope = new Float32Array(count);
    this.topRgb = new Float32Array(count * 3);
    this.faceRgb = new Float32Array(count * 3);
    this.clearDist = new Float32Array(count);
    this.blocked = decodeBlockedMask(surface.blocked, this.n);
    this.micro = new SimplexNoise2D(surface.seed ^ 0x5bd1e995);
  }

  render(): SurfaceRenderResult | null {
    if (typeof document === 'undefined') return null;
    this.computeClearance();
    this.computeHeights();
    this.computeColors();
    const raster = this.rasterize();
    if (!raster) return null;
    const { canvas, ctx, tbuf, ox, oy } = raster;
    this.drawDecor(ctx, tbuf, canvas.width, canvas.height, ox, oy);
    const p = this.p;
    return {
      canvas,
      left: -ox / p,
      top: -oy / p,
      width: canvas.width / p,
      height: canvas.height / p,
      worldSize: this.s,
      margin: this.m,
      haze: surfaceHazeColor(this.type),
      isOpenLand: (u, v) => {
        const i = this.index(u, v);
        return i >= 0 && this.kind[i] === Kind.Land && Math.abs(this.h[i]) < 0.1 && this.slope[i] < 0.5;
      },
    };
  }

  private index(u: number, v: number): number {
    const iu = Math.round(u * RES);
    const iv = Math.round(v * RES);
    if (iu < 0 || iv < 0 || iu >= this.a || iv >= this.a) return -1;
    return iv * this.a + iu;
  }

  private isBuildableSample(iu: number, iv: number): boolean {
    const gx = Math.floor(iu / RES - this.m);
    const gy = Math.floor(iv / RES - this.m);
    return gx >= 0 && gy >= 0 && gx < this.n && gy < this.n && !this.blocked[gy * this.n + gx];
  }

  /* Two-pass chamfer distance transform to the buildable cells. */
  private computeClearance(): void {
    const a = this.a;
    const d = this.clearDist;
    const far = 1e6;
    for (let iv = 0; iv < a; iv++) {
      for (let iu = 0; iu < a; iu++) d[iv * a + iu] = this.isBuildableSample(iu, iv) ? 0 : far;
    }
    const diag = Math.SQRT2;
    for (let iv = 0; iv < a; iv++) {
      for (let iu = 0; iu < a; iu++) {
        const i = iv * a + iu;
        let best = d[i];
        if (iu > 0) best = Math.min(best, d[i - 1] + 1);
        if (iv > 0) {
          best = Math.min(best, d[i - a] + 1);
          if (iu > 0) best = Math.min(best, d[i - a - 1] + diag);
          if (iu < a - 1) best = Math.min(best, d[i - a + 1] + diag);
        }
        d[i] = best;
      }
    }
    for (let iv = a - 1; iv >= 0; iv--) {
      for (let iu = a - 1; iu >= 0; iu--) {
        const i = iv * a + iu;
        let best = d[i];
        if (iu < a - 1) best = Math.min(best, d[i + 1] + 1);
        if (iv < a - 1) {
          best = Math.min(best, d[i + a] + 1);
          if (iu < a - 1) best = Math.min(best, d[i + a + 1] + diag);
          if (iu > 0) best = Math.min(best, d[i + a - 1] + diag);
        }
        d[i] = best;
      }
    }
    for (let i = 0; i < d.length; i++) d[i] /= RES;
  }

  /*
   * Height cap that keeps baked terrain from covering buildable cells: a
   * point in front of the grid hides cells up to 1.22·h behind it along the
   * screen-vertical diagonal, so its height is limited by its distance.
   */
  private capAt(u: number, v: number): number {
    const lo = this.m;
    const hi = this.m + this.n;
    if (u >= lo && u <= hi && v >= lo && v <= hi) return IN_GRID_CAP;
    const k = Math.max(u - hi, v - hi);
    if (k <= 0) return Infinity;
    if (u - k < lo || v - k < lo) return Infinity;
    return IN_GRID_CAP + 0.78 * k;
  }

  private computeHeights(): void {
    const { a, field } = this;
    const biome = field.biome;
    const sea = biome.seaLevel;
    for (let iv = 0; iv < a; iv++) {
      const v = iv / RES;
      for (let iu = 0; iu < a; iu++) {
        const u = iu / RES;
        const i = iv * a + iu;
        const f = field.value(u, v);
        let h = field.height(f, u, v);
        // Persisted mask wins: buildable cells are flat plateau.
        const flat = 1 - smoothstep(0, 0.4, this.clearDist[i]);
        h *= 1 - flat;
        const cap = this.capAt(u, v);
        if (h > cap) h = cap + (h - cap) * 0.15;
        this.h[i] = h;
        let k: Kind;
        let topH = h;
        if (sea !== null && h < sea) {
          k = Kind.Liquid;
          topH = sea;
        } else if (h > 0.06) {
          k = Kind.Rock;
        } else if (h < -0.05) {
          k = sea === null && h < biome.lowFloor * 0.8 ? Kind.Floor : Kind.Shore;
        } else {
          k = Kind.Land;
        }
        this.kind[i] = k;
        this.top[i] = topH;
        if (topH < this.hMin) this.hMin = topH;
        if (topH > this.hMax) this.hMax = topH;
      }
    }
    for (let iv = 0; iv < a; iv++) {
      for (let iu = 0; iu < a; iu++) {
        const i = iv * a + iu;
        const l = this.top[iv * a + Math.max(0, iu - 1)];
        const r = this.top[iv * a + Math.min(a - 1, iu + 1)];
        const up = this.top[Math.max(0, iv - 1) * a + iu];
        const dn = this.top[Math.min(a - 1, iv + 1) * a + iu];
        const gu = ((r - l) * RES) / 2;
        const gv = ((dn - up) * RES) / 2;
        this.slope[i] = Math.sqrt(gu * gu + gv * gv);
      }
    }
  }

  private computeColors(): void {
    const { a, palette: pal, field } = this;
    const biome = field.biome;
    const sea = biome.seaLevel ?? 0;
    const low = biome.low;
    // Light from the screen's upper left (world -u, slightly -v), elevated.
    const lx = -0.62;
    const ly = -0.3;
    const lz = 0.72;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const flatLight = lz / ll;
    const shadow = this.computeShadows(lx / ll, ly / ll, lz / ll);
    const detail = field.detail;
    const micro = this.micro;

    for (let iv = 0; iv < a; iv++) {
      const v = iv / RES;
      for (let iu = 0; iu < a; iu++) {
        const u = iu / RES;
        const i = iv * a + iu;
        const h = this.h[i];
        const k = this.kind[i];
        const var1 = detail.noise(u * 0.16 + 17.3, v * 0.16 - 4.1);
        const var2 = micro.noise(u * 0.45, v * 0.45);

        // Lighting from the top-surface normal.
        const l = this.top[iv * a + Math.max(0, iu - 1)];
        const r = this.top[iv * a + Math.min(a - 1, iu + 1)];
        const up = this.top[Math.max(0, iv - 1) * a + iu];
        const dn = this.top[Math.min(a - 1, iv + 1) * a + iu];
        const nx = -((r - l) * RES) / 2;
        const ny = -((dn - up) * RES) / 2;
        const nl = Math.sqrt(nx * nx + ny * ny + 1);
        const diffuse = Math.max(0, (nx * lx + ny * ly + lz) / (nl * ll));
        const lit = 0.42 + 0.58 * (diffuse / flatLight) * (1 - 0.55 * shadow[i]);

        let c: Rgb;
        let emissive = false;
        if (k === Kind.Liquid) {
          const depth = sea - h;
          c = this.liquidColor(low, depth, u, v, var1, var2);
          emissive = low === 'lava' || low === 'clouds';
          if (!emissive) c = mix(c, [0, 0, 0], 0.35 * shadow[i]);
        } else if (k === Kind.Floor) {
          c = mix(pal.floor, pal.shallow, 0.5 + 0.5 * var1);
        } else if (k === Kind.Shore) {
          c = biome.seaLevel === null ? mix(pal.rockB, pal.floor, 0.4 + 0.3 * var1) : pal.shore;
          c = mix(c, pal.landC, 0.15 + 0.1 * var2);
        } else if (k === Kind.Land) {
          c = mix(pal.landA, pal.landB, 0.5 + 0.5 * var1);
          c = mix(c, pal.landC, smoothstep(0.2, 0.9, var2) * 0.32);
          if (this.type === 'desert') {
            const ripple = Math.sin((u * 0.9 + v * 0.4) * 4.2 + var1 * 5);
            c = mix(c, ripple > 0 ? pal.landA : pal.landC, Math.abs(ripple) * 0.25);
          }
        } else {
          c = mix(pal.rockA, pal.rockB, 0.5 + 0.5 * var2);
          const flatTop = 1 - smoothstep(0.25, 0.9, this.slope[i]);
          c = mix(c, pal.terraceCap, flatTop * 0.55);
          if (pal.peak && h > pal.peakAbove) {
            c = mix(c, pal.peak, smoothstep(pal.peakAbove, pal.peakAbove + 0.5, h + var2 * 0.2));
          }
        }
        if (!emissive) c = [c[0] * lit, c[1] * lit, c[2] * lit];
        this.topRgb[i * 3] = c[0];
        this.topRgb[i * 3 + 1] = c[1];
        this.topRgb[i * 3 + 2] = c[2];

        // Cliff faces: the visible ones face +u (east, away from the light)
        // and +v (south). Shade by how much the slope faces the light.
        const fl = Math.min(1, Math.max(0, 0.55 + 0.45 * ((-nx * lx - ny * ly) / (Math.sqrt(nx * nx + ny * ny) + 1e-6))));
        const faceBase = k === Kind.Liquid || k === Kind.Shore ? mix(pal.face, pal.shore, 0.3) : pal.face;
        const fs = 0.55 + 0.45 * fl;
        this.faceRgb[i * 3] = faceBase[0] * fs;
        this.faceRgb[i * 3 + 1] = faceBase[1] * fs;
        this.faceRgb[i * 3 + 2] = faceBase[2] * fs;
      }
    }
  }

  private liquidColor(
    low: string,
    depth: number,
    u: number,
    v: number,
    var1: number,
    var2: number,
  ): Rgb {
    const pal = this.palette;
    switch (low) {
      case 'lava': {
        const crust = 1 - Math.abs(this.micro.noise(u * 0.55 + 9, v * 0.55));
        const glow = smoothstep(0.7, 0.97, crust) + smoothstep(0.05, 0.4, depth) * 0.35;
        const hot = mix(pal.deep, pal.foam, smoothstep(0.85, 1, crust));
        return mix(pal.shallow, hot, Math.min(1, glow));
      }
      case 'clouds': {
        const swirl = this.field.detail.fbm(u * 0.09 + var1 * 0.6, v * 0.09, 4);
        const c = mix(pal.deep, pal.shallow, smoothstep(-0.5, 0.7, swirl));
        return mix(c, pal.foam, smoothstep(0.55, 0.95, var2) * 0.35);
      }
      case 'ice': {
        if (depth > 0.42 && var1 > 0.05) {
          return mix(pal.deep, pal.shallow, 0.12 + 0.08 * var2);
        }
        const crack = 1 - Math.abs(this.micro.noise(u * 0.7 + 3, v * 0.7 - 8));
        let c = mix(pal.shallow, pal.foam, 0.35 + 0.35 * var2);
        if (crack > 0.94) c = mix(c, pal.deep, 0.45 * smoothstep(0.94, 1, crack));
        return c;
      }
      default: {
        let c = mix(pal.shallow, pal.deep, smoothstep(0, 0.5, depth));
        c = mix(c, [255, 255, 255], Math.max(0, var2) * 0.06);
        if (depth < 0.05) c = mix(c, pal.foam, 0.65 * (1 - depth / 0.05));
        return c;
      }
    }
  }

  /* Hard shadows by marching toward the light over the top heightmap, then a 3×3 blur. */
  private computeShadows(lx: number, ly: number, lz: number): Float32Array {
    const a = this.a;
    const raw = new Float32Array(a * a);
    const horiz = Math.sqrt(lx * lx + ly * ly);
    const stepU = (-lx / horiz) * 0.5;
    const stepV = (-ly / horiz) * 0.5;
    const rise = (lz / horiz) * (0.5 / RES);
    const maxSteps = 6 * RES * 2;
    for (let iv = 0; iv < a; iv++) {
      for (let iu = 0; iu < a; iu++) {
        const i = iv * a + iu;
        let su = iu;
        let sv = iv;
        let z = this.top[i] + 0.02;
        for (let step = 0; step < maxSteps; step++) {
          su += stepU;
          sv += stepV;
          z += rise;
          if (z > this.hMax) break;
          const ju = Math.round(su);
          const jv = Math.round(sv);
          if (ju < 0 || jv < 0 || ju >= a || jv >= a) break;
          if (this.top[jv * a + ju] > z) {
            raw[i] = 1;
            break;
          }
        }
      }
    }
    const out = new Float32Array(a * a);
    for (let iv = 1; iv < a - 1; iv++) {
      for (let iu = 1; iu < a - 1; iu++) {
        let sum = 0;
        for (let dv = -1; dv <= 1; dv++) {
          for (let du = -1; du <= 1; du++) sum += raw[(iv + dv) * a + iu + du];
        }
        out[iv * a + iu] = sum / 9;
      }
    }
    return out;
  }

  private rasterize(): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tbuf: Float32Array;
    ox: number;
    oy: number;
  } | null {
    const { p, s, a } = this;
    const c = s / 2;
    const hMax = this.hMax + 1.2; // headroom for decor
    const hMin = this.hMin;
    const width = Math.ceil(s * SQ2 * p);
    const height = Math.ceil((s / SQ2 + RISE * (hMax - hMin)) * p) + 2;
    const ox = width / 2;
    const oy = (s / (2 * SQ2) + RISE * hMax) * p;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return null;

    const image = ctx.createImageData(width, height);
    const buf = new Uint32Array(image.data.buffer);
    const tbuf = new Float32Array(width * height).fill(-1e9);
    const dt = ((2 * SQ2) / p) * 0.75;
    const topRgb = this.topRgb;
    const faceRgb = this.faceRgb;
    const top = this.top;
    const slope = this.slope;
    const pal = this.palette;
    // Strata: a few broad bands per cliff (period in cell heights = 1/freq).
    const layered = this.type === 'desert' || this.type === 'marslike';
    const bandFreq = layered ? 1.9 : 1.2;
    const bandStrength = layered ? 0.38 : 0.16;
    const abyssDepth = this.field.biome.low === 'clouds' ? -(this.field.biome.seaLevel ?? 0) : 0;

    for (let sx = 0; sx < width; sx++) {
      const d = ((sx + 0.5 - ox) / p) * SQ2;
      const ad = Math.abs(d);
      const tMax = 2 * c - ad;
      const tMin = -2 * c + ad;
      if (tMax <= tMin) continue;
      let ybuf = height;
      for (let t = tMax; t >= tMin; t -= dt) {
        const u = c + (t + d) / 2;
        const v = c + (t - d) / 2;
        const su = Math.min(a - 1.001, Math.max(0, u * RES));
        const sv = Math.min(a - 1.001, Math.max(0, v * RES));
        const iu = Math.floor(su);
        const iv = Math.floor(sv);
        const fu = su - iu;
        const fv = sv - iv;
        const i00 = iv * a + iu;
        const i10 = i00 + 1;
        const i01 = i00 + a;
        const i11 = i01 + 1;
        const w00 = (1 - fu) * (1 - fv);
        const w10 = fu * (1 - fv);
        const w01 = (1 - fu) * fv;
        const w11 = fu * fv;
        const hTop = top[i00] * w00 + top[i10] * w10 + top[i01] * w01 + top[i11] * w11;
        const ys = oy + (t / (2 * SQ2) - RISE * hTop) * p;
        let row = Math.floor(ys);
        if (row >= ybuf) continue;
        if (row < 0) row = 0;

        const edge = Math.min(u, v, s - u, s - v);
        const alpha = Math.round(255 * smoothstep(0, EDGE_FADE, edge));
        // Steepness blends the top colour into the cliff-face colour. It is
        // interpolated, and constant within a span, so consecutive samples
        // on a steep slope do not alternate top/face pixels (that produced a
        // corrugated stripe pattern on every cliff).
        const slopeHere = slope[i00] * w00 + slope[i10] * w10 + slope[i01] * w01 + slope[i11] * w11;
        const faceness = smoothstep(0.7, 2.2, slopeHere);
        const kt = 1 - faceness;

        const tr = topRgb[i00 * 3] * w00 + topRgb[i10 * 3] * w10 + topRgb[i01 * 3] * w01 + topRgb[i11 * 3] * w11;
        const tg = topRgb[i00 * 3 + 1] * w00 + topRgb[i10 * 3 + 1] * w10 + topRgb[i01 * 3 + 1] * w01 + topRgb[i11 * 3 + 1] * w11;
        const tb = topRgb[i00 * 3 + 2] * w00 + topRgb[i10 * 3 + 2] * w10 + topRgb[i01 * 3 + 2] * w01 + topRgb[i11 * 3 + 2] * w11;
        const fr = faceRgb[i00 * 3] * w00 + faceRgb[i10 * 3] * w10 + faceRgb[i01 * 3] * w01 + faceRgb[i11 * 3] * w11;
        const fg = faceRgb[i00 * 3 + 1] * w00 + faceRgb[i10 * 3 + 1] * w10 + faceRgb[i01 * 3 + 1] * w01 + faceRgb[i11 * 3 + 1] * w11;
        const fb = faceRgb[i00 * 3 + 2] * w00 + faceRgb[i10 * 3 + 2] * w10 + faceRgb[i01 * 3 + 2] * w01 + faceRgb[i11 * 3 + 2] * w11;

        for (let r = row; r < ybuf; r++) {
          let g = Math.imul(sx, 374761393) + Math.imul(r, 668265263);
          g = Math.imul(g ^ (g >>> 13), 1274126177);
          const grain = ((g >>> 16) & 15) - 7.5;
          let cr = tr * kt + grain;
          let cg = tg * kt + grain;
          let cb = tb * kt + grain;
          if (faceness > 0) {
            // Strata follow the world height of the pixel, so bands run
            // continuously across the whole cliff.
            const hp = hTop - (r - row) / (RISE * p);
            const band = (0.5 + 0.5 * Math.sin(hp * bandFreq * Math.PI * 2)) * bandStrength;
            let wr = fr + (pal.faceBand[0] - pal.face[0]) * band;
            let wg = fg + (pal.faceBand[1] - pal.face[1]) * band;
            let wb = fb + (pal.faceBand[2] - pal.face[2]) * band;
            if (abyssDepth > 0 && hp < 0) {
              // Walls of the cloud abyss dissolve into the cloud deck.
              const fog = smoothstep(0, abyssDepth, -hp) * 0.9;
              wr += (pal.shallow[0] * 0.8 - wr) * fog;
              wg += (pal.shallow[1] * 0.8 - wg) * fog;
              wb += (pal.shallow[2] * 0.8 - wb) * fog;
            }
            cr += wr * faceness;
            cg += wg * faceness;
            cb += wb * faceness;
          }
          const pi = r * width + sx;
          buf[pi] =
            ((alpha & 255) << 24) |
            (clamp255(cb) << 16) |
            (clamp255(cg) << 8) |
            clamp255(cr);
          tbuf[pi] = t;
        }
        ybuf = row;
        if (ybuf <= 0) break;
      }
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, ctx, tbuf, ox, oy };
  }

  /*
   * Decor: trees, boulders, spires, crystals, vents. Purely visual and
   * deterministic per seed. Never placed on or right next to buildable
   * cells (tall decor keeps more distance), never where the ground point is
   * hidden behind nearer terrain, and capped in front of the grid like the
   * terrain itself.
   */
  private drawDecor(
    ctx: CanvasRenderingContext2D,
    tbuf: Float32Array,
    width: number,
    height: number,
    ox: number,
    oy: number,
  ): void {
    const { s, p, field, palette: pal } = this;
    const rng = createSurfaceRng(this.surface.seed ^ 0x2c1b3c6d);
    const forest = new SimplexNoise2D(this.surface.seed ^ 0x68e31da4);
    const items: { u: number; v: number; kind: DecorKind; scale: number; seed: number; t: number }[] = [];
    const type = this.type;

    for (let cv = 0; cv < s; cv += 0.5) {
      for (let cu = 0; cu < s; cu += 0.5) {
        const u = cu + rng() * 0.5;
        const v = cv + rng() * 0.5;
        const roll = rng();
        const i = this.index(u, v);
        if (i < 0) continue;
        const k = this.kind[i];
        const dist = this.clearDist[i];
        const slope = this.slope[i];
        const h = this.h[i];
        const kind = pickDecor(type, k, slope, h, forest.noise(u * 0.13, v * 0.13), roll, field.biome.lowFloor);
        if (!kind) continue;
        const tall = DECOR_TALL.has(kind);
        if (dist < (tall ? 1.6 : 0.75)) continue;
        const scale = 0.55 + rng() * 0.6;
        const decorHeight = (tall ? 0.9 : 0.35) * scale;
        if (h + decorHeight > this.capAt(u, v) + 0.2) continue;
        items.push({ u, v, kind, scale, seed: Math.floor(rng() * 1e9), t: u + v - s });
      }
    }

    // Blocked grid cells whose terrain ended up flat (legacy colonies,
    // folded pockets) still have to read as obstacles: rubble.
    for (let gy = 0; gy < this.n; gy++) {
      for (let gx = 0; gx < this.n; gx++) {
        if (!this.blocked[gy * this.n + gx]) continue;
        const cu = this.m + gx + 0.5;
        const cv = this.m + gy + 0.5;
        const i = this.index(cu, cv);
        if (i < 0 || this.kind[i] !== Kind.Land) continue;
        for (let j = 0; j < 3; j++) {
          const u = cu + (rng() - 0.5) * 0.6;
          const v = cv + (rng() - 0.5) * 0.6;
          items.push({ u, v, kind: 'boulder', scale: 0.7 + rng() * 0.4, seed: Math.floor(rng() * 1e9), t: u + v - s });
        }
      }
    }

    items.sort((x, y) => x.t - y.t);
    for (const item of items) {
      const i = this.index(item.u, item.v);
      const hTop = this.top[i];
      const du = item.u - s / 2;
      const dv = item.v - s / 2;
      const x = ox + ((du - dv) / SQ2) * p;
      const y = oy + ((du + dv) / (2 * SQ2) - RISE * hTop) * p;
      const px = Math.round(x);
      const py = Math.min(height - 1, Math.max(0, Math.round(y) + 1));
      if (px < 0 || px >= width) continue;
      // Visible only if the terrain painted at the foot is this ground point.
      if (Math.abs(tbuf[py * width + px] - item.t) > 0.6) continue;
      const edge = Math.min(item.u, item.v, s - item.u, s - item.v);
      ctx.globalAlpha = smoothstep(0, EDGE_FADE, edge);
      drawDecorItem(ctx, item.kind, x, y, p * item.scale, pal, item.seed);
    }
    ctx.globalAlpha = 1;
  }
}

function clamp255(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
}

type DecorKind = 'tree' | 'conifer' | 'boulder' | 'spire' | 'crystal' | 'vent' | 'shrub' | 'shard';
const DECOR_TALL = new Set<DecorKind>(['tree', 'conifer', 'spire', 'crystal', 'shard']);

function pickDecor(
  type: string,
  kind: Kind,
  slope: number,
  h: number,
  forest: number,
  roll: number,
  lowFloor: number,
): DecorKind | null {
  const onLand = kind === Kind.Land || (kind === Kind.Rock && slope < 0.5);
  const onRock = kind === Kind.Rock && slope < 1.2;
  const onFloor = kind === Kind.Floor && h < lowFloor * 0.85;
  switch (type) {
    case 'earthlike':
      if (onLand && kind === Kind.Land && forest > 0.15 && roll < 0.55) return roll < 0.2 ? 'conifer' : 'tree';
      if (onLand && roll < 0.03) return 'tree';
      if (onRock && h < 1.3 && roll < 0.12) return roll < 0.05 ? 'conifer' : 'boulder';
      return null;
    case 'ice':
      if (onRock && roll < 0.1) return roll < 0.04 ? 'shard' : 'boulder';
      if (onLand && forest > 0.35 && roll < 0.08) return 'shard';
      return null;
    case 'venuslike':
      if (onLand && forest > 0.25 && roll < 0.06) return 'vent';
      if ((onLand || onRock) && roll < 0.06) return 'boulder';
      return null;
    case 'gasgiant':
      if ((onLand || onRock) && forest > 0.2 && roll < 0.14) return 'crystal';
      if (onRock && roll < 0.04) return 'boulder';
      return null;
    case 'marslike':
      if ((onLand || onFloor) && roll < 0.07) return 'boulder';
      if ((onFloor || onRock) && forest > 0.3 && roll < 0.05) return 'spire';
      return null;
    case 'desert':
      if (onLand && forest > 0.25 && roll < 0.06) return 'shrub';
      if ((onLand || onFloor) && roll < 0.035) return 'boulder';
      if ((onFloor || onRock) && forest > 0.3 && roll < 0.05) return 'spire';
      return null;
    default:
      return null;
  }
}

function rgb(c: Rgb, k = 1, a = 1): string {
  return `rgba(${clamp255(c[0] * k)}, ${clamp255(c[1] * k)}, ${clamp255(c[2] * k)}, ${a})`;
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.45, y + ry * 0.15, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDecorItem(
  ctx: CanvasRenderingContext2D,
  kind: DecorKind,
  x: number,
  y: number,
  size: number,
  pal: SurfacePalette,
  seed: number,
): void {
  const rng = createSurfaceRng(seed);
  switch (kind) {
    case 'tree': {
      groundShadow(ctx, x, y, size * 0.32, size * 0.13);
      ctx.fillStyle = 'rgba(60, 44, 30, 1)';
      ctx.fillRect(x - size * 0.03, y - size * 0.22, size * 0.06, size * 0.22);
      const base = mix(pal.landA, [40, 70, 30], 0.5 + rng() * 0.3);
      for (let j = 0; j < 3; j++) {
        const cx = x + (rng() - 0.5) * size * 0.22;
        const cy = y - size * (0.36 + rng() * 0.16);
        const r = size * (0.15 + rng() * 0.08);
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
        g.addColorStop(0, rgb(base, 1.55));
        g.addColorStop(0.6, rgb(base, 1));
        g.addColorStop(1, rgb(base, 0.6));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'conifer': {
      groundShadow(ctx, x, y, size * 0.2, size * 0.09);
      const base = mix(pal.landA, [24, 56, 34], 0.65);
      const tiers = 3;
      for (let j = 0; j < tiers; j++) {
        const w = size * (0.2 - j * 0.045);
        const by = y - size * (0.08 + j * 0.2);
        const ty = by - size * 0.32;
        const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
        g.addColorStop(0, rgb(base, 1.4));
        g.addColorStop(1, rgb(base, 0.65));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - w, by);
        ctx.lineTo(x, ty);
        ctx.lineTo(x + w, by);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    case 'boulder':
    case 'shrub': {
      const rx = size * (kind === 'shrub' ? 0.13 : 0.17);
      const ry = rx * 0.75;
      groundShadow(ctx, x, y, rx * 1.1, ry * 0.5);
      const base: Rgb = kind === 'shrub' ? [96, 104, 58] : mix(pal.rockA, pal.rockB, rng());
      const cy = y - ry * 0.8;
      const pts = 7;
      ctx.beginPath();
      for (let j = 0; j < pts; j++) {
        const ang = (j / pts) * Math.PI * 2;
        const rr = 0.75 + rng() * 0.35;
        const px = x + Math.cos(ang) * rx * rr;
        const py = cy + Math.sin(ang) * ry * rr * (Math.sin(ang) < 0 ? 1.25 : 0.9);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(x - rx, cy - ry, x + rx, cy + ry);
      g.addColorStop(0, rgb(base, 1.35));
      g.addColorStop(0.55, rgb(base, 0.95));
      g.addColorStop(1, rgb(base, 0.55));
      ctx.fillStyle = g;
      ctx.fill();
      return;
    }
    case 'spire': {
      const w = size * 0.12;
      const hgt = size * (0.6 + rng() * 0.4);
      groundShadow(ctx, x, y, w * 1.6, w * 0.6);
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.lineTo(x - w * 0.55, y - hgt);
      ctx.lineTo(x + w * 0.45, y - hgt * 1.04);
      ctx.lineTo(x + w, y);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, rgb(pal.faceBand, 1.15));
      g.addColorStop(0.5, rgb(pal.face, 1));
      g.addColorStop(1, rgb(pal.face, 0.6));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = rgb(pal.face, 0.55, 0.5);
      ctx.lineWidth = Math.max(1, size * 0.015);
      for (let b = 1; b < 4; b++) {
        const by = y - (hgt * b) / 4;
        ctx.beginPath();
        ctx.moveTo(x - w * (1 - b * 0.11), by);
        ctx.lineTo(x + w * (1 - b * 0.13), by);
        ctx.stroke();
      }
      return;
    }
    case 'crystal':
    case 'shard': {
      const tint: Rgb = kind === 'crystal' ? [196, 140, 255] : [200, 236, 255];
      groundShadow(ctx, x, y, size * 0.16, size * 0.07);
      ctx.save();
      ctx.shadowColor = rgb(tint, 1, 0.6);
      ctx.shadowBlur = size * 0.12;
      const count = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < count; j++) {
        const lean = (rng() - 0.5) * 0.7;
        const len = size * (0.35 + rng() * 0.45);
        const w = size * (0.04 + rng() * 0.03);
        const bx = x + (rng() - 0.5) * size * 0.16;
        const tx = bx + Math.sin(lean) * len;
        const ty = y - Math.cos(lean) * len;
        const g = ctx.createLinearGradient(bx - w, y, bx + w, ty);
        g.addColorStop(0, rgb(tint, 0.55, 0.9));
        g.addColorStop(0.6, rgb(tint, 1, 0.85));
        g.addColorStop(1, rgb([255, 255, 255], 1, 0.95));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx - w, y);
        ctx.lineTo(tx - w * 0.6, ty + w);
        ctx.lineTo(tx, ty - w);
        ctx.lineTo(tx + w * 0.6, ty + w);
        ctx.lineTo(bx + w, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    case 'vent': {
      const w = size * 0.2;
      const hgt = size * 0.22;
      groundShadow(ctx, x, y, w, w * 0.35);
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.lineTo(x - w * 0.3, y - hgt);
      ctx.lineTo(x + w * 0.3, y - hgt);
      ctx.lineTo(x + w, y);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, rgb(pal.rockA, 1.2));
      g.addColorStop(1, rgb(pal.rockB, 0.7));
      ctx.fillStyle = g;
      ctx.fill();
      const glow = ctx.createRadialGradient(x, y - hgt, 0, x, y - hgt, w * 0.9);
      glow.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
      glow.addColorStop(0.4, 'rgba(255, 120, 30, 0.6)');
      glow.addColorStop(1, 'rgba(255, 80, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x, y - hgt, w * 0.9, w * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
  }
}

/** Only used by tests: drops cached renders. */
export function clearPlanetSurfaceRenderCache(): void {
  renderCache.clear();
}


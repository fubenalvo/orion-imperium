import { IsoSvg, LIGHT, RISE, css, rng } from './iso-svg.mjs';

/*
 * Building designs for the planet view, one function per building id in
 * planet-data.json. Each receives a painter whose footprint spans
 * u, v ∈ [0, f] and draws back to front (smaller u + v first).
 *
 * Style: Imperium Galactica-like colony architecture — warm concrete and
 * steel volumes on a bevelled base slab, lit window grids, glowing cyan
 * light strips, red beacons and hazard-yellow markings.
 */

const WALL = [198, 192, 178];
const WALL_DARK = [152, 148, 138];
const WHITE = [222, 226, 230];
const METAL = [122, 130, 140];
const METAL_DARK = [72, 78, 88];
const CONCRETE = [114, 118, 124];
const GLASS = [92, 180, 232];
const ACCENT = [70, 192, 255];
const WARN = [234, 188, 62];
const RED = [255, 72, 60];
const GRASS = [86, 132, 66];
const ROOF_GREEN = [96, 134, 80];

function plate(p, f, color = CONCRETE) {
  p.box(0, 0, f, f, 0, 0.05, METAL_DARK, color);
  p.poly(
    [[0.05, 0.05, 0.05], [f - 0.05, 0.05, 0.05], [f - 0.05, f - 0.05, 0.05], [0.05, f - 0.05, 0.05]],
    css(color, 1.04),
    { stroke: 'rgba(255,255,255,0.12)', width: 0.8 },
  );
}

function beacon(p, u, v, h, height = 0.3) {
  p.line([u, v, h], [u, v, h + height], css(METAL, 1.25), 1.4);
  p.glow(u, v, h + height, 0.05, RED);
}

/* Tower block with windows, floor joints and a crown light strip. */
function tower(p, u, v, du, dv, h0, h1, random, o = {}) {
  const b = p.box(u, v, du, dv, h0, h1, o.wall ?? WALL, o.roof ?? WALL_DARK);
  const floors = Math.max(1, Math.round((h1 - h0) / 0.2));
  p.windows('left', b, h0 + 0.06, h1 - 0.08, floors, Math.max(2, Math.round(du / 0.12)), random, o.lit ?? 0.6);
  p.windows('right', b, h0 + 0.06, h1 - 0.08, floors, Math.max(2, Math.round(dv / 0.12)), random, (o.lit ?? 0.6) - 0.1);
  if (o.stripe !== false) p.stripe(b, h1 - 0.07, o.stripe ?? ACCENT, 0.03);
  return b;
}

/* Roof clutter: AC units / vents on a roof rectangle. */
function roofUnits(p, b, random, count = 2) {
  for (let k = 0; k < count; k++) {
    const w = 0.08 + random() * 0.08;
    const u = b.u + 0.05 + random() * Math.max(0.01, b.du - w - 0.1);
    const v = b.v + 0.05 + random() * Math.max(0.01, b.dv - w - 0.1);
    p.box(u, v, w, w * 0.8, b.h1, b.h1 + 0.06 + random() * 0.05, METAL, METAL, { edges: false });
  }
}

// ---------------------------------------------------------------- defense

function laserTurret(p, f) {
  plate(p, f, METAL_DARK);
  const c = f / 2;
  p.box(0.1, 0.1, f - 0.2, f - 0.2, 0.05, 0.2, METAL, METAL_DARK);
  p.stripe({ u: 0.1, v: 0.1, du: f - 0.2, dv: f - 0.2 }, 0.14, RED, 0.025);
  p.cylinder(c, c, 0.2, 0.2, 0.38, METAL, METAL_DARK);
  p.ring(c, c, 0.2, 0.3, css(RED), 1.6, true);
  // Turret head with twin barrels pointing toward the viewer's left.
  p.box(c - 0.16, c - 0.12, 0.3, 0.24, 0.38, 0.55, WHITE, METAL);
  for (const dv of [-0.06, 0.06]) {
    p.line([c - 0.04 + dv, c + 0.1, 0.47], [c - 0.04 + dv, c + 0.42, 0.47], css(METAL_DARK, 1.1), 3.2, { cap: 'butt' });
    p.line([c - 0.04 + dv, c + 0.1, 0.48], [c - 0.04 + dv, c + 0.42, 0.48], css(METAL, 1.3), 1.1, { cap: 'butt' });
    p.glow(c - 0.04 + dv, c + 0.43, 0.47, 0.05, RED);
  }
  p.box(c - 0.04, c - 0.08, 0.12, 0.1, 0.55, 0.6, METAL_DARK);
  p.glow(c + 0.02, c - 0.03, 0.62, 0.04, ACCENT);
}

function missileTurret(p, f) {
  plate(p, f, METAL_DARK);
  const c = f / 2;
  p.box(0.08, 0.08, f - 0.16, f - 0.16, 0.05, 0.18, METAL, METAL_DARK);
  p.cylinder(c, c, 0.18, 0.18, 0.28, METAL_DARK, METAL);
  // Launcher box with a 3×2 tube array on its visible front faces.
  const b = p.box(c - 0.2, c - 0.17, 0.36, 0.32, 0.28, 0.58, WHITE, METAL);
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 3; k++) {
      const [u, v, h] = [b.u + 0.06 + k * 0.1, b.v + b.dv, 0.36 + r * 0.11];
      p.disc(u + 0.03, v, 0.035, h + 0.02, css([30, 32, 36]));
      p.glow(u + 0.03, v, h + 0.02, 0.025, WARN);
    }
  }
  p.stripe(b, 0.3, WARN, 0.025);
  // Small radar on a mast.
  p.line([b.u + 0.06, b.v + 0.05, 0.58], [b.u + 0.06, b.v + 0.05, 0.75], css(METAL, 1.2), 1.2);
  p.disc(b.u + 0.06, b.v + 0.05, 0.07, 0.76, css(WHITE, 1.1), { stroke: css(METAL_DARK), width: 0.8 });
  beacon(p, b.u + b.du - 0.04, b.v + 0.04, 0.58, 0.12);
}

function planetaryShield(p, f) {
  plate(p, f, METAL_DARK);
  const c = f / 2;
  // Four corner emitter pylons (back ones first).
  const pylon = (u, v) => {
    p.cylinder(u, v, 0.07, 0.05, 0.45, METAL, METAL_DARK, 0.04);
    p.sphere(u, v, 0.48, 0.045, ACCENT, true);
  };
  pylon(0.22, 0.22);
  pylon(f - 0.22, 0.22);
  pylon(0.22, f - 0.22);
  // Generator: stepped base, column, glowing emitter core.
  p.box(c - 0.38, c - 0.38, 0.76, 0.76, 0.05, 0.18, METAL, METAL_DARK);
  p.stripe({ u: c - 0.38, v: c - 0.38, du: 0.76, dv: 0.76 }, 0.12, ACCENT, 0.03);
  p.cylinder(c, c, 0.26, 0.18, 0.32, WHITE, METAL);
  p.cylinder(c, c, 0.12, 0.32, 0.95, METAL, METAL_DARK, 0.08);
  for (const h of [0.45, 0.6, 0.75]) p.ring(c, c, 0.11, h, css(ACCENT), 1.6, true);
  p.sphere(c, c, 1.05, 0.13, ACCENT, true);
  p.glow(c, c, 1.05, 0.32, ACCENT);
  pylon(f - 0.22, f - 0.22);
  // The shield bubble itself, faint.
  p.dome(c, c, f * 0.5, 0.05, f * 0.62, [110, 200, 255], { alpha: 0.18 });
}

// ---------------------------------------------------------------- housing

function smallResidential(p, f) {
  const random = rng(11);
  plate(p, f);
  const t = tower(p, 0.08, 0.08, f * 0.56, f * 0.56, 0.05, 1.0, random);
  roofUnits(p, { ...t, h1: 1.0 }, random, 2);
  beacon(p, t.u + 0.1, t.v + 0.1, 1.0, 0.3);
  const side = p.box(t.u + t.du - 0.02, 0.12, f - t.du - 0.16, t.dv * 0.75, 0.05, 0.52, WALL, WALL_DARK);
  p.windows('right', side, 0.12, 0.46, 2, 2, random, 0.7);
  p.stripe(side, 0.46, ACCENT, 0.025);
  const annex = p.box(0.08, t.v + t.dv - 0.02, f * 0.84, f - t.dv - 0.16, 0.05, 0.3, WALL_DARK, ROOF_GREEN);
  p.windows('left', annex, 0.1, 0.26, 1, 4, random, 0.8);
  p.tree(annex.u + 0.12, annex.v + 0.06, 0.3, 0.2, random);
  p.box(annex.u + annex.du - 0.03, annex.v + 0.03, 0.03, annex.dv * 0.5, 0.05, 0.22, [56, 66, 80]);
}

function mediumResidential(p, f) {
  const random = rng(23);
  plate(p, f);
  const a = tower(p, 0.12, 0.12, 0.62, 0.55, 0.05, 1.35, random);
  roofUnits(p, a, random, 3);
  beacon(p, a.u + 0.1, a.v + 0.1, 1.35, 0.35);
  const b = tower(p, 0.95, 0.15, 0.6, 0.62, 0.05, 0.95, random, { wall: WHITE });
  roofUnits(p, b, random, 2);
  // Sky bridge between the towers.
  p.box(0.74, 0.3, 0.21, 0.22, 0.62, 0.74, METAL, METAL);
  p.stripe({ u: 0.74, v: 0.3, du: 0.21, dv: 0.22 }, 0.66, ACCENT, 0.03);
  const c = tower(p, 0.15, 0.95, 0.75, 0.62, 0.05, 0.7, random, { wall: WALL_DARK });
  roofUnits(p, c, random, 1);
  // Courtyard with trees and a fountain.
  p.poly([[0.98, 0.98, 0.051], [1.58, 0.98, 0.051], [1.58, 1.58, 0.051], [0.98, 1.58, 0.051]], css(GRASS, 1.05));
  p.disc(1.28, 1.28, 0.14, 0.06, css([86, 160, 210]), { stroke: css(WHITE), width: 1.2 });
  p.glow(1.28, 1.28, 0.1, 0.07, [140, 220, 255]);
  p.tree(1.08, 1.45, 0.05, 0.36, random);
  p.tree(1.45, 1.1, 0.05, 0.36, random);
  p.tree(1.48, 1.5, 0.05, 0.4, random);
}

function largeResidential(p, f) {
  const random = rng(37);
  plate(p, f);
  // Central plaza.
  p.poly([[0.9, 0.9, 0.051], [1.8, 0.9, 0.051], [1.8, 1.8, 0.051], [0.9, 1.8, 0.051]], css(GRASS, 1.05));
  p.disc(1.35, 1.35, 0.2, 0.06, css([86, 160, 210]), { stroke: css(WHITE), width: 1.4 });
  p.cylinder(1.35, 1.35, 0.04, 0.06, 0.2, WHITE);
  p.glow(1.35, 1.35, 0.22, 0.09, [140, 220, 255]);
  // Four towers of different heights around the plaza (back to front).
  const t1 = tower(p, 0.12, 0.12, 0.7, 0.7, 0.05, 1.75, random);
  roofUnits(p, t1, random, 3);
  beacon(p, t1.u + 0.12, t1.v + 0.12, 1.75, 0.4);
  // Low podium linking the back blocks (behind towers 2 and 3).
  const pod = p.box(0.85, 0.12, 0.95, 0.42, 0.05, 0.42, WALL_DARK, ROOF_GREEN);
  p.windows('right', pod, 0.1, 0.36, 2, 3, random, 0.7);
  const t2 = tower(p, 1.85, 0.15, 0.7, 0.66, 0.05, 1.3, random, { wall: WHITE });
  roofUnits(p, t2, random, 2);
  const t3 = tower(p, 0.15, 1.85, 0.66, 0.7, 0.05, 1.15, random, { wall: WHITE });
  roofUnits(p, t3, random, 2);
  for (const [u, v] of [[1.0, 1.65], [1.65, 1.0], [1.15, 1.05]]) p.tree(u, v, 0.05, 0.38, random);
  const t4 = tower(p, 1.85, 1.85, 0.72, 0.72, 0.05, 1.5, random);
  roofUnits(p, t4, random, 3);
  beacon(p, t4.u + 0.6, t4.v + 0.1, 1.5, 0.3);
}

// ---------------------------------------------------------------- social

function park(p, f) {
  const random = rng(41);
  plate(p, f, [96, 104, 92]);
  p.poly([[0.08, 0.08, 0.052], [f - 0.08, 0.08, 0.052], [f - 0.08, f - 0.08, 0.052], [0.08, f - 0.08, 0.052]], css(GRASS, 1.1));
  // Paths crossing the park.
  const c = f / 2;
  p.poly([[c - 0.07, 0.08, 0.054], [c + 0.07, 0.08, 0.054], [c + 0.07, f - 0.08, 0.054], [c - 0.07, f - 0.08, 0.054]], css([200, 186, 150]));
  p.poly([[0.08, c - 0.07, 0.054], [f - 0.08, c - 0.07, 0.054], [f - 0.08, c + 0.07, 0.054], [0.08, c + 0.07, 0.054]], css([200, 186, 150]));
  // Pond.
  p.disc(1.25, 0.45, 0.25, 0.055, p.linear(0, 0, 0, 1, [[0, css([70, 150, 200])], [1, css([40, 110, 170])]]), { stroke: css([210, 200, 160]), width: 1.6 });
  p.disc(1.2, 0.42, 0.07, 0.057, 'rgba(255,255,255,0.35)');
  // Fountain plaza in the middle.
  p.cylinder(c, c, 0.22, 0.054, 0.09, WHITE, [96, 170, 220]);
  p.cylinder(c, c, 0.05, 0.09, 0.24, WHITE);
  p.glow(c, c, 0.27, 0.12, [160, 225, 255]);
  // Trees, back to front.
  const spots = [];
  for (let k = 0; k < 16; k++) {
    const u = 0.18 + random() * (f - 0.36);
    const v = 0.18 + random() * (f - 0.36);
    if (Math.abs(u - c) < 0.16 || Math.abs(v - c) < 0.16) continue;
    if (Math.hypot(u - 1.25, v - 0.45) < 0.32) continue;
    spots.push([u, v]);
  }
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [u, v] of spots) p.tree(u, v, 0.055, 0.32 + random() * 0.14, random, random() < 0.3 ? [96, 132, 52] : [62, 118, 58]);
  // Street lamps at the path ends.
  for (const [u, v] of [[c + 0.1, 0.15], [0.15, c + 0.1], [c + 0.1, f - 0.15], [f - 0.15, c + 0.1]]) {
    p.line([u, v, 0.05], [u, v, 0.25], css(METAL_DARK), 1);
    p.glow(u, v, 0.26, 0.05, [255, 220, 150]);
  }
}

function hospital(p, f) {
  const random = rng(53);
  plate(p, f);
  // L-shaped white wings.
  const back = tower(p, 0.12, 0.12, 1.45, 0.6, 0.05, 0.75, random, { wall: WHITE, roof: [200, 204, 208], stripe: [255, 90, 80] });
  roofUnits(p, back, random, 2);
  const wing = tower(p, 0.12, 0.72, 0.62, 0.85, 0.05, 0.6, random, { wall: WHITE, roof: [200, 204, 208], stripe: [255, 90, 80] });
  // Rooftop helipad with a red cross on the back wing.
  p.disc(1.05, 0.42, 0.24, 0.755, css([70, 76, 84]), { stroke: css(WARN), width: 1.3 });
  p.poly([[1.0, 0.3, 0.757], [1.1, 0.3, 0.757], [1.1, 0.54, 0.757], [1.0, 0.54, 0.757]], css([230, 50, 50]));
  p.poly([[0.93, 0.37, 0.758], [1.17, 0.37, 0.758], [1.17, 0.47, 0.758], [0.93, 0.47, 0.758]], css([230, 50, 50]));
  // Entrance canopy and ambulance bay.
  p.box(0.8, 0.8, 0.5, 0.3, 0.05, 0.08, CONCRETE);
  p.box(0.82, 0.72, 0.45, 0.25, 0.28, 0.32, WHITE, WHITE);
  p.line([0.84, 0.95, 0.05], [0.84, 0.95, 0.28], css(METAL), 1.2);
  p.line([1.25, 0.95, 0.05], [1.25, 0.95, 0.28], css(METAL), 1.2);
  p.glow(1.05, 0.98, 0.3, 0.08, [255, 90, 80]);
  // Garden.
  p.poly([[0.85, 1.2, 0.051], [1.6, 1.2, 0.051], [1.6, 1.6, 0.051], [0.85, 1.6, 0.051]], css(GRASS, 1.05));
  p.tree(1.05, 1.4, 0.05, 0.3, random);
  p.tree(1.4, 1.35, 0.05, 0.34, random);
  beacon(p, back.u + 0.1, back.v + 0.1, 0.75, 0.25);
}

function school(p, f) {
  const random = rng(61);
  plate(p, f);
  // Sports field in front.
  p.poly([[0.85, 0.75, 0.052], [1.6, 0.75, 0.052], [1.6, 1.6, 0.052], [0.85, 1.6, 0.052]], css([92, 150, 72]));
  p.poly([[0.9, 0.8, 0.054], [1.55, 0.8, 0.054], [1.55, 1.55, 0.054], [0.9, 1.55, 0.054]], 'none', { stroke: 'rgba(255,255,255,0.8)', width: 1 });
  p.line([0.9, 1.175, 0.054], [1.55, 1.175, 0.054], 'rgba(255,255,255,0.8)', 1);
  p.disc(1.225, 1.175, 0.12, 0.054, 'none', { stroke: 'rgba(255,255,255,0.8)', width: 1 });
  // Main building (back) with a clock tower, side wing.
  const main = tower(p, 0.12, 0.12, 1.45, 0.52, 0.05, 0.62, random, { wall: [214, 196, 160], roof: [168, 92, 70], stripe: WARN });
  const t = p.box(0.6, 0.18, 0.28, 0.28, 0.62, 1.05, [214, 196, 160], [168, 92, 70]);
  p.disc(t.u + 0.14, t.v + t.dv, 0.08, 0.92, css(WHITE), { stroke: css(METAL_DARK), width: 1 });
  roofUnits(p, main, random, 1);
  const wing = tower(p, 0.12, 0.66, 0.6, 0.9, 0.05, 0.48, random, { wall: [214, 196, 160], roof: [168, 92, 70], stripe: WARN });
  p.tree(0.78, 1.55, 0.05, 0.3, random);
  // Goal posts.
  for (const u of [0.95, 1.5]) p.line([u, 1.12, 0.054], [u, 1.12, 0.14], 'rgba(255,255,255,0.9)', 1);
}

function entertainmentCenter(p, f) {
  const random = rng(71);
  plate(p, f);
  const c = f / 2;
  const NEON = [255, 80, 220];
  // Ring building around the arena.
  p.cylinder(c, c, 1.15, 0.05, 0.42, WALL_DARK, [120, 110, 130]);
  for (let k = 0; k < 3; k++) p.ring(c, c, 1.15, 0.12 + k * 0.1, css(k % 2 ? NEON : ACCENT), 1.6, true);
  // Arena dome with ribs and a crown light.
  p.dome(c, c, 0.95, 0.42, 0.75, [150, 120, 210], { ribs: 8 });
  p.ring(c, c, 0.95, 0.43, css(NEON), 2.2, true);
  p.sphere(c, c, 1.07, 0.06, NEON, true);
  p.glow(c, c, 1.1, 0.2, NEON);
  // Billboard pylons at the front corners.
  for (const [u, v] of [[0.3, f - 0.35], [f - 0.35, 0.3], [f - 0.4, f - 0.4]]) {
    p.box(u, v, 0.12, 0.12, 0.05, 0.75, METAL_DARK);
    const sign = p.box(u - 0.05, v - 0.05, 0.22, 0.22, 0.55, 0.78, METAL);
    p.poly(p.facePoly('left', sign, 0.02, 0.2, 0.58, 0.75), css(random() < 0.5 ? NEON : ACCENT, 1), { filter: 'glow' });
    p.poly(p.facePoly('right', sign, 0.02, 0.2, 0.58, 0.75), css(random() < 0.5 ? NEON : WARN, 0.9), { filter: 'glow' });
  }
  // Entrance plaza lights.
  for (let k = 0; k < 6; k++) p.glow(0.4 + k * 0.38, f - 0.12, 0.08, 0.05, k % 2 ? NEON : ACCENT);
}

// ---------------------------------------------------------------- power

function solarArray(p, f) {
  plate(p, f, METAL_DARK);
  const gap = 0.12;
  const size = (f - gap * 3) / 2;
  const hi = 0.36;
  const lo = 0.14;
  const cells = [
    [gap, gap],
    [gap * 2 + size, gap],
    [gap, gap * 2 + size],
    [gap * 2 + size, gap * 2 + size],
  ];
  // Panels lean back (high edge at -v) so their faces turn to the sky and
  // the viewer; drawn back to front.
  for (const [u, v] of cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]))) {
    p.box(u + size * 0.15, v + size * 0.3, 0.05, 0.05, 0.05, hi - 0.05, METAL_DARK, METAL_DARK, { edges: false });
    p.box(u + size * 0.8, v + size * 0.3, 0.05, 0.05, 0.05, hi - 0.05, METAL_DARK, METAL_DARK, { edges: false });
    p.box(u + size * 0.15, v + size * 0.8, 0.05, 0.05, 0.05, lo, METAL_DARK, METAL_DARK, { edges: false });
    p.box(u + size * 0.8, v + size * 0.8, 0.05, 0.05, 0.05, lo, METAL_DARK, METAL_DARK, { edges: false });
    p.poly([[u, v + size, lo - 0.03], [u + size, v + size, lo - 0.03], [u + size, v + size, lo], [u, v + size, lo]], css(METAL, 0.85));
    p.poly([[u + size, v, hi - 0.03], [u + size, v + size, lo - 0.03], [u + size, v + size, lo], [u + size, v, hi]], css(METAL, 0.6));
    const [x0, y0] = p.p(u, v, hi);
    const [x1, y1] = p.p(u + size, v + size, lo);
    const sheen = p.linear(x0, y0, x1, y1, [
      [0, css([64, 116, 196])],
      [0.42, css([24, 50, 118])],
      [0.55, css([110, 160, 228])],
      [0.68, css([30, 60, 130])],
      [1, css([16, 34, 86])],
    ]);
    p.poly([[u, v, hi], [u + size, v, hi], [u + size, v + size, lo], [u, v + size, lo]], sheen, { stroke: css([200, 225, 255], 1, 0.7), width: 1 });
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      p.line([u + size * t, v, hi], [u + size * t, v + size, lo], 'rgba(170,205,255,0.35)', 0.6);
      p.line([u, v + size * t, hi - (hi - lo) * t], [u + size, v + size * t, hi - (hi - lo) * t], 'rgba(170,205,255,0.35)', 0.6);
    }
  }
  const c = f / 2;
  p.box(c - 0.1, c - 0.1, 0.2, 0.2, 0.05, 0.26, METAL, METAL_DARK);
  p.stripe({ u: c - 0.1, v: c - 0.1, du: 0.2, dv: 0.2 }, 0.19, ACCENT, 0.03);
  p.glow(c, c, 0.3, 0.06, ACCENT);
}

function fusionPlant(p, f) {
  const random = rng(83);
  plate(p, f, METAL_DARK);
  // Cooling towers at the back (hyperboloid shells with steam).
  for (const [u, v] of [[0.55, 0.5], [1.35, 0.4]]) {
    p.cylinder(u, v, 0.34, 0.05, 1.05, WALL, [60, 60, 64], 0.24, { waist: 0.2, open: true });
    p.ring(u, v, 0.27, 0.7, css(WARN, 0.9), 1.2);
  }
  for (const [u, v] of [[0.55, 0.5], [1.35, 0.4]]) {
    const [x, y] = p.p(u, v, 1.15);
    p.track(y - 30);
    p.body.push(`<ellipse cx="${x}" cy="${y - 10}" rx="22" ry="14" fill="rgba(235,240,245,0.45)" filter="url(#soft)"/>`);
  }
  // Control block on the right.
  const ctrl = tower(p, 1.9, 0.15, 0.65, 0.75, 0.05, 0.62, random, { lit: 0.7 });
  roofUnits(p, ctrl, random, 2);
  beacon(p, ctrl.u + 0.5, ctrl.v + 0.1, 0.62, 0.3);
  // Pipes from the reactor to the towers.
  for (const [u, v] of [[0.55, 0.5], [1.35, 0.4]]) {
    p.line([u + 0.2, v + 0.3, 0.25], [1.35, 1.35, 0.25], css(METAL, 1.1), 3.4);
    p.line([u + 0.2, v + 0.3, 0.26], [1.35, 1.35, 0.26], css(WHITE, 0.9), 1.2);
  }
  // Reactor: armoured drum, glowing containment rings, energy core.
  const c = 1.4;
  p.cylinder(c, c, 0.72, 0.05, 0.28, METAL, METAL_DARK);
  p.cylinder(c, c, 0.55, 0.28, 0.72, WHITE, METAL);
  for (const h of [0.38, 0.5, 0.62]) p.ring(c, c, 0.55, h, css(ACCENT), 2.2, true);
  p.dome(c, c, 0.48, 0.72, 0.38, [120, 210, 255]);
  p.sphere(c, c, 0.92, 0.12, ACCENT, true);
  p.glow(c, c, 0.95, 0.38, ACCENT);
  // Transformer yard in front.
  for (let k = 0; k < 3; k++) {
    const b = p.box(0.25 + k * 0.32, 2.05, 0.2, 0.3, 0.05, 0.3, METAL, METAL_DARK);
    p.glow(b.u + 0.1, b.v + 0.15, 0.33, 0.04, ACCENT);
  }
  p.box(2.1, 2.0, 0.45, 0.45, 0.05, 0.22, CONCRETE);
  p.stripe({ u: 2.1, v: 2.0, du: 0.45, dv: 0.45 }, 0.16, WARN, 0.03);
}

// ---------------------------------------------------------------- industry

function spaceshipFactory(p, f) {
  const random = rng(97);
  plate(p, f, METAL_DARK);
  // Chimneys behind the hall.
  for (const u of [0.35, 0.6]) {
    p.cylinder(u, 0.25, 0.08, 0.05, 1.45, WALL_DARK, [40, 40, 44], 0.07, { open: true });
    p.ring(u, 0.25, 0.075, 1.3, css(RED), 1.4);
    const [x, y] = p.p(u, 0.25, 1.55);
    p.body.push(`<ellipse cx="${x + 6}" cy="${y - 6}" rx="12" ry="8" fill="rgba(200,200,205,0.4)" filter="url(#soft)"/>`);
  }
  // Main assembly hall with a sawtooth roof.
  const hall = p.box(0.12, 0.12, 1.55, 1.3, 0.05, 0.7, WALL_DARK, METAL);
  p.windows('left', hall, 0.12, 0.6, 2, 8, random, 0.65, { wide: true });
  p.stripe(hall, 0.64, WARN, 0.03);
  for (let k = 0; k < 5; k++) {
    const v0 = hall.v + (k * hall.dv) / 5;
    const v1 = hall.v + ((k + 1) * hall.dv) / 5;
    p.poly([[hall.u, v0, 0.7], [hall.u + hall.du, v0, 0.7], [hall.u + hall.du, v0, 0.92], [hall.u, v0, 0.92]], css(GLASS, 0.9));
    p.poly([[hall.u, v0, 0.92], [hall.u + hall.du, v0, 0.92], [hall.u + hall.du, v1, 0.7], [hall.u, v1, 0.7]], css(METAL, LIGHT.top));
    p.poly([[hall.u + hall.du, v0, 0.7], [hall.u + hall.du, v1, 0.7], [hall.u + hall.du, v0, 0.92]], css(METAL, LIGHT.right));
  }
  // Big hangar door on the right face, open, light spilling out.
  p.poly(p.facePoly('right', hall, 0.25, 1.05, 0.05, 0.55), css([24, 30, 40]));
  p.poly(p.facePoly('right', hall, 0.3, 1.0, 0.05, 0.12), css(WARN, 1, 0.6));
  // Gantry crane over the outdoor slipway.
  const sx = 1.85;
  for (const v of [0.25, 2.35]) {
    p.box(sx, v, 0.07, 0.07, 0.05, 1.0, WARN, WARN, { edges: false });
    p.box(sx + 0.62, v, 0.07, 0.07, 0.05, 1.0, WARN, WARN, { edges: false });
  }
  // Ship hull under construction on the slipway.
  p.box(sx + 0.12, 0.45, 0.42, 1.8, 0.05, 0.12, CONCRETE);
  const hu = sx + 0.18;
  p.poly([[hu, 0.6, 0.15], [hu + 0.3, 0.6, 0.15], [hu + 0.3, 2.05, 0.15], [hu + 0.15, 2.3, 0.2], [hu, 2.05, 0.15]], css(WHITE, 0.8));
  p.poly([[hu, 0.6, 0.15], [hu + 0.3, 0.6, 0.15], [hu + 0.3, 0.6, 0.45], [hu, 0.6, 0.45]], css(WHITE, LIGHT.left));
  p.poly([[hu + 0.3, 0.6, 0.15], [hu + 0.3, 2.05, 0.15], [hu + 0.3, 2.05, 0.4], [hu + 0.3, 0.6, 0.45]], css(METAL, LIGHT.right * 1.2));
  p.poly([[hu, 0.6, 0.45], [hu + 0.3, 0.6, 0.45], [hu + 0.3, 2.05, 0.4], [hu + 0.15, 2.3, 0.2], [hu, 2.05, 0.4]], css(WHITE, LIGHT.top));
  for (let k = 0; k < 6; k++) p.line([hu, 0.8 + k * 0.22, 0.44], [hu + 0.3, 0.8 + k * 0.22, 0.44], 'rgba(0,0,0,0.25)', 0.7);
  p.glow(hu + 0.15, 1.2, 0.47, 0.06, ACCENT);
  p.glow(hu + 0.1, 1.7, 0.45, 0.05, WARN);
  for (const v of [0.25, 2.35]) p.line([sx, v, 1.0], [sx + 0.69, v, 1.0], css(WARN), 3);
  p.line([sx + 0.03, 0.25, 1.0], [sx + 0.03, 2.42, 1.0], css(WARN, 0.85), 3);
  p.line([sx + 0.66, 0.25, 1.0], [sx + 0.66, 2.42, 1.0], css(WARN, 0.85), 3);
  p.line([sx + 0.35, 1.3, 1.0], [sx + 0.35, 1.3, 0.55], css(METAL_DARK), 0.8);
  p.box(sx + 0.28, 1.2, 0.14, 0.2, 0.96, 1.06, METAL_DARK);
  // Parts depot in front of the hall.
  for (let k = 0; k < 4; k++) {
    const b = p.box(0.25 + k * 0.33, 1.65, 0.24, 0.24, 0.05, 0.16 + (k % 2) * 0.08, k % 2 ? [150, 90, 60] : [80, 110, 140]);
    if (k === 3) p.glow(b.u + 0.12, b.v + 0.12, 0.3, 0.04, RED);
  }
  beacon(p, hall.u + 0.1, hall.v + 0.1, 0.92, 0.3);
}

function miningComplex(p, f) {
  const random = rng(109);
  plate(p, f, [96, 88, 80]);
  // Ore storage silos at the back.
  for (const [u, v] of [[0.35, 0.35], [0.85, 0.3], [0.38, 0.85]]) {
    p.cylinder(u, v, 0.2, 0.05, 0.85, [170, 160, 146], METAL);
    p.ring(u, v, 0.2, 0.3, css(WARN, 0.9), 1.2);
    p.ring(u, v, 0.2, 0.6, 'rgba(0,0,0,0.25)', 0.8);
    p.dome(u, v, 0.2, 0.85, 0.08, METAL);
  }
  // Headframe (shaft tower) over the mine shaft.
  const hx = 1.75;
  const hv = 0.55;
  p.box(hx - 0.3, hv - 0.25, 0.6, 0.5, 0.05, 0.3, WALL_DARK, METAL_DARK);
  const legs = [[hx - 0.2, hv - 0.15], [hx + 0.2, hv - 0.15], [hx - 0.2, hv + 0.15], [hx + 0.2, hv + 0.15]];
  for (const [u, v] of legs) p.line([u, v, 0.3], [hx, hv, 1.55], css([200, 120, 60]), 2.4);
  for (const h of [0.6, 0.9, 1.2]) {
    const k = (h - 0.3) / 1.25;
    const ring = legs.map(([u, v]) => [u + (hx - u) * k, v + (hv - v) * k, h]);
    p.line(ring[0], ring[1], css([200, 120, 60], 0.9), 1.4);
    p.line(ring[1], ring[3], css([200, 120, 60], 0.7), 1.4);
    p.line(ring[2], ring[3], css([200, 120, 60]), 1.4);
    p.line(ring[0], ring[2], css([200, 120, 60], 0.85), 1.4);
  }
  p.disc(hx, hv, 0.12, 1.5, css(METAL, 1.2), { stroke: css(METAL_DARK), width: 1 });
  beacon(p, hx, hv, 1.55, 0.18);
  // Processing plant.
  const plant = tower(p, 1.55, 1.15, 0.95, 0.75, 0.05, 0.62, random, { wall: [176, 166, 150], stripe: WARN, lit: 0.5 });
  roofUnits(p, plant, random, 3);
  // Conveyor from the shaft to the plant and on to the ore heaps.
  p.line([hx, hv + 0.3, 0.35], [hx - 0.1, 1.15, 0.45], css(METAL_DARK), 3.2);
  p.line([hx, hv + 0.3, 0.37], [hx - 0.1, 1.15, 0.47], css([140, 90, 50]), 1.2);
  p.line([1.55, 1.6, 0.4], [0.9, 1.6, 0.25], css(METAL_DARK), 3.2);
  p.line([1.55, 1.6, 0.42], [0.9, 1.6, 0.27], css([140, 90, 50]), 1.2);
  // Ore heaps.
  for (const [u, v, r] of [[0.65, 1.65, 0.34], [0.5, 2.2, 0.28], [1.1, 2.2, 0.3]]) {
    p.dome(u, v, r, 0.05, r * 0.7, [176, 112, 60]);
    for (let k = 0; k < 4; k++) p.glow(u + (random() - 0.5) * r, v + (random() - 0.5) * r * 0.6, 0.12 + random() * 0.1, 0.035, [255, 200, 110]);
  }
  // Ore truck.
  const t = p.box(1.75, 2.15, 0.3, 0.18, 0.05, 0.2, WARN, WARN);
  p.box(t.u + 0.3, t.v + 0.02, 0.12, 0.14, 0.05, 0.25, [200, 160, 60]);
  p.glow(t.u + 0.42, t.v + 0.09, 0.15, 0.03, [255, 240, 200]);
}

// ---------------------------------------------------------------- research

function smallResearchLab(p, f) {
  const random = rng(127);
  plate(p, f);
  const b = p.box(0.1, 0.1, f - 0.2, f - 0.3, 0.05, 0.36, WHITE, METAL);
  p.windows('left', b, 0.1, 0.3, 1, 4, random, 0.8, { litColor: [140, 255, 230] });
  p.windows('right', b, 0.1, 0.3, 1, 3, random, 0.7, { litColor: [120, 230, 210] });
  p.stripe(b, 0.32, [80, 255, 210], 0.025);
  p.dome(0.3, 0.3, 0.17, 0.36, 0.2, GLASS, { ribs: 4 });
  p.line([0.5, 0.25, 0.36], [0.5, 0.25, 0.75], css(METAL, 1.2), 1.2);
  p.disc(0.5, 0.25, 0.08, 0.6, css(WHITE, 1.1), { stroke: css(METAL_DARK), width: 0.8 });
  beacon(p, 0.5, 0.25, 0.75, 0.05);
  p.box(0.2, f - 0.2, 0.3, 0.12, 0.05, 0.18, METAL, METAL);
}

function researchLab(p, f) {
  const random = rng(131);
  plate(p, f);
  const TEAL = [80, 255, 210];
  // Main laboratory block.
  const main = tower(p, 0.12, 0.12, 1.0, 0.75, 0.05, 0.62, random, { wall: WHITE, stripe: TEAL, lit: 0.75 });
  // Observatory dome on the roof.
  p.cylinder(0.55, 0.45, 0.3, 0.62, 0.7, METAL, METAL);
  p.dome(0.55, 0.45, 0.28, 0.7, 0.3, GLASS, { ribs: 6 });
  // Antenna mast with dish (back right).
  p.box(1.25, 0.2, 0.3, 0.3, 0.05, 0.25, METAL, METAL_DARK);
  p.line([1.4, 0.35, 0.25], [1.4, 0.35, 1.25], css(METAL, 1.25), 1.6);
  for (const h of [0.5, 0.75, 1.0]) p.line([1.32, 0.35, h], [1.48, 0.35, h], css(METAL, 1.1), 1);
  beacon(p, 1.4, 0.35, 1.25, 0.12);
  // Satellite dish facing the sky.
  p.line([1.35, 1.25, 0.05], [1.35, 1.25, 0.3], css(METAL_DARK), 2.4);
  const [dx, dy] = p.p(1.35, 1.25, 0.42);
  p.track(dy - 20);
  p.body.push(`<ellipse cx="${dx}" cy="${dy}" rx="22" ry="15" transform="rotate(-25 ${dx} ${dy})" fill="${css(WHITE, 1.05)}" stroke="${css(METAL_DARK)}" stroke-width="1"/>`);
  p.body.push(`<ellipse cx="${dx + 2}" cy="${dy + 1}" rx="15" ry="10" transform="rotate(-25 ${dx} ${dy})" fill="${css(WHITE, 0.85)}"/>`);
  p.glow(1.35, 1.25, 0.5, 0.05, TEAL);
  // Glass greenhouse annex in front.
  const g = p.box(0.15, 1.0, 0.85, 0.55, 0.05, 0.3, [130, 200, 210], [170, 230, 230]);
  p.poly(p.facePoly('left', g, 0.02, 0.83, 0.07, 0.28), css([150, 230, 200], 1, 0.6));
  for (let k = 1; k < 5; k++) p.line([g.u + (g.du * k) / 5, g.v + g.dv, 0.05], [g.u + (g.du * k) / 5, g.v + g.dv, 0.3], 'rgba(255,255,255,0.5)', 0.7);
  for (let k = 0; k < 3; k++) p.tree(g.u + 0.2 + k * 0.25, g.v + 0.28, 0.05, 0.18, random);
  roofUnits(p, main, random, 1);
}

// ---------------------------------------------------------------- military

function spaceport(p, f) {
  const random = rng(29);
  plate(p, f);
  // Apron markings.
  for (let k = 0; k < 10; k++) {
    const t = 0.2 + (k / 9) * (f - 0.5);
    p.poly([[t, f * 0.52, 0.052], [t + 0.12, f * 0.52, 0.052], [t + 0.12, f * 0.54, 0.052], [t, f * 0.54, 0.052]], css(WARN, 0.9));
  }
  // Hangar with an arched roof (back left).
  const hu = 0.2;
  const hv = 0.2;
  const hdu = f * 0.5;
  const hdv = f * 0.32;
  const wall = 0.38;
  const arch = 0.32;
  p.box(hu, hv, hdu, hdv, 0.05, wall, WALL_DARK);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const h0 = wall + Math.sin(t0 * Math.PI) * arch;
    const h1 = wall + Math.sin(t1 * Math.PI) * arch;
    const k = h1 < h0 ? LIGHT.left * 1.15 : LIGHT.top * 0.92;
    p.poly([[hu, hv + hdv * t0, h0], [hu + hdu, hv + hdv * t0, h0], [hu + hdu, hv + hdv * t1, h1], [hu, hv + hdv * t1, h1]], css(METAL, k), { stroke: css(METAL_DARK, 0.8, 0.35), width: 0.5 });
  }
  for (let k = 1; k < 6; k++) {
    const u = hu + (hdu * k) / 6;
    const ptsArc = [];
    for (let i = 0; i <= steps; i++) ptsArc.push([u, hv + (hdv * i) / steps, wall + Math.sin((i / steps) * Math.PI) * arch]);
    for (let i = 0; i < steps; i++) p.line(ptsArc[i], ptsArc[i + 1], 'rgba(0,0,0,0.18)', 0.6);
  }
  const end = [[hu + hdu, hv, 0.05], [hu + hdu, hv + hdv, 0.05]];
  for (let i = steps; i >= 0; i--) end.push([hu + hdu, hv + (hdv * i) / steps, wall + Math.sin((i / steps) * Math.PI) * arch]);
  p.poly(end, css(WALL_DARK, LIGHT.right));
  p.poly([[hu + hdu, hv + hdv * 0.15, 0.05], [hu + hdu, hv + hdv * 0.85, 0.05], [hu + hdu, hv + hdv * 0.85, 0.5], [hu + hdu, hv + hdv * 0.15, 0.5]], css([30, 36, 46]));
  p.poly([[hu + hdu, hv + hdv * 0.2, 0.05], [hu + hdu, hv + hdv * 0.8, 0.05], [hu + hdu, hv + hdv * 0.8, 0.1], [hu + hdu, hv + hdv * 0.2, 0.1]], css(WARN, 1, 0.5));
  p.stripe({ u: hu, v: hv, du: hdu, dv: hdv }, 0.3, ACCENT, 0.03);
  p.glow(hu + hdu, hv + hdv * 0.5, 0.55, 0.05, WARN);

  // Operations block and control tower (back right).
  const ops = tower(p, f * 0.62, 0.2, f * 0.3, f * 0.3, 0.05, 0.55, random, { lit: 0.7 });
  roofUnits(p, ops, random, 1);
  // Radar dish at the back corner of the roof, behind the tower.
  p.line([ops.u + 0.12, ops.v + 0.12, 0.55], [ops.u + 0.12, ops.v + 0.12, 0.7], css(METAL), 1.2);
  p.disc(ops.u + 0.12, ops.v + 0.12, 0.12, 0.72, css(WHITE, 1.1), { stroke: css(METAL_DARK), width: 0.8 });
  const tu = ops.u + ops.du * 0.55;
  const tv = ops.v + ops.dv * 0.55;
  p.cylinder(tu, tv, 0.15, 0.55, 1.4, WALL, WALL_DARK, 0.12);
  p.ring(tu, tv, 0.13, 1.1, css(ACCENT), 1.6, true);
  p.cylinder(tu, tv, 0.2, 1.4, 1.46, METAL_DARK, METAL);
  p.cylinder(tu, tv, 0.27, 1.46, 1.62, GLASS, METAL, 0.29);
  p.ring(tu, tv, 0.28, 1.54, 'rgba(255,255,255,0.5)', 0.8);
  p.cylinder(tu, tv, 0.3, 1.62, 1.68, METAL, METAL, 0.24);
  beacon(p, tu, tv, 1.68, 0.38);

  // Two landing pads with lights; a shuttle on the right one.
  const pads = [
    [f * 0.27, f * 0.77],
    [f * 0.73, f * 0.77],
  ];
  pads.forEach(([cu, cv], i) => {
    const r = f * 0.2;
    p.cylinder(cu, cv, r, 0.05, 0.1, METAL_DARK, CONCRETE);
    p.disc(cu, cv, r * 0.9, 0.1, css([80, 86, 94]), { stroke: css(WARN), width: 1.8 });
    p.disc(cu, cv, r * 0.55, 0.1, 'none', { stroke: css(WARN, 1, 0.7), width: 1.1 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.glow(cu + Math.cos(a) * r * 0.92, cv + Math.sin(a) * r * 0.92, 0.11, 0.035, ACCENT);
    }
    if (i === 1) shuttle(p, cu, cv, 0.1);
    else {
      p.poly([[cu - 0.06, cv - 0.18, 0.102], [cu + 0.06, cv - 0.18, 0.102], [cu + 0.06, cv + 0.18, 0.102], [cu - 0.06, cv + 0.18, 0.102]], css(WARN, 0.9));
      p.poly([[cu - 0.18, cv - 0.04, 0.103], [cu + 0.18, cv - 0.04, 0.103], [cu + 0.18, cv + 0.04, 0.103], [cu - 0.18, cv + 0.04, 0.103]], css([80, 86, 94]));
    }
  });
}

/* Delta-wing shuttle, nose toward -u, sitting on landing struts. */
function shuttle(p, cu, cv, h) {
  const L = 0.4;
  const hull = [218, 224, 232];
  const b = h + 0.06;
  p.poly([[cu - L * 0.05, cv - 0.3, b + 0.02], [cu + L * 0.6, cv - 0.12, b + 0.03], [cu + L * 0.6, cv + 0.12, b + 0.03], [cu - L * 0.05, cv + 0.3, b + 0.02]], css(hull, 0.72), { stroke: css(ACCENT, 1, 0.6), width: 0.8 });
  // Fuselage: tapered body with a cockpit.
  const top = b + 0.13;
  p.poly([[cu - L, cv, b + 0.04], [cu + L * 0.6, cv + 0.09, b], [cu + L * 0.6, cv + 0.09, top], [cu - L, cv, b + 0.07]], css(hull, LIGHT.left));
  p.poly([[cu + L * 0.6, cv - 0.09, b], [cu + L * 0.6, cv + 0.09, b], [cu + L * 0.6, cv + 0.09, top], [cu + L * 0.6, cv - 0.09, top]], css(hull, LIGHT.right));
  p.poly([[cu - L, cv, b + 0.07], [cu + L * 0.6, cv - 0.09, top], [cu + L * 0.6, cv + 0.09, top]], css(hull, LIGHT.top));
  p.poly([[cu - L * 0.8, cv - 0.01, b + 0.08], [cu - L * 0.35, cv - 0.04, b + 0.11], [cu - L * 0.35, cv + 0.04, b + 0.11]], css(GLASS, 1.25));
  p.box(cu + L * 0.15, cv - 0.02, 0.12, 0.04, top, top + 0.08, hull, hull, { edges: false });
  p.glow(cu + L * 0.62, cv - 0.04, b + 0.06, 0.04, ACCENT);
  p.glow(cu + L * 0.62, cv + 0.04, b + 0.06, 0.04, ACCENT);
}

export const BUILDINGS = {
  laser_turret: laserTurret,
  missile_turret: missileTurret,
  planetary_shield: planetaryShield,
  small_residential: smallResidential,
  medium_residential: mediumResidential,
  large_residential: largeResidential,
  park,
  hospital,
  school,
  entertainment_center: entertainmentCenter,
  fusion_plant: fusionPlant,
  solar_array: solarArray,
  spaceship_factory: spaceshipFactory,
  spaceport,
  mining_complex: miningComplex,
  small_research_lab: smallResearchLab,
  research_lab: researchLab,
};

export function renderBuilding(id, size, inset) {
  const f = size - inset * 2;
  const painter = BUILDINGS[id];
  if (!painter) throw new Error(`No sprite design for building "${id}"`);
  const p = new IsoSvg(f);
  painter(p, f);
  return p.toString();
}

export { RISE };

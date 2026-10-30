import { IsoSvg, LIGHT, RISE, css, rng } from './iso-svg.mjs';

/*
 * Building designs for the planet view, one function per building id in
 * planet-data.json. Each receives a painter whose footprint spans
 * u, v ∈ [0, f] and draws back to front (smaller u + v first).
 *
 * Style: Imperium Galactica-like sci-fi colony architecture — round towers
 * with domed caps, glowing ribbon windows instead of office-style grids,
 * floating halo rings, arches, tube bridges and spires with glowing tips,
 * on bevelled base slabs with luminous edges. Cyan is the colony's light,
 * red marks beacons and medical, hazard yellow industry.
 */

const WALL = [204, 200, 190];
const WALL_DARK = [150, 148, 142];
const WHITE = [224, 228, 234];
const METAL = [122, 130, 142];
const METAL_DARK = [70, 76, 88];
const CONCRETE = [108, 114, 122];
const GLASS = [92, 180, 232];
const ACCENT = [70, 200, 255];
const TEAL = [80, 255, 210];
const VIOLET = [170, 120, 255];
const WARN = [234, 188, 62];
const RED = [255, 72, 60];
const GRASS = [80, 130, 64];

/* Base slab with a bevelled rim and luminous front edges. */
function plate(p, f, color = CONCRETE, light = ACCENT) {
  p.box(0, 0, f, f, 0, 0.05, METAL_DARK, color);
  p.poly(
    [[0.05, 0.05, 0.05], [f - 0.05, 0.05, 0.05], [f - 0.05, f - 0.05, 0.05], [0.05, f - 0.05, 0.05]],
    css(color, 1.04),
    { stroke: 'rgba(255,255,255,0.12)', width: 0.8 },
  );
  p.line([0.02, f, 0.03], [f, f, 0.03], css(light, 1, 0.75), 1.2, { filter: 'glow' });
  p.line([f, 0.02, 0.03], [f, f, 0.03], css(light, 0.8, 0.6), 1.2, { filter: 'glow' });
  p.glow(f, f, 0.04, 0.05, light);
}

function beacon(p, u, v, h, height = 0.3) {
  p.line([u, v, h], [u, v, h + height], css(METAL, 1.25), 1.4);
  p.glow(u, v, h + height, 0.05, RED);
}

/*
 * Sci-fi block: box volume with glowing ribbon windows, an overhanging deck
 * at the top and a crown (small dome, spire or both).
 */
function block(p, u, v, du, dv, h0, h1, o = {}) {
  const wall = o.wall ?? WALL;
  const light = o.light ?? ACCENT;
  const b = p.box(u, v, du, dv, h0, h1, wall, o.roof ?? WALL_DARK);
  const n = o.bands ?? Math.max(1, Math.round((h1 - h0) / 0.17));
  p.bands('left', b, h0 + 0.04, h1 - 0.06, n, light);
  p.bands('right', b, h0 + 0.04, h1 - 0.06, n, light);
  p.box(u - 0.03, v - 0.03, du + 0.06, dv + 0.06, h1, h1 + 0.035, METAL, METAL, { edges: true });
  p.stripe({ u: u - 0.03, v: v - 0.03, du: du + 0.06, dv: dv + 0.06 }, h1 + 0.005, light, 0.02);
  const top = h1 + 0.035;
  if (o.dome) p.dome(u + du / 2, v + dv / 2, Math.min(du, dv) * o.dome, top, Math.min(du, dv) * o.dome * 0.8, o.domeTint ?? GLASS, { ribs: 4 });
  if (o.spire) p.spire(u + du * 0.25, v + dv * 0.25, top, o.spire, o.spireLight ?? light);
  return { ...b, top };
}

/* Tube bridge between two points, glowing along its length. */
function tube(p, a, b) {
  p.line(a, b, css(METAL, 1.1), 7);
  p.line(a, b, css(WHITE, 0.9), 3.6);
  p.line(a, b, css(ACCENT, 1.1), 1.4, { filter: 'glow' });
}

/* Hall with an arched roof along u (hangars, factory halls). */
function archHall(p, u, v, du, dv, wall, arch, light, ribs = 6) {
  p.box(u, v, du, dv, 0.05, wall, WALL_DARK);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const h0 = wall + Math.sin(t0 * Math.PI) * arch;
    const h1 = wall + Math.sin(t1 * Math.PI) * arch;
    const k = h1 < h0 ? LIGHT.left * 1.15 : LIGHT.top * 0.92;
    p.poly([[u, v + dv * t0, h0], [u + du, v + dv * t0, h0], [u + du, v + dv * t1, h1], [u, v + dv * t1, h1]], css(METAL, k), { stroke: css(METAL_DARK, 0.8, 0.35), width: 0.5 });
  }
  // Glowing roof ribs.
  for (let k = 1; k < ribs; k++) {
    const ru = u + (du * k) / ribs;
    p.arch([ru, v, wall], [ru, v + dv, wall], arch, css(light, 1, 0.8), 1.3, true);
  }
  const end = [[u + du, v, 0.05], [u + du, v + dv, 0.05]];
  for (let i = steps; i >= 0; i--) end.push([u + du, v + (dv * i) / steps, wall + Math.sin((i / steps) * Math.PI) * arch]);
  p.poly(end, css(WALL_DARK, LIGHT.right));
  p.stripe({ u, v, du, dv }, wall - 0.08, light, 0.03);
}

// ---------------------------------------------------------------- defense

function laserTurret(p, f) {
  plate(p, f, METAL_DARK, RED);
  const c = f / 2;
  p.cylinder(c, c, 0.27, 0.05, 0.2, METAL, METAL_DARK, 0.24);
  p.ring(c, c, 0.255, 0.13, css(RED), 1.8, true);
  p.cylinder(c, c, 0.17, 0.2, 0.3, METAL_DARK, METAL);
  // Domed turret head with twin emitters pointing toward the viewer's left.
  p.dome(c, c, 0.17, 0.3, 0.17, [200, 206, 214]);
  for (const dv of [-0.05, 0.05]) {
    p.line([c - 0.03 + dv, c + 0.08, 0.38], [c - 0.03 + dv, c + 0.4, 0.42], css(METAL_DARK, 1.1), 3.2, { cap: 'butt' });
    p.line([c - 0.03 + dv, c + 0.08, 0.39], [c - 0.03 + dv, c + 0.4, 0.43], css(RED, 1), 1, { filter: 'glow' });
    p.glow(c - 0.03 + dv, c + 0.41, 0.42, 0.06, RED);
  }
  p.glow(c, c, 0.47, 0.04, ACCENT);
}

function missileTurret(p, f) {
  plate(p, f, METAL_DARK, WARN);
  const c = f / 2;
  p.cylinder(c, c, 0.27, 0.05, 0.18, METAL, METAL_DARK, 0.25);
  p.ring(c, c, 0.26, 0.12, css(WARN), 1.6, true);
  // Launcher pod: rounded box with a 3×2 tube array.
  const b = p.box(c - 0.19, c - 0.16, 0.34, 0.3, 0.18, 0.46, WHITE, METAL);
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 3; k++) {
      const u = b.u + 0.09 + k * 0.1;
      p.disc(u, b.v + b.dv, 0.035, 0.27 + r * 0.1, css([30, 32, 36]));
      p.glow(u, b.v + b.dv, 0.27 + r * 0.1, 0.03, WARN);
    }
  }
  p.dome(b.u + 0.09, b.v + 0.08, 0.08, 0.46, 0.08, GLASS);
  p.spire(b.u + b.du - 0.05, b.v + 0.05, 0.46, 0.22, RED);
}

function planetaryShield(p, f) {
  plate(p, f, METAL_DARK);
  const c = f / 2;
  const pylon = (u, v) => {
    p.cylinder(u, v, 0.07, 0.05, 0.45, METAL, METAL_DARK, 0.04);
    p.sphere(u, v, 0.48, 0.045, ACCENT, true);
  };
  pylon(0.22, 0.22);
  pylon(f - 0.22, 0.22);
  pylon(0.22, f - 0.22);
  p.box(c - 0.38, c - 0.38, 0.76, 0.76, 0.05, 0.18, METAL, METAL_DARK);
  p.stripe({ u: c - 0.38, v: c - 0.38, du: 0.76, dv: 0.76 }, 0.12, ACCENT, 0.03);
  p.cylinder(c, c, 0.26, 0.18, 0.32, WHITE, METAL);
  p.halo(c, c, 0.3, 0.7, ACCENT, () => {
    p.cylinder(c, c, 0.12, 0.32, 0.95, METAL, METAL_DARK, 0.08);
    for (const h of [0.45, 0.6, 0.75]) p.ring(c, c, 0.11, h, css(ACCENT), 1.6, true);
  });
  p.sphere(c, c, 1.05, 0.13, ACCENT, true);
  p.glow(c, c, 1.05, 0.32, ACCENT);
  // Energy arcs from the corner pylons to the core.
  p.arch([0.22, f - 0.22, 0.48], [c, c, 1.0], 0.15, css(ACCENT, 1, 0.6), 1.2);
  p.arch([f - 0.22, 0.22, 0.48], [c, c, 1.0], 0.15, css(ACCENT, 1, 0.6), 1.2);
  pylon(f - 0.22, f - 0.22);
  p.arch([f - 0.22, f - 0.22, 0.48], [c, c, 1.0], 0.15, css(ACCENT, 1, 0.6), 1.2);
  p.dome(c, c, f * 0.5, 0.05, f * 0.62, [110, 200, 255], { alpha: 0.18 });
}

// ---------------------------------------------------------------- housing

function smallResidential(p, f) {
  plate(p, f);
  const c = 0.3;
  p.halo(c, c, 0.27, 0.72, ACCENT, () => {
    p.roundTower(c, c, 0.2, 0.05, 0.9, WALL, ACCENT, { domeTint: GLASS, spire: 0.22 });
  });
  // Living pod and entrance canopy in front.
  p.cylinder(0.55, 0.52, 0.13, 0.05, 0.2, WALL_DARK, METAL);
  p.ring(0.55, 0.52, 0.13, 0.13, css(ACCENT), 1.6, true);
  p.dome(0.55, 0.52, 0.12, 0.2, 0.11, GLASS, { ribs: 3 });
  p.arch([0.38, 0.6, 0.05], [0.6, 0.65, 0.05], 0.14, css(ACCENT, 1, 0.85), 1.6);
}

function mediumResidential(p, f) {
  const random = rng(23);
  plate(p, f);
  // Tall round tower at the back.
  p.halo(0.45, 0.45, 0.4, 1.0, ACCENT, () => {
    p.roundTower(0.45, 0.45, 0.3, 0.05, 1.3, WALL, ACCENT, { spire: 0.3 });
  });
  tube(p, [0.7, 0.55, 0.78], [1.1, 0.5, 0.78]);
  // Stepped block on the right with a dome crown.
  block(p, 0.98, 0.15, 0.58, 0.62, 0.05, 0.9, { dome: 0.32 });
  // Smaller round tower on the left.
  tube(p, [0.5, 0.75, 0.5], [0.45, 1.1, 0.5]);
  p.roundTower(0.42, 1.25, 0.21, 0.05, 0.7, WHITE, TEAL, { domeTint: [120, 230, 210] });
  // Garden under a glass dome in the front courtyard.
  p.disc(1.22, 1.25, 0.32, 0.055, css(GRASS, 1.05));
  p.tree(1.12, 1.2, 0.055, 0.28, random);
  p.tree(1.3, 1.32, 0.055, 0.3, random);
  p.dome(1.22, 1.25, 0.32, 0.055, 0.32, [150, 220, 255], { alpha: 0.35, ribs: 5 });
  p.ring(1.22, 1.25, 0.32, 0.06, css(ACCENT), 1.8, true);
}

function largeResidential(p, f) {
  const random = rng(37);
  plate(p, f);
  // Arcology spire at the back.
  p.halo(0.62, 0.62, 0.55, 1.35, ACCENT, () => {
    p.roundTower(0.62, 0.62, 0.44, 0.05, 1.75, WALL, ACCENT, { taper: 0.32, spire: 0.45, rings: 9 });
  });
  p.halo(0.62, 0.62, 0.62, 0.65, VIOLET, () => {}, 1.6);
  // Side towers.
  p.roundTower(0.55, 2.05, 0.32, 0.05, 1.1, WHITE, TEAL, { domeTint: [120, 230, 210] });
  tube(p, [0.6, 1.0, 0.9], [0.58, 1.75, 0.9]);
  const b = block(p, 1.75, 0.15, 0.78, 0.72, 0.05, 1.25, { dome: 0.3, spire: 0.25 });
  tube(p, [1.0, 0.62, 1.05], [1.75, 0.52, 1.05]);
  // Plaza: arch gateway and a domed garden.
  p.poly([[1.1, 1.1, 0.052], [2.55, 1.1, 0.052], [2.55, 2.55, 0.052], [1.1, 2.55, 0.052]], css([92, 100, 108]));
  // Gateway: an arch between two glowing pylons.
  p.cylinder(1.15, 1.45, 0.05, 0.05, 0.22, METAL, METAL_DARK);
  p.sphere(1.15, 1.45, 0.24, 0.035, ACCENT, true);
  p.arch([1.15, 1.45, 0.2], [1.15, 2.4, 0.2], 0.4, css(METAL, 1.2), 5, false);
  p.arch([1.15, 1.45, 0.2], [1.15, 2.4, 0.2], 0.4, css(ACCENT, 1.05), 1.8);
  p.cylinder(1.15, 2.4, 0.05, 0.05, 0.22, METAL, METAL_DARK);
  p.sphere(1.15, 2.4, 0.24, 0.035, ACCENT, true);
  p.disc(1.85, 1.85, 0.58, 0.055, css(GRASS, 1.05));
  for (const [u, v] of [[1.6, 1.7], [1.95, 1.6], [1.75, 2.05], [2.1, 1.95], [1.85, 1.85]]) p.tree(u, v, 0.055, 0.34, random);
  p.disc(2.0, 1.75, 0.1, 0.06, css([90, 170, 220]));
  p.dome(1.85, 1.85, 0.58, 0.055, 0.5, [150, 220, 255], { alpha: 0.32, ribs: 7 });
  p.ring(1.85, 1.85, 0.58, 0.06, css(ACCENT), 2, true);
  void b;
}

// ---------------------------------------------------------------- social

function park(p, f) {
  const random = rng(41);
  plate(p, f, [96, 104, 92], TEAL);
  p.poly([[0.08, 0.08, 0.052], [f - 0.08, 0.08, 0.052], [f - 0.08, f - 0.08, 0.052], [0.08, f - 0.08, 0.052]], css(GRASS, 1.1));
  const c = f / 2;
  // Glowing paths.
  p.poly([[c - 0.06, 0.08, 0.054], [c + 0.06, 0.08, 0.054], [c + 0.06, f - 0.08, 0.054], [c - 0.06, f - 0.08, 0.054]], css([170, 200, 210]));
  p.poly([[0.08, c - 0.06, 0.054], [f - 0.08, c - 0.06, 0.054], [f - 0.08, c + 0.06, 0.054], [0.08, c + 0.06, 0.054]], css([170, 200, 210]));
  p.line([c, 0.1, 0.056], [c, f - 0.1, 0.056], css(TEAL, 1, 0.7), 0.8, { filter: 'glow' });
  p.line([0.1, c, 0.056], [f - 0.1, c, 0.056], css(TEAL, 1, 0.7), 0.8, { filter: 'glow' });
  // Pond.
  p.disc(1.25, 0.45, 0.25, 0.055, p.linear(0, 0, 0, 1, [[0, css([70, 150, 200])], [1, css([40, 110, 170])]]), { stroke: css(TEAL, 1, 0.8), width: 1.4 });
  const spots = [];
  for (let k = 0; k < 16; k++) {
    const u = 0.18 + random() * (f - 0.36);
    const v = 0.18 + random() * (f - 0.36);
    if (Math.abs(u - c) < 0.18 || Math.abs(v - c) < 0.18) continue;
    if (Math.hypot(u - 1.25, v - 0.45) < 0.32) continue;
    spots.push([u, v]);
  }
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const back = spots.filter(([u, v]) => u + v < f);
  const front = spots.filter(([u, v]) => u + v >= f);
  for (const [u, v] of back) p.tree(u, v, 0.055, 0.32 + random() * 0.14, random, random() < 0.3 ? [96, 132, 52] : [62, 118, 58]);
  // Holographic fountain under a ring of arches.
  p.cylinder(c, c, 0.22, 0.054, 0.09, WHITE, [96, 170, 220]);
  p.glow(c, c, 0.3, 0.16, TEAL);
  p.arch([c - 0.2, c, 0.09], [c + 0.2, c, 0.09], 0.42, css(TEAL, 1.05), 2.4);
  p.arch([c, c - 0.2, 0.09], [c, c + 0.2, 0.09], 0.42, css(ACCENT, 1.05), 2.4);
  p.sphere(c, c, 0.5, 0.05, TEAL, true);
  for (const [u, v] of front) p.tree(u, v, 0.055, 0.32 + random() * 0.14, random, random() < 0.3 ? [96, 132, 52] : [62, 118, 58]);
  for (const [u, v] of [[c + 0.1, 0.15], [0.15, c + 0.1], [c + 0.1, f - 0.15], [f - 0.15, c + 0.1]]) {
    p.line([u, v, 0.05], [u, v, 0.26], css(METAL_DARK), 1);
    p.sphere(u, v, 0.27, 0.025, TEAL, true);
  }
}

function hospital(p, f) {
  plate(p, f, CONCRETE, RED);
  // Main wing with a domed medical center on its roof.
  const main = block(p, 0.12, 0.12, 1.42, 0.62, 0.05, 0.68, { wall: WHITE, roof: [196, 200, 206] });
  p.cylinder(0.7, 0.43, 0.3, main.top, main.top + 0.08, WHITE, WHITE);
  p.dome(0.7, 0.43, 0.29, main.top + 0.08, 0.3, [230, 240, 248], { ribs: 6 });
  // Floating red cross hologram above the dome.
  const h = main.top + 0.55;
  p.poly([[0.66, 0.28, h], [0.74, 0.28, h], [0.74, 0.58, h], [0.66, 0.58, h]], css(RED, 1, 0.9), { filter: 'glow' });
  p.poly([[0.55, 0.39, h], [0.85, 0.39, h], [0.85, 0.47, h], [0.55, 0.47, h]], css(RED, 1, 0.9), { filter: 'glow' });
  p.spire(1.4, 0.2, main.top, 0.25, RED);
  // Round ward drum in front-left.
  p.roundTower(0.48, 1.2, 0.32, 0.05, 0.5, WHITE, ACCENT, { dome: true, domeTint: [210, 230, 245], rings: 2 });
  tube(p, [0.48, 0.85, 0.35], [0.48, 0.74, 0.35]);
  // Medevac pad.
  p.cylinder(1.25, 1.25, 0.3, 0.05, 0.1, METAL_DARK, METAL);
  p.disc(1.25, 1.25, 0.26, 0.1, css([82, 88, 96]), { stroke: css(RED), width: 1.4 });
  p.poly([[1.21, 1.13, 0.102], [1.29, 1.13, 0.102], [1.29, 1.37, 0.102], [1.21, 1.37, 0.102]], css(RED, 0.95));
  p.poly([[1.13, 1.21, 0.103], [1.37, 1.21, 0.103], [1.37, 1.29, 0.103], [1.13, 1.29, 0.103]], css(RED, 0.95));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    p.glow(1.25 + Math.cos(a) * 0.27, 1.25 + Math.sin(a) * 0.27, 0.11, 0.03, RED);
  }
}

function school(p, f) {
  const random = rng(61);
  plate(p, f);
  // Academy: drum hall under a large glass dome.
  p.halo(0.58, 0.58, 0.58, 0.62, VIOLET, () => {
    p.cylinder(0.58, 0.58, 0.48, 0.05, 0.32, WALL, METAL);
    p.ring(0.58, 0.58, 0.48, 0.14, css(ACCENT), 2, true);
    p.ring(0.58, 0.58, 0.48, 0.24, css(ACCENT), 2, true);
    p.dome(0.58, 0.58, 0.46, 0.32, 0.42, [140, 200, 255], { ribs: 8 });
  }, 1.8);
  // Classroom wing.
  block(p, 1.12, 0.12, 0.46, 0.68, 0.05, 0.5, { wall: WHITE, spire: 0.22, light: TEAL });
  // Holo-lined sports field with an arch gate.
  p.poly([[0.85, 0.9, 0.052], [1.6, 0.9, 0.052], [1.6, 1.6, 0.052], [0.85, 1.6, 0.052]], css([60, 120, 90]));
  p.poly([[0.9, 0.95, 0.054], [1.55, 0.95, 0.054], [1.55, 1.55, 0.054], [0.9, 1.55, 0.054]], 'none', { stroke: css(TEAL, 1, 0.9), width: 1, filter: 'glow' });
  p.line([0.9, 1.25, 0.054], [1.55, 1.25, 0.054], css(TEAL, 1, 0.9), 1, { filter: 'glow' });
  p.disc(1.225, 1.25, 0.12, 0.054, 'none', { stroke: css(TEAL, 1, 0.9), width: 1, filter: 'glow' });
  p.tree(0.3, 1.45, 0.05, 0.3, random);
  p.tree(0.55, 1.5, 0.05, 0.28, random);
  p.arch([0.88, 1.6, 0.05], [1.55, 1.6, 0.05], 0.32, css(ACCENT, 1.05), 3);
}

function entertainmentCenter(p, f) {
  const random = rng(71);
  plate(p, f, CONCRETE, [255, 80, 220]);
  const c = f / 2;
  const NEON = [255, 80, 220];
  p.halo(c, c, 1.25, 0.95, NEON, () => {
    p.cylinder(c, c, 1.15, 0.05, 0.42, WALL_DARK, [120, 110, 130]);
    for (let k = 0; k < 3; k++) p.ring(c, c, 1.15, 0.12 + k * 0.1, css(k % 2 ? NEON : ACCENT), 1.6, true);
    p.dome(c, c, 0.95, 0.42, 0.75, [150, 120, 210], { ribs: 8 });
    p.ring(c, c, 0.95, 0.43, css(NEON), 2.2, true);
  }, 2);
  p.spire(c, c, 1.0, 0.35, NEON, [200, 190, 220], 0.03);
  p.glow(c, c, 1.05, 0.22, NEON);
  for (const [u, v] of [[0.3, f - 0.35], [f - 0.35, 0.3], [f - 0.4, f - 0.4]]) {
    p.box(u, v, 0.12, 0.12, 0.05, 0.75, METAL_DARK);
    const sign = p.box(u - 0.05, v - 0.05, 0.22, 0.22, 0.55, 0.78, METAL);
    p.poly(p.facePoly('left', sign, 0.02, 0.2, 0.58, 0.75), css(random() < 0.5 ? NEON : ACCENT, 1), { filter: 'glow' });
    p.poly(p.facePoly('right', sign, 0.02, 0.2, 0.58, 0.75), css(random() < 0.5 ? NEON : WARN, 0.9), { filter: 'glow' });
  }
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
    p.poly([[u, v, hi], [u + size, v, hi], [u + size, v + size, lo], [u, v + size, lo]], sheen, { stroke: css(ACCENT, 1, 0.8), width: 1.1 });
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      p.line([u + size * t, v, hi], [u + size * t, v + size, lo], 'rgba(170,205,255,0.35)', 0.6);
      p.line([u, v + size * t, hi - (hi - lo) * t], [u + size, v + size * t, hi - (hi - lo) * t], 'rgba(170,205,255,0.35)', 0.6);
    }
  }
  const c = f / 2;
  p.cylinder(c, c, 0.14, 0.05, 0.28, METAL, METAL_DARK);
  p.ring(c, c, 0.14, 0.2, css(ACCENT), 1.8, true);
  p.sphere(c, c, 0.34, 0.07, ACCENT, true);
  p.glow(c, c, 0.34, 0.14, ACCENT);
}

function fusionPlant(p, f) {
  const random = rng(83);
  plate(p, f, METAL_DARK);
  for (const [u, v] of [[0.55, 0.5], [1.35, 0.4]]) {
    p.cylinder(u, v, 0.34, 0.05, 1.05, WALL, [60, 60, 64], 0.24, { waist: 0.2, open: true });
    p.ring(u, v, 0.27, 0.45, css(ACCENT), 1.8, true);
    p.ring(u, v, 0.25, 0.75, css(ACCENT), 1.8, true);
  }
  for (const [u, v] of [[0.55, 0.5], [1.35, 0.4]]) {
    const [x, y] = p.p(u, v, 1.15);
    p.track(y - 30);
    p.body.push(`<ellipse cx="${x}" cy="${y - 10}" rx="22" ry="14" fill="rgba(200,235,255,0.45)" filter="url(#soft)"/>`);
  }
  block(p, 1.9, 0.15, 0.65, 0.75, 0.05, 0.62, { dome: 0.3, spire: 0.28 });
  // Plasma conduits from the reactor to the towers.
  p.arch([0.75, 0.75, 0.6], [1.15, 1.15, 0.75], 0.3, css(ACCENT, 1.1), 3);
  p.arch([1.45, 0.7, 0.6], [1.4, 1.05, 0.75], 0.25, css(ACCENT, 1.1), 3);
  const c = 1.4;
  p.halo(c, c, 0.82, 0.9, ACCENT, () => {
    p.cylinder(c, c, 0.72, 0.05, 0.28, METAL, METAL_DARK);
    p.cylinder(c, c, 0.55, 0.28, 0.72, WHITE, METAL);
    for (const h of [0.38, 0.5, 0.62]) p.ring(c, c, 0.55, h, css(ACCENT), 2.2, true);
    p.dome(c, c, 0.48, 0.72, 0.38, [120, 210, 255]);
  });
  p.sphere(c, c, 0.92, 0.12, ACCENT, true);
  p.glow(c, c, 0.95, 0.38, ACCENT);
  for (let k = 0; k < 3; k++) {
    const b = p.box(0.25 + k * 0.32, 2.05, 0.2, 0.3, 0.05, 0.3, METAL, METAL_DARK);
    p.sphere(b.u + 0.1, b.v + 0.15, 0.35, 0.05, ACCENT, true);
  }
  p.box(2.1, 2.0, 0.45, 0.45, 0.05, 0.22, CONCRETE);
  p.stripe({ u: 2.1, v: 2.0, du: 0.45, dv: 0.45 }, 0.16, WARN, 0.03);
  void random;
}

// ---------------------------------------------------------------- industry

function spaceshipFactory(p, f) {
  plate(p, f, METAL_DARK, WARN);
  // Exhaust stacks with glowing vents behind the hall.
  for (const u of [0.35, 0.6]) {
    p.cylinder(u, 0.25, 0.08, 0.05, 1.4, WALL_DARK, [40, 40, 44], 0.06, { open: true });
    p.ring(u, 0.25, 0.075, 1.1, css(WARN), 1.6, true);
    p.glow(u, 0.25, 1.42, 0.08, [255, 150, 60]);
  }
  // Assembly hall with an arched, rib-lit roof and an open bay.
  archHall(p, 0.12, 0.12, 1.55, 1.3, 0.55, 0.4, WARN, 7);
  p.poly([[1.67, 0.4, 0.05], [1.67, 1.15, 0.05], [1.67, 1.15, 0.48], [1.67, 0.4, 0.48]], css([24, 30, 40]));
  p.poly([[1.67, 0.45, 0.05], [1.67, 1.1, 0.05], [1.67, 1.1, 0.12], [1.67, 0.45, 0.12]], css(WARN, 1, 0.6));
  p.dome(0.55, 0.8, 0.22, 0.95, 0.18, GLASS, { ribs: 4 });
  // Slipway with an arched gantry over the hull.
  const sx = 1.85;
  p.box(sx + 0.12, 0.45, 0.42, 1.8, 0.05, 0.12, CONCRETE);
  const hu = sx + 0.18;
  p.poly([[hu, 0.6, 0.15], [hu + 0.3, 0.6, 0.15], [hu + 0.3, 2.05, 0.15], [hu + 0.15, 2.3, 0.2], [hu, 2.05, 0.15]], css(WHITE, 0.8));
  p.poly([[hu, 0.6, 0.15], [hu + 0.3, 0.6, 0.15], [hu + 0.3, 0.6, 0.45], [hu, 0.6, 0.45]], css(WHITE, LIGHT.left));
  p.poly([[hu + 0.3, 0.6, 0.15], [hu + 0.3, 2.05, 0.15], [hu + 0.3, 2.05, 0.4], [hu + 0.3, 0.6, 0.45]], css(METAL, LIGHT.right * 1.2));
  p.poly([[hu, 0.6, 0.45], [hu + 0.3, 0.6, 0.45], [hu + 0.3, 2.05, 0.4], [hu + 0.15, 2.3, 0.2], [hu, 2.05, 0.4]], css(WHITE, LIGHT.top));
  for (let k = 0; k < 6; k++) p.line([hu, 0.8 + k * 0.22, 0.44], [hu + 0.3, 0.8 + k * 0.22, 0.44], 'rgba(0,0,0,0.25)', 0.7);
  p.line([hu + 0.15, 0.7, 0.46], [hu + 0.15, 2.1, 0.42], css(ACCENT), 1.2, { filter: 'glow' });
  for (const v of [0.5, 1.15, 1.8]) {
    p.arch([sx, v, 0.05], [sx + 0.69, v, 0.05], 0.62, css(WARN, 1), 3.4, false);
    p.arch([sx, v, 0.05], [sx + 0.69, v, 0.05], 0.62, css(WARN, 1.2, 0.6), 1, true);
  }
  p.glow(hu + 0.15, 1.15, 0.66, 0.07, ACCENT);
  for (let k = 0; k < 4; k++) {
    const b = p.box(0.25 + k * 0.33, 1.65, 0.24, 0.24, 0.05, 0.16 + (k % 2) * 0.08, k % 2 ? [150, 90, 60] : [80, 110, 140]);
    if (k === 3) p.glow(b.u + 0.12, b.v + 0.12, 0.3, 0.04, RED);
  }
}

function miningComplex(p, f) {
  const random = rng(109);
  plate(p, f, [96, 88, 80], WARN);
  for (const [u, v] of [[0.35, 0.35], [0.85, 0.3], [0.38, 0.85]]) {
    p.cylinder(u, v, 0.2, 0.05, 0.85, [170, 160, 146], METAL);
    p.ring(u, v, 0.2, 0.3, css(WARN), 1.6, true);
    p.ring(u, v, 0.2, 0.6, css(WARN), 1.6, true);
    p.dome(u, v, 0.2, 0.85, 0.14, METAL);
    p.glow(u, v, 1.0, 0.04, WARN);
  }
  // Drill tower: tapered mast inside glowing rings.
  const hx = 1.75;
  const hv = 0.55;
  p.box(hx - 0.3, hv - 0.25, 0.6, 0.5, 0.05, 0.3, WALL_DARK, METAL_DARK);
  p.halo(hx, hv, 0.25, 0.9, WARN, () => {
    p.cylinder(hx, hv, 0.12, 0.3, 1.45, METAL, METAL_DARK, 0.05);
  });
  p.ring(hx, hv, 0.2, 0.6, css(WARN), 1.6, true);
  p.ring(hx, hv, 0.15, 1.2, css(WARN), 1.6, true);
  beacon(p, hx, hv, 1.45, 0.15);
  // Processing plant with a dome.
  block(p, 1.55, 1.15, 0.95, 0.75, 0.05, 0.6, { wall: [176, 166, 150], light: WARN, dome: 0.35 });
  // Glowing conveyors.
  for (const [a, b] of [[[hx, hv + 0.3, 0.35], [hx - 0.1, 1.15, 0.45]], [[1.55, 1.6, 0.4], [0.9, 1.6, 0.25]]]) {
    p.line(a, b, css(METAL_DARK), 3.4);
    p.line(a, b, css(WARN, 1.1), 1.2, { filter: 'glow' });
  }
  for (const [u, v, r] of [[0.65, 1.65, 0.34], [0.5, 2.2, 0.28], [1.1, 2.2, 0.3]]) {
    p.dome(u, v, r, 0.05, r * 0.7, [176, 112, 60]);
    for (let k = 0; k < 4; k++) p.glow(u + (random() - 0.5) * r, v + (random() - 0.5) * r * 0.6, 0.12 + random() * 0.1, 0.035, [255, 200, 110]);
  }
  // Hover hauler.
  const t = p.box(1.75, 2.15, 0.36, 0.2, 0.12, 0.26, WARN, WARN);
  p.glow(t.u + 0.18, t.v + 0.1, 0.07, 0.12, [255, 170, 60]);
  p.dome(t.u + 0.3, t.v + 0.1, 0.07, 0.26, 0.06, GLASS);
}

// ---------------------------------------------------------------- research

function smallResearchLab(p, f) {
  plate(p, f, CONCRETE, TEAL);
  const c = f / 2;
  p.halo(c, c, 0.3, 0.42, TEAL, () => {
    p.cylinder(c, c, 0.25, 0.05, 0.3, WHITE, METAL);
    p.ring(c, c, 0.25, 0.14, css(TEAL), 2, true);
    p.ring(c, c, 0.25, 0.22, css(TEAL), 2, true);
    p.dome(c, c, 0.23, 0.3, 0.22, GLASS, { ribs: 4 });
  });
  p.spire(c + 0.18, c - 0.18, 0.05, 0.62, TEAL);
}

function researchLab(p, f) {
  const random = rng(131);
  plate(p, f, CONCRETE, TEAL);
  const main = block(p, 0.12, 0.12, 1.0, 0.75, 0.05, 0.6, { wall: WHITE, light: TEAL });
  // Observatory dome with a floating ring.
  p.halo(0.55, 0.45, 0.42, 1.05, VIOLET, () => {
    p.cylinder(0.55, 0.45, 0.32, main.top, main.top + 0.08, METAL, METAL);
    p.dome(0.55, 0.45, 0.3, main.top + 0.08, 0.32, GLASS, { ribs: 6 });
  }, 1.8);
  // Antenna mast with stacked rings.
  p.box(1.25, 0.2, 0.3, 0.3, 0.05, 0.25, METAL, METAL_DARK);
  p.halo(1.4, 0.35, 0.12, 0.75, TEAL, () => p.spire(1.4, 0.35, 0.25, 1.0, TEAL, [140, 148, 160], 0.03), 1.4);
  p.ring(1.4, 0.35, 0.09, 0.95, css(TEAL), 1.4, true);
  // Dish facing the sky.
  p.line([1.35, 1.25, 0.05], [1.35, 1.25, 0.3], css(METAL_DARK), 2.4);
  const [dx, dy] = p.p(1.35, 1.25, 0.42);
  p.track(dy - 20);
  p.body.push(`<ellipse cx="${dx}" cy="${dy}" rx="22" ry="15" transform="rotate(-25 ${dx} ${dy})" fill="${css(WHITE, 1.05)}" stroke="${css(METAL_DARK)}" stroke-width="1"/>`);
  p.body.push(`<ellipse cx="${dx + 2}" cy="${dy + 1}" rx="15" ry="10" transform="rotate(-25 ${dx} ${dy})" fill="${css(WHITE, 0.85)}"/>`);
  p.glow(1.35, 1.25, 0.5, 0.06, TEAL);
  // Bio-dome in front.
  p.disc(0.55, 1.25, 0.34, 0.055, css(GRASS, 1.05));
  for (let k = 0; k < 3; k++) p.tree(0.42 + k * 0.13, 1.2 + (k % 2) * 0.1, 0.055, 0.22, random);
  p.dome(0.55, 1.25, 0.34, 0.055, 0.32, [150, 240, 220], { alpha: 0.35, ribs: 5 });
  p.ring(0.55, 1.25, 0.34, 0.06, css(TEAL), 1.8, true);
}

// ---------------------------------------------------------------- military

function spaceport(p, f) {
  const random = rng(29);
  plate(p, f);
  for (let k = 0; k < 10; k++) {
    const t = 0.2 + (k / 9) * (f - 0.5);
    p.poly([[t, f * 0.52, 0.052], [t + 0.12, f * 0.52, 0.052], [t + 0.12, f * 0.54, 0.052], [t, f * 0.54, 0.052]], css(WARN, 0.9));
  }
  const hu = 0.2;
  const hv = 0.2;
  const hdu = f * 0.5;
  const hdv = f * 0.32;
  archHall(p, hu, hv, hdu, hdv, 0.38, 0.34, ACCENT, 6);
  p.poly([[hu + hdu, hv + hdv * 0.15, 0.05], [hu + hdu, hv + hdv * 0.85, 0.05], [hu + hdu, hv + hdv * 0.85, 0.5], [hu + hdu, hv + hdv * 0.15, 0.5]], css([30, 36, 46]));
  p.poly([[hu + hdu, hv + hdv * 0.2, 0.05], [hu + hdu, hv + hdv * 0.8, 0.05], [hu + hdu, hv + hdv * 0.8, 0.1], [hu + hdu, hv + hdv * 0.2, 0.1]], css(ACCENT, 1, 0.5));

  // Operations block and control tower (back right).
  const ops = block(p, f * 0.62, 0.2, f * 0.3, f * 0.3, 0.05, 0.55, {});
  p.line([ops.u + 0.12, ops.v + 0.12, ops.top], [ops.u + 0.12, ops.v + 0.12, ops.top + 0.15], css(METAL), 1.2);
  p.disc(ops.u + 0.12, ops.v + 0.12, 0.12, ops.top + 0.17, css(WHITE, 1.1), { stroke: css(METAL_DARK), width: 0.8 });
  const tu = ops.u + ops.du * 0.55;
  const tv = ops.v + ops.dv * 0.55;
  p.halo(tu, tv, 0.42, 1.2, ACCENT, () => {
    p.cylinder(tu, tv, 0.15, ops.top, 1.4, WALL, WALL_DARK, 0.12);
    p.ring(tu, tv, 0.13, 1.0, css(ACCENT), 1.6, true);
  });
  p.cylinder(tu, tv, 0.2, 1.4, 1.46, METAL_DARK, METAL);
  p.cylinder(tu, tv, 0.27, 1.46, 1.62, GLASS, METAL, 0.29);
  p.ring(tu, tv, 0.28, 1.54, 'rgba(255,255,255,0.5)', 0.8);
  p.cylinder(tu, tv, 0.3, 1.62, 1.68, METAL, METAL, 0.24);
  p.dome(tu, tv, 0.2, 1.68, 0.12, GLASS);
  p.spire(tu, tv, 1.78, 0.3, RED);

  const pads = [
    [f * 0.27, f * 0.77],
    [f * 0.73, f * 0.77],
  ];
  pads.forEach(([cu, cv], i) => {
    const r = f * 0.2;
    p.cylinder(cu, cv, r, 0.05, 0.1, METAL_DARK, CONCRETE);
    p.disc(cu, cv, r * 0.9, 0.1, css([80, 86, 94]), { stroke: css(ACCENT), width: 1.8, filter: 'glow' });
    p.disc(cu, cv, r * 0.55, 0.1, 'none', { stroke: css(WARN, 1, 0.7), width: 1.1 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.glow(cu + Math.cos(a) * r * 0.92, cv + Math.sin(a) * r * 0.92, 0.11, 0.035, ACCENT);
    }
    if (i === 1) shuttle(p, cu, cv, 0.1);
    else {
      // Guidance arches over the empty pad.
      p.arch([cu - r * 0.8, cv, 0.1], [cu + r * 0.8, cv, 0.1], 0.45, css(ACCENT, 1, 0.7), 1.6);
      p.arch([cu, cv - r * 0.8, 0.1], [cu, cv + r * 0.8, 0.1], 0.45, css(ACCENT, 1, 0.7), 1.6);
    }
  });
  void random;
}

function shuttle(p, cu, cv, h) {
  const L = 0.4;
  const hull = [218, 224, 232];
  const b = h + 0.06;
  p.poly([[cu - L * 0.05, cv - 0.3, b + 0.02], [cu + L * 0.6, cv - 0.12, b + 0.03], [cu + L * 0.6, cv + 0.12, b + 0.03], [cu - L * 0.05, cv + 0.3, b + 0.02]], css(hull, 0.72), { stroke: css(ACCENT, 1, 0.6), width: 0.8 });
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

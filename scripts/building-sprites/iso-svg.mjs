/*
 * Isometric SVG painter for building sprites (docs/planet-surface.md#building-sprites).
 *
 * The projection is the one the planet view uses everywhere (CSS ground plane
 * `rotateX(60deg) rotateZ(45deg)`, terrain renderer, sprite placement): for a
 * local point (u, v, h) in cells,
 *   x = (u - v) / √2,   y = (u + v) / (2√2) - h · sin 60°
 * scaled by S units per cell. Local u, v span the drawn footprint [0, f]
 * (f = building size - 2 · 0.15 inset). The finished SVG is exactly as wide
 * as the footprint diamond and its bottom edge is the footprint's front
 * corner, which is how StarMapPlanetScreenComponent anchors sprites.
 *
 * Light comes from the screen's upper left, like the terrain: tops are
 * brightest, +v faces (left-front) medium, +u faces (right-front) darkest.
 *
 * Elements are emitted in call order, so callers draw back to front.
 */

export const SQ2 = Math.SQRT2;
export const RISE = Math.sin(Math.PI / 3);
const S = 100;

export const LIGHT = { top: 1.08, left: 0.82, right: 0.58 };

const r1 = (n) => Math.round(n * 10) / 10;

export function css(c, k = 1, a = 1) {
  const ch = (x) => Math.max(0, Math.min(255, Math.round(x * k)));
  return a >= 1 ? `rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})` : `rgba(${ch(c[0])},${ch(c[1])},${ch(c[2])},${a})`;
}

export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class IsoSvg {
  constructor(f) {
    this.f = f;
    this.s = S;
    this.width = f * SQ2 * S;
    this.ox = this.width / 2;
    this.bottom = (f / SQ2) * S;
    this.minY = 0;
    this.defs = [];
    this.body = [];
    this.gid = 0;
    this.defs.push(
      '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
      '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>',
    );
  }

  p(u, v, h) {
    const x = this.ox + ((u - v) / SQ2) * S;
    const y = ((u + v) / (2 * SQ2) - h * RISE) * S;
    if (y < this.minY) this.minY = y;
    return [x, y];
  }

  track(y) {
    if (y < this.minY) this.minY = y;
  }

  pts(list) {
    return list.map(([u, v, h]) => this.p(u, v, h).map(r1).join(',')).join(' ');
  }

  attrs(o = {}) {
    let a = '';
    if (o.stroke) a += ` stroke="${o.stroke}" stroke-width="${r1(o.width ?? 1)}" stroke-linejoin="round"`;
    if (o.opacity !== undefined) a += ` opacity="${o.opacity}"`;
    if (o.filter) a += ` filter="url(#${o.filter})"`;
    return a;
  }

  linear(x1, y1, x2, y2, stops) {
    const id = `g${this.gid++}`;
    this.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}">` +
        stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
        '</linearGradient>',
    );
    return `url(#${id})`;
  }

  radial(cx, cy, r, stops, fx = cx, fy = cy) {
    const id = `g${this.gid++}`;
    this.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fx="${r1(fx)}" fy="${r1(fy)}">` +
        stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
        '</radialGradient>',
    );
    return `url(#${id})`;
  }

  poly(points, fill, o = {}) {
    this.body.push(`<polygon points="${this.pts(points)}" fill="${fill}"${this.attrs(o)}/>`);
  }

  path(d, fill, o = {}) {
    this.body.push(`<path d="${d}" fill="${fill}"${this.attrs(o)}/>`);
  }

  line(a, b, color, width, o = {}) {
    const [x1, y1] = this.p(...a);
    const [x2, y2] = this.p(...b);
    this.body.push(
      `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color}" stroke-width="${r1(width)}" stroke-linecap="${o.cap ?? 'round'}"${o.filter ? ` filter="url(#${o.filter})"` : ''}${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}/>`,
    );
  }

  /* Side-face fill: darker at the foot (ambient occlusion), lit near the top. */
  faceFill(base, k, u, v, h0, h1) {
    const [, yb] = this.p(u, v, h0);
    const [, yt] = this.p(u, v, h1);
    return this.linear(0, yb, 0, yt, [
      [0, css(base, k * 0.7)],
      [0.3, css(base, k * 0.94)],
      [1, css(base, k * 1.05)],
    ]);
  }

  /* Axis-aligned box: the three faces visible from the camera. */
  box(u, v, du, dv, h0, h1, base, top = base, o = {}) {
    const u1 = u + du;
    const v1 = v + dv;
    this.poly([[u, v1, h0], [u1, v1, h0], [u1, v1, h1], [u, v1, h1]], this.faceFill(base, LIGHT.left, u, v1, h0, h1));
    this.poly([[u1, v, h0], [u1, v1, h0], [u1, v1, h1], [u1, v, h1]], this.faceFill(base, LIGHT.right, u1, v, h0, h1));
    this.poly([[u, v, h1], [u1, v, h1], [u1, v1, h1], [u, v1, h1]], o.topFill ?? css(top, LIGHT.top));
    if (o.edges !== false) {
      this.line([u, v1, h1], [u1, v1, h1], 'rgba(255,255,255,0.35)', 1);
      this.line([u1, v, h1], [u1, v1, h1], 'rgba(255,255,255,0.18)', 1);
      this.line([u1, v1, h0], [u1, v1, h1], 'rgba(0,0,0,0.25)', 0.9);
    }
    return { u, v, du, dv, h0, h1 };
  }

  /* Quad on a visible face given face-local coordinates (a along, h up). */
  facePoly(face, b, a0, a1, h0, h1) {
    return face === 'left'
      ? [[b.u + a0, b.v + b.dv, h0], [b.u + a1, b.v + b.dv, h0], [b.u + a1, b.v + b.dv, h1], [b.u + a0, b.v + b.dv, h1]]
      : [[b.u + b.du, b.v + a0, h0], [b.u + b.du, b.v + a1, h0], [b.u + b.du, b.v + a1, h1], [b.u + b.du, b.v + a0, h1]];
  }

  windows(face, b, h0, h1, rows, cols, random, lit = 0.55, o = {}) {
    const along = face === 'left' ? b.du : b.dv;
    const cw = along / cols;
    const ch = (h1 - h0) / rows;
    const litColor = o.litColor ?? (face === 'left' ? [170, 228, 255] : [112, 190, 236]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = random() < lit;
        const fill = on ? css(litColor) : css([36, 50, 64], face === 'left' ? 1 : 0.8);
        const mx = o.wide ? 0.08 : 0.22;
        this.poly(this.facePoly(face, b, c * cw + cw * mx, (c + 1) * cw - cw * mx, h0 + r * ch + ch * 0.28, h0 + (r + 1) * ch - ch * 0.18), fill);
      }
    }
  }

  /* Thin darker floor lines across a face (panel joints). */
  floors(face, b, h0, h1, n) {
    for (let k = 1; k < n; k++) {
      const h = h0 + ((h1 - h0) * k) / n;
      const [a, c] = face === 'left'
        ? [[b.u, b.v + b.dv, h], [b.u + b.du, b.v + b.dv, h]]
        : [[b.u + b.du, b.v, h], [b.u + b.du, b.v + b.dv, h]];
      this.line(a, c, 'rgba(0,0,0,0.22)', 0.8);
    }
  }

  /* Glowing band around the two visible faces of a box. */
  stripe(b, h, color, w = 0.035) {
    this.poly(this.facePoly('left', b, 0, b.du, h, h + w), css(color, 1.1), { filter: 'glow' });
    this.poly(this.facePoly('right', b, 0, b.dv, h, h + w), css(color, 0.85), { filter: 'glow' });
  }

  ell(cu, cv, r, h) {
    const [cx, cy] = this.p(cu, cv, h);
    this.track(cy - (r * S) / 2);
    return { cx, cy, rx: r * S, ry: (r * S) / 2 };
  }

  /* Upright cylinder (optionally tapered: r0 bottom, r1 top). */
  cylinder(cu, cv, r0, h0, h1, base, top = base, r1top = r0, o = {}) {
    const b = this.ell(cu, cv, r0, h0);
    const t = this.ell(cu, cv, r1top, h1);
    const fill = this.linear(b.cx - Math.max(b.rx, t.rx), 0, b.cx + Math.max(b.rx, t.rx), 0, [
      [0, css(base, 0.95)],
      [0.32, css(base, 1.15)],
      [0.7, css(base, 0.78)],
      [1, css(base, 0.5)],
    ]);
    const d =
      `M${r1(b.cx - b.rx)},${r1(b.cy)} A${r1(b.rx)} ${r1(b.ry)} 0 0 0 ${r1(b.cx + b.rx)},${r1(b.cy)} ` +
      (o.waist
        ? `Q${r1(b.cx + o.waist * S)},${r1((b.cy + t.cy) / 2)} ${r1(t.cx + t.rx)},${r1(t.cy)} `
        : `L${r1(t.cx + t.rx)},${r1(t.cy)} `) +
      `A${r1(t.rx)} ${r1(t.ry)} 0 0 1 ${r1(t.cx - t.rx)},${r1(t.cy)} ` +
      (o.waist ? `Q${r1(b.cx - o.waist * S)},${r1((b.cy + t.cy) / 2)} ${r1(b.cx - b.rx)},${r1(b.cy)} Z` : 'Z');
    this.path(d, fill);
    if (o.open) {
      this.path(this.ellipsePath(t), css([30, 32, 36]));
      this.path(this.ellipsePath({ ...t, rx: t.rx * 0.98, ry: t.ry * 0.98 }), 'none', { stroke: css(top, 1.2), width: 1.2 });
    } else {
      this.path(this.ellipsePath(t), css(top, LIGHT.top));
    }
    return { b, t };
  }

  ellipsePath(e) {
    return `M${r1(e.cx - e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(e.ry)} 0 1 0 ${r1(e.cx + e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(e.ry)} 0 1 0 ${r1(e.cx - e.rx)},${r1(e.cy)} Z`;
  }

  /* Front half-ring on a cylinder (a band painted around it). */
  ring(cu, cv, r, h, color, width = 2, glow = false) {
    const e = this.ell(cu, cv, r, h);
    this.path(`M${r1(e.cx - e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(e.ry)} 0 0 0 ${r1(e.cx + e.rx)},${r1(e.cy)}`, 'none', {
      stroke: color,
      width,
      filter: glow ? 'glow' : undefined,
    });
  }

  /* Back half-ring (the part hidden behind a cylinder/tower): draw before it. */
  ringBack(cu, cv, r, h, color, width = 2, glow = true) {
    const e = this.ell(cu, cv, r, h);
    this.path(`M${r1(e.cx + e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(e.ry)} 0 0 0 ${r1(e.cx - e.rx)},${r1(e.cy)}`, 'none', {
      stroke: color,
      width,
      opacity: 0.75,
      filter: glow ? 'glow' : undefined,
    });
  }

  /* Floating halo: back half before the object, front half via `ring` after it. */
  halo(cu, cv, r, h, color, draw, width = 2.2) {
    this.ringBack(cu, cv, r, h, css(color), width);
    draw();
    this.ring(cu, cv, r, h, css(color, 1.1), width, true);
  }

  /* Arch in the vertical plane through two ground points (gateways, conduits). */
  arch(a, b, height, color, width = 3, glow = true, steps = 16) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(this.p(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + Math.sin(t * Math.PI) * height));
    }
    const d = 'M' + pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L');
    this.path(d, 'none', { stroke: color, width, filter: glow ? 'glow' : undefined });
    this.body[this.body.length - 1] = this.body[this.body.length - 1].replace('<path', '<path stroke-linecap="round"');
  }

  /* Continuous glowing window bands on a face (sci-fi ribbon windows). */
  bands(face, b, h0, h1, n, color, o = {}) {
    const along = face === 'left' ? b.du : b.dv;
    const step = (h1 - h0) / n;
    for (let k = 0; k < n; k++) {
      const lo = h0 + k * step + step * 0.3;
      const hi = h0 + (k + 1) * step - step * 0.25;
      this.poly(this.facePoly(face, b, along * 0.06, along * 0.94, lo, hi), css(color, face === 'left' ? 1.05 : 0.8), {
        filter: o.glow === false ? undefined : 'glow',
      });
    }
  }

  /* Thin tapered spire with a glowing tip. */
  spire(u, v, h0, height, color, base = [130, 138, 150], w = 0.035) {
    const [x0, y0] = this.p(u, v, h0);
    const [x1, y1] = this.p(u, v, h0 + height);
    const sw = w * S;
    this.track(y1 - 6);
    this.body.push(
      `<polygon points="${r1(x0 - sw)},${r1(y0)} ${r1(x0 + sw)},${r1(y0)} ${r1(x1)},${r1(y1)}" fill="${this.linear(x0 - sw, 0, x0 + sw, 0, [[0, css(base, 1.2)], [1, css(base, 0.55)]])}"/>`,
    );
    this.glow(u, v, h0 + height, 0.06, color);
  }

  /*
   * Round sci-fi tower: cylinder with glowing ring windows, a collar, and a
   * dome cap (optionally a spire). Returns the top height.
   */
  roundTower(cu, cv, r, h0, h1, base, light, o = {}) {
    this.cylinder(cu, cv, r, h0, h1, base, base, o.taper ?? r);
    const rt = o.taper ?? r;
    const rings = o.rings ?? Math.max(2, Math.round((h1 - h0) / 0.16));
    for (let k = 0; k < rings; k++) {
      const h = h0 + 0.1 + ((h1 - h0 - 0.16) * k) / Math.max(1, rings - 1);
      const rr = r + (rt - r) * ((h - h0) / (h1 - h0));
      this.ring(cu, cv, rr * 1.002, h, css(light, 1.05), o.ringWidth ?? 2.4, true);
    }
    this.cylinder(cu, cv, rt * 1.12, h1, h1 + 0.04, [96, 104, 116], [150, 158, 170]);
    if (o.dome !== false) this.dome(cu, cv, rt * 0.95, h1 + 0.04, rt * 0.9, o.domeTint ?? light, { ribs: 4 });
    const top = h1 + 0.04 + (o.dome !== false ? rt * 0.9 : 0);
    if (o.spire) this.spire(cu, cv, top - 0.02, o.spire, light);
    return top;
  }

  disc(cu, cv, r, h, fill, o = {}) {
    this.path(this.ellipsePath(this.ell(cu, cv, r, h)), fill, o);
  }

  /* Glass or metal dome (half ellipsoid) with a specular highlight. */
  dome(cu, cv, r, h0, height, tint, o = {}) {
    const e = this.ell(cu, cv, r, h0);
    const hh = height * RISE * S;
    this.track(e.cy - hh);
    const fill = this.radial(e.cx, e.cy - hh * 0.4, e.rx * 1.15, [
      [0, css([240, 252, 255], 1, o.alpha ?? 1)],
      [0.25, css(tint, 1.2, o.alpha ?? 1)],
      [1, css(tint, 0.45, o.alpha ?? 1)],
    ], e.cx - e.rx * 0.35, e.cy - hh * 0.75);
    const d = `M${r1(e.cx - e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(e.ry)} 0 0 0 ${r1(e.cx + e.rx)},${r1(e.cy)} A${r1(e.rx)} ${r1(hh)} 0 0 0 ${r1(e.cx - e.rx)},${r1(e.cy)} Z`;
    this.path(d, fill, { stroke: 'rgba(255,255,255,0.3)', width: 0.8 });
    if (o.ribs) {
      for (let k = 1; k < o.ribs; k++) {
        const t = k / o.ribs;
        const x = e.cx - e.rx + 2 * e.rx * t;
        const dy = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
        this.path(`M${r1(x)},${r1(e.cy + e.ry * dy)} Q${r1(x + (x - e.cx) * 0.1)},${r1(e.cy - hh * 1.1 * dy)} ${r1(e.cx)},${r1(e.cy - hh)}`, 'none', {
          stroke: 'rgba(255,255,255,0.22)',
          width: 0.7,
        });
      }
    }
  }

  sphere(u, v, h, r, color, glow = false) {
    const [x, y] = this.p(u, v, h);
    this.track(y - r * S);
    const fill = this.radial(x, y, r * S, [
      [0, css([255, 255, 255])],
      [0.35, css(color, 1.15)],
      [1, css(color, 0.5)],
    ], x - r * S * 0.35, y - r * S * 0.35);
    this.body.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * S)}" fill="${fill}"${glow ? ' filter="url(#glow)"' : ''}/>`);
  }

  glow(u, v, h, r, color) {
    const [x, y] = this.p(u, v, h);
    this.track(y - r * S);
    const fill = this.radial(x, y, r * S, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.3, css(color, 1.1, 0.85)],
      [1, css(color, 1, 0)],
    ]);
    this.body.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * S)}" fill="${fill}"/>`);
  }

  /* Small tree: trunk and a cluster of shaded canopy blobs. */
  tree(u, v, h0, scale, rand, green = [70, 120, 56]) {
    const [x, y] = this.p(u, v, h0);
    const s = scale * S;
    this.body.push(`<ellipse cx="${r1(x + s * 0.12)}" cy="${r1(y + s * 0.03)}" rx="${r1(s * 0.24)}" ry="${r1(s * 0.09)}" fill="rgba(0,0,0,0.28)"/>`);
    this.body.push(`<rect x="${r1(x - s * 0.025)}" y="${r1(y - s * 0.2)}" width="${r1(s * 0.05)}" height="${r1(s * 0.2)}" fill="rgb(70,52,36)"/>`);
    for (let k = 0; k < 3; k++) {
      const cx = x + (rand() - 0.5) * s * 0.2;
      const cy = y - s * (0.3 + rand() * 0.14);
      const rr = s * (0.13 + rand() * 0.06);
      this.track(cy - rr);
      const fill = this.radial(cx, cy, rr, [
        [0, css(green, 1.6)],
        [0.6, css(green, 1)],
        [1, css(green, 0.6)],
      ], cx - rr * 0.35, cy - rr * 0.4);
      this.body.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr)}" fill="${fill}"/>`);
    }
  }

  toString() {
    // Exact (fractional) width and bottom: the sprite anchor depends on the
    // image being precisely the footprint diamond wide, ending at its front corner.
    const top = Math.floor(this.minY - 3);
    const h = r1(this.bottom - top);
    const w = r1(this.width);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${w} ${h}" width="${w}" height="${h}">` +
      `<defs>${this.defs.join('')}</defs>${this.body.join('')}</svg>\n`
    );
  }
}

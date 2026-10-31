import { BATTLE_CELL_HEIGHT_VW, BATTLE_CELL_WIDTH_VW, MAX_STACK_SIZE } from '../battle/battle.types';

/*
 * =========================================================
 * BATTLE SHIP ICONS — class → SVG mapping and on-screen size
 * =========================================================
 *
 * Single source of truth for which SVG a battle stack draws and how large.
 * Pure presentation: nothing here feeds movement, collision, targeting or
 * clicks (the stack's button always covers its whole cell box).
 *
 * Assets live in public/ships/<typeId>.svg. Each file's root <svg> has
 * id="ship" so the grid can reference it with <use href="ships/x.svg#ship">;
 * inline <use> (instead of a CSS background) lets the faction color reach
 * the icon via currentColor and the engine glow via CSS custom properties.
 *
 * Shared scale: every file is drawn at 100 SVG units = 1 battlefield unit
 * (--u), bow pointing right. `width`/`height` below MUST equal the file's
 * viewBox divided by 100 — the relative size of the classes comes from the
 * drawings themselves, so a fighter is ~1 u long and a dreadnought ~4.4 u.
 */

export interface ShipIconDef {
  /* URL relative to the app base href; points at the file's root <svg id="ship">. */
  href: string;
  /* Natural size in battlefield units (viewBox / 100). */
  width: number;
  height: number;
}

const icon = (typeId: string, viewBoxW: number, viewBoxH: number): ShipIconDef => ({
  href: `ships/${typeId}.svg#ship`,
  width: viewBoxW / 100,
  height: viewBoxH / 100,
});

/* Keyed by ship-data.json ids plus the planet-defense buildings that enter
 * battle as virtual ships (planet-data.json, role "defense", type "turret"). */
export const SHIP_ICONS: Readonly<Record<string, ShipIconDef>> = {
  fighter: icon('fighter', 95, 66),
  scout: icon('scout', 106, 46),
  corvette: icon('corvette', 118, 62),
  colonizer: icon('colonizer', 124, 72),
  outpost_ship: icon('outpost_ship', 130, 80),
  frigate: icon('frigate', 138, 70),
  destroyer: icon('destroyer', 155, 68),
  cruiser: icon('cruiser', 220, 96),
  carrier: icon('carrier', 255, 124),
  battlecruiser: icon('battlecruiser', 285, 104),
  battleship: icon('battleship', 292, 134),
  dreadnought: icon('dreadnought', 440, 140),
  laser_turret: icon('laser_turret', 112, 100),
  missile_turret: icon('missile_turret', 116, 108),
  station_core: icon('station_core', 160, 150),
};

/* Used only for a type id with no entry (e.g. a newly added ship type before
 * its icon exists); the spec asserts every known type has its own icon. */
export const FALLBACK_SHIP_ICON: ShipIconDef = SHIP_ICONS['frigate'];

export function shipIconFor(typeId: string): ShipIconDef {
  return SHIP_ICONS[typeId] ?? FALLBACK_SHIP_ICON;
}

/* Stack cell box in field units — mirrors .stack-cell / .stack-cell--size-N
 * in battle-grid.component.scss (0.925 of a cell, +0.2 u gap per extra cell). */
const STACK_BOX_FILL = 0.925;
const STACK_BOX_GAP = 0.2;
/* Share of the box the icon may use: leaves room for the HP / shield bars
 * along the bottom edge and the friend/foe brackets in the corners. */
const ICON_MAX_W = 0.94;
const ICON_MAX_H = 0.84;

export function stackBoxSize(cells: number): { width: number; height: number } {
  const n = Math.max(1, cells);
  return {
    width: n * STACK_BOX_FILL * BATTLE_CELL_WIDTH_VW + (n - 1) * STACK_BOX_GAP,
    height: STACK_BOX_FILL * BATTLE_CELL_HEIGHT_VW,
  };
}

/* A fuller stack draws slightly larger so stack strength stays readable;
 * the range is kept small so class size dominates. */
export function stackCountScale(shipCount: number): number {
  const n = Math.min(Math.max(shipCount, 1), MAX_STACK_SIZE);
  return 0.88 + (0.12 * (n - 1)) / (MAX_STACK_SIZE - 1);
}

/*
 * Rendered icon size (field units) for a stack: natural size × count scale,
 * then shrunk uniformly if it would overflow the stack's cell box. With the
 * current numbers only a near-full Dreadnought stack touches the height cap
 * (by a few percent), so the shared scale is effectively preserved; the clamp
 * mainly guards against future assets or grid changes.
 */
export function shipIconSize(
  typeId: string,
  cells: number,
  shipCount: number,
): { width: number; height: number } {
  const def = shipIconFor(typeId);
  const box = stackBoxSize(cells);
  const scale = stackCountScale(shipCount);
  const w = def.width * scale;
  const h = def.height * scale;
  const fit = Math.min(1, (box.width * ICON_MAX_W) / w, (box.height * ICON_MAX_H) / h);
  return { width: w * fit, height: h * fit };
}

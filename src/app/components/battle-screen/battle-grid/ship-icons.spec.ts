import shipData from '../../star-map/ship-data.json';
import planetData from '../../star-map/planet-data.json';
import { MAX_STACK_SIZE } from '../battle/battle.types';
import {
  FALLBACK_SHIP_ICON,
  SHIP_ICONS,
  shipIconFor,
  shipIconSize,
  stackBoxSize,
  stackCountScale,
} from './ship-icons';

const shipTypeIds = shipData.shipTypes.map((s) => s.id);
/* Defense buildings that become virtual battle ships (the shield building
 * becomes a shared pool instead, see PlanetBattleService). */
const turretIds = (planetData as { buildings: { id: string; role?: string; type?: string }[] }).buildings
  .filter((b) => b.role === 'defense' && b.type === 'turret')
  .map((b) => b.id);

/* Same tier → cell-count rule as battle-state.ts. */
const TIER: Record<string, number> = {
  scout: 1, fighter: 1, colonizer: 1, corvette: 1, frigate: 2, destroyer: 2,
  cruiser: 3, carrier: 3, battleship: 4, battlecruiser: 4, dreadnought: 5,
};
const cellsFor = (id: string) => {
  const tier = TIER[id] ?? 3;
  return tier >= 5 ? 3 : tier >= 3 ? 2 : 1;
};

describe('ship icons', () => {
  it('gives every ship class and defense turret its own icon file', () => {
    const ids = [...shipTypeIds, ...turretIds];
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      expect(SHIP_ICONS[id], id).toBeDefined();
      expect(SHIP_ICONS[id].href).toBe(`ships/${id}.svg#ship`);
    }
    const hrefs = Object.values(SHIP_ICONS).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('falls back only for unknown type ids', () => {
    expect(shipIconFor('fighter')).toBe(SHIP_ICONS['fighter']);
    expect(shipIconFor('no-such-ship')).toBe(FALLBACK_SHIP_ICON);
  });

  it('keeps the size hierarchy fighter < frigate < destroyer < cruiser < battleship < dreadnought', () => {
    const order = ['fighter', 'frigate', 'destroyer', 'cruiser', 'battleship', 'dreadnought'];
    const areas = order.map((id) => {
      const s = shipIconSize(id, cellsFor(id), 1);
      return s.width * s.height;
    });
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i], order[i]).toBeGreaterThan(areas[i - 1]);
    }
  });

  it('never draws an icon outside its stack cell box', () => {
    for (const id of Object.keys(SHIP_ICONS)) {
      const cells = cellsFor(id);
      const box = stackBoxSize(cells);
      for (let n = 1; n <= MAX_STACK_SIZE; n++) {
        const s = shipIconSize(id, cells, n);
        expect(s.width, `${id} x${n}`).toBeLessThanOrEqual(box.width);
        expect(s.height, `${id} x${n}`).toBeLessThanOrEqual(box.height);
        // Uniform scaling only: the aspect ratio of the artwork is preserved.
        expect(s.width / s.height).toBeCloseTo(SHIP_ICONS[id].width / SHIP_ICONS[id].height, 6);
      }
    }
  });

  it('grows slightly with the number of ships in a stack', () => {
    expect(stackCountScale(1)).toBeLessThan(stackCountScale(MAX_STACK_SIZE));
    expect(stackCountScale(MAX_STACK_SIZE)).toBe(1);
    expect(stackCountScale(99)).toBe(1);
  });
});

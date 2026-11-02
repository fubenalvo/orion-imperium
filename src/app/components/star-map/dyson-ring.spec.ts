import { describe, expect, it } from 'vitest';
import { Faction, Fleet, StarSystem } from './star-map.models';
import {
  DYSON_RING_CONFIG,
  DysonRing,
  buildDysonRing,
  dysonSlotAtCell,
  dysonWedgeAt,
  dysonWedgePath,
  isInDysonRingZone,
} from './dyson-ring';
import { computeTerritory } from './territory';
import { OUTPOST_SHIP_TYPE, validateBaseDeployment } from './space-base';
import { blackHoleObject } from '../../services/galaxy-generator.service';
import { GALAXY_SIZE_PRESETS } from '../../services/new-game.models';
import { GalaxySize } from './star-map.models';

const W = 240;
const H = 144;

const factions = [
  { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
  { id: 'enemy1', name: 'Enemy', color: '#d65757', team: 2, ai: true, currencies: {} },
] as unknown as Faction[];

function ringFor(width = W, height = H): DysonRing {
  return buildDysonRing([blackHoleObject(width, height)])!;
}

function ownedSystem(id: string, x: number, y: number, owner: string): StarSystem {
  return {
    id, name: id, x, y, planets: 1, color: '#fff', explored: true,
    planetsTiles: [{ id: 1, index: 1, name: `${id} I`, factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 100, buildings: [], explored: true }],
  } as unknown as StarSystem;
}

describe('Dyson ring geometry', () => {
  it('has no ring without a black hole', () => {
    expect(buildDysonRing([])).toBeNull();
    expect(buildDysonRing(undefined)).toBeNull();
    expect(isInDysonRingZone(null, 1, 1)).toBe(false);
  });

  for (const size of ['small', 'medium', 'large'] as GalaxySize[]) {
    it(`places 8 evenly spaced slots on integer cells (${size})`, () => {
      const preset = GALAXY_SIZE_PRESETS[size];
      const ring = ringFor(preset.width, preset.height);
      expect(ring.slots).toHaveLength(DYSON_RING_CONFIG.slotCount);
      for (const slot of ring.slots) {
        // Exactly on the offset (no rounding needed): the center is on a half cell.
        const offset = DYSON_RING_CONFIG.slotOffsets[slot.index];
        expect(slot.col).toBe(ring.cx + offset.dx);
        expect(slot.row).toBe(ring.cy + offset.dy);
        expect(Math.hypot(slot.col - ring.cx, slot.row - ring.cy)).toBeCloseTo(Math.sqrt(48.5), 9);
        // Outside the no-fly disc, inside the zone, and in its own wedge.
        expect(Math.hypot(slot.col - ring.cx, slot.row - ring.cy)).toBeGreaterThan(ring.innerRadius * 1.05);
        expect(isInDysonRingZone(ring, slot.col, slot.row)).toBe(true);
        expect(dysonWedgeAt(ring, slot.col, slot.row)).toBe(slot.index);
        expect(dysonSlotAtCell(ring, slot.col, slot.row)).toBe(slot);
      }
      for (const a of ring.slots) {
        for (const b of ring.slots) {
          if (a !== b) expect(Math.hypot(a.col - b.col, a.row - b.row)).toBeGreaterThanOrEqual(5);
        }
      }
      // Rings stay well inside the system clearance of every preset.
      expect(ring.outerRadius).toBeLessThan(preset.blackHoleClearance);
    });
  }

  it('the 8 wedges tile the ring: every ring cell outside the no-fly disc has exactly one wedge, mirrored wedges are equal', () => {
    const ring = ringFor();
    const counts = Array(8).fill(0);
    for (let row = Math.floor(ring.cy - 11); row <= ring.cy + 11; row++) {
      for (let col = Math.floor(ring.cx - 11); col <= ring.cx + 11; col++) {
        const d = Math.hypot(col - ring.cx, row - ring.cy);
        const wedge = dysonWedgeAt(ring, col, row);
        if (d > ring.outerRadius) {
          expect(wedge).toBeNull();
          expect(isInDysonRingZone(ring, col, row)).toBe(false);
        } else if (d < ring.innerRadius) {
          expect(wedge).toBeNull();
          expect(isInDysonRingZone(ring, col, row)).toBe(true);
        } else {
          expect(wedge).not.toBeNull();
          counts[wedge!]++;
        }
      }
    }
    // Mirror symmetry of the slot layout on both axes.
    expect(counts[0]).toBe(counts[3]);
    expect(counts[0]).toBe(counts[4]);
    expect(counts[0]).toBe(counts[7]);
    expect(counts[1]).toBe(counts[2]);
    expect(counts[1]).toBe(counts[5]);
    expect(counts[1]).toBe(counts[6]);
    expect(Math.min(...counts)).toBeGreaterThan(15);
  });

  it('draws each wedge as a closed annular sector', () => {
    const path = dysonWedgePath(ringFor(), 0);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.match(/ A /g)).toHaveLength(2);
    expect(path.endsWith('Z')).toBe(true);
  });
});

describe('Dyson ring territory precedence', () => {
  it('cuts a system disc that reaches into the ring, and a slot never lies in foreign territory', () => {
    const ring = ringFor();
    // A system just behind slot 0 (about 13 cells from the center): its 7-cell disc covers the slot.
    const slot = ring.slots[0];
    const system = ownedSystem('near', slot.col + 6, slot.row + 2, 'enemy1');
    const without = computeTerritory([system], [], factions, W, H);
    expect(without.ownerAt(slot.col, slot.row)).toBe('enemy1');

    const territory = computeTerritory([system], [], factions, W, H, { ring, wedgeOwners: [] });
    for (const s of ring.slots) expect(territory.ownerAt(s.col, s.row)).toBeNull();
    // Outside the zone the system keeps its disc.
    expect(territory.ownerAt(system.x, system.y)).toBe('enemy1');
    territory.forEachCell((col, row) => expect(isInDysonRingZone(ring, col, row)).toBe(false));
  });

  it('cuts a base disc the same way', () => {
    const ring = ringFor();
    const base = { id: 1, name: 'B', factionId: 'player', x: Math.round(ring.cx + 13), y: Math.round(ring.cy) };
    const territory = computeTerritory([], [base], factions, W, H, { ring, wedgeOwners: [] });
    expect(territory.ownerAt(base.x, base.y)).toBe('player');
    territory.forEachCell((col, row) => expect(isInDysonRingZone(ring, col, row)).toBe(false));
  });

  it('gives a wedge only to its anchor owner, never the no-fly disc', () => {
    const ring = ringFor();
    const slot = ring.slots[0];
    const system = ownedSystem('near', slot.col + 6, slot.row + 2, 'enemy1');
    const territory = computeTerritory([system], [], factions, W, H, { ring, wedgeOwners: ['player'] });
    expect(territory.ownerAt(slot.col, slot.row)).toBe('player');
    expect(territory.claimAt(slot.col, slot.row)).toMatchObject({ kind: 'dyson', sourceId: 'dyson-0' });
    expect(territory.ownerAt(ring.slots[1].col, ring.slots[1].row)).toBeNull();
    expect(territory.ownerAt(Math.floor(ring.cx), Math.floor(ring.cy))).toBeNull();
    territory.forEachCell((col, row, owner) => {
      if (isInDysonRingZone(ring, col, row)) {
        expect(owner).toBe('player');
        expect(dysonWedgeAt(ring, col, row)).toBe(0);
      }
    });
  });
});

describe('ordinary space bases and the ring zone', () => {
  const fleetAt = (x: number, y: number): Fleet =>
    ({ id: 1, name: 'F', factionId: 'player', x, y, targetX: null, targetY: null, speed: 1, system: null, ships: [{ id: 1, name: 'O', type: OUTPOST_SHIP_TYPE }] }) as Fleet;

  it('refuses a base inside the ring zone and allows one just outside', () => {
    const ring = ringFor();
    const territory = computeTerritory([], [], factions, W, H, { ring, wedgeOwners: [] });
    const input = (x: number, y: number) => ({ fleet: fleetAt(x, y), factions, starSystems: [], bases: [], territory, width: W, height: H, dysonRing: ring });

    const slot = ring.slots[2];
    const inside = validateBaseDeployment(input(slot.col, slot.row));
    expect(inside.ok ? 'ok' : inside.reason).toBe('dyson_ring');
    const outside = validateBaseDeployment(input(Math.ceil(ring.cx + ring.outerRadius + 1), Math.floor(ring.cy)));
    expect(outside.ok).toBe(true);
  });
});

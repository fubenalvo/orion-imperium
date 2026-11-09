import { Fleet, Wormhole } from './star-map.models';
import { NavGraph, NavPoint } from './fleet-navigation';
import { StarMapTerrainService } from './star-map-terrain.service';
import { StarMapMovementService } from './star-map-movement.service';
import { WORMHOLE_CONFIG, planWormholeRoute, routeTravelSeconds } from './wormholes';

/* Wormhole transit (docs/campaign-design.md §11): routing, movement, ETA. */
describe('wormholes', () => {
  const gate = (state: Wormhole['state'] = 'active'): Wormhole => ({
    id: 'gate', name: 'Gate', state, mouths: [{ x: 10, y: 10 }, { x: 90, y: 10 }],
  });
  const graph = new NavGraph([], { width: 100, height: 60 });
  const plan = (a: NavPoint, b: NavPoint) => graph.plan(a, b);

  describe('planWormholeRoute', () => {
    it('goes through an active wormhole when that is shorter, with a jump on the entry mouth', () => {
      const route = planWormholeRoute(plan, { x: 5, y: 10 }, { x: 95, y: 10 }, [gate()]);
      expect(route.ok).toBe(true);
      const jump = route.ok ? route.waypoints.find((w) => w.jump) : undefined;
      expect(jump).toMatchObject({ x: 10, y: 10, jump: { wormholeId: 'gate', exitX: 90, exitY: 10 } });
    });

    it('uses the wormhole in both directions', () => {
      const route = planWormholeRoute(plan, { x: 95, y: 10 }, { x: 5, y: 10 }, [gate()]);
      expect(route.ok && route.waypoints.find((w) => w.jump)?.jump?.exitX).toBe(10);
    });

    it('flies directly when that is shorter, and never through dormant wormholes or exit gates', () => {
      const short = planWormholeRoute(plan, { x: 40, y: 30 }, { x: 50, y: 30 }, [gate()]);
      expect(short.ok && short.waypoints.some((w) => w.jump)).toBe(false);
      const dormant = planWormholeRoute(plan, { x: 5, y: 10 }, { x: 95, y: 10 }, [gate('dormant')]);
      expect(dormant.ok && dormant.waypoints.some((w) => w.jump)).toBe(false);
      const exitGate: Wormhole = { id: 'exit', name: 'Exit', state: 'active', mouths: [{ x: 10, y: 10 }] };
      const single = planWormholeRoute(plan, { x: 5, y: 10 }, { x: 95, y: 10 }, [exitGate]);
      expect(single.ok && single.waypoints.some((w) => w.jump)).toBe(false);
    });

    it('measures a route without flying the jump, plus the transit time', () => {
      const seconds = routeTravelSeconds(
        [{ x: 0, y: 0 }, { x: 10, y: 0, jump: { wormholeId: 'g', exitX: 90, exitY: 0, transitSeconds: 20 } }, { x: 100, y: 0 }],
        (leg) => leg.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - leg[i - 1].x, p.y - leg[i - 1].y)), 0),
      );
      expect(seconds).toBe(10 + 20 + 10);
    });
  });

  describe('fleet movement', () => {
    const setup = (wormholes: Wormhole[]) => {
      const terrain = new StarMapTerrainService();
      terrain.configure({ specialObjects: [], nebulae: [], asteroidBelts: [], wormholes, width: 100, height: 60 });
      const movement = new StarMapMovementService(terrain);
      movement.initialize(2, 2, 100, 60);
      return { terrain, movement };
    };
    const fleet = (): Fleet => ({
      id: 1, name: 'F', factionId: 'player', x: 5, y: 10, targetX: 95, targetY: 10, speed: 4, system: null, destroyed: false,
      ships: [{ id: 1, name: 's', type: 'frigate' }],
    });
    const step = (movement: StarMapMovementService, fleets: Fleet[], dt: number) =>
      movement.updateFleets(fleets, [], null, 'map', dt, () => {}, () => {});

    it('enters transit on the entry mouth, comes out at the exit and arrives at the predicted time', () => {
      const { movement } = setup([gate()]);
      const f = fleet();
      const eta = movement.estimateRemainingTravelSeconds(f)!;
      // 5 cells to the mouth + 20 s transit + 5 cells, at 0.2 cells/s.
      expect(eta).toBeCloseTo(5 / 0.2 + WORMHOLE_CONFIG.transitSeconds + 5 / 0.2, 1);
      let seconds = 0;
      let sawTransit = false;
      while (f.targetX !== null && seconds < 500) {
        step(movement, [f], 0.25);
        seconds += 0.25;
        if (f.transit) {
          sawTransit = true;
          expect([f.x, f.y], 'waits at the entry while in transit').toEqual([10, 10]);
        }
      }
      expect(sawTransit).toBe(true);
      expect([f.x, f.y]).toEqual([95, 10]);
      expect(Math.abs(seconds - eta) / eta).toBeLessThan(0.05);
    });

    it('finishes a saved transit after a reload and never jumps twice', () => {
      const first = setup([gate()]);
      const f = fleet();
      while (!f.transit) step(first.movement, [f], 0.25);
      // A reload: a new movement service (no cached route), the fleet record as saved.
      const saved: Fleet = structuredClone(f);
      const second = setup([gate()]);
      let seconds = 0;
      while (saved.targetX !== null && seconds < 500) {
        step(second.movement, [saved], 0.25);
        seconds += 0.25;
      }
      expect([saved.x, saved.y]).toEqual([95, 10]);
      expect(seconds, 'the rest of one transit + 5 cells, not a second transit').toBeLessThan(WORMHOLE_CONFIG.transitSeconds + 5 / 0.2 + 1);
    });

    it('follows a wormhole woken during the game for routes planned afterwards', () => {
      const { terrain, movement } = setup([gate('dormant')]);
      const before = movement.planGalaxyRoute({ x: 5, y: 10 }, { x: 95, y: 10 });
      expect(before.ok && before.waypoints.some((w) => w.jump)).toBe(false);
      terrain.setWormholes([gate('active')]);
      const after = movement.planGalaxyRoute({ x: 5, y: 10 }, { x: 95, y: 10 });
      expect(after.ok && after.waypoints.some((w) => w.jump)).toBe(true);
    });
  });
});

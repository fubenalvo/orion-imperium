import { Fleet, StarSystem } from './star-map.models';
import { SYSTEM_FLEET_ENTRY_VW } from './system-grid';
import {
  SYSTEM_INBOUND_WARNING_SECONDS,
  separatedInsideSystem,
  systemEntryAlert,
  systemPositionOf,
  updateSystemPursuit,
} from './system-pursuit';

function makeFleet(id: number, factionId: string, extra: Partial<Fleet> = {}): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x: 10.5, y: 10.5, targetX: null, targetY: null, speed: 4, system: null,
    ships: [{ id: id * 10, name: 'Frigate', type: 'frigate' }],
    ...extra,
  };
}

const SYSTEM = { id: 'sol', name: 'SOL', x: 10.5, y: 10.5 } as StarSystem;
const at = (x: number, y: number) => ({ id: 'sol', x, y, targetX: null, targetY: null });

const hooks = {
  isComputerFleet: (fleet: Fleet) => fleet.factionId !== 'player',
  mayHunt: () => true,
};

describe('system pursuit', () => {
  it('treats a fleet without an in-system position as standing at the entry point', () => {
    expect(systemPositionOf(makeFleet(1, 'player'), 'sol')).toEqual(SYSTEM_FLEET_ENTRY_VW);
  });

  it('keeps the galaxy cell rule while neither fleet is inside the system view', () => {
    expect(separatedInsideSystem(makeFleet(1, 'player'), makeFleet(2, 'ai1'), [SYSTEM])).toBe(false);
  });

  it('separates a player fleet that moved away from the entry from a newly arrived enemy', () => {
    const player = makeFleet(1, 'player', { system: at(40, 10) });
    expect(separatedInsideSystem(player, makeFleet(2, 'ai1'), [SYSTEM])).toBe(true);
  });

  it('does not separate a player fleet still at the entry point', () => {
    const player = makeFleet(1, 'player', { system: at(SYSTEM_FLEET_ENTRY_VW.x, SYSTEM_FLEET_ENTRY_VW.y) });
    expect(separatedInsideSystem(player, makeFleet(2, 'ai1'), [SYSTEM])).toBe(false);
  });

  it('sends a stopped hostile fleet from the entry point after the player fleet', () => {
    const player = makeFleet(1, 'player', { system: at(40, 10) });
    const enemy = makeFleet(2, 'ai1');
    expect(updateSystemPursuit([player, enemy], [SYSTEM], hooks)).toBe(true);
    expect(enemy.system).toEqual({
      id: 'sol', x: SYSTEM_FLEET_ENTRY_VW.x, y: SYSTEM_FLEET_ENTRY_VW.y, targetX: 40, targetY: 10,
    });
  });

  it('does not pursue while still flying on the galaxy map or when it may not attack', () => {
    const player = makeFleet(1, 'player', { system: at(40, 10) });
    const passing = makeFleet(2, 'ai1', { targetX: 20, targetY: 20 });
    const peaceful = makeFleet(3, 'ai2');
    updateSystemPursuit([player, passing, peaceful], [SYSTEM], { ...hooks, mayHunt: (h) => h.id !== 3 });
    expect(passing.system).toBeNull();
    expect(peaceful.system).toBeNull();
  });

  it('never moves the player fleet on its own', () => {
    const player = makeFleet(1, 'player');
    const enemy = makeFleet(2, 'ai1', { system: at(40, 10) });
    updateSystemPursuit([player, enemy], [SYSTEM], hooks);
    expect(player.system).toBeNull();
    expect(enemy.system!.targetX).toBe(SYSTEM_FLEET_ENTRY_VW.x);
  });
});

describe('system entry alert', () => {
  const threat = { isThreat: (f: Fleet) => f.factionId !== 'player', cellsPerSecond: () => 0.5 };

  it('reports a hostile fleet standing at the jump point', () => {
    const alert = systemEntryAlert([makeFleet(2, 'ai1')], SYSTEM, threat);
    expect(alert).toEqual({ kind: 'present', seconds: null, fleetIds: [2] });
  });

  it('ignores a hostile fleet that already moved away from the jump point', () => {
    expect(systemEntryAlert([makeFleet(2, 'ai1', { system: at(40, 10) })], SYSTEM, threat)).toBeNull();
  });

  it('warns about a hostile fleet due within the warning window, not one far away', () => {
    const near = makeFleet(2, 'ai1', { x: 15.5, y: 10.5, targetX: 10.5, targetY: 10.5 });
    const far = makeFleet(3, 'ai1', { x: 60.5, y: 10.5, targetX: 10.5, targetY: 10.5 });
    const alert = systemEntryAlert([near, far], SYSTEM, threat);
    expect(alert?.kind).toBe('inbound');
    expect(alert?.fleetIds).toEqual([2]);
    expect(alert?.seconds).toBeCloseTo(10, 6);
    expect(SYSTEM_INBOUND_WARNING_SECONDS).toBeLessThan(100);
  });
});

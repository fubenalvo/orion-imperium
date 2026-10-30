import { TestBed } from '@angular/core/testing';
import {
  Faction,
  FactionShipStock,
  Fleet,
  FleetShip,
  ShipStockEntry,
  StarMapData,
  StarSystem,
} from '../components/star-map/star-map.models';
import {
  FleetOrganizationPlan,
  FleetOrganizationService,
  FLEET_NAME_MAX_LENGTH,
} from './fleet-organization.service';
import { SaveGameService } from './save-game.service';
import { validateSaveData } from './save-validation';

let shipSeq = 0;
const ship = (type: string, extra: Partial<FleetShip> = {}): FleetShip => ({
  id: ++shipSeq,
  name: 'Ship',
  type,
  currentHp: 50,
  destroyed: false,
  ...extra,
});

const fleet = (id: number, ships: FleetShip[], extra: Partial<Fleet> = {}): Fleet => ({
  id,
  name: `Fleet ${id}`,
  factionId: 'player',
  x: 10.4,
  y: 20.7,
  targetX: null,
  targetY: null,
  speed: 4,
  system: { id: 'sol', x: 12.5, y: 7.5, targetX: null, targetY: null },
  gridCol: 4,
  gridRow: 2,
  ships,
  destroyed: false,
  sensorRange: 3,
  ...extra,
});

const ids = (f: Fleet): number[] => f.ships.filter((s) => !s.destroyed).map((s) => s.id);

/* Every living ship across `fleets`, each with the number of fleets holding it. */
const ownership = (fleets: Fleet[]): Map<number, number> => {
  const owners = new Map<number, number>();
  for (const f of fleets) {
    if (f.destroyed) continue;
    for (const s of f.ships) {
      if (!s.destroyed) owners.set(s.id, (owners.get(s.id) ?? 0) + 1);
    }
  }
  return owners;
};

describe('FleetOrganizationService', () => {
  let service: FleetOrganizationService;

  beforeEach(() => {
    service = TestBed.inject(FleetOrganizationService);
    shipSeq = 0;
  });

  describe('getCoLocatedFleets', () => {
    it('returns own active fleets on the same galaxy cell, anchor first', () => {
      const a = fleet(5, [ship('scout')]);
      const b = fleet(2, [ship('fighter')], { x: 10.9, y: 20.1 });
      const far = fleet(3, [ship('fighter')], { x: 11.0 });
      const enemy = fleet(4, [ship('fighter')], { factionId: 'enemy1' });
      const dead = fleet(6, [ship('fighter')], { destroyed: true });
      const wrecksOnly = fleet(7, [ship('fighter', { destroyed: true })]);

      const result = service.getCoLocatedFleets([b, far, enemy, dead, wrecksOnly, a], a);

      expect(result.map((f) => f.id)).toEqual([5, 2]);
    });
  });

  describe('merging', () => {
    it('merges two fleets and retires the emptied one', () => {
      const a = fleet(1, [ship('scout'), ship('fighter')]);
      const b = fleet(2, [ship('cruiser')]);
      const fleets = [a, b];

      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [
          { fleetId: 1, originFleetId: 1, name: 'Fleet 1', shipIds: [...ids(a), ...ids(b)] },
        ],
      });

      expect(result.ok).toBe(true);
      expect(ids(a)).toEqual([1, 2, 3]);
      expect(b.destroyed).toBe(true);
      expect(b.ships).toEqual([]);
      expect(result.retired).toEqual([b]);
      expect(fleets.length).toBe(2); // retired fleets stay so their ids still resolve
    });

    it('merges three or more fleets into one', () => {
      const fleets = [1, 2, 3, 4].map((id) => fleet(id, [ship('fighter'), ship('frigate')]));
      const all = fleets.flatMap(ids);

      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2, 3, 4],
        fleets: [{ fleetId: 3, originFleetId: 3, name: 'Grand Fleet', shipIds: all }],
      });

      expect(result.ok).toBe(true);
      expect(result.fleets.map((f) => f.id)).toEqual([3]);
      expect(fleets[2].ships.length).toBe(8);
      expect(fleets[2].name).toBe('Grand Fleet');
      expect(fleets.filter((f) => f.destroyed).map((f) => f.id)).toEqual([1, 2, 4]);
    });

    it('keeps the receiving fleet position and orders; clears orders of retired fleets', () => {
      const a = fleet(1, [ship('scout')], { targetX: 40, targetY: 30, attackFleetId: 9 });
      const b = fleet(2, [ship('fighter')], {
        targetX: 50,
        targetY: 50,
        interceptAsteroidId: 3,
        system: { id: 'sol', x: 30, y: 10, targetX: 40, targetY: 10 },
      });

      service.applyPlan({ fleets: [a, b] }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b)] }],
      });

      expect([a.x, a.y, a.targetX, a.targetY, a.attackFleetId]).toEqual([10.4, 20.7, 40, 30, 9]);
      expect([b.targetX, b.targetY, b.interceptAsteroidId]).toEqual([null, null, null]);
      expect([b.system?.targetX, b.system?.targetY]).toEqual([null, null]);
    });

    it('keeps wreck records with their original fleet and never moves them', () => {
      const wreck = ship('frigate', { destroyed: true, currentHp: 0 });
      const a = fleet(1, [ship('scout')]);
      const b = fleet(2, [ship('fighter'), wreck]);

      service.applyPlan({ fleets: [a, b] }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b)] }],
      });

      expect(a.ships.some((s) => s.destroyed)).toBe(false);
      expect(b.ships).toEqual([wreck]);
    });
  });

  describe('splitting', () => {
    it('splits a fleet into two, the new fleet inheriting position and stats but no orders', () => {
      const s = [ship('scout'), ship('fighter'), ship('cruiser', { currentHp: 17 })];
      const a = fleet(7, s, { targetX: 80, targetY: 80, speed: 6, sensorRange: 5 });
      const other = fleet(12, [ship('fighter')], { x: 90, y: 90 });
      const fleets = [a, other];

      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [7],
        fleets: [
          { fleetId: 7, originFleetId: 7, name: 'Main', shipIds: [s[0].id] },
          { fleetId: null, originFleetId: 7, name: 'Strike Group', shipIds: [s[1].id, s[2].id] },
        ],
      });

      expect(result.ok).toBe(true);
      const created = result.created[0];
      expect(created.id).toBe(13); // above every existing id
      expect(created.name).toBe('Strike Group');
      expect([created.x, created.y, created.gridCol, created.gridRow]).toEqual([10.4, 20.7, 4, 2]);
      expect(created.system).toEqual({ id: 'sol', x: 12.5, y: 7.5, targetX: null, targetY: null });
      expect(created.system).not.toBe(a.system);
      expect([created.targetX, created.targetY]).toEqual([null, null]);
      expect([created.speed, created.sensorRange]).toEqual([6, 5]);
      // Ship records move as-is (damage is preserved).
      expect(created.ships[1]).toBe(s[2]);
      expect(created.ships[1].currentHp).toBe(17);
      // The original keeps its orders.
      expect([a.targetX, a.targetY]).toEqual([80, 80]);
      expect(fleets).toContain(created);
    });

    it('splits one fleet into many with unique ids', () => {
      const s = Array.from({ length: 6 }, () => ship('fighter'));
      const a = fleet(1, s);
      const fleets = [a];

      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [
          { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [s[0].id] },
          { fleetId: null, originFleetId: 1, name: 'B', shipIds: [s[1].id, s[2].id] },
          { fleetId: null, originFleetId: 1, name: 'C', shipIds: [s[3].id] },
          { fleetId: null, originFleetId: 1, name: 'D', shipIds: [s[4].id, s[5].id] },
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.created.map((f) => f.id)).toEqual([2, 3, 4]);
      expect(new Set(fleets.map((f) => f.id)).size).toBe(fleets.length);
      expect([...ownership(fleets).values()].every((n) => n === 1)).toBe(true);
      expect(ownership(fleets).size).toBe(6);
    });

    it('can dissolve the original while splitting it completely into new fleets', () => {
      const s = [ship('fighter'), ship('fighter')];
      const a = fleet(1, s, { targetX: 5, targetY: 5 });
      const fleets = [a];

      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [
          { fleetId: null, originFleetId: 1, name: 'X', shipIds: [s[0].id] },
          { fleetId: null, originFleetId: 1, name: 'Y', shipIds: [s[1].id] },
        ],
      });

      expect(result.ok).toBe(true);
      expect(a.destroyed).toBe(true);
      // Position came from the origin snapshot even though the origin was retired.
      expect(
        result.created.every((f) => f.x === 10.4 && f.y === 20.7 && f.system?.id === 'sol'),
      ).toBe(true);
    });

    it('never reuses the id of a destroyed fleet', () => {
      const a = fleet(1, [ship('fighter'), ship('fighter')]);
      const dead = fleet(40, [], { destroyed: true });
      const result = service.applyPlan({ fleets: [a, dead] }, [], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [
          { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [a.ships[0].id] },
          { fleetId: null, originFleetId: 1, name: 'B', shipIds: [a.ships[1].id] },
        ],
      });
      expect(result.created[0].id).toBe(41);
    });
  });

  describe('redistribution', () => {
    it('moves individual ships of the same class between existing fleets', () => {
      const aShips = [ship('fighter'), ship('fighter'), ship('fighter'), ship('cruiser')];
      const bShips = [ship('frigate')];
      const a = fleet(1, aShips);
      const b = fleet(2, bShips);

      const result = service.applyPlan({ fleets: [a, b] }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [
          { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [aShips[0].id, aShips[3].id] },
          {
            fleetId: 2,
            originFleetId: 2,
            name: 'B',
            shipIds: [bShips[0].id, aShips[1].id, aShips[2].id],
          },
        ],
      });

      expect(result.ok).toBe(true);
      expect(a.ships.map((s) => s.type)).toEqual(['fighter', 'cruiser']);
      expect(b.ships.map((s) => s.type)).toEqual(['frigate', 'fighter', 'fighter']);
      expect(result.retired).toEqual([]);
    });

    it('retires a fleet whose last ship moves out', () => {
      const a = fleet(1, [ship('fighter')]);
      const b = fleet(2, [ship('fighter')]);

      const result = service.applyPlan({ fleets: [a, b] }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [{ fleetId: 2, originFleetId: 2, name: 'B', shipIds: [...ids(b), ...ids(a)] }],
      });

      expect(result.retired).toEqual([a]);
      expect(a.destroyed).toBe(true);
    });

    it('trims and clamps names, falling back to the previous name when blank', () => {
      const a = fleet(1, [ship('fighter')]);
      service.applyPlan({ fleets: [a] }, [], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: '   ', shipIds: ids(a) }],
      });
      expect(a.name).toBe('Fleet 1');

      service.applyPlan({ fleets: [a] }, [], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: `  ${'X'.repeat(60)} `, shipIds: ids(a) }],
      });
      expect(a.name.length).toBe(FLEET_NAME_MAX_LENGTH);
    });
  });

  describe('validation (rejected plans change nothing)', () => {
    const setup = () => {
      const a = fleet(1, [ship('fighter'), ship('scout')]);
      const b = fleet(2, [ship('cruiser')]);
      const fleets = [a, b];
      return { a, b, fleets, snapshot: structuredClone(fleets) };
    };

    const cases: [string, (a: Fleet, b: Fleet) => Partial<FleetOrganizationPlan>, string][] = [
      [
        'an empty fleet',
        (a, b) => ({
          fleets: [
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b)] },
            { fleetId: null, originFleetId: 1, name: 'Empty', shipIds: [] },
          ],
        }),
        'empty_fleet',
      ],
      [
        'a ship in two fleets',
        (a, b) => ({
          fleets: [
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) },
            { fleetId: 2, originFleetId: 2, name: 'B', shipIds: [...ids(b), ids(a)[0]] },
          ],
        }),
        'ship_duplicated',
      ],
      [
        'a lost ship',
        (a) => ({ fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) }] }),
        'ship_missing',
      ],
      [
        'a ship from outside the sources',
        (a, b) => ({
          fleets: [
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b), 999] },
          ],
        }),
        'ship_unknown',
      ],
      [
        'the same fleet twice',
        (a, b) => ({
          fleets: [
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) },
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(b) },
          ],
        }),
        'duplicate_fleet',
      ],
      [
        'a new fleet with a foreign origin',
        (a, b) => ({
          fleets: [
            { fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) },
            { fleetId: null, originFleetId: 77, name: 'B', shipIds: ids(b) },
          ],
        }),
        'invalid_origin',
      ],
      ['no fleets', () => ({ fleets: [] }), 'no_fleets'],
    ];

    for (const [label, build, reason] of cases) {
      it(`rejects ${label}`, () => {
        const { a, b, fleets, snapshot } = setup();
        const plan: FleetOrganizationPlan = {
          factionId: 'player',
          sourceFleetIds: [1, 2],
          fleets: [],
          ...build(a, b),
        };
        const result = service.applyPlan({ fleets: fleets }, [], plan);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe(reason);
        expect(fleets).toEqual(snapshot);
      });
    }

    it('rejects fleets that are not on the same galaxy cell', () => {
      const { a, b, fleets } = setup();
      b.x = 11.01;
      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b)] }],
      });
      expect(result.reason).toBe('not_co_located');
      expect(b.destroyed).toBe(false);
    });

    it('rejects foreign and destroyed fleets', () => {
      const { a, b, fleets } = setup();
      b.factionId = 'enemy1';
      const plan: FleetOrganizationPlan = {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), ...ids(b)] }],
      };
      expect(service.applyPlan({ fleets: fleets }, [], plan).reason).toBe('wrong_faction');
      b.factionId = 'player';
      b.destroyed = true;
      expect(service.applyPlan({ fleets: fleets }, [], plan).reason).toBe('fleet_not_found');
    });
  });

  describe('reserve (ship stock at a Spaceport)', () => {
    const spaceportSystem = (
      factionId = 'player',
      buildings = [{ name: 'Spaceport' }],
    ): StarSystem =>
      ({
        id: 'sol',
        name: 'Sol',
        x: 10,
        y: 20,
        planets: 1,
        color: '#fff',
        planetsTiles: [{ id: 1, factionId, buildings }],
      }) as unknown as StarSystem;

    const stockOf = (entries: ShipStockEntry[]): FactionShipStock[] => [
      { factionId: 'player', ships: entries },
    ];
    const entry = (type: string): ShipStockEntry => ({ id: ++shipSeq, type, name: 'Ship' });

    it('draws stock ships into a fleet at full hull and returns fleet ships to the stock', () => {
      const damaged = ship('cruiser', { currentHp: 10 });
      const a = fleet(1, [ship('fighter'), damaged]);
      const s1 = entry('frigate');
      const s2 = entry('scout');
      const data = { fleets: [a], shipStock: stockOf([s1, s2]) };

      const result = service.applyPlan(data, [spaceportSystem()], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [a.ships[0].id, s1.id] }],
        reserveShipIds: [s2.id, damaged.id],
      });

      expect(result.ok).toBe(true);
      const joined = a.ships.find((x) => x.id === s1.id)!;
      expect(joined).toEqual({
        id: s1.id,
        type: 'frigate',
        name: 'Ship',
        currentHp: 130,
        destroyed: false,
      });
      // Remaining stock first (FIFO), returned ship appended as a plain stock entry.
      expect(data.shipStock[0].ships).toEqual([
        s2,
        { id: damaged.id, type: 'cruiser', name: 'Ship' },
      ]);
    });

    it('forms a new fleet purely from the reserve at the fleet position', () => {
      const a = fleet(1, [ship('fighter')]);
      const s1 = entry('frigate');
      const data = { fleets: [a], shipStock: stockOf([s1]) };

      const result = service.applyPlan(data, [spaceportSystem()], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [
          { fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) },
          { fleetId: null, originFleetId: 1, name: 'Fresh', shipIds: [s1.id] },
        ],
        reserveShipIds: [],
      });

      expect(result.ok).toBe(true);
      expect(result.created[0].ships.map((x) => x.id)).toEqual([s1.id]);
      expect([result.created[0].x, result.created[0].y]).toEqual([a.x, a.y]);
      expect(data.shipStock[0].ships).toEqual([]);
    });

    it('may return every ship to the reserve, retiring all fleets', () => {
      const a = fleet(1, [ship('fighter')]);
      const data = { fleets: [a], shipStock: stockOf([]) };
      const result = service.applyPlan(data, [spaceportSystem()], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [],
        reserveShipIds: ids(a),
      });
      expect(result.ok).toBe(true);
      expect(result.fleets).toEqual([]);
      expect(a.destroyed).toBe(true);
      expect(data.shipStock[0].ships.length).toBe(1);
    });

    it('rejects the reserve away from an own Spaceport and changes nothing', () => {
      for (const systems of [
        [],
        [spaceportSystem('enemy1')],
        [spaceportSystem('player', [])],
        [{ ...spaceportSystem(), x: 11 }],
      ]) {
        const a = fleet(1, [ship('fighter')]);
        const s1 = entry('frigate');
        const data = { fleets: [a], shipStock: stockOf([s1]) };
        const snapshot = structuredClone(data);
        const result = service.applyPlan(data, systems as StarSystem[], {
          factionId: 'player',
          sourceFleetIds: [1],
          fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), s1.id] }],
          reserveShipIds: [],
        });
        expect(result.reason).toBe('not_at_spaceport');
        expect(data).toEqual(snapshot);
      }
    });

    it('requires every stock ship to be accounted for', () => {
      const a = fleet(1, [ship('fighter')]);
      const s1 = entry('frigate');
      const data = { fleets: [a], shipStock: stockOf([s1]) };
      const result = service.applyPlan(data, [spaceportSystem()], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: ids(a) }],
        reserveShipIds: [],
      });
      expect(result.reason).toBe('ship_missing');
      expect(data.shipStock[0].ships).toEqual([s1]);
    });

    it('never touches the stock when the plan has no reserve', () => {
      const a = fleet(1, [ship('fighter'), ship('fighter')]);
      const s1 = entry('frigate');
      const data = { fleets: [a], shipStock: stockOf([s1]) };
      const result = service.applyPlan(data, [spaceportSystem()], {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [a.ships[0].id] }],
      });
      expect(result.reason).toBe('ship_missing');
      expect(
        service.applyPlan(data, [spaceportSystem()], {
          factionId: 'player',
          sourceFleetIds: [1],
          fleets: [{ fleetId: 1, originFleetId: 1, name: 'A', shipIds: [...ids(a), s1.id] }],
        }).reason,
      ).toBe('ship_unknown');
    });
  });

  describe('save compatibility', () => {
    const PLAYER = {
      id: 'player',
      name: 'Player',
      color: '#8cc4ff',
      team: 1,
      currencies: {},
    } as Faction;

    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('produces fleets that pass save validation and survive a save/load round trip', () => {
      const s = [
        ship('fighter'),
        ship('fighter'),
        ship('cruiser'),
        ship('scout', { destroyed: true }),
      ];
      const a = fleet(1, s.slice(0, 2));
      const b = fleet(2, s.slice(2));
      const fleets = [a, b];
      const result = service.applyPlan({ fleets: fleets }, [], {
        factionId: 'player',
        sourceFleetIds: [1, 2],
        fleets: [
          { fleetId: null, originFleetId: 2, name: 'Vanguard', shipIds: [s[0].id, s[2].id] },
          { fleetId: null, originFleetId: 1, name: 'Reserve', shipIds: [s[1].id] },
        ],
      });
      expect(result.ok).toBe(true);

      const data: StarMapData = {
        factions: [PLAYER],
        map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
        starSystems: [
          {
            id: 'sol',
            name: 'Sol',
            x: 10,
            y: 20,
            planets: 0,
            color: '#fff',
            planetsTiles: [],
            explored: true,
          },
        ],
        fleets,
      };
      const validation = validateSaveData(data);
      expect(validation.errors).toEqual([]);
      expect(validation.warnings.filter((w) => w.code === 'ship_id_duplicate')).toEqual([]);

      const saves = new SaveGameService();
      saves.saveToSlot(0, data);
      const loaded = saves.loadFromSlot(0)!;
      const byName = (name: string) => loaded.fleets.find((f) => f.name === name)!;

      expect(byName('Vanguard').ships.map((x) => x.id)).toEqual([s[0].id, s[2].id]);
      expect(byName('Reserve').ships.map((x) => x.id)).toEqual([s[1].id]);
      expect(byName('Vanguard').system?.id).toBe('sol');
      expect(loaded.fleets.filter((f) => f.destroyed).map((f) => f.id)).toEqual([1, 2]);
      expect(ownership(loaded.fleets).size).toBe(3);
    });
  });
});

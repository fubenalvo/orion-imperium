import { TestBed } from '@angular/core/testing';
import { Fleet, FleetShip } from '../star-map.models';
import { FleetOrganizationService } from '../../../services/fleet-organization.service';
import { FleetOrganizationDraft, RESERVE_KEY } from './fleet-organization-draft';

let shipSeq = 0;
const ships = (type: string, n: number, extra: Partial<FleetShip> = {}): FleetShip[] =>
  Array.from({ length: n }, () => ({ id: ++shipSeq, name: 'Ship', type, currentHp: 50, ...extra }));

const fleet = (id: number, list: FleetShip[]): Fleet => ({
  id,
  name: `Fleet ${id}`,
  factionId: 'player',
  x: 3.5,
  y: 3.5,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  ships: list,
});

describe('FleetOrganizationDraft', () => {
  beforeEach(() => (shipSeq = 0));

  it('starts with one draft fleet per source fleet, living ships only', () => {
    const a = fleet(1, [...ships('fighter', 2), ...ships('cruiser', 1, { destroyed: true })]);
    const draft = new FleetOrganizationDraft([a]);
    expect(draft.fleets.map((f) => f.ships.length)).toEqual([2]);
    expect(draft.isDirty).toBe(false);
  });

  it('groups ships by class with counts and hull condition, heaviest first', () => {
    const a = fleet(1, [...ships('fighter', 3), ...ships('cruiser', 2, { currentHp: 105 })]);
    const draft = new FleetOrganizationDraft([a]);
    const groups = draft.groups(draft.fleets[0]);
    expect(groups.map((g) => [g.typeId, g.ships.length])).toEqual([
      ['cruiser', 2],
      ['fighter', 3],
    ]);
    expect(groups[1].condition).toBeCloseTo(1); // fighter: 50 / 50 hp
    expect(groups[0].condition).toBeLessThan(1);
  });

  it('transfers part of a class between fleets', () => {
    const draft = new FleetOrganizationDraft([
      fleet(1, ships('fighter', 5)),
      fleet(2, ships('cruiser', 1)),
    ]);
    const target = draft.transfer('f1', { fighter: 3 }, 'f2');
    expect(target?.key).toBe('f2');
    expect(draft.find('f1')!.ships.length).toBe(2);
    expect(draft.find('f2')!.ships.map((s) => s.type)).toEqual([
      'cruiser',
      'fighter',
      'fighter',
      'fighter',
    ]);
    expect(draft.summary.movedShips).toBe(3);
  });

  it('removes a fleet as soon as its last ship leaves', () => {
    const draft = new FleetOrganizationDraft([
      fleet(1, ships('fighter', 1)),
      fleet(2, ships('scout', 1)),
    ]);
    draft.transferAll('f1', 'f2');
    expect(draft.fleets.map((f) => f.key)).toEqual(['f2']);
    expect(draft.summary.dissolvedFleets).toEqual([{ fleetId: 1, name: 'Fleet 1' }]);
  });

  it('forms new fleets with unique suggested names', () => {
    const draft = new FleetOrganizationDraft([fleet(1, ships('fighter', 4))], ['1st Fleet']);
    draft.transfer('f1', { fighter: 1 }, 'new');
    draft.transfer('f1', { fighter: 1 }, 'new');
    expect(draft.fleets.map((f) => f.name)).toEqual(['Fleet 1', '2nd Fleet', '3rd Fleet']);
    expect(draft.fleets.slice(1).every((f) => f.fleetId === null && f.originFleetId === 1)).toBe(
      true,
    );
  });

  it('refuses to turn a whole fleet into a new one (no-op)', () => {
    const draft = new FleetOrganizationDraft([fleet(1, ships('fighter', 2))]);
    expect(draft.transfer('f1', { fighter: 2 }, 'new')).toBeNull();
    expect(draft.fleets.length).toBe(1);
  });

  it('clamps requested counts to what the fleet holds', () => {
    const draft = new FleetOrganizationDraft([
      fleet(1, ships('fighter', 2)),
      fleet(2, ships('scout', 1)),
    ]);
    draft.transfer('f1', { fighter: 99, cruiser: 4 }, 'f2');
    expect(draft.find('f2')!.ships.length).toBe(3);
    expect(draft.find('f1')).toBeUndefined();
  });

  it('gathers every fleet into one', () => {
    const draft = new FleetOrganizationDraft([1, 2, 3].map((id) => fleet(id, ships('fighter', 2))));
    draft.gatherInto('f2');
    expect(draft.fleets.map((f) => [f.key, f.ships.length])).toEqual([['f2', 6]]);
  });

  it('splits by class and in half', () => {
    const draft = new FleetOrganizationDraft([
      fleet(1, [...ships('fighter', 4), ...ships('cruiser', 3), ...ships('scout', 1)]),
    ]);
    draft.splitInHalf('f1');
    expect(draft.fleets.map((f) => f.ships.length)).toEqual([5, 3]); // 2+2+1 stay, 2+1 leave

    draft.splitByClass('f1');
    expect(
      draft.fleets.map((f) =>
        draft
          .groups(f)
          .map((g) => g.typeId)
          .join(),
      ),
    ).toEqual(['cruiser', 'cruiser,fighter', 'fighter', 'scout']);
  });

  it('halves a fleet of single ships by class', () => {
    const draft = new FleetOrganizationDraft([
      fleet(1, [...ships('cruiser', 1), ...ships('fighter', 1)]),
    ]);
    draft.splitInHalf('f1');
    expect(draft.fleets.map((f) => f.ships.map((s) => s.type))).toEqual([['cruiser'], ['fighter']]);
  });

  it('tracks renames and blank names; reset restores the original layout', () => {
    const draft = new FleetOrganizationDraft([fleet(1, ships('fighter', 2))]);
    draft.rename('f1', '  ');
    expect(draft.hasBlankNames).toBe(true);
    draft.rename('f1', 'Home Guard');
    expect(draft.summary.renamedFleets).toBe(1);
    draft.transfer('f1', { fighter: 1 }, 'new');
    draft.reset();
    expect(draft.fleets.map((f) => [f.name, f.ships.length])).toEqual([['Fleet 1', 2]]);
    expect(draft.isDirty).toBe(false);
  });

  it('produces a plan the service applies with every ship accounted for', () => {
    const a = fleet(1, [...ships('fighter', 3), ...ships('cruiser', 2)]);
    const b = fleet(2, ships('scout', 2));
    const c = fleet(3, ships('frigate', 1));
    const fleets = [a, b, c];
    const draft = new FleetOrganizationDraft(fleets);
    draft.transferAll('f3', 'f1'); // merge c into a
    draft.transfer('f1', { fighter: 2 }, 'f2'); // redistribute
    draft.transfer('f2', { scout: 1 }, 'new'); // split

    const result = TestBed.inject(FleetOrganizationService).applyPlan(
      { fleets },
      [],
      draft.toPlan('player'),
    );

    expect(result.ok).toBe(true);
    expect(a.ships.map((s) => s.type).sort()).toEqual(['cruiser', 'cruiser', 'fighter', 'frigate']);
    expect(b.ships.map((s) => s.type).sort()).toEqual(['fighter', 'fighter', 'scout']);
    expect(result.created[0].ships.map((s) => s.type)).toEqual(['scout']);
    expect(c.destroyed).toBe(true);
    const living = fleets.filter((f) => !f.destroyed).flatMap((f) => f.ships.map((s) => s.id));
    expect(new Set(living).size).toBe(8);
    expect(living.length).toBe(8);
  });

  describe('reserve', () => {
    const stock = (type: string, n: number) =>
      Array.from({ length: n }, () => ({ id: ++shipSeq, type, name: 'Ship' }));

    it('exists only when the host passes the stock, and is never dropped when empty', () => {
      expect(new FleetOrganizationDraft([fleet(1, ships('fighter', 1))]).reserve).toBeNull();
      const draft = new FleetOrganizationDraft(
        [fleet(1, ships('fighter', 1))],
        [],
        stock('frigate', 1),
      );
      draft.transferAll(RESERVE_KEY, 'f1');
      expect(draft.reserve?.ships).toEqual([]);
      expect(draft.find(RESERVE_KEY)).toBe(draft.reserve);
    });

    it('moves ships both ways and counts them in the summary', () => {
      const draft = new FleetOrganizationDraft(
        [fleet(1, ships('fighter', 3))],
        [],
        stock('frigate', 2),
      );
      draft.transfer(RESERVE_KEY, { frigate: 1 }, 'f1');
      draft.transfer('f1', { fighter: 2 }, RESERVE_KEY);
      expect(draft.summary).toMatchObject({ fromReserve: 1, toReserve: 2, movedShips: 3 });
      const plan = draft.toPlan('player');
      expect(plan.fleets[0].shipIds.length).toBe(2);
      expect(plan.reserveShipIds?.length).toBe(3);
    });

    it('may empty the reserve into a new fleet placed at the first fleet', () => {
      const draft = new FleetOrganizationDraft(
        [fleet(7, ships('fighter', 1))],
        [],
        stock('frigate', 2),
      );
      const created = draft.transferAll(RESERVE_KEY, 'new');
      expect(created?.originFleetId).toBe(7);
      expect(created?.ships.length).toBe(2);
    });

    it('allows returning every fleet to the reserve', () => {
      const draft = new FleetOrganizationDraft([fleet(1, ships('fighter', 2))], [], []);
      draft.transferAll('f1', RESERVE_KEY);
      expect(draft.fleets).toEqual([]);
      expect(draft.toPlan('player')).toMatchObject({ fleets: [], reserveShipIds: [1, 2] });
    });

    it('omits reserveShipIds from plans without a reserve', () => {
      const draft = new FleetOrganizationDraft([fleet(1, ships('fighter', 2))]);
      expect('reserveShipIds' in draft.toPlan('player')).toBe(false);
    });
  });
});

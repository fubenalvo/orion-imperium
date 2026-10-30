import { Fleet, FleetShip, ShipStockEntry } from '../star-map.models';
import {
  FleetOrganizationPlan,
  livingShips,
  normalizeFleetName,
} from '../../../services/fleet-organization.service';
import { getShipTypeById } from '../star-map-display.util';

/*
 * Editable, in-memory draft of a fleet reorganization (docs/fleet-organization.md).
 *
 * The fleet manager dialog mutates only this draft; live fleets change only
 * when the finished draft is turned into a plan (`toPlan`) and applied by
 * FleetOrganizationService. Cancel simply drops the draft.
 *
 * Draft invariants (kept by every operation, relied on by `toPlan`):
 * - every living ship of the source fleets is in exactly one draft fleet;
 * - no draft fleet is empty: a fleet that loses its last ship is removed at
 *   once (an existing fleet is then retired on apply);
 * - an existing fleet id appears at most once.
 *
 * Ship records are the live `FleetShip` objects (never copied or mutated
 * here), so the plan refers to them by id.
 *
 * Reserve: when the fleets stand at an own Spaceport the host passes the
 * faction's stock, which becomes the `reserve` pseudo-fleet (key
 * RESERVE_KEY). It is never removed when empty, never renamed and never
 * part of `fleets`; its ships are display copies of the stock entries.
 */

export const RESERVE_KEY = 'reserve';

export interface DraftFleet {
  /* Stable UI key: `f<id>` for existing fleets, `n<seq>` for new ones. */
  key: string;
  fleetId: number | null;
  /* Source fleet whose position a new fleet takes (its own id if existing). */
  originFleetId: number;
  name: string;
  ships: FleetShip[];
}

export interface ShipClassGroup {
  typeId: string;
  typeName: string;
  role: string;
  ships: FleetShip[];
  /* Average hull condition of the group, 0..1. */
  condition: number;
}

/* `new` targets a fleet that does not exist yet (formed by the transfer). */
export type TransferTarget = string | 'new';

export interface DraftSummary {
  /* Ships that end up somewhere other than where they started (reserve included). */
  movedShips: number;
  fromReserve: number;
  toReserve: number;
  createdFleets: number;
  dissolvedFleets: { fleetId: number; name: string }[];
  renamedFleets: number;
}

export class FleetOrganizationDraft {
  fleets: DraftFleet[] = [];
  reserve: DraftFleet | null = null;
  private newSeq = 0;
  /* Ship id → draft key of its starting place (`f<id>` or RESERVE_KEY). */
  private readonly originalShipOwner = new Map<number, string>();
  private readonly reserveShips: FleetShip[] | null;
  private readonly originalNames = new Map<number, string>();
  private readonly sourceFleets: Fleet[];

  /*
   * `reservedNames` are names of the faction's other fleets (not part of
   * the draft) so suggested names stay unique across the empire.
   */
  constructor(
    sourceFleets: Fleet[],
    private readonly reservedNames: string[] = [],
    reserveEntries: ShipStockEntry[] | null = null,
  ) {
    this.sourceFleets = sourceFleets;
    for (const fleet of sourceFleets) {
      this.originalNames.set(fleet.id, fleet.name);
      for (const ship of livingShips(fleet)) {
        this.originalShipOwner.set(ship.id, `f${fleet.id}`);
      }
    }
    this.reserveShips = reserveEntries
      ? reserveEntries.map((e) => ({ id: e.id, type: e.type, name: e.name }))
      : null;
    for (const ship of this.reserveShips ?? []) {
      this.originalShipOwner.set(ship.id, RESERVE_KEY);
    }
    this.reset();
  }

  get hasReserve(): boolean {
    return this.reserve !== null;
  }

  reset(): void {
    this.newSeq = 0;
    this.fleets = this.sourceFleets.map((fleet) => ({
      key: `f${fleet.id}`,
      fleetId: fleet.id,
      originFleetId: fleet.id,
      name: fleet.name,
      ships: livingShips(fleet),
    }));
    this.reserve = this.reserveShips
      ? {
          key: RESERVE_KEY,
          fleetId: null,
          originFleetId: this.sourceFleets[0]?.id ?? 0,
          name: 'Reserve',
          ships: [...this.reserveShips],
        }
      : null;
  }

  get totalShips(): number {
    return this.fleets.reduce((n, f) => n + f.ships.length, 0);
  }

  find(key: string): DraftFleet | undefined {
    if (key === RESERVE_KEY) {
      return this.reserve ?? undefined;
    }
    return this.fleets.find((f) => f.key === key);
  }

  /* Ships grouped by class, heaviest classes first. */
  groups(fleet: DraftFleet): ShipClassGroup[] {
    const byType = new Map<string, FleetShip[]>();
    for (const ship of fleet.ships) {
      const list = byType.get(ship.type);
      if (list) {
        list.push(ship);
      } else {
        byType.set(ship.type, [ship]);
      }
    }
    const groups: ShipClassGroup[] = [];
    for (const [typeId, ships] of byType) {
      const type = getShipTypeById(typeId);
      const maxHp = type?.hitPoints ?? 0;
      const condition =
        maxHp > 0
          ? ships.reduce(
              (sum, s) => sum + Math.min(1, Math.max(0, (s.currentHp ?? maxHp) / maxHp)),
              0,
            ) / ships.length
          : 1;
      groups.push({
        typeId,
        typeName: type?.name ?? typeId,
        role: type?.role ?? '',
        ships,
        condition,
      });
    }
    return groups.sort((a, b) => classRank(b.typeId) - classRank(a.typeId));
  }

  /*
   * Moves `counts[typeId]` ships of each class from one fleet to another
   * (or into a new fleet). Counts are clamped to what the source holds.
   * Returns the receiving fleet, or null when nothing moved — including a
   * "new fleet" made of an entire source fleet, which would only replace
   * a fleet with an identical one. The reserve is exempt: a new fleet may
   * take every reserve ship, since the reserve itself stays.
   */
  transfer(fromKey: string, counts: Record<string, number>, to: TransferTarget): DraftFleet | null {
    const source = this.find(fromKey);
    if (!source || to === fromKey) {
      return null;
    }
    const moving: FleetShip[] = [];
    for (const [typeId, requested] of Object.entries(counts)) {
      const n = Math.max(0, Math.floor(requested));
      if (n === 0) {
        continue;
      }
      moving.push(...source.ships.filter((s) => s.type === typeId).slice(0, n));
    }
    if (moving.length === 0) {
      return null;
    }
    if (to === 'new' && moving.length === source.ships.length && source.key !== RESERVE_KEY) {
      return null;
    }

    let target: DraftFleet | undefined;
    if (to === 'new') {
      target = this.createFleet(source.key === RESERVE_KEY ? this.anchorId : source.originFleetId);
    } else {
      target = this.find(to);
      if (!target) {
        return null;
      }
    }

    const movingIds = new Set(moving.map((s) => s.id));
    source.ships = source.ships.filter((s) => !movingIds.has(s.id));
    target.ships = [...target.ships, ...moving];
    this.dropEmpty();
    return target;
  }

  transferAll(fromKey: string, to: TransferTarget): DraftFleet | null {
    const source = this.find(fromKey);
    return source ? this.transfer(fromKey, this.countsOf(source), to) : null;
  }

  /* Every other fleet's ships join `intoKey`; the others are dissolved. */
  gatherInto(intoKey: string): void {
    if (!this.find(intoKey)) {
      return;
    }
    for (const fleet of [...this.fleets]) {
      if (fleet.key !== intoKey) {
        this.transferAll(fleet.key, intoKey);
      }
    }
  }

  /* One fleet per ship class; the first (heaviest) class stays in place. */
  splitByClass(key: string): void {
    const fleet = this.find(key);
    if (!fleet) {
      return;
    }
    for (const group of this.groups(fleet).slice(1)) {
      this.transfer(key, { [group.typeId]: group.ships.length }, 'new');
    }
  }

  /* Detaches half of every class (rounded down) into one new fleet. */
  splitInHalf(key: string): void {
    const fleet = this.find(key);
    if (!fleet || fleet.ships.length < 2) {
      return;
    }
    const counts: Record<string, number> = {};
    for (const group of this.groups(fleet)) {
      counts[group.typeId] = Math.floor(group.ships.length / 2);
    }
    // A fleet of single ships per class would detach nothing; take the
    // lighter half of its classes instead.
    if (Object.values(counts).every((n) => n === 0)) {
      const groups = this.groups(fleet);
      for (const group of groups.slice(Math.ceil(groups.length / 2))) {
        counts[group.typeId] = group.ships.length;
      }
    }
    this.transfer(key, counts, 'new');
  }

  rename(key: string, name: string): void {
    const fleet = this.find(key);
    if (fleet) {
      fleet.name = name;
    }
  }

  countsOf(fleet: DraftFleet): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const ship of fleet.ships) {
      counts[ship.type] = (counts[ship.type] ?? 0) + 1;
    }
    return counts;
  }

  /* Draft fleets whose name is blank after trimming; apply is blocked. */
  get hasBlankNames(): boolean {
    return this.fleets.some((f) => f.name.trim().length === 0);
  }

  get summary(): DraftSummary {
    let movedShips = 0;
    let fromReserve = 0;
    let toReserve = 0;
    for (const fleet of this.fleets) {
      for (const ship of fleet.ships) {
        const from = this.originalShipOwner.get(ship.id);
        if (fleet.fleetId === null || from !== fleet.key) {
          movedShips++;
        }
        if (from === RESERVE_KEY) {
          fromReserve++;
        }
      }
    }
    for (const ship of this.reserve?.ships ?? []) {
      if (this.originalShipOwner.get(ship.id) !== RESERVE_KEY) {
        movedShips++;
        toReserve++;
      }
    }
    const kept = new Set(this.fleets.map((f) => f.fleetId));
    const dissolvedFleets = this.sourceFleets
      .filter((f) => !kept.has(f.id))
      .map((f) => ({ fleetId: f.id, name: f.name }));
    const renamedFleets = this.fleets.filter(
      (f) => f.fleetId !== null && f.name.trim() !== this.originalNames.get(f.fleetId),
    ).length;
    return {
      movedShips,
      fromReserve,
      toReserve,
      createdFleets: this.fleets.filter((f) => f.fleetId === null).length,
      dissolvedFleets,
      renamedFleets,
    };
  }

  get isDirty(): boolean {
    const s = this.summary;
    return (
      s.movedShips > 0 || s.createdFleets > 0 || s.dissolvedFleets.length > 0 || s.renamedFleets > 0
    );
  }

  toPlan(factionId: string): FleetOrganizationPlan {
    return {
      factionId,
      sourceFleetIds: this.sourceFleets.map((f) => f.id),
      fleets: this.fleets.map((f) => ({
        fleetId: f.fleetId,
        originFleetId: f.originFleetId,
        name: normalizeFleetName(
          f.name,
          f.fleetId !== null ? (this.originalNames.get(f.fleetId) ?? '') : 'New Fleet',
        ),
        shipIds: f.ships.map((s) => s.id),
      })),
      ...(this.reserve ? { reserveShipIds: this.reserve.ships.map((s) => s.id) } : {}),
    };
  }

  /* New fleets formed from the reserve take the first source fleet's position. */
  private get anchorId(): number {
    return this.sourceFleets[0]?.id ?? 0;
  }

  private createFleet(originFleetId: number): DraftFleet {
    const fleet: DraftFleet = {
      key: `n${++this.newSeq}`,
      fleetId: null,
      originFleetId,
      name: this.suggestName(),
      ships: [],
    };
    this.fleets.push(fleet);
    return fleet;
  }

  private dropEmpty(): void {
    this.fleets = this.fleets.filter((f) => f.ships.length > 0);
  }

  /* Same naming scheme as the spaceport ("1st Fleet", "2nd Fleet", ...). */
  private suggestName(): string {
    const used = new Set([...this.reservedNames, ...this.fleets.map((f) => f.name)]);
    for (let i = 1; i < 1000; i++) {
      const name = `${i}${ordinalSuffix(i)} Fleet`;
      if (!used.has(name)) {
        return name;
      }
    }
    return 'New Fleet';
  }
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/* Rough hull class weight used only for display ordering. */
function classRank(typeId: string): number {
  const type = getShipTypeById(typeId);
  return type ? type.hitPoints + type.attack * 4 : 0;
}

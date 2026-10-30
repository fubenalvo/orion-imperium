import { Injectable } from '@angular/core';
import {
  FactionShipStock,
  Fleet,
  FleetShip,
  ShipStockEntry,
  StarSystem,
} from '../components/star-map/star-map.models';
import { ShipService } from './ship.service';
import { ShipStockService } from './ship-stock.service';
import { SpaceportService } from './spaceport.service';

/*
 * =========================================================
 * FLEET ORGANIZATION SERVICE — merge, split, redistribute
 * =========================================================
 *
 * Applies a complete fleet-composition plan for a group of co-located
 * fleets of one faction in a single atomic step (see
 * docs/fleet-organization.md). The UI edits a draft and hands the final
 * plan over; nothing touches live data until `applyPlan` has validated the
 * whole plan, so a rejected plan leaves every fleet exactly as it was.
 *
 * Model rules this service relies on (no parallel fleet system):
 * - Ships are per-instance `FleetShip` records; moving a ship moves the
 *   record object itself, so `currentHp` and every other field travel with
 *   it. Battle stacks are derived at battle time, so there is no stack data
 *   to maintain here.
 * - Co-location is the galaxy grid cell (`floor(x)`, `floor(y)`), the same
 *   rule battle detection and AI invasion merging use. Fleets inside one
 *   star system always share that cell.
 * - A fleet left without living ships is retired the way disband and AI
 *   merging retire fleets: `destroyed = true`, orders cleared, its wreck
 *   records (ships with `destroyed: true`) kept. Retired fleets stay in
 *   `fleets` so ids referenced elsewhere (AI goals, selection) resolve to a
 *   destroyed fleet instead of dangling.
 * - Wrecks never move between fleets; only living ships are planned.
 * - New fleets get an id greater than every existing fleet id (destroyed
 *   ones included, so ids are never reused) and inherit position, system
 *   location, speed and sensor floor from their origin fleet. They start
 *   idle: splitting never issues a movement order.
 * - Reserve: when the fleets stand in a system with one of the faction's
 *   Spaceports, a plan may also include the faction's global ship stock
 *   (`reserveShipIds`). Stock ships then move into fleets (at full hull, as
 *   in FleetAssemblyService) and fleet ships back into the stock (as
 *   `ShipStockEntry`, which stores no damage: docking repairs them, as
 *   disband always did). Away from a Spaceport the stock is untouchable.
 *
 * The service is faction-agnostic, but only the player's UI calls it; AI
 * fleets are organized by the AI pipeline (EnemyFleetService /
 * EnemyInvasionService).
 */

export interface FleetPlanEntry {
  /* Existing fleet id, or null for a fleet created by this plan. */
  fleetId: number | null;
  /*
   * Source fleet a new fleet was split from: it inherits that fleet's
   * position and movement stats. Must be one of the plan's source fleets.
   * Ignored for existing fleets.
   */
  originFleetId: number;
  name: string;
  /* Living ships this fleet holds after the plan is applied. */
  shipIds: number[];
}

export interface FleetOrganizationPlan {
  factionId: string;
  /*
   * Every fleet whose living ships are being redistributed. Never empty:
   * the first fleet also defines the location.
   */
  sourceFleetIds: number[];
  fleets: FleetPlanEntry[];
  /*
   * Present only when the faction's stock takes part (fleets at an own
   * Spaceport): the ids of every ship that is in the stock after the plan,
   * i.e. stock ships staying there plus fleet ships returned to it. With a
   * reserve, `fleets` may be empty (everything returned to the stock).
   */
  reserveShipIds?: number[];
}

export type FleetOrganizationFailure =
  | 'no_fleets'
  | 'fleet_not_found'
  | 'wrong_faction'
  | 'not_co_located'
  | 'fleet_not_in_sources'
  | 'duplicate_fleet'
  | 'invalid_origin'
  | 'empty_fleet'
  | 'ship_unknown'
  | 'ship_duplicated'
  | 'ship_missing'
  | 'not_at_spaceport';

export interface FleetOrganizationResult {
  ok: boolean;
  reason?: FleetOrganizationFailure;
  /* Fleets that exist after the plan, in plan order. */
  fleets: Fleet[];
  created: Fleet[];
  retired: Fleet[];
}

export const FLEET_NAME_MAX_LENGTH = 28;

const DEFAULT_FLEET_SPEED = 4;
const DEFAULT_FLEET_SENSOR_RANGE = 3;

export function fleetCell(fleet: Pick<Fleet, 'x' | 'y'>): { col: number; row: number } {
  return { col: Math.floor(fleet.x), row: Math.floor(fleet.y) };
}

export function areFleetsCoLocated(a: Pick<Fleet, 'x' | 'y'>, b: Pick<Fleet, 'x' | 'y'>): boolean {
  const ca = fleetCell(a);
  const cb = fleetCell(b);
  return ca.col === cb.col && ca.row === cb.row;
}

export function livingShips(fleet: Fleet): FleetShip[] {
  return (fleet.ships ?? []).filter((s) => !s.destroyed);
}

export function normalizeFleetName(name: string, fallback: string): string {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, FLEET_NAME_MAX_LENGTH);
  return trimmed || fallback;
}

type PoolShip = { from: 'fleet'; ship: FleetShip } | { from: 'stock'; entry: ShipStockEntry };

@Injectable({ providedIn: 'root' })
export class FleetOrganizationService {
  constructor(
    private shipService: ShipService,
    private shipStockService: ShipStockService,
    private spaceportService: SpaceportService,
  ) {}

  /* True when stock ships can be exchanged with fleets at this position. */
  canUseReserve(
    factionId: string,
    position: { x: number; y: number },
    starSystems: StarSystem[],
  ): boolean {
    return this.spaceportService.spaceportAt(factionId, position, starSystems) !== null;
  }

  /*
   * Fleets the given fleet can be organized with: same faction, active
   * (not destroyed, at least one living ship) and on the same galaxy cell.
   * The anchor comes first, the rest by id, so the UI order is stable.
   */
  getCoLocatedFleets(fleets: Fleet[], anchor: Fleet): Fleet[] {
    const others = fleets
      .filter(
        (f) =>
          f !== anchor &&
          f.id !== anchor.id &&
          f.factionId === anchor.factionId &&
          !f.destroyed &&
          livingShips(f).length > 0 &&
          areFleetsCoLocated(f, anchor),
      )
      .sort((a, b) => a.id - b.id);
    return [anchor, ...others];
  }

  applyPlan(
    data: { fleets: Fleet[]; shipStock?: FactionShipStock[] },
    starSystems: StarSystem[],
    plan: FleetOrganizationPlan,
  ): FleetOrganizationResult {
    const fleets = data.fleets;
    const fail = (reason: FleetOrganizationFailure): FleetOrganizationResult => ({
      ok: false,
      reason,
      fleets: [],
      created: [],
      retired: [],
    });

    const usesReserve = plan.reserveShipIds !== undefined;
    const sourceIds = [...new Set(plan.sourceFleetIds)];
    if (sourceIds.length === 0 || (plan.fleets.length === 0 && !usesReserve)) {
      return fail('no_fleets');
    }

    // ---- Validate sources -------------------------------------------------
    const sources = new Map<number, Fleet>();
    for (const id of sourceIds) {
      const fleet = fleets.find((f) => f.id === id);
      if (!fleet || fleet.destroyed) {
        return fail('fleet_not_found');
      }
      if (fleet.factionId !== plan.factionId) {
        return fail('wrong_faction');
      }
      sources.set(id, fleet);
    }
    const anchor = sources.get(sourceIds[0])!;
    for (const fleet of sources.values()) {
      if (!areFleetsCoLocated(fleet, anchor)) {
        return fail('not_co_located');
      }
    }
    if (usesReserve && !this.canUseReserve(plan.factionId, anchor, starSystems)) {
      return fail('not_at_spaceport');
    }

    // ---- Validate ship ownership: every pooled ship exactly once ----------
    const pool = new Map<number, PoolShip>();
    for (const fleet of sources.values()) {
      for (const ship of livingShips(fleet)) {
        pool.set(ship.id, { from: 'fleet', ship });
      }
    }
    const stock = usesReserve ? this.shipStockService.getStock(data, plan.factionId) : [];
    for (const entry of stock) {
      pool.set(entry.id, { from: 'stock', entry });
    }

    const assigned = new Set<number>();
    const claim = (shipId: number): FleetOrganizationFailure | null => {
      if (!pool.has(shipId)) {
        return 'ship_unknown';
      }
      if (assigned.has(shipId)) {
        return 'ship_duplicated';
      }
      assigned.add(shipId);
      return null;
    };
    const seenFleetIds = new Set<number>();
    for (const entry of plan.fleets) {
      if (entry.fleetId !== null) {
        if (!sources.has(entry.fleetId)) {
          return fail('fleet_not_in_sources');
        }
        if (seenFleetIds.has(entry.fleetId)) {
          return fail('duplicate_fleet');
        }
        seenFleetIds.add(entry.fleetId);
      } else if (!sources.has(entry.originFleetId)) {
        return fail('invalid_origin');
      }
      if (entry.shipIds.length === 0) {
        return fail('empty_fleet');
      }
      for (const shipId of entry.shipIds) {
        const problem = claim(shipId);
        if (problem) {
          return fail(problem);
        }
      }
    }
    for (const shipId of plan.reserveShipIds ?? []) {
      const problem = claim(shipId);
      if (problem) {
        return fail(problem);
      }
    }
    if (assigned.size !== pool.size) {
      return fail('ship_missing');
    }

    // ---- Apply (nothing below can fail) -----------------------------------
    // Origins are snapshotted first: an origin may itself be retired by
    // this plan (e.g. a fleet split completely into new fleets).
    const originSnapshot = new Map<number, Fleet>();
    for (const [id, fleet] of sources) {
      originSnapshot.set(id, { ...fleet, system: fleet.system ? { ...fleet.system } : null });
    }

    let nextId = fleets.reduce((max, f) => Math.max(max, f.id), 0) + 1;
    const resultFleets: Fleet[] = [];
    const created: Fleet[] = [];

    for (const entry of plan.fleets) {
      const ships = entry.shipIds.map((id) => this.toFleetShip(pool.get(id)!));
      if (entry.fleetId !== null) {
        const fleet = sources.get(entry.fleetId)!;
        const wrecks = (fleet.ships ?? []).filter((s) => s.destroyed);
        fleet.ships = [...ships, ...wrecks];
        fleet.name = normalizeFleetName(entry.name, fleet.name);
        resultFleets.push(fleet);
      } else {
        const origin = originSnapshot.get(entry.originFleetId)!;
        const fleet: Fleet = {
          id: nextId++,
          name: normalizeFleetName(entry.name, 'New Fleet'),
          factionId: plan.factionId,
          x: origin.x,
          y: origin.y,
          targetX: null,
          targetY: null,
          speed: origin.speed ?? DEFAULT_FLEET_SPEED,
          system: origin.system ? { ...origin.system, targetX: null, targetY: null } : null,
          gridCol: origin.gridCol,
          gridRow: origin.gridRow,
          ships,
          destroyed: false,
          sensorRange: origin.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE,
        };
        fleets.push(fleet);
        resultFleets.push(fleet);
        created.push(fleet);
      }
    }

    if (usesReserve) {
      // Remaining stock keeps its FIFO order; returned ships go to the back.
      const keep = new Set(plan.reserveShipIds);
      const staying = stock.filter((e) => keep.has(e.id));
      const returned: ShipStockEntry[] = [];
      for (const id of plan.reserveShipIds!) {
        const item = pool.get(id)!;
        if (item.from === 'fleet') {
          returned.push({ id: item.ship.id, type: item.ship.type, name: item.ship.name });
        }
      }
      stock.splice(0, stock.length, ...staying, ...returned);
    }

    const retired: Fleet[] = [];
    for (const [id, fleet] of sources) {
      if (seenFleetIds.has(id)) {
        continue;
      }
      fleet.ships = (fleet.ships ?? []).filter((s) => s.destroyed);
      fleet.destroyed = true;
      fleet.targetX = null;
      fleet.targetY = null;
      fleet.interceptAsteroidId = null;
      fleet.attackFleetId = null;
      if (fleet.system) {
        fleet.system.targetX = null;
        fleet.system.targetY = null;
      }
      retired.push(fleet);
    }

    return { ok: true, fleets: resultFleets, created, retired };
  }

  /* Fleet ships move as-is; stock ships enter at full hull (as in fleet assembly). */
  private toFleetShip(item: PoolShip): FleetShip {
    if (item.from === 'fleet') {
      return item.ship;
    }
    const { entry } = item;
    return {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      currentHp: this.shipService.getShipType(entry.type)?.hitPoints,
      destroyed: false,
    };
  }

  describeFailure(reason: FleetOrganizationFailure | undefined): string {
    switch (reason) {
      case 'not_co_located':
        return 'The fleets are no longer in the same sector.';
      case 'fleet_not_found':
        return 'One of the fleets no longer exists.';
      case 'empty_fleet':
        return 'Every fleet needs at least one ship.';
      case 'not_at_spaceport':
        return 'The reserve is only reachable at one of your Spaceports.';
      case 'ship_missing':
      case 'ship_unknown':
      case 'ship_duplicated':
        return 'The fleet roster changed. Reopen the organizer and try again.';
      default:
        return 'These fleet changes could not be applied.';
    }
  }
}

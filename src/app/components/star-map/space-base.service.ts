import { Injectable } from '@angular/core';
import { Faction, Fleet, SpaceBase, StarSystem } from './star-map.models';
import { TerritoryMap } from './territory';
import {
  BaseDeploymentCheck,
  OUTPOST_SHIP_TYPE,
  nameSpaceBase,
  validateBaseDeployment,
} from './space-base';

/*
 * =========================================================
 * SPACE BASE SERVICE
 * =========================================================
 *
 * Session registry of the live space bases (like DriftingAsteroidService
 * holds the live asteroids): StarMap.loadGame restores it from
 * StarMapData.spaceBases and serializeGameState writes it back. Every
 * change (deploy, destroy, restore) bumps `revision`, which
 * TerritoryService uses to know the territory must be rebuilt — territory
 * changes are event-driven, never recomputed per frame.
 *
 * The battle screen applies a base battle to the autosave snapshot, not to
 * this registry (removeBaseFromList); the reload after the battle restores
 * the registry from that snapshot.
 */
@Injectable({ providedIn: 'root' })
export class SpaceBaseService {
  private list: SpaceBase[] = [];
  private revisionCounter = 0;

  get bases(): readonly SpaceBase[] {
    return this.list;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  /* Replaces the registry with the saved bases (malformed entries dropped). */
  restore(saved: readonly SpaceBase[] | undefined): void {
    this.list = (saved ?? [])
      .filter((b) => b && Number.isFinite(b.id) && Number.isFinite(b.x) && Number.isFinite(b.y) && typeof b.factionId === 'string')
      .map((b) => ({ ...b, x: Math.floor(b.x), y: Math.floor(b.y) }));
    this.revisionCounter++;
  }

  serialize(): SpaceBase[] {
    return this.list.map((b) => ({ ...b }));
  }

  getBase(id: number): SpaceBase | undefined {
    return this.list.find((b) => b.id === id);
  }

  getBaseAtCell(col: number, row: number): SpaceBase | undefined {
    return this.list.find((b) => b.x === col && b.y === row);
  }

  basesOf(factionId: string): SpaceBase[] {
    return this.list.filter((b) => b.factionId === factionId);
  }

  check(fleet: Fleet, ctx: DeployContext): BaseDeploymentCheck {
    return validateBaseDeployment({ ...ctx, fleet, bases: this.list });
  }

  /*
   * Deploys a base from `fleet` (player DEPLOY BASE command or AI). Re-checks
   * the rules, consumes one outpost ship and retires a fleet left without
   * living ships, the way colonization does. Returns the new base, or the
   * failed check (nothing changed).
   */
  deploy(fleet: Fleet, ctx: DeployContext): { base: SpaceBase; fleetRetired: boolean } | { base: null; check: BaseDeploymentCheck } {
    const check = this.check(fleet, ctx);
    if (!check.ok) return { base: null, check };

    const index = fleet.ships.findIndex((s) => s.type === OUTPOST_SHIP_TYPE && !s.destroyed);
    fleet.ships.splice(index, 1);
    const base: SpaceBase = {
      id: this.list.reduce((max, b) => Math.max(max, b.id), 0) + 1,
      name: nameSpaceBase(check.col, check.row, ctx.starSystems, this.list),
      factionId: fleet.factionId,
      x: check.col,
      y: check.row,
    };
    this.list.push(base);
    this.revisionCounter++;

    const fleetRetired = !fleet.ships.some((s) => !s.destroyed);
    if (fleetRetired) {
      fleet.destroyed = true;
      fleet.targetX = null;
      fleet.targetY = null;
      fleet.interceptAsteroidId = null;
      fleet.attackFleetId = null;
    }
    return { base, fleetRetired };
  }

  /* Destroys a base (lost battle); its territory claim disappears with it. */
  destroy(id: number): boolean {
    const before = this.list.length;
    this.list = removeBaseFromList(this.list, id);
    if (this.list.length === before) return false;
    this.revisionCounter++;
    return true;
  }

  setShieldPool(id: number, value: number): void {
    const base = this.getBase(id);
    if (base) base.shieldPoolCurrent = value;
  }
}

export interface DeployContext {
  factions: readonly Faction[];
  starSystems: readonly StarSystem[];
  territory: TerritoryMap;
  width: number;
  height: number;
  isBlocked?: (x: number, y: number) => boolean;
}

export function removeBaseFromList(list: SpaceBase[], id: number): SpaceBase[] {
  return list.filter((b) => b.id !== id);
}

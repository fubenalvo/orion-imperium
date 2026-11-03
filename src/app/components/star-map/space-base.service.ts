import { Injectable } from '@angular/core';
import { Faction, Fleet, SpaceBase, StarSystem } from './star-map.models';
import { TerritoryMap } from './territory';
import {
  BaseDeploymentCheck,
  OUTPOST_SHIP_TYPE,
  nameSpaceBase,
  validateBaseDeployment,
} from './space-base';
import { StationDefenseState } from './station-defense';
import { DysonRingService } from './dyson-ring.service';
import { DysonRing } from './dyson-ring';
import { adjustOpinion, isTreatyPair } from './diplomacy';
import {
  AnchorDeploymentCheck,
  DYSON_ANCHOR_OPINION_PENALTY,
  DYSON_ANCHOR_SHIP_TYPE,
  DysonBonusId,
  dysonAnchorName,
  isDysonAnchor,
  isDysonBonusId,
  validateAnchorDeployment,
} from './dyson-anchor';
import { STATION_CONSTRUCTION_SECONDS, advanceStationConstruction, isStationComplete } from './station-construction';

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
 * A deployed base is a construction site for STATION_CONSTRUCTION_SECONDS
 * .spaceBase of game time (station-construction.ts). `bases` lists sites
 * too (they reserve their spot); `completeBases` is what territory, sensors
 * and upkeep read. Completion bumps `revision` like a deploy does.
 *
 * Dyson anchors (dyson-anchor.ts) are bases of kind 'dyson' in the same
 * list: deployAnchor / demolish / chooseBonus manage them, and every other
 * path (battles, save, sensors, construction) treats them as bases.
 *
 * The battle screen applies a base battle to the autosave snapshot, not to
 * this registry (removeBaseFromList); the reload after the battle restores
 * the registry from that snapshot.
 */
@Injectable({ providedIn: 'root' })
export class SpaceBaseService {
  private list: SpaceBase[] = [];
  private revisionCounter = 0;
  /* Anchors removed by DEMOLISH, so the Dyson news can tell them from destroyed ones. */
  private readonly demolishedIds = new Set<number>();

  constructor(private readonly dyson: DysonRingService) {}

  get bases(): readonly SpaceBase[] {
    return this.list;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  /* Finished bases: the only ones that claim territory, sense and pay upkeep. */
  get completeBases(): SpaceBase[] {
    return this.list.filter(isStationComplete);
  }

  /*
   * Replaces the registry with the saved bases. Malformed entries are dropped,
   * and so is a Dyson anchor without a valid slot or on a slot an earlier
   * anchor already holds (one anchor per slot); an unknown bonus is cleared.
   */
  restore(saved: readonly SpaceBase[] | undefined): void {
    const takenSlots = new Set<number>();
    this.list = (saved ?? [])
      .filter((b) => b && Number.isFinite(b.id) && Number.isFinite(b.x) && Number.isFinite(b.y) && typeof b.factionId === 'string')
      .filter((b) => {
        if (!isDysonAnchor(b)) return true;
        const slot = b.dysonSlot;
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 7 || takenSlots.has(slot)) return false;
        takenSlots.add(slot);
        return true;
      })
      .map((b) => {
        const base = { ...b, x: Math.floor(b.x), y: Math.floor(b.y) };
        if (base.dysonBonus !== undefined && !isDysonBonusId(base.dysonBonus)) delete base.dysonBonus;
        return base;
      });
    this.revisionCounter++;
  }

  /* Adds a base outside the outpost-ship deployment rules (the pirate haven, pirate-incursion.ts). */
  addBase(base: Omit<SpaceBase, 'id'>): SpaceBase {
    const created: SpaceBase = { ...base, id: this.list.reduce((max, b) => Math.max(max, b.id), 0) + 1, x: Math.floor(base.x), y: Math.floor(base.y) };
    this.list.push(created);
    this.revisionCounter++;
    return created;
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

  /* Every base of a faction, construction sites included. */
  basesOf(factionId: string): SpaceBase[] {
    return this.list.filter((b) => b.factionId === factionId);
  }

  /*
   * Advances every base under construction by `deltaSeconds` of game time
   * and returns the bases that completed in this step.
   */
  advanceConstruction(deltaSeconds: number): SpaceBase[] {
    const completed = this.list.filter((b) => advanceStationConstruction(b, deltaSeconds));
    if (completed.length > 0) this.revisionCounter++;
    return completed;
  }

  check(fleet: Fleet, ctx: DeployContext): BaseDeploymentCheck {
    // The current map's ring unless the caller passes its own (tests). Anchors
    // do not count for ordinary base spacing: they live only on the ring.
    return validateBaseDeployment({
      dysonRing: this.dyson.ring,
      ...ctx,
      fleet,
      bases: this.list.filter((b) => !isDysonAnchor(b)),
    });
  }

  /* The Dyson anchors in the registry (construction sites included). */
  get dysonAnchors(): SpaceBase[] {
    return this.list.filter(isDysonAnchor);
  }

  anchorOnSlot(slot: number): SpaceBase | undefined {
    return this.list.find((b) => isDysonAnchor(b) && b.dysonSlot === slot);
  }

  checkAnchor(fleet: Fleet, factions: readonly Faction[], ring?: DysonRing | null): AnchorDeploymentCheck {
    return validateAnchorDeployment({ fleet, factions, ring: ring === undefined ? this.dyson.ring : ring, bases: this.list });
  }

  /*
   * Deploys a Dyson anchor from `fleet` on the ring slot it stands on (player
   * DEPLOY ANCHOR or, later, the AI). Re-checks the rules, consumes one Swarm
   * Constructor, starts the anchor as a construction site and retires a
   * fleet left without living ships. Nothing changes when the check fails.
   */
  deployAnchor(
    fleet: Fleet,
    factions: readonly Faction[],
    ring?: DysonRing | null,
  ): { base: SpaceBase; fleetRetired: boolean } | { base: null; check: AnchorDeploymentCheck } {
    const check = this.checkAnchor(fleet, factions, ring);
    if (!check.ok) return { base: null, check };

    const index = fleet.ships.findIndex((s) => s.type === DYSON_ANCHOR_SHIP_TYPE && !s.destroyed);
    fleet.ships.splice(index, 1);
    const base: SpaceBase = {
      id: this.list.reduce((max, b) => Math.max(max, b.id), 0) + 1,
      name: dysonAnchorName(check.slot),
      factionId: fleet.factionId,
      x: check.col,
      y: check.row,
      kind: 'dyson',
      dysonSlot: check.slot,
      constructionRemaining: STATION_CONSTRUCTION_SECONDS.dysonAnchor,
    };
    this.list.push(base);
    this.revisionCounter++;
    // Every other empire resents the builder (dyson-anchor.ts, once per anchor).
    const builder = factions.find((f) => f.id === fleet.factionId);
    for (const other of factions) {
      if (builder && other !== builder && isTreatyPair(other, builder)) {
        adjustOpinion(other, builder, DYSON_ANCHOR_OPINION_PENALTY);
      }
    }
    return { base, fleetRetired: this.retireIfEmpty(fleet) };
  }

  /*
   * Picks the anchor's bonus. Only its owner may pick, and only once: the
   * choice is permanent (DEMOLISH and rebuild to change it).
   */
  chooseBonus(id: number, factionId: string, bonus: DysonBonusId): boolean {
    const base = this.getBase(id);
    if (!base || !isDysonAnchor(base) || base.factionId !== factionId || base.dysonBonus || !isDysonBonusId(bonus)) return false;
    base.dysonBonus = bonus;
    return true;
  }

  /*
   * Owner-only demolition of a Dyson anchor (built or under construction):
   * no refund, the slot is free for anyone again. Ordinary bases cannot be
   * demolished.
   */
  demolish(id: number, factionId: string): boolean {
    const base = this.getBase(id);
    if (!base || !isDysonAnchor(base) || base.factionId !== factionId) return false;
    this.demolishedIds.add(id);
    return this.destroy(id);
  }

  /* Was this (removed) anchor demolished rather than destroyed? Reads the mark once. */
  takeDemolished(id: number): boolean {
    return this.demolishedIds.delete(id);
  }

  /*
   * Deploys a base from `fleet` (player DEPLOY BASE command or AI). Re-checks
   * the rules, starts the base as a construction site, consumes one outpost ship and retires a fleet left without
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
      constructionRemaining: STATION_CONSTRUCTION_SECONDS.spaceBase,
    };
    this.list.push(base);
    this.revisionCounter++;
    return { base, fleetRetired: this.retireIfEmpty(fleet) };
  }

  /* Retires a fleet left without living ships (like colonization does). */
  private retireIfEmpty(fleet: Fleet): boolean {
    const retired = !fleet.ships.some((s) => !s.destroyed);
    if (retired) {
      fleet.destroyed = true;
      fleet.targetX = null;
      fleet.targetY = null;
      fleet.interceptAsteroidId = null;
      fleet.attackFleetId = null;
    }
    return retired;
  }

  /* Destroys a base (lost battle); its territory claim disappears with it. */
  destroy(id: number): boolean {
    const before = this.list.length;
    this.list = removeBaseFromList(this.list, id);
    if (this.list.length === before) return false;
    this.revisionCounter++;
    return true;
  }

  /* Shield pool and core hull a base keeps after a battle it survived. */
  setDefenseState(id: number, state: StationDefenseState): void {
    const base = this.getBase(id);
    if (base) Object.assign(base, state);
  }
}

export interface DeployContext {
  factions: readonly Faction[];
  starSystems: readonly StarSystem[];
  territory: TerritoryMap;
  width: number;
  height: number;
  isBlocked?: (x: number, y: number) => boolean;
  /* Defaults to the current map's ring (DysonRingService). */
  dysonRing?: DysonRing | null;
}

export function removeBaseFromList(list: SpaceBase[], id: number): SpaceBase[] {
  return list.filter((b) => b.id !== id);
}

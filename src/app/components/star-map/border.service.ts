import { Injectable } from '@angular/core';
import { ShipService } from '../../services/ship.service';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { TerritoryService } from './territory.service';
import { adjustOpinion, DIPLOMACY_TURN_SECONDS, getRelationKind, hasPassageRights, isTreatyPair } from './diplomacy';

/*
 * Border-violation tuning (docs/territory.md#border-violations).
 * "size" = fleet value / sizeValueScale clamped to [minSize, maxSize];
 * "repeat" = 1 + repeatStep × min(repeatMaxIncidents, owner's remembered
 * incidents with the intruder before this one).
 */
export const BORDER_CONFIG = {
  /* Game seconds between territory checks of all fleets. */
  checkInterval: 1,
  /* Owner's opinion change when a violation starts (× size × repeat). */
  incidentOpinion: -2,
  /* Owner's opinion change per diplomatic turn spent inside (× size × repeat). */
  opinionPerTurn: -3,
  sizeValueScale: 1000,
  minSize: 0.25,
  maxSize: 3,
  repeatStep: 0.5,
  repeatMaxIncidents: 4,
  /* Remembered incidents fade by this much per diplomatic turn. */
  incidentDecayPerTurn: 0.2,
} as const;

export interface BorderViolationEvent {
  ownerId: string;
  intruderId: string;
  fleetId: number;
  fleetName: string;
}

/*
 * =========================================================
 * BORDER SERVICE
 * =========================================================
 *
 * Detects fleets inside the territory of an empire their faction is at
 * PEACE with (and that has not granted passage) and turns that into a
 * diplomatic cost: the territory owner's opinion of the intruder drops on
 * entry and keeps dropping while the fleet stays, scaled by fleet value
 * and by how often the intruder did it before.
 *
 * A border violation is never a war declaration: this service only
 * changes opinion (and remembers incidents). At war there is no violation
 * (the fleets fight instead); allied and neutral factions never violate.
 * Player and AI fleets follow exactly the same rule; the AI can react
 * through its normal opinion-driven war and peace decisions.
 *
 * Runtime state (which fleet is currently inside whose territory) is not
 * saved. After a load the first check only re-registers fleets already
 * inside — they were counted before the save — so loading never creates
 * a new incident. The remembered incident count is persisted in
 * FactionRelation.borderIncidents.
 */
@Injectable({ providedIn: 'root' })
export class BorderService {
  private clock = 0;
  private seeded = false;
  /* fleet id → owner whose territory it is currently violating. */
  private readonly active = new Map<number, string>();
  private events: BorderViolationEvent[] = [];

  constructor(
    private readonly territory: TerritoryService,
    private readonly shipService: ShipService,
  ) {}

  reset(): void {
    this.clock = 0;
    this.seeded = false;
    this.active.clear();
    this.events = [];
  }

  drainEvents(): BorderViolationEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /* Owner whose territory the fleet is violating right now, if any. */
  violatedTerritoryOf(fleetId: number): string | null {
    return this.active.get(fleetId) ?? null;
  }

  /*
   * Would `fleet` violate a border at grid position (x, y)? Returns the
   * territory owner id. Shared by the tick and UI warnings.
   */
  violationAt(fleet: Fleet, x: number, y: number, starSystems: readonly StarSystem[], factions: readonly Faction[]): string | null {
    const ownerId = this.territory.get(starSystems, factions).ownerAtPoint(x, y);
    if (ownerId === null || ownerId === fleet.factionId) return null;
    const owner = factions.find((f) => f.id === ownerId);
    const intruder = factions.find((f) => f.id === fleet.factionId);
    if (!owner || !intruder || !isTreatyPair(owner, intruder)) return null;
    if (getRelationKind(owner, intruder) !== 'peace' || hasPassageRights(owner, intruder)) return null;
    return ownerId;
  }

  /* Returns true when an opinion or the violation set changed. */
  tick(deltaTime: number, ctx: { factions: Faction[]; fleets: Fleet[]; starSystems: StarSystem[] }): boolean {
    if (deltaTime <= 0) return false;
    this.clock += deltaTime;
    if (this.clock < BORDER_CONFIG.checkInterval) return false;
    const elapsed = this.clock;
    this.clock = 0;

    this.decayIncidents(ctx.factions, elapsed);

    let changed = false;
    const seen = new Set<number>();
    for (const fleet of ctx.fleets) {
      if (fleet.destroyed || !fleet.ships.some((s) => !s.destroyed)) continue;
      const ownerId = this.violationAt(fleet, fleet.x, fleet.y, ctx.starSystems, ctx.factions);
      if (ownerId === null) continue;
      seen.add(fleet.id);
      const owner = ctx.factions.find((f) => f.id === ownerId)!;
      const intruder = ctx.factions.find((f) => f.id === fleet.factionId)!;
      const scale = this.penaltyScale(fleet, owner, intruder);

      if (this.active.get(fleet.id) !== ownerId) {
        this.active.set(fleet.id, ownerId);
        changed = true;
        if (!this.seeded) continue;
        adjustOpinion(owner, intruder, BORDER_CONFIG.incidentOpinion * scale);
        const entry = owner.relations?.[intruder.id];
        if (entry) entry.borderIncidents = (entry.borderIncidents ?? 0) + 1;
        this.events.push({ ownerId, intruderId: intruder.id, fleetId: fleet.id, fleetName: fleet.name });
      } else {
        adjustOpinion(owner, intruder, (BORDER_CONFIG.opinionPerTurn * scale * elapsed) / DIPLOMACY_TURN_SECONDS);
        changed = true;
      }
    }
    for (const fleetId of [...this.active.keys()]) {
      if (!seen.has(fleetId)) {
        this.active.delete(fleetId);
        changed = true;
      }
    }
    this.seeded = true;
    return changed;
  }

  /* size × repeat (see BORDER_CONFIG). */
  penaltyScale(fleet: Fleet, owner: Faction, intruder: Faction): number {
    let value = 0;
    for (const ship of fleet.ships) {
      if (!ship.destroyed) value += this.shipService.getShipType(ship.type)?.cost ?? 0;
    }
    const size = Math.min(BORDER_CONFIG.maxSize, Math.max(BORDER_CONFIG.minSize, value / BORDER_CONFIG.sizeValueScale));
    const incidents = owner.relations?.[intruder.id]?.borderIncidents ?? 0;
    const repeat = 1 + BORDER_CONFIG.repeatStep * Math.min(BORDER_CONFIG.repeatMaxIncidents, incidents);
    return size * repeat;
  }

  private decayIncidents(factions: Faction[], elapsed: number): void {
    const decay = (BORDER_CONFIG.incidentDecayPerTurn * elapsed) / DIPLOMACY_TURN_SECONDS;
    for (const faction of factions) {
      for (const entry of Object.values(faction.relations ?? {})) {
        if (!entry.borderIncidents) continue;
        const next = entry.borderIncidents - decay;
        if (next > 0) entry.borderIncidents = next;
        else delete entry.borderIncidents;
      }
    }
  }
}

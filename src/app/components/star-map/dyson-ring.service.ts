import { Injectable } from '@angular/core';
import { SpecialObject } from './star-map.models';
import { buildDysonRing, DysonRing } from './dyson-ring';

/*
 * =========================================================
 * DYSON RING SERVICE
 * =========================================================
 *
 * Session holder of the current map's Dyson ring (dyson-ring.ts). The ring
 * is derived from the black hole special object and never saved:
 * StarMap.loadGame calls configure() with the loaded specialObjects (every
 * load, including the reload after a battle), and headless simulations call
 * it with their generated map. Until then — and on a map without a black
 * hole — `ring` is null and nothing Dyson-related applies.
 *
 * `revision` changes whenever the ring is configured, so TerritoryService
 * knows to rebuild the territory (event-driven, like the base registry).
 * Wedge owners come from the Dyson anchors in SpaceBaseService
 * (dysonWedgeOwners); TerritoryService combines the two.
 */
@Injectable({ providedIn: 'root' })
export class DysonRingService {
  private current: DysonRing | null = null;
  private revisionCounter = 0;

  get ring(): DysonRing | null {
    return this.current;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  configure(specialObjects: readonly SpecialObject[] | undefined): void {
    this.current = buildDysonRing(specialObjects);
    this.revisionCounter++;
  }
}

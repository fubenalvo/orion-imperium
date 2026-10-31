import { Injectable } from '@angular/core';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { Faction, StarSystem } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { StarMapMovementService } from './star-map-movement.service';
import { computeTerritory, TerritoryMap } from './territory';
import { getRelationKind } from './diplomacy';

/*
 * =========================================================
 * TERRITORY SERVICE
 * =========================================================
 *
 * Cached access to the derived territory (territory.ts). The map is
 * rebuilt only when one of its inputs changed:
 *  - PlanetOwnershipService.revision (every planet owner change goes
 *    through transferPlanet — invariant),
 *  - SpaceBaseService.revision (deploy, destroy, restore),
 *  - a different starSystems / factions array (load, new game, tests),
 *  - the grid size.
 * So territory changes are event-driven; nothing scans the map per frame.
 *
 * Code that writes PlanetTile.factionId directly (tests only) must call
 * invalidate().
 */
@Injectable({ providedIn: 'root' })
export class TerritoryService {
  private cached: TerritoryMap | null = null;
  private key: unknown[] = [];

  constructor(
    private readonly ownership: PlanetOwnershipService,
    private readonly bases: SpaceBaseService,
    private readonly movement: StarMapMovementService,
  ) {}

  get(starSystems: readonly StarSystem[], factions: readonly Faction[]): TerritoryMap {
    const width = this.movement.gridColumns;
    const height = this.movement.gridRows;
    const key = [starSystems, factions, this.ownership.revision, this.bases.revision, width, height];
    if (!this.cached || key.some((part, i) => part !== this.key[i])) {
      this.cached = computeTerritory(starSystems, this.bases.bases, factions, width, height);
      this.key = key;
    }
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }

  /*
   * Territory rule for colonization (player and AI): an uninhabited planet
   * cannot be colonized in a system lying in another empire's territory,
   * unless the colonizer is at war with that empire (then the space is
   * contested). Own and neutral space is always open.
   */
  canColonizeIn(colonizer: Faction | undefined, system: StarSystem, starSystems: readonly StarSystem[], factions: readonly Faction[]): boolean {
    if (!colonizer) return false;
    const ownerId = this.get(starSystems, factions).systemTerritoryOwner(system);
    if (ownerId === null || ownerId === colonizer.id) return true;
    const owner = factions.find((f) => f.id === ownerId);
    return !!owner && getRelationKind(colonizer, owner) === 'war';
  }
}

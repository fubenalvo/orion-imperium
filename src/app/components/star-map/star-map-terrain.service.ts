import { Injectable } from '@angular/core';
import { AsteroidBelt, Nebula, SpecialObject } from './star-map.models';
import { buildNavObstacles, NavBounds, NavGraph, NavObstacle } from './fleet-navigation';
import { beltObstacles } from './asteroid-belts';
import { NebulaField } from './nebula';

/*
 * =========================================================
 * STAR MAP TERRAIN SERVICE
 * =========================================================
 *
 * Session-wide, read-mostly view of the galaxy's static terrain: black
 * hole no-fly zones and asteroid belts (navigation obstacles, with one
 * cached visibility graph for routing) and nebulae. StarMap.loadGame
 * calls `configure` with the loaded save; the save data stays the source
 * of truth (`specialObjects` / `asteroidBelts` / `nebulae`), this service only
 * holds derived lookup structures.
 *
 * Consumers (all apply the same rules to the player and the AI):
 * - StarMapMovementService: routing around obstacles, nebula slowdown.
 * - StarMapSensorService / EnemyIntelService: nebula sensor penalty.
 * - DriftingAsteroidService: intercept estimates, asteroid trajectories.
 *
 * Until `configure` is called the terrain is empty, so services used in
 * isolation (unit tests, AI simulations) behave exactly as in open space.
 */
@Injectable({ providedIn: 'root' })
export class StarMapTerrainService {
  private obstacleList: NavObstacle[] = [];
  private graph = new NavGraph([]);
  private field = new NebulaField([], 0, 0);
  private mapBounds: NavBounds | undefined;

  configure(input: {
    specialObjects?: readonly SpecialObject[];
    nebulae?: readonly Nebula[];
    asteroidBelts?: readonly AsteroidBelt[];
    width: number;
    height: number;
  }): void {
    this.obstacleList = [
      ...buildNavObstacles(input.specialObjects),
      ...beltObstacles(input.asteroidBelts),
    ];
    this.field = new NebulaField(input.nebulae ?? [], input.width, input.height);
    this.mapBounds = { width: input.width, height: input.height };
    this.graph = new NavGraph(this.obstacleList, this.mapBounds);
  }

  reset(): void {
    this.obstacleList = [];
    this.field = new NebulaField([], 0, 0);
    this.mapBounds = undefined;
    this.graph = new NavGraph([]);
  }

  get obstacles(): readonly NavObstacle[] {
    return this.obstacleList;
  }

  /* Cached routing graph of the current obstacles (rebuilt only by configure/reset). */
  get navGraph(): NavGraph {
    return this.graph;
  }

  get nebulae(): readonly Nebula[] {
    return this.field.nebulae;
  }

  get nebulaField(): NebulaField {
    return this.field;
  }

  get bounds(): NavBounds | undefined {
    return this.mapBounds;
  }

  isPointInNebula(x: number, y: number): boolean {
    return this.field.isPointInNebula(x, y);
  }

  isCellInNebula(col: number, row: number): boolean {
    return this.field.isCellInNebula(col, row);
  }
}

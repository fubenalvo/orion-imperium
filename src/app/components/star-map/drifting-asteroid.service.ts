import { Injectable } from '@angular/core';
import {
  AsteroidEventState,
  AsteroidReward,
  DriftingAsteroid,
  Faction,
  Fleet,
} from './star-map.models';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';
import {
  ASTEROID_CONFIG,
  InterceptPlan,
  StatefulRng,
  asteroidPosition,
  createInitialAsteroidState,
  isWellFormedAsteroid,
  planAsteroidIntercept,
  spawnAsteroid,
} from './drifting-asteroids';

export interface AsteroidCollection {
  asteroid: DriftingAsteroid;
  fleetId: number;
  factionId: string;
  reward: AsteroidReward;
}

export interface AsteroidTickResult {
  /* True when asteroids moved, spawned, expired or were collected. */
  changed: boolean;
  collected: AsteroidCollection[];
  /* Player intercept orders dropped because the asteroid can no longer be reached. */
  failedIntercepts: { fleetId: number; asteroidId: number }[];
}

export type InterceptOrderResult =
  { ok: true; plan: InterceptPlan } | { ok: false; reason: 'gone' | 'unreachable' };

/*
 * =========================================================
 * DRIFTING ASTEROID SERVICE
 * =========================================================
 *
 * Owns the live drifting-asteroid event state for the session (the pure
 * rules live in drifting-asteroids.ts). StarMap restores it from the save
 * on every load (`restore`) and writes `serialize()` into every save, so
 * the active asteroids, their cargo, the spawn timer and the rng state
 * survive save/load; collected or expired asteroids are simply absent.
 *
 * `tick` is called from StarMap's game loop with the scaled game delta
 * (0 while paused → nothing moves or spawns). Per tick:
 *   1. spawn timer / spawn (bounded by ASTEROID_CONFIG.maxActive);
 *   2. advance asteroids, drop the ones that left the map;
 *   3. collection: the first qualifying fleet gets the reward, the asteroid
 *      is removed in the same step (exactly-once). StarMap autosaves right
 *      after a collection so a battle-return reload cannot restore it;
 *   4. steer fleets that carry a player intercept order
 *      (`Fleet.interceptAsteroidId`) toward the predicted meeting point.
 *
 * AI factions collect through the same proximity rule; their fleets are
 * steered by EnemyFleetService's salvage role (it owns AI fleet targets),
 * which uses `planIntercept` from here.
 */
@Injectable({ providedIn: 'root' })
export class DriftingAsteroidService {
  private state: AsteroidEventState = createInitialAsteroidState(0);
  // Seconds since each pursuing fleet was last re-aimed (transient).
  private readonly reaimClock = new Map<number, number>();

  constructor(
    private readonly movementService: StarMapMovementService,
    private readonly terrain: StarMapTerrainService,
  ) {}

  /*
   * Restores the event state from a save. A missing or malformed state
   * starts a fresh (deterministic) one; malformed asteroids are dropped.
   * Intercept orders that point at an asteroid that no longer exists are
   * cleared on the given fleets.
   */
  restore(saved: AsteroidEventState | undefined, seed: number, fleets: Fleet[] = []): void {
    const fresh = createInitialAsteroidState(seed);
    if (!saved || typeof saved !== 'object') {
      this.state = fresh;
    } else {
      const active = Array.isArray(saved.active)
        ? saved.active.filter(isWellFormedAsteroid).map((a) => structuredClone(a))
        : [];
      const maxId = active.reduce((max, a) => Math.max(max, a.id), 0);
      this.state = {
        nextId: Number.isInteger(saved.nextId) && saved.nextId > maxId ? saved.nextId : maxId + 1,
        spawnTimer: Number.isFinite(saved.spawnTimer)
          ? Math.max(0, saved.spawnTimer)
          : fresh.spawnTimer,
        rngState: Number.isFinite(saved.rngState) ? saved.rngState | 0 : fresh.rngState,
        active,
      };
    }
    this.reaimClock.clear();
    for (const fleet of fleets) {
      if (fleet.interceptAsteroidId != null && !this.getAsteroid(fleet.interceptAsteroidId)) {
        fleet.interceptAsteroidId = null;
      }
    }
  }

  serialize(): AsteroidEventState {
    return structuredClone(this.state);
  }

  get active(): readonly DriftingAsteroid[] {
    return this.state.active;
  }

  getAsteroid(id: number): DriftingAsteroid | undefined {
    return this.state.active.find((a) => a.id === id);
  }

  isInNebula(pos: { x: number; y: number }): boolean {
    return this.terrain.isPointInNebula(pos.x, pos.y);
  }

  /* Earliest meeting point for this fleet, or null if it cannot catch the asteroid. */
  planIntercept(fleet: Fleet, asteroid: DriftingAsteroid): InterceptPlan | null {
    return planAsteroidIntercept(
      { x: fleet.x, y: fleet.y },
      StarMapMovementService.galaxyCellsPerSecond(fleet),
      asteroid,
      (from, to, speed) => this.movementService.estimateTravelSeconds(from, to, speed),
    );
  }

  /*
   * Gives a (player) fleet an intercept order. The order is only accepted
   * when the fleet can actually reach the asteroid before it leaves the map.
   */
  orderIntercept(fleet: Fleet, asteroidId: number): InterceptOrderResult {
    const asteroid = this.getAsteroid(asteroidId);
    if (!asteroid) {
      return { ok: false, reason: 'gone' };
    }
    const plan = this.planIntercept(fleet, asteroid);
    if (!plan) {
      return { ok: false, reason: 'unreachable' };
    }
    fleet.interceptAsteroidId = asteroidId;
    fleet.targetX = plan.point.x;
    fleet.targetY = plan.point.y;
    this.reaimClock.set(fleet.id, 0);
    return { ok: true, plan };
  }

  tick(
    gameDeltaTime: number,
    fleets: Fleet[],
    factions: Faction[],
    mapWidth: number,
    mapHeight: number,
  ): AsteroidTickResult {
    const result: AsteroidTickResult = { changed: false, collected: [], failedIntercepts: [] };
    if (gameDeltaTime <= 0) {
      return result;
    }

    // 1. Spawning.
    this.state.spawnTimer -= gameDeltaTime;
    if (this.state.spawnTimer <= 0) {
      const rng = new StatefulRng(this.state.rngState);
      if (this.state.active.length < ASTEROID_CONFIG.maxActive) {
        const asteroid = spawnAsteroid(
          rng,
          this.state.nextId,
          mapWidth,
          mapHeight,
          this.terrain.obstacles,
        );
        if (asteroid) {
          this.state.active.push(asteroid);
          this.state.nextId++;
          result.changed = true;
        }
      }
      this.state.spawnTimer = Math.round(rng.range(ASTEROID_CONFIG.spawnInterval));
      this.state.rngState = rng.state;
    }

    // 2. Movement and exit.
    if (this.state.active.length > 0) {
      result.changed = true;
      for (const asteroid of this.state.active) {
        asteroid.traveled = Math.min(
          asteroid.length,
          asteroid.traveled + asteroid.speed * gameDeltaTime,
        );
      }
      this.state.active = this.state.active.filter((a) => a.traveled < a.length);
    }

    // 3. Collection (exactly once per asteroid).
    const collectors = this.eligibleCollectors(fleets, factions);
    for (const asteroid of [...this.state.active]) {
      const pos = asteroidPosition(asteroid);
      let winner: { fleet: Fleet; dist: number } | null = null;
      for (const fleet of collectors) {
        const dist = Math.hypot(fleet.x - pos.x, fleet.y - pos.y);
        if (dist > ASTEROID_CONFIG.collectRadius) {
          continue;
        }
        if (!winner || dist < winner.dist || (dist === winner.dist && fleet.id < winner.fleet.id)) {
          winner = { fleet, dist };
        }
      }
      if (!winner) {
        continue;
      }
      const faction = factions.find((f) => f.id === winner!.fleet.factionId);
      if (!faction) {
        continue;
      }
      this.state.active = this.state.active.filter((a) => a.id !== asteroid.id);
      for (const [key, amount] of Object.entries(asteroid.reward) as [
        keyof AsteroidReward,
        number,
      ][]) {
        faction.currencies[key] = (faction.currencies[key] ?? 0) + amount;
      }
      result.collected.push({
        asteroid,
        fleetId: winner.fleet.id,
        factionId: faction.id,
        reward: { ...asteroid.reward },
      });
      result.changed = true;
    }

    // 4. Steering of player intercept orders.
    for (const fleet of fleets) {
      if (fleet.interceptAsteroidId == null) {
        continue;
      }
      const asteroid = fleet.destroyed ? undefined : this.getAsteroid(fleet.interceptAsteroidId);
      if (!asteroid) {
        // Collected (by this or another fleet), expired, or the fleet died:
        // the order is finished — stop where the fleet is.
        const collectedHere = result.collected.some((c) => c.fleetId === fleet.id);
        if (!collectedHere && !fleet.destroyed) {
          result.failedIntercepts.push({
            fleetId: fleet.id,
            asteroidId: fleet.interceptAsteroidId,
          });
        }
        this.clearIntercept(fleet);
        result.changed = true;
        continue;
      }
      const clock =
        (this.reaimClock.get(fleet.id) ?? ASTEROID_CONFIG.reaimInterval) + gameDeltaTime;
      if (clock < ASTEROID_CONFIG.reaimInterval) {
        this.reaimClock.set(fleet.id, clock);
        continue;
      }
      this.reaimClock.set(fleet.id, 0);
      const plan = this.planIntercept(fleet, asteroid);
      if (!plan) {
        result.failedIntercepts.push({ fleetId: fleet.id, asteroidId: asteroid.id });
        this.clearIntercept(fleet);
        result.changed = true;
        continue;
      }
      fleet.targetX = plan.point.x;
      fleet.targetY = plan.point.y;
    }
    for (const fleetId of [...this.reaimClock.keys()]) {
      if (!fleets.some((f) => f.id === fleetId && f.interceptAsteroidId != null)) {
        this.reaimClock.delete(fleetId);
      }
    }
    return result;
  }

  private clearIntercept(fleet: Fleet): void {
    fleet.interceptAsteroidId = null;
    fleet.targetX = null;
    fleet.targetY = null;
    this.reaimClock.delete(fleet.id);
  }

  private eligibleCollectors(fleets: Fleet[], factions: Faction[]): Fleet[] {
    const majorFactions = new Set(factions.filter((f) => f.team !== 0).map((f) => f.id));
    return fleets.filter(
      (f) => !f.destroyed && majorFactions.has(f.factionId) && f.ships.some((s) => !s.destroyed),
    );
  }
}

import { Injectable } from '@angular/core';
import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { StarMapSensorService, PLAYER_SYSTEM_SENSOR_RANGE } from './star-map-sensor.service';
import { ResearchService } from '../../services/research.service';
import { GameSettingsService } from '../../services/game-settings.service';

/*
 * =========================================================
 * ENEMY INTEL SERVICE (AI fog of war)
 * =========================================================
 *
 * Per-AI-faction knowledge, kept separate from the authoritative world
 * state. AI decision layers (plan, strategy, goal, capability, action,
 * fleet operations, research, economy threat checks) see the world only
 * through `getView(faction)`; the executor, invasion and economy
 * construction keep acting on the real state, which always re-validates
 * a decision before it changes anything.
 *
 * Sensor rules are the player's (StarMapSensorService): every system with
 * an owned planet senses PLAYER_SYSTEM_SENSOR_RANGE (+ research bonus)
 * cells around it, every own fleet senses getFleetSensorRange. A cell is
 * sensed when its integer cell lies within that Euclidean radius of the
 * source, exactly as getCellsInRadius computes the player's layer.
 *
 * Knowledge (refreshed every UPDATE_INTERVAL, first refresh immediately):
 *  - known systems: star positions are public (every star is charted);
 *    planet contents (owner, population, buildings) are known only after
 *    the system was sensed, as last seen;
 *  - visible hostile fleets: the real objects while sensed;
 *  - remembered hostile fleets: a frozen copy at the last-seen position,
 *    kept SIGHTING_TTL seconds, then forgotten. A stale sighting is
 *    `uncertain` (older than UNCERTAIN_AFTER): it still counts as a danger
 *    but is never chosen as an interception target.
 * Own and same-team (allied) fleets and own planets are always the real
 * objects, so decisions about own assets act on live state.
 *
 * The AI uses fog of war exactly when the player does
 * (GameSettingsService.fogOfWarEnabled). With fog disabled the view is the
 * real world, matching what the player can see.
 *
 * State is in-memory and bounded (one entry per known system and per
 * remembered hostile fleet); it is rebuilt after a load from what the
 * faction's sensors cover at that moment.
 */
interface PlanetIntel {
  owner: string;
  population: number;
  buildings: PlanetTile['buildings'];
  seenAt: number;
}

interface FleetSighting {
  ghost: Fleet;
  seenAt: number;
}

interface FactionIntel {
  clock: number;
  nextUpdateAt: number;
  knownSystems: Map<string, Map<number, PlanetIntel>>;
  sightings: Map<number, FleetSighting>;
  visible: Set<number>;
  view?: { starSystems: StarSystem[]; fleets: Fleet[] };
}

export interface IntelSummary {
  knownSystems: number;
  totalSystems: number;
  visibleHostiles: number;
  rememberedHostiles: number;
}

@Injectable({ providedIn: 'root' })
export class EnemyIntelService {
  static readonly UPDATE_INTERVAL = 2;
  static readonly SIGHTING_TTL = 300;
  static readonly UNCERTAIN_AFTER = 60;

  private readonly intel = new Map<string, FactionIntel>();

  constructor(
    private readonly sensorService: StarMapSensorService,
    private readonly researchService: ResearchService,
    private readonly settings: GameSettingsService,
  ) {}

  reset(): void {
    this.intel.clear();
  }

  get enabled(): boolean {
    return this.settings.fogOfWarEnabled;
  }

  tick(gameDeltaTime: number, faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): void {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return;
    }
    const state = this.state(faction.id);
    state.clock += gameDeltaTime;
    if (state.clock < state.nextUpdateAt && state.view) {
      return;
    }
    state.nextUpdateAt = state.clock + EnemyIntelService.UPDATE_INTERVAL;
    this.update(faction, factions, starSystems, fleets, state);
  }

  /* What the faction knows. The real world when fog of war is disabled or before the first update. */
  getView(faction: Faction, starSystems: StarSystem[], fleets: Fleet[]): { starSystems: StarSystem[]; fleets: Fleet[] } {
    if (!this.enabled || faction.ai !== true) {
      return { starSystems, fleets };
    }
    return this.intel.get(faction.id)?.view ?? { starSystems, fleets };
  }

  /*
   * Before a faction's first intel update its view is the real world
   * (getView), so every query answers like the real world too.
   */
  isVisible(factionId: string, fleetId: number): boolean {
    const state = this.intel.get(factionId);
    return !this.enabled || !state?.view || state.visible.has(fleetId);
  }

  /* A remembered sighting older than UNCERTAIN_AFTER. */
  isUncertain(factionId: string, fleetId: number): boolean {
    if (!this.enabled) {
      return false;
    }
    const state = this.intel.get(factionId);
    const sighting = state?.sightings.get(fleetId);
    return !!state && !state.visible.has(fleetId) && !!sighting && state.clock - sighting.seenAt > EnemyIntelService.UNCERTAIN_AFTER;
  }

  /* Where the faction believes a hostile fleet is (real position only while visible). */
  getKnownPosition(factionId: string, fleet: Fleet): { x: number; y: number } | undefined {
    if (!this.enabled) {
      return { x: fleet.x, y: fleet.y };
    }
    const state = this.intel.get(factionId);
    if (!state) {
      return { x: fleet.x, y: fleet.y };
    }
    if (state.visible.has(fleet.id)) {
      return { x: fleet.x, y: fleet.y };
    }
    const sighting = state.sightings.get(fleet.id);
    return sighting ? { x: sighting.ghost.x, y: sighting.ghost.y } : undefined;
  }

  knowsSystem(factionId: string, systemId: string): boolean {
    const state = this.intel.get(factionId);
    return !this.enabled || !state?.view || state.knownSystems.has(systemId);
  }

  summary(factionId: string, totalSystems: number): IntelSummary {
    const state = this.intel.get(factionId);
    return {
      knownSystems: this.enabled ? state?.knownSystems.size ?? 0 : totalSystems,
      totalSystems,
      visibleHostiles: state?.visible.size ?? 0,
      rememberedHostiles: state ? [...state.sightings.keys()].filter((id) => !state.visible.has(id)).length : 0,
    };
  }

  private update(faction: Faction, factions: Faction[], starSystems: StarSystem[], fleets: Fleet[], state: FactionIntel): void {
    const team = faction.team;
    const sameTeam = new Set(factions.filter((f) => f.team === team && f.team !== 0).map((f) => f.id));
    const bonus = this.researchService.getSensorRangeBonus(faction);
    const sources: { x: number; y: number; r: number }[] = [];
    for (const system of starSystems) {
      if (system.planetsTiles.some((p) => p.factionId === faction.id)) {
        sources.push({ x: system.gridCol ?? Math.floor(system.x), y: system.gridRow ?? Math.floor(system.y), r: PLAYER_SYSTEM_SENSOR_RANGE + bonus });
      }
    }
    for (const fleet of fleets) {
      if (fleet.factionId === faction.id && !fleet.destroyed && fleet.ships.some((s) => !s.destroyed)) {
        sources.push({ x: fleet.x, y: fleet.y, r: this.sensorService.getFleetSensorRange(fleet, faction) });
      }
    }
    const sensed = (x: number, y: number): boolean => {
      const col = Math.floor(x);
      const row = Math.floor(y);
      return sources.some((s) => (col - s.x) ** 2 + (row - s.y) ** 2 <= s.r * s.r);
    };

    // Systems: refresh planet snapshots of every sensed system.
    for (const system of starSystems) {
      if (!sensed(system.x, system.y)) {
        continue;
      }
      const planets = new Map<number, PlanetIntel>();
      for (const planet of system.planetsTiles) {
        planets.set(planet.id, {
          owner: planet.factionId,
          population: planet.population,
          buildings: planet.buildings.map((b) => ({ ...b })),
          seenAt: state.clock,
        });
      }
      state.knownSystems.set(system.id, planets);
    }

    // Hostile fleets: visible now, or remembered at the last-seen position.
    state.visible.clear();
    for (const fleet of fleets) {
      if (sameTeam.has(fleet.factionId) || fleet.destroyed || !fleet.ships.some((s) => !s.destroyed)) {
        continue;
      }
      if (sensed(fleet.x, fleet.y)) {
        state.visible.add(fleet.id);
        state.sightings.set(fleet.id, {
          ghost: { ...fleet, ships: fleet.ships.map((s) => ({ ...s })), targetX: null, targetY: null, system: null },
          seenAt: state.clock,
        });
      }
    }
    for (const [fleetId, sighting] of state.sightings) {
      const expired = state.clock - sighting.seenAt > EnemyIntelService.SIGHTING_TTL;
      // Seeing the remembered position empty disproves the sighting.
      const disproved = !state.visible.has(fleetId) && sensed(sighting.ghost.x, sighting.ghost.y);
      if (expired || disproved) {
        state.sightings.delete(fleetId);
      }
    }

    state.view = this.buildView(faction, sameTeam, starSystems, fleets, state);
  }

  private buildView(
    faction: Faction,
    sameTeam: Set<string>,
    starSystems: StarSystem[],
    fleets: Fleet[],
    state: FactionIntel,
  ): { starSystems: StarSystem[]; fleets: Fleet[] } {
    const systems = starSystems.map((system) => {
      const known = state.knownSystems.get(system.id);
      const planetsTiles = system.planetsTiles
        .map((planet) => {
          // Own planets are the real objects (decisions act on own assets).
          if (planet.factionId === faction.id) {
            return planet;
          }
          const seen = known?.get(planet.id);
          if (!seen) {
            return undefined;
          }
          return { ...planet, factionId: seen.owner, population: seen.population, buildings: seen.buildings };
        })
        .filter((p): p is PlanetTile => p !== undefined);
      return { ...system, planetsTiles };
    });

    const viewFleets: Fleet[] = [];
    for (const fleet of fleets) {
      if (sameTeam.has(fleet.factionId) || state.visible.has(fleet.id)) {
        viewFleets.push(fleet);
      }
    }
    for (const [fleetId, sighting] of state.sightings) {
      if (!state.visible.has(fleetId)) {
        viewFleets.push(sighting.ghost);
      }
    }
    return { starSystems: systems, fleets: viewFleets };
  }

  private state(factionId: string): FactionIntel {
    let state = this.intel.get(factionId);
    if (!state) {
      state = { clock: 0, nextUpdateAt: 0, knownSystems: new Map(), sightings: new Map(), visible: new Set() };
      this.intel.set(factionId, state);
    }
    return state;
  }
}

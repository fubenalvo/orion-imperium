import { Injectable } from '@angular/core';
import { Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import { StatefulRng } from './drifting-asteroids';
import { SpaceBaseService } from './space-base.service';
import { StarMapMovementService } from './star-map-movement.service';
import { ShipService } from '../../services/ship.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { DEFAULT_FLEET_SPEED, FleetAssemblyService } from '../../services/fleet-assembly.service';
import { DEFAULT_FLEET_SENSOR_RANGE } from './star-map-sensor.service';

/*
 * =========================================================
 * PIRATE INCURSION (dynamic event against a quiet game)
 * =========================================================
 *
 * When the game goes quiet for the player (no battle of the player and none
 * of the player's planets changing hands for PIRATE_CONFIG.quietSeconds
 * after PIRATE_CONFIG.firstAfter; AI-vs-AI wars do not count), a pirate fleet flies in
 * from a random map edge, builds a Pirate Haven (an ordinary SpaceBase of
 * the outlaw faction 'pirates') in open space, and the haven sends raider
 * fleets that take turns harassing every empire. Full rules:
 * docs/pirate-incursion.md.
 *
 * - The pirates are an outlaw Faction (team 0, `outlaw: true`): at war
 *   with everyone (diplomacy.ts getRelationKind), no diplomacy, no war
 *   record, no planets, no territory, never counted for victory or defeat.
 *   Fights with them use the normal battle detection (AI side auto-resolve,
 *   the player's battle screen).
 * - Raiders never capture planets. A raider standing in a system with a
 *   planet of its target drains that empire's credits (capped per raid).
 * - Strength follows the player: every pirate fleet is built to about
 *   `strengthShare` of the human player's total fleet strength (frigates
 *   first, then destroyers), so the player's fleets can always handle one;
 *   a player without warships faces a single frigate.
 * - The haven leaves after `havenLifetime`; destroyed earlier, the event
 *   ends at once and the remaining raiders vanish. Then a cooldown.
 * - Everything is saved: the faction in `factions`, the haven in the base
 *   registry, the fleets in `fleets`, this state in StarMapData.pirates.
 */
export const PIRATE_CONFIG = {
  /* Earliest start (480 s; was 1200 before the strength followed the player). */
  firstAfter: 480,
  quietSeconds: 480,
  cooldownSeconds: 900,
  havenLifetime: 1200,
  havenBuildSeconds: 60,
  spawnInterval: { min: 180, max: 300 },
  maxRaiders: 2,
  strengthShare: 0.4,
  minShips: 1,
  maxShips: 12,
  raidStaySeconds: 60,
  drainPerSecond: 15,
  drainCapPerRaid: 1500,
  /* Haven site: kept this far from every star system (cells). */
  siteSystemClearance: 8,
} as const;

export const PIRATE_FACTION_ID = 'pirates';
const RAIDER_HULLS = ['frigate', 'destroyer'] as const;

export interface PirateRaider {
  fleetId: number;
  targetFactionId: string;
  targetSystemId: string;
  mode: 'travel' | 'raid';
  stayLeft: number;
  drained: number;
}

export interface PirateIncursionState {
  phase: 'idle' | 'arriving' | 'active';
  /* Game seconds of the last battle or planet ownership change anywhere. */
  lastActivity: number;
  /* No new incursion before this game second. */
  cooldownUntil: number;
  rng: number;
  arrivalFleetId?: number;
  siteX?: number;
  siteY?: number;
  havenId?: number;
  endsAt?: number;
  spawnIn?: number;
  /* Round-robin index into the sorted empire ids (whose turn it is to be harassed). */
  cursor: number;
  raiders: PirateRaider[];
}

export interface PirateWorld {
  gameSeconds: number;
  factions: Faction[];
  fleets: Fleet[];
  starSystems: StarSystem[];
  shipStock?: FactionShipStock[];
  mapWidth: number;
  mapHeight: number;
}

export function initialPirateState(seed = 0x5eed): PirateIncursionState {
  return { phase: 'idle', lastActivity: 0, cooldownUntil: 0, rng: seed | 0, cursor: 0, raiders: [] };
}

@Injectable({ providedIn: 'root' })
export class PirateIncursionService {
  private state: PirateIncursionState = initialPirateState();

  constructor(
    private readonly bases: SpaceBaseService,
    private readonly movement: StarMapMovementService,
    private readonly shipService: ShipService,
    private readonly shipStock: ShipStockService,
    private readonly fleetAssembly: FleetAssemblyService,
  ) {}

  restore(saved: PirateIncursionState | undefined, seed: number): void {
    this.state = saved && typeof saved === 'object' && Array.isArray(saved.raiders)
      ? structuredClone(saved)
      : initialPirateState(seed);
  }

  serialize(): PirateIncursionState {
    return structuredClone(this.state);
  }

  get phase(): PirateIncursionState['phase'] {
    return this.state.phase;
  }

  /* A battle or a planet changing hands somewhere: the galaxy is not quiet. */
  noteActivity(gameSeconds: number): void {
    this.state.lastActivity = Math.max(this.state.lastActivity, gameSeconds);
  }

  /* One step of the event. Returns map notices for the player (empty = nothing to say). */
  tick(dt: number, world: PirateWorld): string[] {
    if (!(dt > 0)) return [];
    const s = this.state;
    if (s.phase === 'idle') return this.tryStart(world);
    if (s.phase === 'arriving') return this.arrive(world);
    return this.runActive(dt, world);
  }

  /* ---------- Start and arrival ---------- */

  private tryStart(world: PirateWorld): string[] {
    const s = this.state;
    if (world.gameSeconds < PIRATE_CONFIG.firstAfter || world.gameSeconds < s.cooldownUntil) return [];
    if (world.gameSeconds - s.lastActivity < PIRATE_CONFIG.quietSeconds) return [];
    const rng = new StatefulRng(s.rng);
    const site = this.pickSite(rng, world);
    if (!site) {
      s.rng = rng.state;
      s.cooldownUntil = world.gameSeconds + 120; // retry later; nothing suitable now
      return [];
    }
    const { entry, direction } = this.pickEntry(rng, world, site);
    s.rng = rng.state;
    this.ensureFaction(world.factions);
    const fleet = this.createFleet(world, entry.x, entry.y, 'Pirate Warband');
    fleet.targetX = site.x + 0.5;
    fleet.targetY = site.y + 0.5;
    Object.assign(s, { phase: 'arriving', arrivalFleetId: fleet.id, siteX: site.x, siteY: site.y, raiders: [] });
    return [`Pirate raiders have entered the galaxy from the ${direction}.`];
  }

  private arrive(world: PirateWorld): string[] {
    const s = this.state;
    const fleet = world.fleets.find((f) => f.id === s.arrivalFleetId);
    if (!fleet || fleet.destroyed || !fleet.ships.some((sh) => !sh.destroyed)) {
      this.end(world, false);
      return ['The pirate warband was destroyed before it could dig in.'];
    }
    if (fleet.targetX !== null || Math.floor(fleet.x) !== s.siteX || Math.floor(fleet.y) !== s.siteY) {
      if (fleet.targetX === null) {
        fleet.targetX = s.siteX! + 0.5; // knocked off course by a battle: resume
        fleet.targetY = s.siteY! + 0.5;
      }
      return [];
    }
    const haven = this.bases.addBase({
      name: 'Pirate Haven', factionId: PIRATE_FACTION_ID, x: s.siteX!, y: s.siteY!,
      constructionRemaining: PIRATE_CONFIG.havenBuildSeconds,
    });
    Object.assign(s, {
      phase: 'active', havenId: haven.id,
      endsAt: world.gameSeconds + PIRATE_CONFIG.havenLifetime,
      spawnIn: PIRATE_CONFIG.havenBuildSeconds + this.nextInterval(),
    });
    return ['The pirates are building a haven in open space. Raids will follow.'];
  }

  /* ---------- Active haven and raiders ---------- */

  private runActive(dt: number, world: PirateWorld): string[] {
    const s = this.state;
    const haven = s.havenId !== undefined ? this.bases.getBase(s.havenId) : undefined;
    if (!haven) {
      this.end(world, true);
      return ['The Pirate Haven has been destroyed. The surviving raiders scatter.'];
    }
    if (world.gameSeconds >= (s.endsAt ?? 0)) {
      this.bases.destroy(haven.id);
      this.end(world, true);
      return ['The pirates have abandoned their haven and left the galaxy.'];
    }
    const notices: string[] = [];
    s.raiders = s.raiders.filter((r) => {
      const fleet = world.fleets.find((f) => f.id === r.fleetId);
      return !!fleet && !fleet.destroyed && fleet.ships.some((sh) => !sh.destroyed);
    });
    for (const raider of s.raiders) this.stepRaider(dt, raider, world, notices);

    const complete = !(haven.constructionRemaining && haven.constructionRemaining > 0);
    s.spawnIn = (s.spawnIn ?? 0) - dt;
    if (complete && s.spawnIn <= 0) {
      s.spawnIn = this.nextInterval();
      if (s.raiders.length < PIRATE_CONFIG.maxRaiders) {
        const fleet = this.createFleet(world, haven.x + 0.5, haven.y + 0.5, 'Pirate Raiders');
        const raider: PirateRaider = { fleetId: fleet.id, targetFactionId: '', targetSystemId: '', mode: 'travel', stayLeft: 0, drained: 0 };
        if (this.retarget(raider, fleet, world)) {
          s.raiders.push(raider);
          const target = world.factions.find((f) => f.id === raider.targetFactionId);
          if (raider.targetFactionId === 'player') notices.push('A pirate raiding party is heading for your space.');
          else if (target) notices.push(`A pirate raiding party has set out against ${target.name}.`);
        } else {
          fleet.destroyed = true;
        }
      }
    }
    return notices;
  }

  private stepRaider(dt: number, raider: PirateRaider, world: PirateWorld, notices: string[]): void {
    const fleet = world.fleets.find((f) => f.id === raider.fleetId)!;
    const system = world.starSystems.find((sys) => sys.id === raider.targetSystemId);
    const target = world.factions.find((f) => f.id === raider.targetFactionId);
    const stillOwned = !!system && system.planetsTiles.some((p) => p.factionId === raider.targetFactionId);
    if (!system || !target || !stillOwned) {
      this.retarget(raider, fleet, world);
      return;
    }
    const onSystem = Math.floor(fleet.x) === Math.floor(system.x) && Math.floor(fleet.y) === Math.floor(system.y);
    if (raider.mode === 'travel') {
      if (onSystem && fleet.targetX === null) {
        raider.mode = 'raid';
        raider.stayLeft = PIRATE_CONFIG.raidStaySeconds;
        raider.drained = 0;
        if (target.id === 'player') notices.push(`Pirates are raiding the ${system.name} system!`);
      } else if (fleet.targetX === null) {
        fleet.targetX = system.x;
        fleet.targetY = system.y;
      }
      return;
    }
    // Raid: drain credits while standing in the system, capped per raid.
    if (onSystem && fleet.targetX === null) {
      const credits = target.currencies['credits'] ?? 0;
      const take = Math.min(credits, PIRATE_CONFIG.drainPerSecond * dt, PIRATE_CONFIG.drainCapPerRaid - raider.drained);
      if (take > 0) {
        target.currencies['credits'] = credits - take;
        raider.drained += take;
      }
    }
    raider.stayLeft -= dt;
    if (raider.stayLeft <= 0) this.retarget(raider, fleet, world);
  }

  /*
   * The next empire in turn (round robin over living empires with planets)
   * and its colony nearest to the raider; a homeworld (Capital) only when
   * the empire has nothing else. Returns false when there is no target.
   */
  private retarget(raider: PirateRaider, fleet: Fleet, world: PirateWorld): boolean {
    const empires = world.factions
      .filter((f) => f.team !== 0 && f.outlaw !== true)
      .filter((f) => world.starSystems.some((sys) => sys.planetsTiles.some((p) => p.factionId === f.id)))
      .map((f) => f.id)
      .sort();
    if (empires.length === 0) return false;
    const factionId = empires[this.state.cursor % empires.length];
    this.state.cursor = (this.state.cursor + 1) % Math.max(1, empires.length);
    const owned = world.starSystems.filter((sys) => sys.planetsTiles.some((p) => p.factionId === factionId));
    const colonies = owned.filter((sys) => !sys.planetsTiles.some((p) => p.factionId === factionId && p.buildings.some((b) => b.name === 'Capital')));
    const pool = colonies.length > 0 ? colonies : owned;
    const dist = (sys: StarSystem) => Math.hypot(sys.x - fleet.x, sys.y - fleet.y);
    const system = [...pool].sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id))[0];
    Object.assign(raider, { targetFactionId: factionId, targetSystemId: system.id, mode: 'travel', stayLeft: 0, drained: 0 });
    fleet.targetX = system.x;
    fleet.targetY = system.y;
    return true;
  }

  /* ---------- Helpers ---------- */

  private end(world: PirateWorld, removeFleets: boolean): void {
    const s = this.state;
    if (removeFleets) {
      const ids = new Set([s.arrivalFleetId, ...s.raiders.map((r) => r.fleetId)]);
      for (const fleet of world.fleets) {
        if (fleet.factionId === PIRATE_FACTION_ID && ids.has(fleet.id)) {
          fleet.destroyed = true;
          fleet.targetX = null;
          fleet.targetY = null;
        }
      }
    }
    Object.assign(s, {
      phase: 'idle', cooldownUntil: world.gameSeconds + PIRATE_CONFIG.cooldownSeconds,
      lastActivity: world.gameSeconds, raiders: [],
    });
    for (const key of ['arrivalFleetId', 'siteX', 'siteY', 'havenId', 'endsAt', 'spawnIn'] as const) delete s[key];
  }

  private nextInterval(): number {
    const rng = new StatefulRng(this.state.rng);
    const value = rng.range(PIRATE_CONFIG.spawnInterval);
    this.state.rng = rng.state;
    return value;
  }

  private ensureFaction(factions: Faction[]): void {
    if (factions.some((f) => f.id === PIRATE_FACTION_ID)) return;
    factions.push({
      id: PIRATE_FACTION_ID, name: 'Pirates', color: '#c0392b', team: 0, ai: false, outlaw: true,
      currencies: { credits: 0, rawmaterials: 0, research: 0 },
    } as Faction);
  }

  /* A cell in the central part of the map, clear of systems, reachable from outside. */
  private pickSite(rng: StatefulRng, world: PirateWorld): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(world.mapWidth * (0.2 + 0.6 * rng.next()));
      const y = Math.floor(world.mapHeight * (0.2 + 0.6 * rng.next()));
      if (world.starSystems.some((sys) => Math.hypot(sys.x - x, sys.y - y) < PIRATE_CONFIG.siteSystemClearance)) continue;
      if (this.bases.getBaseAtCell(x, y)) continue;
      if (!this.movement.planGalaxyRoute({ x: 1.5, y: y + 0.5 }, { x: x + 0.5, y: y + 0.5 }).ok) continue;
      return { x, y };
    }
    return null;
  }

  /* A point on a random map edge with a route to the site, and its compass name. */
  private pickEntry(rng: StatefulRng, world: PirateWorld, site: { x: number; y: number }): { entry: { x: number; y: number }; direction: string } {
    const w = world.mapWidth;
    const h = world.mapHeight;
    for (let attempt = 0; attempt < 20; attempt++) {
      const edge = Math.floor(rng.next() * 4);
      const t = 0.1 + 0.8 * rng.next();
      const entry = [
        { x: t * w, y: 1.5 }, { x: w - 1.5, y: t * h }, { x: t * w, y: h - 1.5 }, { x: 1.5, y: t * h },
      ][edge];
      if (!this.movement.planGalaxyRoute(entry, { x: site.x + 0.5, y: site.y + 0.5 }).ok) continue;
      return { entry, direction: compass(entry.x / w, entry.y / h) };
    }
    return { entry: { x: 1.5, y: site.y + 0.5 }, direction: 'west' };
  }

  /* A fleet worth about strengthShare of the human player's total fleet strength. */
  private createFleet(world: PirateWorld, x: number, y: number, name: string): Fleet {
    const playerStrength = world.fleets
      .filter((fl) => fl.factionId === 'player' && !fl.destroyed)
      .reduce((sum, fl) => sum + this.shipService.calculateFleetStrength(fl.ships), 0);
    const wanted = playerStrength * PIRATE_CONFIG.strengthShare;
    const ships: Fleet['ships'] = [];
    let nextId = this.shipStock.nextShipId(world.fleets, { shipStock: world.shipStock ?? [] });
    while (ships.length < PIRATE_CONFIG.maxShips
      && (ships.length < PIRATE_CONFIG.minShips || this.shipService.calculateFleetStrength(ships) < wanted)) {
      const type = RAIDER_HULLS[ships.length % RAIDER_HULLS.length];
      ships.push({ id: nextId++, name: this.shipService.getShipType(type)?.name ?? type, type, currentHp: this.shipService.getShipType(type)?.hitPoints, destroyed: false });
    }
    const fleet: Fleet = {
      id: this.fleetAssembly.nextFleetId(world.fleets), name, factionId: PIRATE_FACTION_ID,
      x, y, targetX: null, targetY: null, speed: DEFAULT_FLEET_SPEED, system: null, ships,
      destroyed: false, sensorRange: DEFAULT_FLEET_SENSOR_RANGE,
    };
    world.fleets.push(fleet);
    return fleet;
  }
}

function compass(fx: number, fy: number): string {
  const ns = fy < 0.33 ? 'north' : fy > 0.67 ? 'south' : '';
  const ew = fx < 0.33 ? 'west' : fx > 0.67 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'deep space';
}

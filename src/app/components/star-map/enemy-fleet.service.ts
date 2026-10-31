import { Injectable } from '@angular/core';
import { Faction, FactionProduction, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { SpaceportService } from '../../services/spaceport.service';
import { getAiDifficultyProfile } from './ai-difficulty';
import { EnemyInvasionService } from './enemy-invasion.service';
import { EnemyPlanService } from './enemy-plan.service';
import { EnemyIntelService } from './enemy-intel.service';
import { EnemyReachService } from './enemy-reach.service';
import { AI_COLONIZATION_REACH } from './ai-queries';
import { DriftingAsteroidService } from './drifting-asteroid.service';
import { asteroidPosition } from './drifting-asteroids';
import { areFactionsHostile, hostileFactionIds } from './diplomacy';

/*
 * =========================================================
 * ENEMY FLEET SERVICE (AI fleet operations)
 * =========================================================
 *
 * Gives every AI fleet that the strategic pipeline is not using a role
 * and is the single owner of that fleet's movement orders:
 *
 *   garrison  — hold an assigned owned system (the primary Spaceport
 *               system first, then other systems). Default role.
 *   intercept — engage a hostile fleet near AI territory, only when the
 *               assigned fleets together are stronger than the target by
 *               the faction's attackStrengthAdvantage (AI difficulty).
 *               Gives up after INTERCEPT_TIMEOUT or when the target
 *               leaves the area or becomes too strong.
 *   retreat   — a stronger hostile fleet is close (DANGER_RADIUS) and the
 *               fleet is not at a Spaceport system: fall back to the
 *               primary Spaceport system.
 *   regroup   — the fleet lost too much strength (< REGROUP_THRESHOLD of
 *               its peak): return to the primary Spaceport system, where
 *               EnemyEconomyService deploys new ships into parked fleets,
 *               until it is back to REGROUP_DONE of its peak.
 *   explore   — fog of war: fly to the nearest uncharted system within
 *               1.5 × colonization reach until the faction's sensors have
 *               seen it (EnemyIntelService). One explorer at a time, never
 *               the home guard; gives up after EXPLORE_TIMEOUT.
 *   assault   — capture a hostile planet (EnemyInvasionService). Planned
 *               every ASSAULT_PLANNING_INTERVAL when no assault is active:
 *               the target must be within AI_COLONIZATION_REACH of AI
 *               territory, and the group is chosen so that a forecast
 *               with the real battle rules (autoResolveBattle) wins with at
 *               least the posture's assaultMinSurvival of its strength left
 *               (EnemyPlanService; 50% when balanced). The group never
 *               takes the home guard and never more than
 *               1 - homeGuardFraction of the faction's managed strength, so
 *               the faction is not stripped bare by one target. The group
 *               gathers in the target system (or waits
 *               ASSAULT_GATHER_TIMEOUT after the first arrival) and then
 *               launches. Captured → the fleets garrison the new system;
 *               repelled → survivors regroup and the target is skipped for
 *               ASSAULT_RETRY_DELAY. Assaults on player planets are fought
 *               on the interactive battle screen; the group holds until
 *               that battle has been resolved.
 *   salvage   — opportunistic: one free fleet (never the home guard)
 *               intercepts a drifting asteroid the faction can see when it
 *               can meet it within SALVAGE_MAX_ETA, near its territory.
 *               Re-planned at every decision; the order follows the predicted meeting point
 *               (DriftingAsteroidService.planIntercept); dropped when the
 *               asteroid is gone or out of reach. Collection and rewards
 *               follow the same proximity rule as for the player.
 *
 * Ownership: fleets carrying a colonizer and fleets commanded by a
 * current move_to_target / defend action belong to the pipeline and are
 * never touched here. Fleets managed here are reserved from the legacy
 * EnemyAiService pursuit (StarMapAiTickService.getReservedFleetIds), so
 * exactly one subsystem writes each fleet's target.
 *
 * Combat itself is NOT simulated here. Battles start when hostile fleets
 * share a galaxy cell (StarMapBattleDetectionService) and are resolved by
 * the battle screen; this service only decides where fleets go, using
 * ShipService.calculateFleetStrength (living ships only) as the strength
 * estimate. Results flow back through StarMap.applyBattleResult (ships
 * flagged destroyed, wiped fleets destroyed) and change the next
 * decision: lower strength → regroup/retreat, and EnemyEconomyService
 * raises military production.
 *
 * Hostility = at war (diplomacy.ts `areFactionsHostile`), the same rule
 * battle detection uses; fleets of factions at peace are ignored.
 *
 * Fog of war: `starSystems`/`fleets` passed to tick are the faction's
 * perceived view (EnemyIntelService) — hostiles are the visible and
 * remembered ones, foreign planets as last seen. Only visible hostiles are
 * intercepted; remembered ones still count as danger. Assault launches use
 * the real state (`real`), which re-validates the target.
 */
export type AiFleetRole = 'garrison' | 'intercept' | 'retreat' | 'regroup' | 'assault' | 'explore' | 'salvage';

interface FleetAssignment {
  role: AiFleetRole;
  systemId?: string;
  targetFleetId?: number;
  planetId?: number;
  // Assault: clock time the first group fleet reached the target system.
  arrivedAt?: number;
  // Assault: a player-defended battle was queued and not yet observed resolved.
  launched?: boolean;
  // Salvage: drifting asteroid being intercepted.
  asteroidId?: number;
  since: number;
}

export interface AssaultReport {
  factionId: string;
  planetId: number;
  result: 'captured' | 'repelled' | 'pending_player' | 'invalid';
  time: number;
}

@Injectable({ providedIn: 'root' })
export class EnemyFleetService {
  static readonly DECISION_INTERVAL = 2;
  // Hostile fleets this close to an owned system count as threats.
  private static readonly THREAT_RADIUS = 25;
  // Hostile fleets this close to an AI fleet are opportunities (if weaker)
  // or dangers (if stronger).
  private static readonly DANGER_RADIUS = 14;
  // An intercepted target farther than this from AI territory is let go.
  private static readonly PURSUIT_LEASH = 40;
  private static readonly INTERCEPT_TIMEOUT = 90;
  private static readonly REGROUP_THRESHOLD = 0.5;
  private static readonly REGROUP_DONE = 0.8;
  private static readonly ASSAULT_PLANNING_INTERVAL = 10;
  private static readonly ASSAULT_GATHER_TIMEOUT = 30;
  // An assault group that has not reached its target by then gives up.
  private static readonly ASSAULT_TRAVEL_TIMEOUT = 400;
  private static readonly ASSAULT_RETRY_DELAY = 300;
  private static readonly ASSAULT_MAX_GROUP = 4;
  private static readonly EXPLORE_TIMEOUT = 300;
  private static readonly EXPLORE_REACH_FACTOR = 1.5;
  // Salvage: only asteroids the fleet can meet this soon (game seconds)…
  private static readonly SALVAGE_MAX_ETA = 150;
  // …and whose meeting point is this close to AI territory (cells).
  private static readonly SALVAGE_TERRITORY_RANGE = 45;

  private readonly accumulators = new Map<string, number>();
  private readonly clocks = new Map<string, number>();
  private readonly assignments = new Map<number, FleetAssignment>();
  private readonly peakStrength = new Map<number, number>();
  private readonly nextAssaultPlanAt = new Map<string, number>();
  // `${factionId}:${planetId}` → clock time when the target may be retried.
  private readonly failedAssaults = new Map<string, number>();
  private readonly assaultReports: AssaultReport[] = [];

  constructor(
    private readonly shipService: ShipService,
    private readonly spaceportService: SpaceportService,
    private readonly invasionService: EnemyInvasionService,
    private readonly planService: EnemyPlanService,
    private readonly intelService: EnemyIntelService,
    private readonly reachService: EnemyReachService,
    private readonly asteroidService: DriftingAsteroidService,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.clocks.clear();
    this.assignments.clear();
    this.peakStrength.clear();
    this.nextAssaultPlanAt.clear();
    this.failedAssaults.clear();
    this.assaultReports.length = 0;
  }

  /*
   * Returns assaults whose player battle was queued but never fought to
   * the pre-launch state, so advanceAssaults launches them again (and the
   * battle is re-queued from current objects) instead of reading the
   * planet owner as a repelled assault.
   */
  cancelQueuedLaunches(planetIds: readonly number[]): void {
    if (planetIds.length === 0) {
      return;
    }
    const queued = new Set(planetIds);
    for (const assignment of this.assignments.values()) {
      if (assignment.role === 'assault' && assignment.launched && queued.has(assignment.planetId!)) {
        assignment.launched = false;
      }
    }
  }

  /*
   * releaseFleet: Drops a fleet's role and order (EnemyProgressService
   * found it unable to complete its objective). It is reassigned on the
   * next decision like any free fleet.
   */
  releaseFleet(fleet: Fleet): void {
    this.assignments.delete(fleet.id);
    fleet.targetX = null;
    fleet.targetY = null;
  }

  /* Assault launches in this session (diagnostics and tests). */
  getAssaultReports(): readonly AssaultReport[] {
    return this.assaultReports;
  }

  getAssignment(fleetId: number): Readonly<FleetAssignment> | undefined {
    return this.assignments.get(fleetId);
  }

  /* Fleets whose movement this service owns (reserved from EnemyAiService). */
  getManagedFleetIds(): Set<number> {
    return new Set(this.assignments.keys());
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    pipelineFleetIds: ReadonlySet<number>,
    production: FactionProduction[] = [],
    // The authoritative state for launches; defaults to the (then real) view.
    real?: { starSystems: StarSystem[]; fleets: Fleet[] },
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return false;
    }
    const clock = (this.clocks.get(faction.id) ?? 0) + gameDeltaTime;
    this.clocks.set(faction.id, clock);
    this.dropLostInterceptions(faction, factions, (real ?? { fleets }).fleets);
    // First decision immediately, so fleets are owned from the first frame.
    // Difficulty `reactionInterval` slows decisions (Easy decides every 4 s).
    const interval = EnemyFleetService.DECISION_INTERVAL * getAiDifficultyProfile(faction).reactionInterval;
    const accumulator = (this.accumulators.get(faction.id) ?? interval) + gameDeltaTime;
    if (accumulator < interval) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, Math.max(0, accumulator - interval));
    return this.decide(faction, factions, starSystems, fleets, pipelineFleetIds, clock, production, real ?? { starSystems, fleets });
  }

  /*
   * Ends interceptions whose target the faction no longer knows about
   * (intel dropped the sighting) or is no longer at war with (peace was
   * signed). Runs every frame, not only on decision ticks: intel refreshes
   * and fleet decisions run on separate 2 s clocks that drift apart, and
   * without this sweep an interceptor could keep chasing a lost contact
   * for up to one decision interval. The fleet keeps flying to its last
   * ordered point and gets a new role at the next decision. Only the
   * assignment changes (no game state), so nothing is reported as changed.
   */
  private dropLostInterceptions(faction: Faction, factions: Faction[], realFleets: Fleet[]): void {
    for (const fleet of realFleets) {
      if (fleet.factionId !== faction.id) continue;
      const assignment = this.assignments.get(fleet.id);
      if (assignment?.role !== 'intercept' || assignment.targetFleetId === undefined) continue;
      const target = realFleets.find((f) => f.id === assignment.targetFleetId);
      const owner = target ? factions.find((f) => f.id === target.factionId) : undefined;
      if (!target || !areFactionsHostile(faction, owner) || !this.intelService.getKnownPosition(faction.id, target)) {
        // Keep the fleet owned by this service (so the legacy pursuit layer
        // never picks it up); without a target the interception is invalid
        // at the next decision and the fleet gets a new role.
        this.assignments.set(fleet.id, { ...assignment, targetFleetId: undefined });
      }
    }
  }

  private decide(
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    pipelineFleetIds: ReadonlySet<number>,
    clock: number,
    production: FactionProduction[],
    real: { starSystems: StarSystem[]; fleets: Fleet[] },
  ): boolean {
    const own = fleets.filter((f) => f.factionId === faction.id && this.isAlive(f));
    const managed = own.filter(
      (f) => !pipelineFleetIds.has(f.id) && !f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
    );

    // Drop assignments of fleets that are gone or now owned by the pipeline.
    // The map holds every AI faction's fleets, so existence is checked in the
    // real world: `fleets` is this faction's fog-of-war view, which does not
    // contain other factions' unseen fleets (checking it wiped every other
    // AI's fleet roles on each decision once AIs stopped being allies).
    const managedIds = new Set(managed.map((f) => f.id));
    for (const fleetId of [...this.assignments.keys()]) {
      const fleet = real.fleets.find((f) => f.id === fleetId);
      if (fleet?.factionId === faction.id && !managedIds.has(fleetId)) {
        this.assignments.delete(fleetId);
        this.peakStrength.delete(fleetId);
      } else if (!fleet) {
        this.assignments.delete(fleetId);
        this.peakStrength.delete(fleetId);
      }
    }

    const ownedSystems = this.ownedSystemsSorted(faction.id, starSystems);
    // A faction that lost every planet has no home; its fleets can still
    // assault (capturing an undefended or weak planet is its recovery route).
    const home: StarSystem | undefined = this.primarySpaceportSystem(faction.id, starSystems) ?? ownedSystems[0];
    const spaceportCells = new Set(
      this.spaceportService.listSpaceports(faction.id, starSystems).map(({ system }) => this.cellKey(system.x, system.y)),
    );

    const hostileIds = hostileFactionIds(faction, factions);
    const hostiles = fleets.filter((f) => hostileIds.has(f.factionId) && this.isAlive(f));
    const difficulty = getAiDifficultyProfile(faction);
    const advantage = difficulty.attackStrengthAdvantage;
    // Engagement judgment: battle forecast (real combat rules) on Normal and
    // Hard, summed strength on Easy. With a forecast, attackStrengthAdvantage
    // sets the acceptable risk: the attackers must keep at least
    // 1 - 1/advantage of their strength (Hard 1.0: any win; Normal 1.2: 17%).
    const canWin = (attackers: Fleet[], defenders: Fleet[]): boolean => {
      if (difficulty.combatForecast) {
        const forecast = this.invasionService.forecastFleetBattle(attackers, defenders);
        return forecast.win && forecast.survivingRatio >= 1 - 1 / advantage;
      }
      const ours = attackers.reduce((sum, f) => sum + this.strength(f), 0);
      const theirs = defenders.reduce((sum, f) => sum + this.strength(f), 0);
      return ours >= theirs * advantage;
    };

    let changed = false;
    const free: Fleet[] = [];
    const assaultFleets: Fleet[] = [];

    for (const fleet of managed) {
      const strength = this.strength(fleet);
      const peak = Math.max(this.peakStrength.get(fleet.id) ?? 0, strength);
      this.peakStrength.set(fleet.id, peak);
      const current = this.assignments.get(fleet.id);
      const atSpaceport = spaceportCells.has(this.cellKey(fleet.x, fleet.y));

      // 1. Danger: nearby hostiles would beat this fleet (together with own
      // fleets close enough to fight alongside), outside Spaceport cover.
      // Explorers move away from home on purpose; battles only start on a
      // shared cell, so they only abort for a stronger hostile right next to them.
      const dangerRadius = current?.role === 'explore' ? EnemyFleetService.DANGER_RADIUS / 2 : EnemyFleetService.DANGER_RADIUS;
      const nearbyHostiles = hostiles.filter((h) => this.distance(h, fleet) <= dangerRadius);
      const allies = managed.filter((f) => this.distance(f, fleet) <= EnemyFleetService.DANGER_RADIUS / 2);
      const inDanger = nearbyHostiles.length > 0 && (difficulty.combatForecast
        ? !this.invasionService.forecastFleetBattle(allies, nearbyHostiles).win
        : nearbyHostiles.reduce((sum, h) => sum + this.strength(h), 0) > strength);
      if (home && inDanger && !atSpaceport) {
        changed = this.assign(fleet, { role: 'retreat', systemId: home.id, since: clock }, current) || changed;
        changed = this.moveTo(fleet, home.x, home.y) || changed;
        continue;
      }

      // 2. Regroup after losses (and stay until reinforced).
      const regrouping = current?.role === 'regroup' && strength < EnemyFleetService.REGROUP_DONE * peak;
      if (home && (regrouping || strength < EnemyFleetService.REGROUP_THRESHOLD * peak)) {
        changed = this.assign(fleet, { role: 'regroup', systemId: home.id, since: current?.role === 'regroup' ? current.since : clock }, current) || changed;
        changed = this.moveTo(fleet, home.x, home.y) || changed;
        continue;
      }
      if (current?.role === 'regroup') {
        // Back to strength: rebase the peak so new losses are measured from now.
        this.peakStrength.set(fleet.id, strength);
      }

      // 3a. Continue an active assault (launch is decided per group below).
      if (current?.role === 'assault' && this.isAssaultStillValid(current, faction, factions, starSystems, clock)) {
        assaultFleets.push(fleet);
        continue;
      }

      // 3b. Continue an exploration flight until the target system has been sensed.
      if (current?.role === 'explore' && current.systemId) {
        const target = starSystems.find((s) => s.id === current.systemId);
        if (target && !this.intelService.knowsSystem(faction.id, target.id) && clock - current.since <= EnemyFleetService.EXPLORE_TIMEOUT) {
          changed = this.moveTo(fleet, target.x, target.y) || changed;
          continue;
        }
      }

      // 3c. Continue a salvage run while the asteroid is still reachable.
      if (current?.role === 'salvage' && current.asteroidId != null) {
        const point = this.salvagePoint(faction, fleet, current.asteroidId);
        if (point) {
          // The meeting point shifts slightly at every decision; re-issue the
          // order only once it drifted a full cell (same rule as the executor's
          // moving targets), otherwise every decision would report a state
          // change and keep the save dirty.
          const drifted =
            fleet.targetX === null ||
            fleet.targetY === null ||
            Math.abs(fleet.targetX - point.x) >= 1 ||
            Math.abs(fleet.targetY - point.y) >= 1;
          if (drifted) {
            changed = this.moveTo(fleet, point.x, point.y) || changed;
          }
          continue;
        }
        // Asteroid gone or out of reach: stop and get a new role below.
        this.assignments.delete(fleet.id);
        fleet.targetX = null;
        fleet.targetY = null;
        changed = true;
      }

      // 3. Continue a still-valid interception.
      if (current?.role === 'intercept' && this.isInterceptStillValid(current, fleet, hostiles, ownedSystems, canWin, managed, clock)) {
        const target = hostiles.find((h) => h.id === current.targetFleetId)!;
        changed = this.moveTo(fleet, target.x, target.y) || changed;
        continue;
      }

      free.push(fleet);
    }

    // 4. New interceptions: threats near AI territory or near our fleets,
    // engaged only with a sufficient strength advantage.
    // Only fleets the faction can currently see can be intercepted.
    const threats = hostiles
      .filter((h) => this.intelService.isVisible(faction.id, h.id) && !this.intelService.isUncertain(faction.id, h.id))
      .filter((h) =>
        ownedSystems.some((s) => this.distance(h, s) <= EnemyFleetService.THREAT_RADIUS)
        || free.some((f) => this.distance(h, f) <= EnemyFleetService.DANGER_RADIUS))
      .sort((a, b) => this.minDistance(a, ownedSystems) - this.minDistance(b, ownedSystems) || a.id - b.id);

    for (const threat of threats) {
      // Strength already committed to this threat counts, so one weak
      // intruder does not pull every fleet off its post.
      const committedFleets = managed
        .filter((f) => !free.includes(f))
        .filter((f) => this.assignments.get(f.id)?.role === 'intercept' && this.assignments.get(f.id)?.targetFleetId === threat.id);
      if (committedFleets.length > 0 && canWin(committedFleets, [threat])) {
        continue;
      }
      // Add the nearest free fleets until the engagement is judged winnable.
      const byDistance = [...free].sort((a, b) => this.distance(a, threat) - this.distance(b, threat) || a.id - b.id);
      const group: Fleet[] = [];
      let winnable = false;
      for (const fleet of byDistance.slice(0, EnemyFleetService.ASSAULT_MAX_GROUP)) {
        group.push(fleet);
        if (canWin([...committedFleets, ...group], [threat])) {
          winnable = true;
          break;
        }
      }
      if (!winnable) {
        continue;
      }
      for (const fleet of group) {
        const current = this.assignments.get(fleet.id);
        changed = this.assign(fleet, { role: 'intercept', targetFleetId: threat.id, since: clock }, current) || changed;
        changed = this.moveTo(fleet, threat.x, threat.y) || changed;
        free.splice(free.indexOf(fleet), 1);
      }
    }

    // 4b. Advance active assaults; 4c. plan a new one when none is active.
    const data = { factions, starSystems: real.starSystems, fleets: real.fleets, production };
    changed = this.advanceAssaults(faction, assaultFleets, free, starSystems, data, clock) || changed;
    if (assaultFleets.length === 0 && clock >= (this.nextAssaultPlanAt.get(faction.id) ?? 0)
      && this.planService.getPosture(faction).allowAssault) {
      this.nextAssaultPlanAt.set(faction.id, clock + EnemyFleetService.ASSAULT_PLANNING_INTERVAL);
      changed = this.planAssault(faction, factions, starSystems, ownedSystems, home, free, managed, clock) || changed;
    }

    // 4d. Fog of war: send one free fleet to chart the nearest unknown system
    // (also without any planet left: exploring is part of the recovery route).
    changed = this.planExploration(faction, starSystems, ownedSystems, home, free, managed, clock) || changed;

    // 4e. Opportunistic asteroid salvage with one free fleet.
    changed = this.planSalvage(faction, ownedSystems, home, free, managed, clock) || changed;

    // 5. Garrison duty for everyone else.
    if (home) {
      changed = this.assignGarrisons(free, ownedSystems, home, clock) || changed;
    }
    return changed;
  }

  private planExploration(
    faction: Faction,
    starSystems: StarSystem[],
    ownedSystems: StarSystem[],
    home: StarSystem | undefined,
    free: Fleet[],
    managed: Fleet[],
    clock: number,
  ): boolean {
    if (!this.intelService.enabled || managed.some((f) => this.assignments.get(f.id)?.role === 'explore')) {
      return false;
    }
    const reach = this.reachService.getReach(faction) * EnemyFleetService.EXPLORE_REACH_FACTOR;
    // Distance from the faction's territory, or from its fleets when it owns no planet.
    const origins: { x: number; y: number }[] = ownedSystems.length > 0 ? ownedSystems : managed;
    const distanceToTerritory = (s: StarSystem) =>
      origins.reduce((min, o) => Math.min(min, this.distance(o, s)), Infinity);
    const target = starSystems
      .filter((s) => !this.intelService.knowsSystem(faction.id, s.id) && distanceToTerritory(s) <= reach)
      .sort((a, b) => distanceToTerritory(a) - distanceToTerritory(b) || a.id.localeCompare(b.id))[0];
    if (!target) {
      return false;
    }
    // The weakest free fleet explores; the strongest fleet at home stays.
    const homeGuard = home
      ? free
        .filter((f) => this.cellKey(f.x, f.y) === this.cellKey(home.x, home.y))
        .sort((a, b) => this.strength(b) - this.strength(a))[0]
      : undefined;
    const explorer = [...free]
      .filter((f) => !(homeGuard && free.length > 1 && f.id === homeGuard.id))
      .sort((a, b) => this.strength(a) - this.strength(b) || a.id - b.id)[0];
    if (!explorer || (home && free.length === 1 && explorer.id === homeGuard?.id && managed.length === 1)) {
      return false;
    }
    this.assignments.set(explorer.id, { role: 'explore', systemId: target.id, since: clock });
    free.splice(free.indexOf(explorer), 1);
    return this.moveTo(explorer, target.x, target.y);
  }

  /*
   * Meeting point for a salvage run, or null when the asteroid is gone, no
   * longer visible to the faction, or can no longer be reached in time.
   */
  private salvagePoint(faction: Faction, fleet: Fleet, asteroidId: number): { x: number; y: number } | null {
    const asteroid = this.asteroidService.getAsteroid(asteroidId);
    if (!asteroid || !this.canSeeAsteroid(faction, asteroidPosition(asteroid))) {
      return null;
    }
    const plan = this.asteroidService.planIntercept(fleet, asteroid);
    return plan && plan.time <= EnemyFleetService.SALVAGE_MAX_ETA * 1.5 ? plan.point : null;
  }

  /*
   * Same visibility rule as the player's map: asteroids are seen anywhere
   * except inside a nebula, where only sensor coverage reveals them.
   */
  private canSeeAsteroid(faction: Faction, pos: { x: number; y: number }): boolean {
    return !this.asteroidService.isInNebula(pos) || this.intelService.isPointSensed(faction.id, pos.x, pos.y);
  }

  private planSalvage(
    faction: Faction,
    ownedSystems: StarSystem[],
    home: StarSystem | undefined,
    free: Fleet[],
    managed: Fleet[],
    clock: number,
  ): boolean {
    const asteroids = this.asteroidService.active;
    if (asteroids.length === 0 || free.length === 0 || ownedSystems.length === 0) {
      return false;
    }
    if (managed.some((f) => this.assignments.get(f.id)?.role === 'salvage')) {
      return false;
    }
    // Never strip the last defender from home: the strongest free fleet
    // parked at home stays, as for exploration.
    const homeGuard = home
      ? free
        .filter((f) => this.cellKey(f.x, f.y) === this.cellKey(home.x, home.y))
        .sort((a, b) => this.strength(b) - this.strength(a))[0]
      : undefined;
    const candidates = free.filter((f) => f.id !== homeGuard?.id);
    // Asteroids another faction's fleet is already chasing are left alone,
    // so two AI factions do not race for the same rock.
    const claimed = new Set([...this.assignments.values()].filter((a) => a.role === 'salvage').map((a) => a.asteroidId));

    let best: { fleet: Fleet; asteroidId: number; point: { x: number; y: number }; time: number } | null = null;
    for (const asteroid of asteroids) {
      if (claimed.has(asteroid.id) || !this.canSeeAsteroid(faction, asteroidPosition(asteroid))) {
        continue;
      }
      for (const fleet of candidates) {
        const plan = this.asteroidService.planIntercept(fleet, asteroid);
        if (!plan || plan.time > EnemyFleetService.SALVAGE_MAX_ETA) {
          continue;
        }
        if (ownedSystems.reduce((min, s) => Math.min(min, this.distance(plan.point, s)), Infinity) > EnemyFleetService.SALVAGE_TERRITORY_RANGE) {
          continue;
        }
        if (!best || plan.time < best.time || (plan.time === best.time && fleet.id < best.fleet.id)) {
          best = { fleet, asteroidId: asteroid.id, point: plan.point, time: plan.time };
        }
      }
    }
    if (!best) {
      return false;
    }
    this.assignments.set(best.fleet.id, { role: 'salvage', asteroidId: best.asteroidId, since: clock });
    free.splice(free.indexOf(best.fleet), 1);
    return this.moveTo(best.fleet, best.point.x, best.point.y);
  }

  private isAssaultStillValid(
    assignment: FleetAssignment,
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    clock: number,
  ): boolean {
    const target = this.findPlanet(starSystems, assignment.planetId);
    if (!target) {
      return false;
    }
    if (assignment.launched) {
      // Kept until advanceAssaults has observed the player battle's result.
      return true;
    }
    if (!this.invasionService.isHostilePlanet(target.planet, faction, factions)) {
      return false;
    }
    return assignment.arrivedAt !== undefined || clock - assignment.since <= EnemyFleetService.ASSAULT_TRAVEL_TIMEOUT;
  }

  /*
   * advanceAssaults: Moves assault fleets to their target, waits for the
   * group to gather (or the gather timeout) and launches the assault via
   * EnemyInvasionService. Fleets released here are added to `free`.
   */
  private advanceAssaults(
    faction: Faction,
    assaultFleets: Fleet[],
    free: Fleet[],
    starSystems: StarSystem[],
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; production: FactionProduction[] },
    clock: number,
  ): boolean {
    let changed = false;
    const byPlanet = new Map<number, Fleet[]>();
    for (const fleet of assaultFleets) {
      const planetId = this.assignments.get(fleet.id)!.planetId!;
      byPlanet.set(planetId, [...(byPlanet.get(planetId) ?? []), fleet]);
    }

    for (const [planetId, group] of byPlanet) {
      // The real planet: launches and results must use authoritative state.
      const target = this.findPlanet(data.starSystems, planetId) ?? this.findPlanet(starSystems, planetId)!;
      const assignments = group.map((f) => this.assignments.get(f.id)!);

      // A queued player battle: wait until it has been fought, then read the result.
      if (assignments.some((a) => a.launched)) {
        if (this.invasionService.hasPendingBattleFor(planetId)) {
          continue;
        }
        const captured = target.planet.factionId === faction.id;
        this.finishAssault(faction, group, target, captured, free, clock);
        continue;
      }

      for (const fleet of group) {
        changed = this.moveTo(fleet, target.system.x, target.system.y) || changed;
      }
      const present = group.filter((f) => this.cellKey(f.x, f.y) === this.cellKey(target.system.x, target.system.y));
      if (present.length === 0) {
        continue;
      }
      const firstArrival = Math.min(...assignments.map((a) => a.arrivedAt ?? clock));
      for (const a of assignments) {
        a.arrivedAt = firstArrival;
      }
      const gathered = present.length === group.length;
      if (!gathered && clock - firstArrival < EnemyFleetService.ASSAULT_GATHER_TIMEOUT) {
        continue;
      }

      const result = this.invasionService.launch(present, target.planet, target.system, data);
      this.assaultReports.push({ factionId: faction.id, planetId, result, time: clock });
      // Bounded diagnostic history.
      if (this.assaultReports.length > 200) {
        this.assaultReports.splice(0, this.assaultReports.length - 200);
      }
      changed = true;
      if (result === 'pending_player') {
        for (const a of assignments) {
          a.launched = true;
        }
        continue;
      }
      this.finishAssault(faction, group, target, result === 'captured', free, clock);
    }
    return changed;
  }

  private finishAssault(
    faction: Faction,
    group: Fleet[],
    target: { system: StarSystem; planet: PlanetTile },
    captured: boolean,
    free: Fleet[],
    clock: number,
  ): void {
    if (!captured) {
      this.failedAssaults.set(`${faction.id}:${target.planet.id}`, clock + EnemyFleetService.ASSAULT_RETRY_DELAY);
    }
    for (const fleet of group) {
      if (!this.isAlive(fleet)) {
        this.assignments.delete(fleet.id);
        continue;
      }
      // Captured: garrison the conquered system. Repelled: hand the fleet
      // back; the regroup rule picks up its losses on the next decision.
      this.assignments.set(
        fleet.id,
        captured ? { role: 'garrison', systemId: target.system.id, since: clock } : { role: 'garrison', since: clock },
      );
      free.push(fleet);
    }
  }

  /*
   * planAssault: Picks the most valuable reachable hostile planet the
   * faction can take with the forecast and commitment limits, and assigns
   * the smallest group (strongest first) that achieves it.
   */
  private planAssault(
    faction: Faction,
    factions: Faction[],
    starSystems: StarSystem[],
    ownedSystems: StarSystem[],
    home: StarSystem | undefined,
    free: Fleet[],
    managed: Fleet[],
    clock: number,
  ): boolean {
    const origins: { x: number; y: number }[] = ownedSystems.length > 0 ? ownedSystems : managed;
    const candidates: { system: StarSystem; planet: PlanetTile; score: number; distance: number }[] = [];
    for (const system of starSystems) {
      const distance = origins.reduce((min, o) => Math.min(min, this.distance(o, system)), Infinity);
      if (distance > AI_COLONIZATION_REACH) {
        continue;
      }
      for (const planet of system.planetsTiles) {
        if (!this.invasionService.isHostilePlanet(planet, faction, factions)) {
          continue;
        }
        if ((this.failedAssaults.get(`${faction.id}:${planet.id}`) ?? -Infinity) > clock) {
          continue;
        }
        const value = 1 + (planet.population ?? 0) / 100 + planet.buildings.length;
        candidates.push({ system, planet, distance, score: value / (1 + distance / 10) });
      }
    }
    if (candidates.length === 0) {
      return false;
    }
    candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || a.planet.id - b.planet.id);

    // Keep the strongest fleet guarding home (when there is more than one),
    // and never commit more than the posture allows (1 - homeGuardFraction,
    // i.e. 70% for the neutral posture) of the managed strength.
    const posture = this.planService.getPosture(faction);
    const maxCommit = 1 - posture.homeGuardFraction;
    const totalStrength = managed.reduce((sum, f) => sum + this.strength(f), 0);
    const homeGuard = home
      ? free
        .filter((f) => this.cellKey(f.x, f.y) === this.cellKey(home.x, home.y))
        .sort((a, b) => this.strength(b) - this.strength(a))[0]
      : undefined;
    const pool = free
      .filter((f) => !(homeGuard && free.length > 1 && f.id === homeGuard.id))
      .sort((a, b) => this.strength(b) - this.strength(a) || a.id - b.id);

    for (const target of candidates.slice(0, 3)) {
      const group: Fleet[] = [];
      let committed = 0;
      for (const fleet of pool) {
        if (group.length >= EnemyFleetService.ASSAULT_MAX_GROUP) {
          break;
        }
        if (committed + this.strength(fleet) > maxCommit * totalStrength && group.length > 0) {
          break;
        }
        group.push(fleet);
        committed += this.strength(fleet);
        const forecast = this.invasionService.forecast(group, target.planet, factions);
        if (forecast.win && forecast.survivingRatio >= posture.assaultMinSurvival) {
          for (const member of group) {
            this.assignments.set(member.id, { role: 'assault', planetId: target.planet.id, systemId: target.system.id, since: clock });
            free.splice(free.indexOf(member), 1);
            this.moveTo(member, target.system.x, target.system.y);
          }
          return true;
        }
      }
    }
    return false;
  }

  private findPlanet(starSystems: StarSystem[], planetId: number | undefined): { system: StarSystem; planet: PlanetTile } | undefined {
    if (planetId === undefined) {
      return undefined;
    }
    for (const system of starSystems) {
      const planet = system.planetsTiles.find((p) => p.id === planetId);
      if (planet) {
        return { system, planet };
      }
    }
    return undefined;
  }

  private isInterceptStillValid(
    assignment: FleetAssignment,
    fleet: Fleet,
    hostiles: Fleet[],
    ownedSystems: StarSystem[],
    canWin: (attackers: Fleet[], defenders: Fleet[]) => boolean,
    managed: Fleet[],
    clock: number,
  ): boolean {
    const target = hostiles.find((h) => h.id === assignment.targetFleetId);
    if (!target) {
      return false;
    }
    if (clock - assignment.since > EnemyFleetService.INTERCEPT_TIMEOUT) {
      return false;
    }
    if (this.minDistance(target, ownedSystems) > EnemyFleetService.PURSUIT_LEASH) {
      return false;
    }
    // Re-check the odds with the whole intercepting group: the target may
    // have been reinforced, or our group may have taken losses.
    const group = managed.filter(
      (f) => this.assignments.get(f.id)?.role === 'intercept' && this.assignments.get(f.id)?.targetFleetId === target.id,
    );
    return canWin(group.length > 0 ? group : [fleet], [target]);
  }

  /*
   * assignGarrisons: Keeps existing garrison posts when still owned
   * (no oscillation), otherwise fills the primary Spaceport system first
   * and then other owned systems one fleet each; extra fleets stay home.
   */
  private assignGarrisons(free: Fleet[], ownedSystems: StarSystem[], home: StarSystem, clock: number): boolean {
    let changed = false;
    const ownedIds = new Set(ownedSystems.map((s) => s.id));
    const covered = new Set<string>();
    const unposted: Fleet[] = [];

    for (const fleet of [...free].sort((a, b) => a.id - b.id)) {
      const current = this.assignments.get(fleet.id);
      if (current?.role === 'garrison' && current.systemId && ownedIds.has(current.systemId)
        && (current.systemId === home.id || !covered.has(current.systemId))) {
        covered.add(current.systemId);
      } else {
        unposted.push(fleet);
      }
    }

    const openPosts = [home, ...ownedSystems.filter((s) => s.id !== home.id)].filter(
      (s) => s.id === home.id ? !covered.has(home.id) : !covered.has(s.id),
    );
    for (const fleet of unposted) {
      const post = openPosts.shift() ?? home;
      covered.add(post.id);
      changed = this.assign(fleet, { role: 'garrison', systemId: post.id, since: clock }, this.assignments.get(fleet.id)) || changed;
    }

    for (const fleet of free) {
      const post = ownedSystems.find((s) => s.id === this.assignments.get(fleet.id)?.systemId) ?? home;
      changed = this.moveTo(fleet, post.x, post.y) || changed;
    }
    return changed;
  }

  private assign(fleet: Fleet, next: FleetAssignment, current: FleetAssignment | undefined): boolean {
    if (current && current.role === next.role && current.systemId === next.systemId
      && current.targetFleetId === next.targetFleetId && current.planetId === next.planetId) {
      return false;
    }
    this.assignments.set(fleet.id, next);
    return false; // An assignment alone does not change game state.
  }

  /*
   * moveTo: Sets the fleet's galaxy target unless it already heads there
   * or is parked in that cell. Returns true only when the order changed.
   */
  private moveTo(fleet: Fleet, x: number, y: number): boolean {
    if (fleet.targetX === x && fleet.targetY === y) {
      return false;
    }
    if (fleet.targetX === null && this.cellKey(fleet.x, fleet.y) === this.cellKey(x, y)) {
      return false;
    }
    fleet.targetX = x;
    fleet.targetY = y;
    return true;
  }

  private primarySpaceportSystem(factionId: string, starSystems: StarSystem[]): StarSystem | undefined {
    // Same ordering as EnemyEconomyService deployment, so regrouping fleets
    // wait exactly where new ships are deployed.
    return [...this.spaceportService.listSpaceports(factionId, starSystems)]
      .sort((a, b) => a.system.id.localeCompare(b.system.id) || a.planet.id - b.planet.id)[0]?.system;
  }

  private ownedSystemsSorted(factionId: string, starSystems: StarSystem[]): StarSystem[] {
    return starSystems
      .filter((s) => s.planetsTiles.some((p) => p.factionId === factionId))
      .sort((a, b) => b.planetsTiles.filter((p) => p.factionId === factionId).length
        - a.planetsTiles.filter((p) => p.factionId === factionId).length || a.id.localeCompare(b.id));
  }

  private isAlive(fleet: Fleet): boolean {
    return !fleet.destroyed && fleet.ships.some((s) => !s.destroyed);
  }

  private strength(fleet: Fleet): number {
    return this.shipService.calculateFleetStrength(fleet.ships);
  }

  private distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private minDistance(fleet: Fleet, systems: StarSystem[]): number {
    return systems.reduce((min, s) => Math.min(min, this.distance(fleet, s)), Infinity);
  }

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x)},${Math.floor(y)}`;
  }
}

import { Injectable } from '@angular/core';
import { ActionResult, Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { EnemyPlanService } from './enemy-plan.service';
import { isCombatShipType } from './ai-queries';
import { ShipService } from '../../services/ship.service';

/*
 * =========================================================
 * ENEMY PROGRESS SERVICE (deadlock detection and recovery)
 * =========================================================
 *
 * Watches every AI faction for situations where it keeps trying without
 * getting anywhere and triggers a targeted replan — never a reset of the
 * whole AI, and never more often than REPLAN_COOLDOWN per faction and
 * detector. Detectors (checked every SAMPLE_INTERVAL of game time):
 *
 *   no_valid_action   — the primary action is 'none' with the same reason
 *                       for NO_ACTION_WINDOW → abandon the primary goal
 *                       (its target is remembered and skipped for a while).
 *   repeated_failure  — an assemble / create / reinforce / colonize action
 *                       stays current for FAILURE_WINDOW without the
 *                       executor ever succeeding → abandon that goal.
 *   stuck_fleet       — a fleet with a movement order has not moved for
 *                       STUCK_WINDOW → clear the order and release the
 *                       fleet (fleet operations), or abandon the goal it
 *                       serves (pipeline fleet).
 *   stagnation        — no progress metric improved for STAGNATION_WINDOW
 *                       although the posture still shows opportunities
 *                       (expansion, research or offense) → abandon both
 *                       goal slots so the pipeline re-selects.
 *   saturated         — same, but no opportunity remains (everything in
 *                       reach is taken, the tree is researched, the
 *                       military is at target): recorded, no replan.
 *
 * Progress metrics: owned planets, buildings, researched technologies,
 * living combat ships (fleets + stock). Any increase counts as progress.
 * State is in-memory and reset on load with the rest of the pipeline.
 */
export type DeadlockType = 'no_valid_action' | 'repeated_failure' | 'stuck_fleet' | 'stagnation' | 'saturated';

export interface DeadlockEvent {
  time: number;
  factionId: string;
  type: DeadlockType;
  detail: string;
}

export interface ActionRecord {
  type: string;
  goalType: string;
  reason: string;
  time: number;
}

/* Read-only status for the AI debug panel (EnemyDebugService). */
export interface FactionProgressStatus {
  clock: number;
  secondsSinceProgress: number;
  lastCompleted?: ActionRecord;
  lastFailed?: ActionRecord;
  recentEvents: DeadlockEvent[];
}

interface FactionProgress {
  lastCompleted?: ActionRecord;
  lastFailed?: ActionRecord;
  clock: number;
  nextSampleAt: number;
  metrics: string;
  lastProgressAt: number;
  actionKey?: string;
  actionSince: number;
  actionSucceeded: boolean;
  lastReplan: Map<DeadlockType, number>;
}

@Injectable({ providedIn: 'root' })
export class EnemyProgressService {
  private static readonly SAMPLE_INTERVAL = 10;
  private static readonly NO_ACTION_WINDOW = 60;
  private static readonly FAILURE_WINDOW = 90;
  private static readonly STUCK_WINDOW = 30;
  private static readonly STAGNATION_WINDOW = 240;
  private static readonly REPLAN_COOLDOWN = 60;
  // Diagnostic history is bounded so long games cannot grow it without limit.
  static readonly MAX_EVENTS = 200;
  private static readonly FAILURE_WATCHED: ReadonlySet<string> = new Set(['assemble_fleet', 'create_fleet', 'reinforce_fleet', 'colonize']);

  private readonly progress = new Map<string, FactionProgress>();
  // fleetId → last sampled position and when it last moved.
  private readonly fleetMotion = new Map<number, { x: number; y: number; movedAt: number }>();
  private readonly events: DeadlockEvent[] = [];

  constructor(
    private readonly goalService: EnemyGoalService,
    private readonly fleetService: EnemyFleetService,
    private readonly planService: EnemyPlanService,
    private readonly shipService: ShipService,
  ) {}

  reset(): void {
    this.progress.clear();
    this.fleetMotion.clear();
    this.events.length = 0;
  }

  getEvents(): readonly DeadlockEvent[] {
    return this.events;
  }

  private pushEvent(event: DeadlockEvent): void {
    this.events.push(event);
    if (this.events.length > EnemyProgressService.MAX_EVENTS) {
      this.events.splice(0, this.events.length - EnemyProgressService.MAX_EVENTS);
    }
  }

  /* Called once per frame per faction with whether the primary action executed this frame. */
  recordExecution(factionId: string, action: ActionResult | undefined, succeeded: boolean): void {
    const state = this.progress.get(factionId);
    if (!state || !action) {
      return;
    }
    const key = this.actionKey(action);
    if (state.actionKey !== key) {
      state.actionKey = key;
      state.actionSince = state.clock;
      state.actionSucceeded = false;
      // A 'none' action is a failed attempt to find something to do.
      if (action.type === 'none') {
        state.lastFailed = { type: action.type, goalType: action.goalType, reason: action.reason, time: state.clock };
      }
    }
    if (succeeded) {
      state.actionSucceeded = true;
      state.lastCompleted = { type: action.type, goalType: action.goalType, reason: action.reason, time: state.clock };
    }
  }

  getStatus(factionId: string): FactionProgressStatus | undefined {
    const state = this.progress.get(factionId);
    if (!state) {
      return undefined;
    }
    return {
      clock: state.clock,
      secondsSinceProgress: state.clock - state.lastProgressAt,
      lastCompleted: state.lastCompleted,
      lastFailed: state.lastFailed,
      recentEvents: this.events.filter((e) => e.factionId === factionId).slice(-5),
    };
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    data: { starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] },
    primaryAction: ActionResult | undefined,
    pipelineFleetIds: ReadonlySet<number>,
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return false;
    }
    const state = this.state(faction.id);
    state.clock += gameDeltaTime;
    if (state.clock < state.nextSampleAt) {
      return false;
    }
    state.nextSampleAt = state.clock + EnemyProgressService.SAMPLE_INTERVAL;

    const metrics = this.metrics(faction, data);
    if (state.metrics === '' || this.improved(state.metrics, metrics)) {
      state.lastProgressAt = state.clock;
    }
    state.metrics = metrics;

    let changed = false;
    changed = this.checkStuckFleets(faction, data.fleets, pipelineFleetIds, state) || changed;
    changed = this.checkAction(faction, primaryAction, state) || changed;
    this.checkStagnation(faction, state);
    return changed;
  }

  private checkAction(faction: Faction, action: ActionResult | undefined, state: FactionProgress): boolean {
    if (!action || state.actionKey !== this.actionKey(action)) {
      return false;
    }
    const age = state.clock - state.actionSince;
    if (action.type === 'none' && age >= EnemyProgressService.NO_ACTION_WINDOW) {
      return this.replan(faction, state, 'no_valid_action', `${action.goalType}: ${action.reason}`, () => {
        this.goalService.abandonGoal(faction.id, 'primary');
        state.actionSince = state.clock;
      });
    }
    if (EnemyProgressService.FAILURE_WATCHED.has(action.type) && !state.actionSucceeded
      && age >= EnemyProgressService.FAILURE_WINDOW) {
      state.lastFailed = { type: action.type, goalType: action.goalType, reason: `never succeeded: ${action.reason}`, time: state.clock };
      return this.replan(faction, state, 'repeated_failure', `${action.type}: ${action.reason}`, () => {
        this.goalService.abandonGoal(faction.id, 'primary');
        state.actionSince = state.clock;
      });
    }
    return false;
  }

  private checkStuckFleets(faction: Faction, fleets: Fleet[], pipelineFleetIds: ReadonlySet<number>, state: FactionProgress): boolean {
    let changed = false;
    for (const fleet of fleets) {
      if (fleet.factionId !== faction.id) {
        continue;
      }
      if (fleet.destroyed) {
        // Keep the motion map bounded by living fleets.
        this.fleetMotion.delete(fleet.id);
        continue;
      }
      const motion = this.fleetMotion.get(fleet.id);
      const moved = !motion || Math.hypot(motion.x - fleet.x, motion.y - fleet.y) > 0.05;
      if (moved || fleet.targetX === null) {
        this.fleetMotion.set(fleet.id, { x: fleet.x, y: fleet.y, movedAt: state.clock });
        continue;
      }
      if (state.clock - motion.movedAt < EnemyProgressService.STUCK_WINDOW) {
        continue;
      }
      // Has an order but has not moved: the objective cannot be completed.
      this.pushEvent({ time: state.clock, factionId: faction.id, type: 'stuck_fleet', detail: `fleet ${fleet.id}`, dbg: `spd=${fleet.speed} pos=${fleet.x.toFixed(2)},${fleet.y.toFixed(2)} tgt=${fleet.targetX?.toFixed(2)},${fleet.targetY?.toFixed(2)} alive=${fleet.ships.filter((s) => !s.destroyed).length} role=${(this.fleetService as any).assignments.get(fleet.id)?.role} sys=${fleet.system?.id} pipe=${pipelineFleetIds.has(fleet.id)} others=${fleets.filter((o) => o.id !== fleet.id && !o.destroyed && Math.floor(o.x) === Math.floor(fleet.x) && Math.floor(o.y) === Math.floor(fleet.y)).map((o) => o.factionId + '#' + o.id).join('/')}` } as any);
      if (pipelineFleetIds.has(fleet.id)) {
        const carriesColonizer = fleet.ships.some((s) => s.type === 'colonizer' && !s.destroyed);
        this.goalService.abandonGoal(faction.id, carriesColonizer && this.goalService.getColonizationGoal(faction.id) ? 'colonization' : 'primary');
        fleet.targetX = null;
        fleet.targetY = null;
      } else {
        this.fleetService.releaseFleet(fleet);
      }
      this.fleetMotion.set(fleet.id, { x: fleet.x, y: fleet.y, movedAt: state.clock });
      changed = true;
    }
    return changed;
  }

  private checkStagnation(faction: Faction, state: FactionProgress): void {
    if (state.clock - state.lastProgressAt < EnemyProgressService.STAGNATION_WINDOW) {
      return;
    }
    const scores = this.planService.getPosture(faction).scores;
    const opportunities = scores.expansion > 0 || scores.research > 0 || scores.offense > 0;
    if (!opportunities) {
      this.replan(faction, state, 'saturated', 'no opportunity left in reach', () => {
        state.lastProgressAt = state.clock;
      });
      return;
    }
    this.replan(faction, state, 'stagnation', `no progress for ${EnemyProgressService.STAGNATION_WINDOW}s`, () => {
      this.goalService.abandonGoal(faction.id, 'primary');
      this.goalService.abandonGoal(faction.id, 'colonization');
      state.lastProgressAt = state.clock;
    });
  }

  private replan(faction: Faction, state: FactionProgress, type: DeadlockType, detail: string, apply: () => void): boolean {
    const last = state.lastReplan.get(type) ?? -Infinity;
    if (state.clock - last < EnemyProgressService.REPLAN_COOLDOWN) {
      return false;
    }
    state.lastReplan.set(type, state.clock);
    this.pushEvent({ time: state.clock, factionId: faction.id, type, detail });
    apply();
    return type !== 'saturated';
  }

  private metrics(faction: Faction, data: { starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] }): string {
    const planets = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
    const buildings = planets.reduce((sum, p) => sum + p.buildings.length, 0);
    const techs = (faction.researchedTechnologies ?? []).length;
    const isCombat = (type: string) => isCombatShipType(this.shipService.getShipType(type));
    const combat = data.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .reduce((sum, f) => sum + f.ships.filter((s) => !s.destroyed && isCombat(s.type)).length, 0)
      + (data.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).filter((s) => isCombat(s.type)).length;
    return [planets.length, buildings, techs, combat].join(',');
  }

  private improved(previous: string, next: string): boolean {
    const a = previous.split(',').map(Number);
    const b = next.split(',').map(Number);
    return b.some((value, i) => value > a[i]);
  }

  private actionKey(action: ActionResult): string {
    return `${action.type}|${action.goalType}|${action.targetId ?? ''}|${action.targetPlanetId ?? ''}|${action.reason}`;
  }

  private state(factionId: string): FactionProgress {
    let state = this.progress.get(factionId);
    if (!state) {
      state = { clock: 0, nextSampleAt: 0, metrics: '', lastProgressAt: 0, actionSince: 0, actionSucceeded: false, lastReplan: new Map() };
      this.progress.set(factionId, state);
    }
    return state;
  }
}

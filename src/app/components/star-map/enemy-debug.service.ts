import { Injectable } from '@angular/core';
import { Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import { EnemyPlanService } from './enemy-plan.service';
import { EnemyStrategyService } from './enemy-strategy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyActionService } from './enemy-action.service';
import { EnemyCapabilityService } from './enemy-capability.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { EnemyProgressService, ActionRecord, DeadlockEvent } from './enemy-progress.service';
import { EnemyIntelService, IntelSummary } from './enemy-intel.service';
import { EconomyService } from '../../services/economy.service';
import { getAiPersonalityProfile } from './ai-personality';

/*
 * =========================================================
 * ENEMY DEBUG SERVICE (AI observability)
 * =========================================================
 *
 * Builds read-only per-faction snapshots of the AI's state for the
 * developer panel (AiDebugPanelComponent, toggled with F9 on the star map)
 * and for tests. Nothing here runs per frame: snapshots are built only when
 * asked for (the panel refreshes about once per second while open), and
 * the service never changes game or AI state.
 *
 * `consoleEnabled` (off by default) additionally prints new deadlock /
 * replan events to the console, at most once per snapshot refresh — the
 * only console output of the AI layer.
 */
export interface FleetObjective {
  fleetId: number;
  name: string;
  role: string;
  target?: string;
}

export interface AiDebugSnapshot {
  factionId: string;
  name: string;
  personality: string;
  difficulty: string;
  priority: string;
  strategy: string;
  goal: string;
  action: string;
  colonizationGoal: string;
  colonizationAction: string;
  fleets: FleetObjective[];
  lastCompleted?: ActionRecord;
  lastFailed?: ActionRecord;
  shortages: string[];
  recentReplans: DeadlockEvent[];
  secondsSinceProgress: number;
  credits: number;
  research: number;
  intel: IntelSummary;
}

@Injectable({ providedIn: 'root' })
export class EnemyDebugService {
  consoleEnabled = false;
  // Events already printed (the event history is a capped ring, so track identity, not counts).
  private readonly logged = new WeakSet<DeadlockEvent>();

  constructor(
    private readonly plan: EnemyPlanService,
    private readonly strategy: EnemyStrategyService,
    private readonly goals: EnemyGoalService,
    private readonly actions: EnemyActionService,
    private readonly capabilities: EnemyCapabilityService,
    private readonly fleetOps: EnemyFleetService,
    private readonly progress: EnemyProgressService,
    private readonly intel: EnemyIntelService,
    private readonly economy: EconomyService,
  ) {}

  snapshots(data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock?: FactionShipStock[] }): AiDebugSnapshot[] {
    const result = data.factions.filter((f) => f.ai === true).map((f) => this.snapshot(f, data));
    this.logNewEvents();
    return result;
  }

  private snapshot(faction: Faction, data: { starSystems: StarSystem[]; fleets: Fleet[] }): AiDebugSnapshot {
    const goal = this.goals.getGoal(faction.id);
    const action = this.actions.getAction(faction.id);
    const colonization = this.goals.getColonizationGoal(faction.id);
    const colonizationAction = this.actions.getColonizationAction(faction.id);
    const status = this.progress.getStatus(faction.id);
    const describeGoal = (g: typeof goal) =>
      !g ? '—' : g.type === 'colonize' ? `colonize planet ${g.targetPlanetId} (${g.targetSystemId})`
        : g.type === 'attack' ? `attack fleet ${g.targetFleetId}`
          : g.type === 'defend' ? `defend planet ${g.targetPlanetId} (${g.targetSystemId})` : g.type;
    const describeAction = (a: typeof action) => (a ? `${a.type} — ${a.reason}` : '—');

    const fleets: FleetObjective[] = data.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed && f.ships.some((s) => !s.destroyed))
      .map((f) => {
        const assignment = this.fleetOps.getAssignment(f.id);
        const carrier = f.ships.some((s) => s.type === 'colonizer' && !s.destroyed);
        const role = assignment?.role ?? (carrier ? 'colonization' : 'pipeline');
        const target = assignment?.planetId !== undefined ? `planet ${assignment.planetId}`
          : assignment?.targetFleetId !== undefined ? `fleet ${assignment.targetFleetId}`
            : assignment?.systemId;
        return { fleetId: f.id, name: f.name, role, target };
      });

    return {
      factionId: faction.id,
      name: faction.name,
      personality: getAiPersonalityProfile(faction).id,
      difficulty: faction.aiDifficulty ?? 'normal',
      priority: this.plan.getPosture(faction).primary,
      strategy: this.strategy.getStrategy(faction.id) ?? '—',
      goal: describeGoal(goal),
      action: describeAction(action),
      colonizationGoal: describeGoal(colonization),
      colonizationAction: describeAction(colonizationAction),
      fleets,
      lastCompleted: status?.lastCompleted,
      lastFailed: status?.lastFailed,
      shortages: this.shortages(faction, data.starSystems),
      recentReplans: status?.recentEvents ?? [],
      secondsSinceProgress: Math.round(status?.secondsSinceProgress ?? 0),
      credits: Math.round(faction.currencies['credits'] ?? 0),
      research: Math.round(faction.currencies['research'] ?? 0),
      intel: this.intel.summary(faction.id, data.starSystems.length),
    };
  }

  /* Missing prerequisites (unsatisfied capability requirements) and economic shortages. */
  private shortages(faction: Faction, starSystems: StarSystem[]): string[] {
    const out: string[] = [];
    const capability = this.capabilities.getCapability(faction.id);
    for (const requirement of capability?.requirements ?? []) {
      if (!requirement.satisfied && requirement.type !== 'fleet_needs_reinforcement') {
        out.push(`${capability!.goalType}: ${requirement.reason}`);
      }
    }
    const owned = starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
    for (const planet of owned) {
      const e = this.economy.calculatePlanetEconomy(planet);
      if (e.energyProduction < e.energyConsumption) out.push(`${planet.name}: energy ${e.energyProduction}/${e.energyConsumption}`);
      if (e.workforceAvailable < e.workforceRequired) out.push(`${planet.name}: workforce ${e.workforceAvailable}/${e.workforceRequired}`);
      if ((planet.satisfaction ?? 100) < 40) out.push(`${planet.name}: satisfaction ${Math.round(planet.satisfaction ?? 0)}%`);
    }
    if (!owned.some((p) => p.buildings.some((b) => b.name === 'Spaceship Factory'))) out.push('no Spaceship Factory');
    if (!owned.some((p) => p.buildings.some((b) => b.name === 'Spaceport'))) out.push('no Spaceport');
    return out;
  }

  private logNewEvents(): void {
    if (!this.consoleEnabled) {
      return;
    }
    const fresh = this.progress.getEvents().filter((e) => !this.logged.has(e));
    for (const event of fresh) {
      this.logged.add(event);
    }
    // Throttled: at most 10 lines per refresh (about once per second).
    for (const event of fresh.slice(-10)) {
      console.debug(`[AI] ${event.factionId} ${event.type} @${event.time.toFixed(0)}s: ${event.detail}`);
    }
  }

}

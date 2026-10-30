import { Injectable } from '@angular/core';
import { EnemyAiService } from './enemy-ai.service';
import { EnemyStrategyService } from './enemy-strategy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyCapabilityService } from './enemy-capability.service';
import { EnemyActionService } from './enemy-action.service';
import { EnemyActionExecutor } from './enemy-action-executor.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { EnemyResearchService } from './enemy-research.service';
import { EnemyInvasionService } from './enemy-invasion.service';
import { EnemyPlanService } from './enemy-plan.service';
import { EnemyProgressService } from './enemy-progress.service';
import { EnemyReachService } from './enemy-reach.service';
import { EnemyIntelService } from './enemy-intel.service';
import { Battle } from '../battle-screen/battle/battle.types';
import { Faction, FactionProduction, FactionShipStock, Fleet, StarSystem, getAiFactionIds } from './star-map.models';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { DiplomacyService } from '../../services/diplomacy.service';

/*
 * =========================================================
 * STAR MAP AI TICK SERVICE
 * =========================================================
 *
 * Sequences one AI pipeline tick for all AI factions:
 * V3 reactive targeting → strategy → per-faction goals →
 * per-faction capabilities → per-faction actions → action
 * execution → per-faction background economy
 * (EnemyEconomyService: construction, military production,
 * deployment of stocked ships).
 *
 * The service owns no game state: it receives the live game
 * arrays each tick and reports whether any AI system changed
 * state, so the caller can decide whether to run change
 * detection. The pipeline order and the per-faction loop
 * structure must stay stable — battle/action logging and the
 * executor both assume this exact sequencing.
 *
 * Fleet movement ownership (one writer per fleet):
 *  - pipeline fleets (colonizer carriers, the fleet of a current
 *    move_to_target / defend action) — EnemyActionExecutor;
 *  - every other AI fleet — EnemyFleetService (garrison, intercept,
 *    retreat, regroup roles);
 *  - EnemyAiService (legacy reactive pursuit) only acts on AI fleets
 *    neither of the above manages, which in practice is none once
 *    EnemyFleetService has made its first decision (it decides on the
 *    first frame).
 * Research (EnemyResearchService) also runs here per faction.
 * AI treaty decisions (EnemyDiplomacyService) run first in every tick.
 */
@Injectable({ providedIn: 'root' })
export class StarMapAiTickService {
  constructor(
    private enemyAiService: EnemyAiService,
    private enemyStrategyService: EnemyStrategyService,
    private enemyGoalService: EnemyGoalService,
    private enemyCapabilityService: EnemyCapabilityService,
    private enemyActionService: EnemyActionService,
    private enemyActionExecutor: EnemyActionExecutor,
    private enemyEconomyService: EnemyEconomyService,
    private enemyFleetService: EnemyFleetService,
    private enemyResearchService: EnemyResearchService,
    private enemyInvasionService: EnemyInvasionService,
    private enemyPlanService: EnemyPlanService,
    private enemyProgressService: EnemyProgressService,
    private enemyReachService: EnemyReachService,
    private enemyIntelService: EnemyIntelService,
    private enemyDiplomacyService: EnemyDiplomacyService,
    private diplomacyService: DiplomacyService,
  ) {}

  // Cadence of the parallel colonization objective's action evaluation.
  private static readonly COLONIZATION_INTERVAL = 2;
  private readonly colonizationAccumulators = new Map<string, number>();
  // Set when StarMap leaves for the battle screen; see suspendForBattle.
  private suspendedForBattle = false;

  /*
   * An AI assault on a player-owned defended planet is fought on the
   * interactive battle screen. StarMap takes the queued battle after the
   * tick and navigates exactly like for a player-initiated planet battle.
   */
  takePendingPlayerBattle(): Battle | undefined {
    return this.enemyInvasionService.takePendingPlayerBattle();
  }

  tick(
    gameDeltaTime: number,
    data: {
      fleets: Fleet[];
      factions: Faction[];
      starSystems: StarSystem[];
      shipStock: FactionShipStock[];
      production: FactionProduction[];
    },
  ): boolean {
    // Treaties first: every layer below reads hostility (diplomacy.ts), so
    // a peace or war signed this frame is respected by the whole pipeline.
    const diplomacyChanged = this.enemyDiplomacyService.tick(gameDeltaTime, data);

    // Fleet operations and research run first: fleet roles decided here
    // are reserved from the legacy reactive layer in the same frame.
    const pipelineFleetIds = this.getReservedFleetIds(data.fleets, data.factions);

    /*
     * Fog of war: decision layers see each faction's perceived view
     * (EnemyIntelService); the executor, invasion and construction act on
     * the real state, which re-validates every decision.
     */
    for (const faction of data.factions) {
      if (faction.ai === true) {
        this.enemyIntelService.tick(gameDeltaTime, faction, data.factions, data.starSystems, data.fleets);
      }
    }
    const views = new Map(
      data.factions
        .filter((f) => f.ai === true)
        .map((f) => [f.id, this.enemyIntelService.getView(f, data.starSystems, data.fleets)] as const),
    );
    const viewOf = (factionId: string) => views.get(factionId) ?? { starSystems: data.starSystems, fleets: data.fleets };

    let operationsChanged = false;
    for (const faction of data.factions) {
      if (faction.ai !== true) {
        continue;
      }
      const view = viewOf(faction.id);
      // Strategic assessment first: every layer below reads its posture.
      this.enemyPlanService.tick(gameDeltaTime, faction, data.factions, view.starSystems, view.fleets);
      operationsChanged = this.enemyFleetService.tick(
        gameDeltaTime,
        faction,
        data.factions,
        view.starSystems,
        view.fleets,
        pipelineFleetIds,
        data.production,
        { starSystems: data.starSystems, fleets: data.fleets },
      ) || operationsChanged;
      operationsChanged = this.enemyResearchService.tick(
        gameDeltaTime,
        faction,
        data.factions,
        view.starSystems,
        view.fleets,
      ) || operationsChanged;
    }

    const reservedFleetIds = new Set([...pipelineFleetIds, ...this.enemyFleetService.getManagedFleetIds()]);
    const aiChanged = this.enemyAiService.tick(gameDeltaTime, data.fleets, data.factions, reservedFleetIds);
    const strategyChanged = this.enemyStrategyService.tick(
      gameDeltaTime,
      data.fleets,
      data.factions,
      data.starSystems,
      viewOf,
    );

    const aiFactionIds = getAiFactionIds(data.factions);

    let goalChanged = false;
    for (const factionId of aiFactionIds) {
      const strategy = this.enemyStrategyService.getStrategy(factionId);
      if (strategy === undefined) {
        continue;
      }
      const factionGoalChanged = this.enemyGoalService.tick(
        gameDeltaTime,
        strategy,
        factionId,
        viewOf(factionId).fleets,
        data.factions,
        viewOf(factionId).starSystems,
        this.enemyPlanService.getPosture(data.factions.find((f) => f.id === factionId)).allowParallelColonization,
        this.enemyPlanService.getPosture(data.factions.find((f) => f.id === factionId)).concurrentColonizations,
      );
      if (factionGoalChanged) {
        goalChanged = true;
      }
    }

    for (const factionId of aiFactionIds) {
      const goal = this.enemyGoalService.getGoal(factionId);
      this.enemyCapabilityService.tick(
        gameDeltaTime,
        goal,
        factionId,
        viewOf(factionId).fleets,
        data.factions,
        viewOf(factionId).starSystems,
        data.shipStock,
        data.production,
      );
    }

    let actionChanged = false;
    for (const factionId of aiFactionIds) {
      const goal = this.enemyGoalService.getGoal(factionId);
      const capability = this.enemyCapabilityService.getCapability(factionId);
      const factionActionChanged = this.enemyActionService.tick(
        gameDeltaTime,
        goal,
        capability,
        factionId,
        viewOf(factionId).fleets,
        data.factions,
        viewOf(factionId).starSystems,
        data.shipStock,
        data.production,
      );
      if (factionActionChanged) {
        actionChanged = true;
      }
    }

    // Parallel colonization objective: same capability and action rules,
    // evaluated on its own 2 s cadence per faction.
    for (const factionId of aiFactionIds) {
      if (gameDeltaTime <= 0) {
        break;
      }
      const accumulator = (this.colonizationAccumulators.get(factionId) ?? 0) + gameDeltaTime;
      if (accumulator < StarMapAiTickService.COLONIZATION_INTERVAL) {
        this.colonizationAccumulators.set(factionId, accumulator);
        continue;
      }
      this.colonizationAccumulators.set(factionId, accumulator - StarMapAiTickService.COLONIZATION_INTERVAL);
      const colonization = this.enemyGoalService.getColonizationGoal(factionId);
      const capability = colonization
        ? this.enemyCapabilityService.evaluate(colonization, factionId, viewOf(factionId).fleets, data.factions, viewOf(factionId).starSystems, data.shipStock, data.production)
        : undefined;
      actionChanged = this.enemyActionService.planColonizationAction(
        colonization, capability, factionId, viewOf(factionId).fleets, data.factions, viewOf(factionId).starSystems, data.shipStock, data.production,
      ) || actionChanged;
    }

    let actionExecuted = false;
    for (const factionId of aiFactionIds) {
      const action = this.enemyActionService.getAction(factionId);
      const executed = this.enemyActionExecutor.tick(
        gameDeltaTime,
        action,
        data.factions,
        data.starSystems,
        data.production,
        data.shipStock,
        data.fleets,
      );
      if (gameDeltaTime > 0) {
        this.enemyProgressService.recordExecution(factionId, action, executed);
      }
      actionExecuted = executed || actionExecuted;
      actionExecuted = this.enemyActionExecutor.tick(
        gameDeltaTime,
        this.enemyActionService.getColonizationAction(factionId),
        data.factions,
        data.starSystems,
        data.production,
        data.shipStock,
        data.fleets,
        true,
      ) || actionExecuted;
    }

    // Background economy (construction, military production, deployment)
    // runs for every AI faction regardless of its current goal.
    let economyChanged = false;
    for (const faction of data.factions) {
      if (faction.ai !== true) {
        continue;
      }
      economyChanged = this.enemyEconomyService.tick(gameDeltaTime, faction, data.starSystems, {
        fleets: data.fleets,
        shipStock: data.shipStock,
        production: data.production,
        factions: data.factions,
        perceivedFleets: viewOf(faction.id).fleets,
        perceivedSystems: viewOf(faction.id).starSystems,
      }) || economyChanged;
    }

    // Deadlock detection last, with the state every layer produced this frame.
    let recoveryChanged = false;
    const reservedAfterActions = this.getReservedFleetIds(data.fleets, data.factions);
    for (const faction of data.factions) {
      if (faction.ai !== true) {
        continue;
      }
      recoveryChanged = this.enemyProgressService.tick(
        gameDeltaTime,
        faction,
        data,
        this.enemyActionService.getAction(faction.id),
        reservedAfterActions,
      ) || recoveryChanged;
    }

    return diplomacyChanged || operationsChanged || aiChanged || strategyChanged || goalChanged || actionChanged
      || actionExecuted || economyChanged || recoveryChanged;
  }

  /*
   * Resets every AI pipeline service. Called by StarMap.loadGame so a loaded
   * save never inherits stale AI targets, strategies, goals, or actions.
   * The reset order mirrors the pipeline order.
   */
  resetAiPipeline(): void {
    this.suspendedForBattle = false;
    this.enemyDiplomacyService.reset();
    this.diplomacyService.reset();
    this.enemyAiService.reset();
    this.enemyStrategyService.reset();
    this.enemyGoalService.reset();
    this.enemyCapabilityService.reset();
    this.enemyActionService.reset();
    this.enemyActionExecutor.reset();
    this.enemyEconomyService.reset();
    this.enemyFleetService.reset();
    this.enemyResearchService.reset();
    this.enemyInvasionService.reset();
    this.enemyPlanService.reset();
    this.enemyProgressService.reset();
    this.enemyReachService.reset();
    this.enemyIntelService.reset();
    this.colonizationAccumulators.clear();
  }

  /*
   * Battle-screen round trip. The battle screen is a separate route, so
   * StarMap is recreated and reloads the autosave when the player comes
   * back. That reload continues the running session (game time was paused
   * during the battle), so AI memory — charted systems, sightings, goals,
   * fleet roles, assaults, failed targets and their retry timers — must
   * survive it; only a genuine new game or save load resets the pipeline.
   *
   * suspendForBattle() is called right before navigating to the battle
   * screen; StarMap takes the flag on its next initialization (every exit
   * of the battle screen leads back to /star-map) and then calls
   * resumeAfterBattle() instead of resetAiPipeline().
   */
  suspendForBattle(): void {
    this.suspendedForBattle = true;
  }

  takeBattleSuspension(): boolean {
    const suspended = this.suspendedForBattle;
    this.suspendedForBattle = false;
    return suspended;
  }

  /*
   * Keeps all AI memory but discards what references objects of the
   * previous load (the save was re-read, so every fleet/planet is a new
   * object): cached intel views and queued player battles. AI state is
   * otherwise keyed by ids and revalidated against the world every tick.
   */
  resumeAfterBattle(): void {
    this.enemyIntelService.invalidateViews();
    this.enemyFleetService.cancelQueuedLaunches(this.enemyInvasionService.dropPendingPlayerBattles());
  }

  /*
   * Fleets the reactive layer must not retarget:
   *  - the fleet a current move_to_target / defend action commands
   *    (ActionResult.targetId is the AI's own fleet for those types;
   *    for 'attack' it is the player's fleet, so it is not reserved);
   *  - every AI fleet carrying a living colonizer, so a colonization
   *    run is never diverted into a chase between action ticks.
   */
  private getReservedFleetIds(fleets: Fleet[], factions: Faction[]): Set<number> {
    const reserved = new Set<number>();
    const aiFactionIds = getAiFactionIds(factions);
    for (const factionId of aiFactionIds) {
      for (const action of [this.enemyActionService.getAction(factionId), this.enemyActionService.getColonizationAction(factionId)]) {
        if ((action?.type === 'move_to_target' || action?.type === 'defend') && action.targetId !== undefined) {
          reserved.add(action.targetId);
        }
      }
    }
    const aiFactionSet = new Set(aiFactionIds);
    for (const fleet of fleets) {
      if (aiFactionSet.has(fleet.factionId)
        && !fleet.destroyed
        && fleet.ships.some((ship) => ship.type === 'colonizer' && !ship.destroyed)) {
        reserved.add(fleet.id);
      }
    }
    return reserved;
  }
}

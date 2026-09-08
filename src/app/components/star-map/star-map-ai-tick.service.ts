import { Injectable } from '@angular/core';
import { EnemyAiService } from './enemy-ai.service';
import { EnemyStrategyService } from './enemy-strategy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyCapabilityService } from './enemy-capability.service';
import { EnemyActionService } from './enemy-action.service';
import { EnemyActionExecutor } from './enemy-action-executor.service';
import { Faction, FactionProduction, FactionShipStock, Fleet, StarSystem, getAiFactionIds } from './star-map.models';

/*
 * =========================================================
 * STAR MAP AI TICK SERVICE
 * =========================================================
 *
 * Sequences one AI pipeline tick for all AI factions:
 * V3 reactive targeting → strategy → per-faction goals →
 * per-faction capabilities → per-faction actions → action
 * execution.
 *
 * The service owns no game state: it receives the live game
 * arrays each tick and reports whether any AI system changed
 * state, so the caller can decide whether to run change
 * detection. The pipeline order and the per-faction loop
 * structure must stay stable — battle/action logging and the
 * executor both assume this exact sequencing.
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
  ) {}

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
    const aiChanged = this.enemyAiService.tick(gameDeltaTime, data.fleets, data.factions);
    const strategyChanged = this.enemyStrategyService.tick(
      gameDeltaTime,
      data.fleets,
      data.factions,
      data.starSystems,
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
        data.fleets,
        data.factions,
        data.starSystems,
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
        data.fleets,
        data.factions,
        data.starSystems,
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
        data.fleets,
        data.factions,
        data.starSystems,
        data.shipStock,
        data.production,
      );
      if (factionActionChanged) {
        const action = this.enemyActionService.getAction(factionId);
        console.log(`[Enemy AI] ${factionId} action: ${action?.type ?? 'none'}`);
        actionChanged = true;
      }
    }

    let actionExecuted = false;
    for (const factionId of aiFactionIds) {
      const action = this.enemyActionService.getAction(factionId);
      actionExecuted = this.enemyActionExecutor.tick(
        gameDeltaTime,
        action,
        data.factions,
        data.starSystems,
        data.production,
        data.shipStock,
        data.fleets,
      ) || actionExecuted;
    }

    return aiChanged || strategyChanged || goalChanged || actionChanged || actionExecuted;
  }

  /*
   * Resets every AI pipeline service. Called by StarMap.loadGame so a loaded
   * save never inherits stale AI targets, strategies, goals, or actions.
   * The reset order mirrors the pipeline order.
   */
  resetAiPipeline(): void {
    this.enemyAiService.reset();
    this.enemyStrategyService.reset();
    this.enemyGoalService.reset();
    this.enemyCapabilityService.reset();
    this.enemyActionService.reset();
  }
}

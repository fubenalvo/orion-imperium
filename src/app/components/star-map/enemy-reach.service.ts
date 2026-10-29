import { Injectable } from '@angular/core';
import { Faction } from './star-map.models';
import { getColonizationReach } from './ai-queries';

/*
 * =========================================================
 * ENEMY REACH SERVICE (adaptive colonization reach)
 * =========================================================
 *
 * The single source of each AI faction's colonization reach, shared by
 * EnemyStrategyService (is 'expand' worth choosing), EnemyGoalService
 * (which targets qualify) and EnemyPlanService (expansion score), so the
 * three layers can never disagree.
 *
 * reach = AI_COLONIZATION_REACH × personality reach × adaptive bonus.
 * The bonus starts at 1. EnemyPlanService widens it by WIDEN_STEP (up to
 * MAX_BONUS) when a faction has had no colonization target in reach for a
 * while although unhabited planets exist elsewhere and it is not under
 * threat — on sparse large maps a fixed reach otherwise stops expansion
 * for good. In-memory; reset on load (the bonus is re-earned quickly).
 */
@Injectable({ providedIn: 'root' })
export class EnemyReachService {
  static readonly WIDEN_STEP = 0.25;
  static readonly MAX_BONUS = 2;

  private readonly bonus = new Map<string, number>();

  reset(): void {
    this.bonus.clear();
  }

  getReach(faction: Faction | undefined): number {
    return getColonizationReach(faction) * (faction ? this.bonus.get(faction.id) ?? 1 : 1);
  }

  getBonus(factionId: string): number {
    return this.bonus.get(factionId) ?? 1;
  }

  /* Returns false once the maximum bonus is reached. */
  widen(factionId: string): boolean {
    const current = this.bonus.get(factionId) ?? 1;
    if (current >= EnemyReachService.MAX_BONUS) {
      return false;
    }
    this.bonus.set(factionId, Math.min(EnemyReachService.MAX_BONUS, current + EnemyReachService.WIDEN_STEP));
    return true;
  }
}

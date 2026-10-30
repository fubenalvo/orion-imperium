import { Fleet } from './star-map.models';

/*
 * Player attack orders against enemy fleets (galaxy map).
 *
 * An attack order is a pursuit: `Fleet.attackFleetId` names the hostile
 * fleet, and every frame the attacker's galaxy target is re-aimed at the
 * quarry's current position once it has drifted far enough. Combat itself
 * is NOT started here — the regular battle detection triggers when both
 * fleets share a grid cell (see StarMapBattleDetectionService), exactly as
 * for a plain move order onto the enemy.
 *
 * The order ends (attackFleetId cleared, the fleet keeps flying to the last
 * aimed point) when the quarry is destroyed or gone, stops being hostile,
 * leaves the player's sensor picture, or becomes unreachable. Any manual
 * move or intercept order replaces it. Player fleets only: AI fleet targets
 * are owned by EnemyFleetService.
 */

/*
 * Re-aim threshold in galaxy cells. Re-aiming replans the route, so it is
 * done only when the quarry has moved noticeably, not every frame.
 */
export const ATTACK_REAIM_DISTANCE = 0.5;

export type AttackOrderEnd = 'destroyed' | 'lost-contact' | 'no-route';

export interface AttackOrderHooks {
  /* True when the quarry is currently visible to the player (fog of war). */
  isVisible(quarry: Fleet): boolean;
  /* True when the owners of attacker and quarry are at war (diplomacy.ts); peace ends the order. */
  isHostile(attacker: Fleet, quarry: Fleet): boolean;
  /* Sets the attacker's galaxy target if a safe route exists; false if not. */
  retarget(attacker: Fleet, x: number, y: number): boolean;
}

export interface AttackOrderEvent {
  attacker: Fleet;
  quarry: Fleet | undefined;
  reason: AttackOrderEnd;
}

/*
 * Advances all attack orders. Returns the orders that ended this frame
 * (for player notices) and whether any target changed. No allocation when
 * nothing happens apart from the empty result array.
 */
export function updateAttackOrders(
  fleets: readonly Fleet[],
  hooks: AttackOrderHooks,
): { ended: AttackOrderEvent[]; retargeted: boolean } {
  const ended: AttackOrderEvent[] = [];
  let retargeted = false;
  for (const attacker of fleets) {
    if (attacker.attackFleetId == null) {
      continue;
    }
    if (attacker.destroyed || attacker.factionId !== 'player') {
      attacker.attackFleetId = null;
      continue;
    }
    const quarry = fleets.find((f) => f.id === attacker.attackFleetId);
    let reason: AttackOrderEnd | null = null;
    if (!quarry || quarry.destroyed || !hooks.isHostile(attacker, quarry)) {
      reason = 'destroyed';
    } else if (!hooks.isVisible(quarry)) {
      reason = 'lost-contact';
    } else {
      const drifted =
        attacker.targetX === null ||
        attacker.targetY === null ||
        Math.abs(attacker.targetX - quarry.x) >= ATTACK_REAIM_DISTANCE ||
        Math.abs(attacker.targetY - quarry.y) >= ATTACK_REAIM_DISTANCE;
      // Already sharing the quarry's cell: battle detection owns what happens
      // next; re-aiming here would just re-issue a zero-length move every frame.
      const sameCell =
        Math.floor(attacker.x) === Math.floor(quarry.x) && Math.floor(attacker.y) === Math.floor(quarry.y);
      if (drifted && !sameCell) {
        if (hooks.retarget(attacker, quarry.x, quarry.y)) {
          retargeted = true;
        } else {
          reason = 'no-route';
        }
      }
    }
    if (reason) {
      attacker.attackFleetId = null;
      ended.push({ attacker, quarry, reason });
    }
  }
  return { ended, retargeted };
}

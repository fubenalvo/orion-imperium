import { Injectable } from '@angular/core';
import {
  ANIMATION_MS,
  BATTLE_CELL_HEIGHT_VW,
  BATTLE_CELL_WIDTH_VW,
  BATTLE_FIELD_HEIGHT_VW,
  BATTLE_FIELD_WIDTH_VW,
  BATTLE_RANGE_UNIT_VW,
  BattleModelState,
  BattleProjectile,
  BattleStack,
  FIRE_RATE_MULTIPLIER,
  PROJECTILE_HITBOX_SCALE,
  PROJECTILE_OVERSHOOT_VW,
  PROJECTILE_SPEED_VW_PER_S,
  REFERENCE_FIRE_RATE,
  battleDebug,
  nextVolleyDueMs,
  volleyShare,
} from './battle.types';
import {
  checkVictory,
  computeCarrierBoostTargets,
  canAttack,
  effectiveAttackRange,
  weaponMultiplier,
  applyShieldRegen,
  absoluteDistanceRangeUnits,
} from './battle-grid';
import { rememberAutoTarget, selectFireTarget } from './battle-targeting';
import { BattleAnimationService } from './battle-animation.service';
import { BattleTimeService } from './battle-time.service';

/*
 * =========================================================
 *  BATTLE MINIGAME — COMBAT SERVICE
 * =========================================================
 *
 * One attack = the whole stack fires one volley. A "reference volley" is
 * the sum of the firing stack's alive-ship attack values, reduced by the
 * target front ship's defense (per-ship semantics, not summed), scaled by
 * weapon effectiveness (attacker attackType vs front target weakness:
 * 1.5x / 1.0x / 0.5x), floored at 1. One actual volley deals
 * volleyShare = REFERENCE_FIRE_RATE / fireRate of that, so fast-firing
 * classes land many small hits and slow ones few big hits at the same
 * damage per second (fractions carry over, see damageCarry). Damage is
 * applied ship by ship in order; each ship's shield absorbs first,
 * overkill spills to the next ship.
 *
 * Fire control (runFireControl) is the ONLY place that decides when a
 * stack fires. It runs every frame for every living stack of both sides —
 * player, AUTO and enemy AI alike. Each stack fires on its own class
 * cadence of (1 / fireRate) s * FIRE_RATE_MULTIPLIER, with a small
 * deterministic jitter (FIRE_JITTER) so same-class stacks do not fire in
 * lockstep. Whom to shoot comes from
 * battle-targeting.ts. Player commands and the AI only set orders/movement.
 *
 * Planet-defense turrets are immobile but DO fire.
 *
 * Every volley is a laser bolt (BattleProjectile) that is aimed once at
 * launch and flies straight at constant speed (updateProjectiles, driven by
 * the game loop on battle time). Damage is applied only when the bolt
 * actually crosses the target's hitbox, so a target that moves out of the
 * line of fire is missed. The damage rule itself (applyVolleyDamage) is
 * unchanged and shared with the auto-resolver, which has no projectiles.
 *
 * The Carrier has one special action: Shield Pulse. It restores the
 * Carrier's shieldRegen to every friendly stack within its reach (capped at
 * each ship's maxShield) and consumes the Carrier's fire cooldown, so it
 * replaces one volley rather than being free.
 */

/* ±fraction of the fire interval varied per volley. Small enough that the
 * average cadence (and so damage per second) is unchanged in practice. */
const FIRE_JITTER = 0.08;

/*
 * Deterministic multiplier in [1 − FIRE_JITTER, 1 + FIRE_JITTER] for one
 * volley, hashed from the stack id and the fire time, so stacks of the same
 * class drift apart instead of firing in lockstep while replays and tests
 * stay reproducible (no Math.random in the battle simulation).
 */
export function fireJitter(stackId: string, nowMs: number): number {
  let h = 2166136261;
  const key = stackId + ':' + Math.round(nowMs);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = (h >>> 0) / 4294967295;
  return 1 + (unit * 2 - 1) * FIRE_JITTER;
}

/* Per-ship power of one shot (attack × volleyShare) mapped onto a log scale
 * to the bolt's visual size: ~0.45 (fighter, scout) … 1 (destroyer, a
 * medium-heavy shot) … 1.75 (dreadnought). Log because shot power spans
 * two orders of magnitude between classes. */
const SHOT_SCALE_MIN = 0.45;
const SHOT_SCALE_MAX = 1.75;
const SHOT_POWER_LOG_MIN = 0.5; // ≈ 3 attack per shot
const SHOT_POWER_LOG_MAX = 2.7; // ≈ 500 attack per shot

export function shotScale(stack: BattleStack): number {
  const front = stack.ships.find((s) => s.alive) ?? stack.ships[0];
  const power = Math.max(1, (front?.attack ?? 1) * volleyShare(stack));
  const t = (Math.log10(power) - SHOT_POWER_LOG_MIN) / (SHOT_POWER_LOG_MAX - SHOT_POWER_LOG_MIN);
  const clamped = Math.min(1, Math.max(0, t));
  return SHOT_SCALE_MIN + (SHOT_SCALE_MAX - SHOT_SCALE_MIN) * clamped;
}

/*
 * applyVolleyDamage: The damage rule of one volley, shared by the animated
 * battle (BattleCombatService.attackStack) and the non-interactive
 * resolver (battle-auto-resolve.ts) so both always use identical combat
 * maths. Mutates the target ships, the shared planetary shield pool and
 * the target's destroyed flag; does not check range, cooldown or victory.
 * The caller must ensure the target has a living ship.
 */
export function applyVolleyDamage(
  state: BattleModelState,
  attacker: BattleStack,
  target: BattleStack,
): { damage: number; kills: number; targetDestroyed: boolean } {
  const totalAttack = attacker.ships
    .filter((s) => s.alive)
    .reduce((sum, s) => sum + s.attack, 0);
  const front = target.ships.find((s) => s.alive);
  if (!front) {
    return { damage: 0, kills: 0, targetDestroyed: target.destroyed };
  }
  const raw = totalAttack - front.defense;
  // The attacker's weapon type is taken from its front ship (stacks
  // are homogeneous by type per buildStacks).
  const attackerFront = attacker.ships.find((s) => s.alive);
  const multiplier = weaponMultiplier(
    attackerFront?.attackType ?? 'kinetic',
    front.weakness ?? 'energy',
  );
  // Defense is subtracted from the whole reference volley, then the volley
  // is split by fire rate — subtracting it per small shot would let armour
  // erase fast-firing classes. At REFERENCE_FIRE_RATE (share 1) this is
  // exactly the reference volley and the carry stays 0.
  const referenceDamage = Math.max(1, Math.floor(raw * multiplier));
  const carry = (state.damageCarry ??= {});
  const exact = referenceDamage * volleyShare(attacker) + (carry[attacker.stackId] ?? 0);
  // Epsilon guards against 0.9999… float remainders swallowing a point.
  const damage = Math.floor(exact + 1e-9);
  carry[attacker.stackId] = Math.max(0, exact - damage);
  let remaining = damage;
  /*
   * Planet defense stacks are protected by the shared planetary
   * shield before their own per-ship shields. The pool absorbs the
   * whole defense line, so it applies to any immobile target stack
   * and only the overflow reaches hull / per-ship shield logic.
   */
  if (target.immobile && state.defenderShieldPool && state.defenderShieldPool.current > 0) {
    const absorbed = Math.min(state.defenderShieldPool.current, remaining);
    state.defenderShieldPool.current -= absorbed;
    remaining -= absorbed;
  }
  let kills = 0;
  for (const ship of target.ships) {
    if (!ship.alive || remaining <= 0) {
      continue;
    }
    const shieldHp = ship.shield ?? 0;
    const shieldDamage = Math.min(shieldHp, remaining);
    ship.shield = shieldHp - shieldDamage;
    remaining -= shieldDamage;
    if (remaining <= 0) {
      continue;
    }
    const applied = Math.min(ship.hp, remaining);
    ship.hp -= applied;
    remaining -= applied;
    if (ship.hp <= 0) {
      ship.hp = 0;
      ship.alive = false;
      kills++;
    }
  }
  const targetDestroyed = target.ships.every((s) => !s.alive);
  if (targetDestroyed) {
    target.destroyed = true;
  }
  return { damage, kills, targetDestroyed };
}

/*
 * Hitbox of a stack: the drawn stack-cell box (size cells wide, one cell
 * high, scaled by PROJECTILE_HITBOX_SCALE) centred on its live x/y.
 * Returns true when the segment (x0,y0)→(x1,y1) touches it. Testing the
 * swept segment rather than only the end point keeps fast bolts from
 * tunnelling through small targets on long frames.
 */
export function segmentHitsStack(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stack: Pick<BattleStack, 'x' | 'y' | 'size'>,
): boolean {
  const halfW = (stack.size * BATTLE_CELL_WIDTH_VW * PROJECTILE_HITBOX_SCALE) / 2;
  const halfH = (BATTLE_CELL_HEIGHT_VW * PROJECTILE_HITBOX_SCALE) / 2;
  // Liang–Barsky clipping of the segment against the axis-aligned box.
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tMin = 0;
  let tMax = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tMax) return false;
      if (t > tMin) tMin = t;
    } else {
      if (t < tMin) return false;
      if (t < tMax) tMax = t;
    }
    return true;
  };
  return (
    clip(-dx, x0 - (stack.x - halfW)) &&
    clip(dx, stack.x + halfW - x0) &&
    clip(-dy, y0 - (stack.y - halfH)) &&
    clip(dy, stack.y + halfH - y0)
  );
}

@Injectable({ providedIn: 'root' })
export class BattleCombatService {
  constructor(
    private anim: BattleAnimationService,
    private time: BattleTimeService,
  ) {}

  private nextProjectileId = 1;
  /* Completion callbacks for attackStack() promises, keyed by projectile id.
   * Kept out of BattleModelState so the state stays plain data. */
  private readonly projectileResolvers = new Map<number, () => void>();

  /* Milliseconds (battle time) between two volleys of a stack. */
  fireIntervalMs(stack: BattleStack): number {
    const fireRate = stack.fireRate > 0 ? stack.fireRate : REFERENCE_FIRE_RATE;
    return (1000 / fireRate) * FIRE_RATE_MULTIPLIER;
  }

  /* True when the stack's fire cooldown has elapsed. */
  isFireReady(stack: BattleStack): boolean {
    return (stack.attackCooldownUntil ?? 0) <= this.time.battleElapsedMs;
  }

  /*
   * Per-frame fire control for every living stack on both sides. Also the
   * single place where orders pointing at destroyed stacks are cleaned up,
   * so no stack is ever left holding a dead target (which would block AUTO
   * from taking over again).
   */
  runFireControl(state: BattleModelState): void {
    if (state.winner) {
      return;
    }
    const now = this.time.battleElapsedMs;
    for (const stack of state.stacks) {
      if (stack.destroyed) {
        continue;
      }
      this.clearDeadOrders(state, stack);
      if ((stack.attackCooldownUntil ?? 0) > now || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      if (!stack.ships.some((s) => s.alive && s.attack > 0)) {
        continue;
      }
      const target = selectFireTarget(state, stack);
      if (!target) {
        continue;
      }
      stack.attackCooldownUntil = nextVolleyDueMs(
        stack.attackCooldownUntil,
        now,
        this.fireIntervalMs(stack) * fireJitter(stack.stackId, now),
      );
      rememberAutoTarget(stack, target);
      void this.attackStack(state, stack.stackId, target.stackId);
    }
  }

  private clearDeadOrders(state: BattleModelState, stack: BattleStack): void {
    const isDead = (id: string | null | undefined): boolean =>
      !!id && !state.stacks.some((s) => s.stackId === id && !s.destroyed);
    if (isDead(stack.explicitAttackTargetId)) {
      // Order completed: the stack returns to its automatic targeting mode.
      if (stack.moveToAttackTargetId === stack.explicitAttackTargetId) {
        stack.moveToAttackTargetId = null;
      }
      stack.explicitAttackTargetId = null;
    }
    if (isDead(stack.autoTargetId)) {
      stack.autoTargetId = null;
    }
  }

  /*
   * Fires one volley as a laser bolt aimed at the target's current
   * position. Validates reach at fire time only. Callers are responsible
   * for the fire cooldown (runFireControl sets it).
   *
   * Resolves to true once the bolt has resolved (hit or miss) — useful for
   * tests and callers that want to await the outcome — or false
   * immediately when the volley could not be fired.
   */
  attackStack(
    state: BattleModelState,
    attackerStackId: string,
    targetStackId: string,
  ): Promise<boolean> {
    const attacker = state.stacks.find((s) => s.stackId === attackerStackId && !s.destroyed);
    const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
    if (!attacker || !target || state.winner || attacker.side === target.side) {
      return Promise.resolve(false);
    }

    const canAttackNow = canAttack(attacker, target);
    battleDebug(`[ATTACK] ${attackerStackId} -> ${targetStackId} | canAttack=${canAttackNow} | dist=${absoluteDistanceRangeUnits(attacker, target).toFixed(2)} | range=${attacker.attackRange}`);
    if (!canAttackNow) {
      return Promise.resolve(false);
    }

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.hypot(dx, dy);
    const projectile: BattleProjectile = {
      id: this.nextProjectileId++,
      side: attacker.side,
      attackerStackId: attacker.stackId,
      targetStackId: target.stackId,
      volley: { ...attacker, ships: attacker.ships.map((s) => ({ ...s })) },
      x: attacker.x,
      y: attacker.y,
      // Degenerate zero distance cannot happen (footprints never overlap);
      // the fallback direction only keeps the maths finite.
      dirX: dist > 0 ? dx / dist : 1,
      dirY: dist > 0 ? dy / dist : 0,
      traveledVw: 0,
      maxTravelVw: effectiveAttackRange(attacker) * BATTLE_RANGE_UNIT_VW + PROJECTILE_OVERSHOOT_VW,
      color: attacker.side === 'attacker' ? state.attackerColor : state.defenderColor,
      scale: shotScale(attacker),
    };
    state.projectiles.push(projectile);
    attacker.firing = true;
    this.anim.tick();
    return new Promise((resolve) => {
      this.projectileResolvers.set(projectile.id, () => resolve(true));
    });
  }

  /*
   * Advances every bolt and visual effect by deltaSec of battle time.
   * Called every unpaused frame by the game loop — also after the battle is
   * decided, so bolts still in flight fly off and the last explosion plays
   * out before the result overlay (which waits for both lists to empty).
   * After a winner is set, bolts no longer deal damage, so the outcome is
   * fixed at the moment of victory.
   */
  updateProjectiles(state: BattleModelState, deltaSec: number): void {
    if (deltaSec <= 0) {
      return;
    }
    const deltaMs = deltaSec * 1000;
    state.effects = state.effects.filter((e) => (e.remainingMs -= deltaMs) > 0);

    const step = PROJECTILE_SPEED_VW_PER_S * deltaSec;
    const inFlight: BattleProjectile[] = [];
    for (const p of state.projectiles) {
      const advance = Math.min(step, p.maxTravelVw - p.traveledVw);
      const x0 = p.x;
      const y0 = p.y;
      p.x += p.dirX * advance;
      p.y += p.dirY * advance;
      p.traveledVw += advance;

      const target = state.stacks.find((s) => s.stackId === p.targetStackId && !s.destroyed);
      if (target && !state.winner && segmentHitsStack(x0, y0, p.x, p.y, target)) {
        this.resolveHit(state, p, target);
        this.finishProjectile(p.id);
        continue;
      }
      const outOfField =
        p.x < -PROJECTILE_OVERSHOOT_VW ||
        p.y < -PROJECTILE_OVERSHOOT_VW ||
        p.x > BATTLE_FIELD_WIDTH_VW + PROJECTILE_OVERSHOOT_VW ||
        p.y > BATTLE_FIELD_HEIGHT_VW + PROJECTILE_OVERSHOOT_VW;
      if (p.traveledVw >= p.maxTravelVw || outOfField) {
        // Miss: the target moved out of the line of fire (or died first).
        this.finishProjectile(p.id);
        continue;
      }
      inFlight.push(p);
    }
    state.projectiles = inFlight;

    // The recoil highlight lasts for the first ANIMATION_MS.muzzle of each
    // bolt's flight.
    const muzzleVw = (PROJECTILE_SPEED_VW_PER_S * ANIMATION_MS.muzzle) / 1000;
    for (const stack of state.stacks) {
      stack.firing = inFlight.some((p) => p.attackerStackId === stack.stackId && p.traveledVw < muzzleVw);
    }
  }

  /* Bolts, effects and pending attackStack() promises are battle-local;
   * drop them when the battle screen is torn down. */
  clearProjectiles(state: BattleModelState | null): void {
    if (state) {
      state.projectiles = [];
      state.effects = [];
    }
    for (const resolve of this.projectileResolvers.values()) {
      resolve();
    }
    this.projectileResolvers.clear();
  }

  private resolveHit(state: BattleModelState, p: BattleProjectile, target: BattleStack): void {
    const { damage, kills, targetDestroyed } = applyVolleyDamage(state, p.volley, target);
    state.log.push({
      round: state.round,
      side: p.side,
      attackerStack: p.attackerStackId,
      defenderStack: target.stackId,
      damage,
      kills,
    });
    state.effects.push({
      id: p.id,
      phase: targetDestroyed ? 'explosion' : 'impact',
      to: { x: target.x, y: target.y },
      targetStackId: target.stackId,
      attackerStackId: p.attackerStackId,
      remainingMs: targetDestroyed ? ANIMATION_MS.explosion : ANIMATION_MS.hit,
      scale: p.scale,
      color: p.color,
    });
    checkVictory(state);
  }

  private finishProjectile(id: number): void {
    const resolve = this.projectileResolvers.get(id);
    this.projectileResolvers.delete(id);
    resolve?.();
  }

  /*
   * Whether a Shield Pulse would do anything right now: the Carrier is
   * alive, stationary, not animating, off cooldown, and at least one ally in
   * reach has missing shield. Pure read — used by the UI button and the AI.
   */
  canCarrierBoost(state: BattleModelState, carrierStackId: string): boolean {
    const carrier = state.stacks.find((s) => s.stackId === carrierStackId && !s.destroyed);
    if (!carrier || carrier.typeId !== 'carrier' || state.winner) {
      return false;
    }
    if (carrier.moving || carrier.immobile || carrier.firing || this.anim.isStackBusy(carrier.stackId)) {
      return false;
    }
    if (!this.isFireReady(carrier)) {
      return false;
    }
    const regen = carrier.ships.find((s) => s.alive)?.shieldRegen ?? 0;
    if (regen <= 0) {
      return false;
    }
    const targetIds = new Set(computeCarrierBoostTargets(state, carrier));
    return state.stacks.some(
      (s) =>
        targetIds.has(s.stackId) &&
        s.ships.some((ship) => ship.alive && (ship.maxShield ?? 0) > (ship.shield ?? 0)),
    );
  }

  /*
   * Carrier Shield Pulse. Restores the Carrier's front-ship shieldRegen to
   * every friendly ship within reach, capped at maxShield, and consumes the
   * Carrier's fire cooldown. Returns false (and costs nothing) when the
   * pulse would not restore any shield.
   */
  carrierShieldBoost(state: BattleModelState, carrierStackId: string): boolean {
    if (!this.canCarrierBoost(state, carrierStackId)) {
      return false;
    }
    const carrier = state.stacks.find((s) => s.stackId === carrierStackId)!;
    const regen = carrier.ships.find((s) => s.alive)?.shieldRegen ?? 0;

    const targetIds = new Set(computeCarrierBoostTargets(state, carrier));
    for (const stack of state.stacks) {
      if (!targetIds.has(stack.stackId)) {
        continue;
      }
      for (const ship of stack.ships) {
        if (!ship.alive) {
          continue;
        }
        const max = ship.maxShield ?? 0;
        if (max <= 0) {
          continue;
        }
        ship.shield = applyShieldRegen(ship.shield ?? 0, max, regen);
      }
    }
    carrier.attackCooldownUntil = this.time.battleElapsedMs + this.fireIntervalMs(carrier);
    return true;
  }
}

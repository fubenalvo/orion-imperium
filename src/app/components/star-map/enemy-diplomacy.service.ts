import { Injectable } from '@angular/core';
import { ShipService } from '../../services/ship.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { getAiPersonalityProfile } from './ai-personality';
import { AiPersonality, Faction, Fleet, StarSystem } from './star-map.models';
import { getRelation, isTreatyPair } from './diplomacy';

/*
 * =========================================================
 * ENEMY DIPLOMACY SERVICE — AI treaty decisions
 * =========================================================
 *
 * Every DECISION_INTERVAL seconds of game time each AI faction reviews its
 * treaty relations (rules and rationale: docs/diplomacy.md):
 *
 *  - Peace: an AI wants peace with a war enemy when that enemy is clearly
 *    stronger (strength ratio ≥ the personality's peaceRatio), when the
 *    war is a second front (it has ≥ 2 wars, this is not its primary
 *    enemy, and the enemy is not much weaker), or when it is nearly beaten
 *    (≤ 1 planet). Two AIs sign peace only when both want it. Toward the
 *    human it makes a timed peace offer instead (DiplomacyService).
 *  - War: an AI at peace declares war on a neighbour (within WAR_REACH)
 *    that is clearly weaker (ratio ≤ warRatio), at most one declaration
 *    per review, and only while it has fewer wars than the personality's
 *    maxWars.
 *
 * The same `wantsPeace` rule answers the player's peace proposals, so the
 * player can predict the AI: it accepts when it is losing or busy
 * elsewhere, and refuses while it feels strong.
 *
 * Information: diplomacy uses the real total fleet strength of both
 * factions, not the fog-of-war view. Rough military power is treated as
 * public knowledge for treaties (envoys, intelligence services); the
 * tactical layers still only see what their sensors report.
 *
 * Treaty minimum durations (diplomacy.ts) prevent flip-flopping: a fresh
 * war cannot end before WAR_MIN_DURATION_SECONDS, a fresh peace holds for
 * PEACE_MIN_DURATION_SECONDS, and the opening wars are locked for
 * INITIAL_WAR_LOCK_SECONDS.
 */

interface DiplomacyProfile {
  /* Enemy/own strength ratio from which the AI seeks peace. */
  peaceRatio: number;
  /* Target/own strength ratio up to which the AI declares war. */
  warRatio: number;
  /* Wars (with treaty factions) the AI is willing to fight at once. */
  maxWars: number;
}

const DIPLOMACY_PROFILES: Readonly<Record<AiPersonality, DiplomacyProfile>> = {
  balanced: { peaceRatio: 1.4, warRatio: 0.6, maxWars: 1 },
  expansionist: { peaceRatio: 1.25, warRatio: 0.65, maxWars: 1 },
  militarist: { peaceRatio: 2, warRatio: 0.85, maxWars: 2 },
  technologist: { peaceRatio: 1.1, warRatio: 0.5, maxWars: 1 },
};

export type PeaceReason = 'outmatched' | 'second_front' | 'collapsing';
export interface PeaceDecision {
  accept: boolean;
  reason?: PeaceReason;
}

export interface DiplomacyContext {
  factions: Faction[];
  fleets: Fleet[];
  starSystems: StarSystem[];
}

@Injectable({ providedIn: 'root' })
export class EnemyDiplomacyService {
  static readonly DECISION_INTERVAL = 10;
  /* Galaxy cells between the two empires within which an AI starts a war. */
  static readonly WAR_REACH = 120;
  /* A war enemy weaker than this ratio is never let off on a second front. */
  static readonly SECOND_FRONT_MIN_RATIO = 0.75;
  /* After offering peace to the player, the AI waits this long before offering again. */
  static readonly OFFER_COOLDOWN = 150;

  private accumulator = 0;
  /* AI faction id → seconds until it may offer the player peace again. */
  private offerCooldowns = new Map<string, number>();

  constructor(
    private readonly shipService: ShipService,
    private readonly diplomacy: DiplomacyService,
  ) {}

  reset(): void {
    this.accumulator = 0;
    this.offerCooldowns.clear();
  }

  /* Returns true when a treaty changed or an offer was made. */
  tick(gameDeltaTime: number, ctx: DiplomacyContext): boolean {
    if (gameDeltaTime <= 0) return false;
    for (const [id, left] of this.offerCooldowns) {
      const next = left - gameDeltaTime;
      if (next <= 0) this.offerCooldowns.delete(id);
      else this.offerCooldowns.set(id, next);
    }
    this.accumulator += gameDeltaTime;
    if (this.accumulator < EnemyDiplomacyService.DECISION_INTERVAL) return false;
    this.accumulator = 0;

    let changed = false;
    // Fixed faction order keeps the decisions deterministic.
    for (const faction of ctx.factions) {
      if (faction.ai !== true || !this.isAlive(faction.id, ctx)) continue;
      changed = this.reviewPeace(faction, ctx) || changed;
      changed = this.reviewWar(faction, ctx) || changed;
    }
    return changed;
  }

  /*
   * Would `ai` sign peace with `enemy` now? Used for AI–AI treaties, AI
   * offers to the player and the answer to the player's proposals.
   */
  wantsPeace(ai: Faction, enemy: Faction, ctx: DiplomacyContext): PeaceDecision {
    const relation = getRelation(ai, enemy);
    if (!relation || relation.state !== 'war') return { accept: false };
    const profile = this.profileOf(ai);
    const ratio = this.strengthRatio(enemy, ai, ctx);
    if (ratio >= profile.peaceRatio) return { accept: true, reason: 'outmatched' };
    if (this.ownedPlanetCount(ai.id, ctx) <= 1 && ratio >= 0.8) return { accept: true, reason: 'collapsing' };
    const wars = this.warEnemies(ai, ctx);
    if (
      wars.length >= 2
      && this.primaryEnemy(ai, wars, ctx)?.id !== enemy.id
      && ratio >= EnemyDiplomacyService.SECOND_FRONT_MIN_RATIO
    ) {
      return { accept: true, reason: 'second_front' };
    }
    return { accept: false };
  }

  /* Total living fleet strength of a faction (public estimate, see header). */
  militaryStrength(factionId: string, fleets: Fleet[]): number {
    let total = 0;
    for (const fleet of fleets) {
      if (fleet.factionId !== factionId || fleet.destroyed) continue;
      total += this.shipService.calculateFleetStrength(fleet.ships);
    }
    return total;
  }

  private reviewPeace(ai: Faction, ctx: DiplomacyContext): boolean {
    let changed = false;
    for (const enemy of this.warEnemies(ai, ctx)) {
      if (!this.diplomacy.canSignPeace(ai, enemy).ok) continue;
      if (!this.wantsPeace(ai, enemy, ctx).accept) continue;
      if (enemy.ai === true) {
        if (this.wantsPeace(enemy, ai, ctx).accept) {
          changed = this.diplomacy.signPeace(ai, enemy).ok || changed;
        }
      } else if (!this.diplomacy.hasOffer(ai.id) && !this.offerCooldowns.has(ai.id)) {
        this.diplomacy.addOffer(ai.id);
        this.offerCooldowns.set(ai.id, EnemyDiplomacyService.OFFER_COOLDOWN);
        changed = true;
      }
    }
    return changed;
  }

  private reviewWar(ai: Faction, ctx: DiplomacyContext): boolean {
    const profile = this.profileOf(ai);
    if (this.warEnemies(ai, ctx).length >= profile.maxWars) return false;
    let best: { target: Faction; ratio: number } | undefined;
    for (const other of ctx.factions) {
      if (!isTreatyPair(ai, other) || !this.isAlive(other.id, ctx)) continue;
      if (!this.diplomacy.canDeclareWar(ai, other).ok) continue;
      const ratio = this.strengthRatio(other, ai, ctx);
      if (ratio > profile.warRatio) continue;
      if (this.empireDistance(ai.id, other.id, ctx) > EnemyDiplomacyService.WAR_REACH) continue;
      if (!best || ratio < best.ratio) best = { target: other, ratio };
    }
    return best ? this.diplomacy.declareWar(ai, best.target).ok : false;
  }

  private warEnemies(ai: Faction, ctx: DiplomacyContext): Faction[] {
    return ctx.factions.filter(
      (other) => getRelation(ai, other)?.state === 'war' && this.isAlive(other.id, ctx),
    );
  }

  /* The war enemy the AI concentrates on: the nearest, weighted toward weaker ones. */
  private primaryEnemy(ai: Faction, enemies: Faction[], ctx: DiplomacyContext): Faction | undefined {
    let best: { enemy: Faction; score: number } | undefined;
    for (const enemy of enemies) {
      const score = this.empireDistance(ai.id, enemy.id, ctx) * Math.max(0.5, this.strengthRatio(enemy, ai, ctx));
      if (!best || score < best.score) best = { enemy, score };
    }
    return best?.enemy;
  }

  /* Strength of `other` relative to `self` (own strength floored at 1). */
  private strengthRatio(other: Faction, self: Faction, ctx: DiplomacyContext): number {
    return this.militaryStrength(other.id, ctx.fleets) / Math.max(1, this.militaryStrength(self.id, ctx.fleets));
  }

  /* Shortest distance between the two empires' systems (fleets for a faction without planets). */
  private empireDistance(aId: string, bId: string, ctx: DiplomacyContext): number {
    const a = this.presence(aId, ctx);
    const b = this.presence(bId, ctx);
    let best = Infinity;
    for (const p of a) {
      for (const q of b) {
        best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
    return best;
  }

  private presence(factionId: string, ctx: DiplomacyContext): { x: number; y: number }[] {
    const systems = ctx.starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === factionId));
    if (systems.length > 0) return systems;
    return ctx.fleets.filter((f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => !s.destroyed));
  }

  private ownedPlanetCount(factionId: string, ctx: DiplomacyContext): number {
    return ctx.starSystems.reduce((n, s) => n + s.planetsTiles.filter((p) => p.factionId === factionId).length, 0);
  }

  /* Eliminated factions (no planet, no living fleet) take no part in diplomacy. */
  private isAlive(factionId: string, ctx: DiplomacyContext): boolean {
    return this.ownedPlanetCount(factionId, ctx) > 0
      || ctx.fleets.some((f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => !s.destroyed));
  }

  private profileOf(faction: Faction): DiplomacyProfile {
    return DIPLOMACY_PROFILES[getAiPersonalityProfile(faction).id];
  }
}

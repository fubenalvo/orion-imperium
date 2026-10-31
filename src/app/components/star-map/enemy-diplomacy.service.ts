import { Injectable } from '@angular/core';
import { ShipService } from '../../services/ship.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { getAiPersonalityProfile } from './ai-personality';
import { AiPersonality, Faction, FactionProduction, Fleet, StarSystem } from './star-map.models';
import {
  getEffectiveOpinion,
  getFactionWarExhaustion,
  getRelation,
  getWarExhaustion,
  isTreatyPair,
  isTruceActive,
} from './diplomacy';
import {
  PeaceTreaty,
  TreatyItem,
  TreatyValidation,
  isFactionAlive,
  otherParty,
  validateTreaty,
} from './peace-treaty';

/*
 * =========================================================
 * ENEMY DIPLOMACY SERVICE — AI diplomatic judgment
 * =========================================================
 *
 * Deterministic, explainable AI diplomacy (docs/diplomacy.md):
 *
 *  1. assessWar(ai, enemy) turns the war situation into a *peace pressure*
 *     (sum of named factors: military balance, war exhaustion (own level
 *     and the gap to the enemy's), fleet and
 *     planet losses, effective opinion, second front, collapse, pointless
 *     war, treasury, personality, and a baseline "war aims" resistance).
 *     Positive pressure means the AI wants out. peaceValue = pressure ×
 *     scale, where scale is about one minute of the AI's income: what an
 *     end to this war is worth to it in credits (negative = it wants to be
 *     paid for peace).
 *  2. evaluateTreaty values the concrete terms for the AI (credits at
 *     face value, raw materials ×1.2) and accepts when terms + peaceValue
 *     ≥ 0 and the terms are feasible (validateTreaty). The same number
 *     drives the acceptance meter the player sees, so the AI is
 *     predictable. Treaties carry resources only — the AI never values,
 *     offers or demands planets or star systems.
 *  3. counterOffer repairs a refused proposal: first it pays less, then
 *     asks the other side for resources it actually holds. Only feasible
 *     counters the AI itself accepts are returned.
 *  4. Every DECISION_INTERVAL the AI reviews its relations: AI–AI wars end
 *     when both peace values allow it (the more eager side pays the
 *     other's price); toward the human it makes a proposal when it wants
 *     peace; at peace it may declare war on a weak neighbour it does not
 *     like, or — militarists only — break a truce when overwhelmingly
 *     stronger and hostile.
 *
 * Information: total fleet strength, losses and exhaustion are treated as
 * public knowledge for diplomacy (envoys, intelligence); tactical layers
 * still only see what sensors report.
 */

interface DiplomacyProfile {
  /* Added to peace pressure (positive = more peaceful). */
  peaceBias: number;
  /* Target/own strength ratio up to which the AI declares war. */
  warRatio: number;
  /* Wars (with treaty factions) the AI is willing to fight at once. */
  maxWars: number;
  /* The AI only declares war on factions it judges at or below this effective opinion. */
  warOpinionMax: number;
  /* May break a running truce (overwhelming strength, hostile opinion). */
  treachery: boolean;
}

const DIPLOMACY_PROFILES: Readonly<Record<AiPersonality, DiplomacyProfile>> = {
  balanced: { peaceBias: 0, warRatio: 0.6, maxWars: 1, warOpinionMax: 10, treachery: false },
  expansionist: { peaceBias: 0.05, warRatio: 0.65, maxWars: 1, warOpinionMax: 15, treachery: false },
  militarist: { peaceBias: -0.2, warRatio: 0.85, maxWars: 2, warOpinionMax: 30, treachery: true },
  technologist: { peaceBias: 0.15, warRatio: 0.5, maxWars: 1, warOpinionMax: 0, treachery: false },
};

export interface WarFactor {
  key: string;
  label: string;
  /* Contribution to peace pressure (positive pushes the AI toward peace). */
  value: number;
}

export interface WarAssessment {
  pressure: number;
  /* Credits per unit of pressure (≈ one minute of the AI's income). */
  scale: number;
  /* Worth of peace itself to the AI, in credits. */
  peaceValue: number;
  factors: WarFactor[];
}

export interface TreatyEvaluation {
  validation: TreatyValidation;
  /* Value of the terms for the AI in credits (what it gains minus what it gives). */
  termsValue: number;
  peaceValue: number;
  /* termsValue + peaceValue; the AI accepts feasible terms when ≥ 0. */
  margin: number;
  /* 0…1 for the acceptance meter; 0.5 is the acceptance threshold. */
  acceptance: number;
  accept: boolean;
  assessment: WarAssessment;
}

export interface ProposalResponse {
  decision: 'accept' | 'counter' | 'refuse';
  evaluation: TreatyEvaluation;
  counter?: PeaceTreaty;
}

export interface DiplomacyContext {
  factions: Faction[];
  fleets: Fleet[];
  starSystems: StarSystem[];
  production?: FactionProduction[];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const roundUp10 = (value: number): number => Math.ceil(value / 10) * 10;
const roundDown10 = (value: number): number => Math.floor(value / 10) * 10;

@Injectable({ providedIn: 'root' })
export class EnemyDiplomacyService {
  static readonly DECISION_INTERVAL = 10;
  /* Galaxy cells between the two empires within which an AI starts a war. */
  static readonly WAR_REACH = 120;
  /* A war enemy weaker than this ratio is not let off on a second front. */
  static readonly SECOND_FRONT_MIN_RATIO = 0.75;
  /* Planets the enemy must hold for a one-planet AI to count as collapsing. */
  static readonly COLLAPSE_ENEMY_PLANETS = 3;
  /* After proposing peace to the player, the AI waits this long before proposing again. */
  static readonly OFFER_COOLDOWN = 180;
  /* Proposals to the player need at least this much pressure (keeps the AI from nagging). */
  static readonly PROPOSE_MIN_PRESSURE = 0.1;
  /* Own worst exhaustion from which the AI starts no new war. */
  static readonly NO_NEW_WAR_EXHAUSTION = 40;
  /* Raw materials are valued at this many credits each. */
  static readonly RAW_VALUE = 1.2;
  /* Baseline resistance to ending a war without a reason ("war aims"). */
  static readonly BASELINE_PRESSURE = -0.2;

  private accumulator = 0;
  /* AI faction id → seconds until it may propose peace to the player again. */
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
      if (faction.ai !== true || !isFactionAlive(faction.id, ctx)) continue;
      changed = this.reviewPeace(faction, ctx) || changed;
      changed = this.reviewWar(faction, ctx) || changed;
    }
    return changed;
  }

  /* ---------- Assessment ---------- */

  assessWar(ai: Faction, enemy: Faction, ctx: DiplomacyContext): WarAssessment {
    const scale = this.scaleOf(ai, ctx);
    const ownStrength = this.militaryStrength(ai.id, ctx.fleets);
    const enemyStrength = this.militaryStrength(enemy.id, ctx.fleets);
    const ratio = enemyStrength / Math.max(1, ownStrength);
    const own = getRelation(ai, enemy);
    const theirs = getRelation(enemy, ai);
    const factors: WarFactor[] = [];
    const add = (key: string, label: string, value: number) => {
      if (Math.abs(value) >= 0.005) factors.push({ key, label, value });
    };

    add('baseline', 'War aims', EnemyDiplomacyService.BASELINE_PRESSURE);
    add('military', 'Military balance', clamp(0.5 * Math.log2(Math.max(ratio, 1 / 16)), -1, 1));
    // Own exhaustion counts on its own (two exhausted empires both want out)
    // and relative to the enemy's (who can hold out longer).
    const ownExhaustion = getWarExhaustion(ai, enemy);
    add('exhaustion', 'War exhaustion', (ownExhaustion / 100) * 0.6 + ((ownExhaustion - getWarExhaustion(enemy, ai)) / 100) * 0.3);
    add('fleet_losses', 'Fleet losses', clamp((0.5 * ((own?.shipsLostValue ?? 0) - (theirs?.shipsLostValue ?? 0))) / scale, -0.5, 0.5));
    add('planet_losses', 'Planets lost', clamp(0.15 * ((own?.planetsLost ?? 0) - (theirs?.planetsLost ?? 0)), -0.6, 0.6));
    add('opinion', 'Relations', (getEffectiveOpinion(ai, enemy) / 100) * 0.3);
    const wars = this.warEnemies(ai, ctx);
    if (wars.length >= 2 && this.primaryEnemy(ai, wars, ctx)?.id !== enemy.id && ratio >= EnemyDiplomacyService.SECOND_FRONT_MIN_RATIO) {
      add('second_front', 'Second front', 0.25);
    }
    if (this.ownedPlanetCount(ai.id, ctx) <= 1 && this.ownedPlanetCount(enemy.id, ctx) >= EnemyDiplomacyService.COLLAPSE_ENEMY_PLANETS) {
      add('collapse', 'Empire collapsing', 0.5);
    }
    if (this.empireDistance(ai.id, enemy.id, ctx) > EnemyDiplomacyService.WAR_REACH * 1.5) {
      add('pointless', 'Out of reach', 0.3);
    }
    if ((ai.currencies['credits'] ?? 0) < scale * 0.2) {
      add('treasury', 'Empty treasury', 0.15);
    }
    add('personality', 'Temperament', this.profileOf(ai).peaceBias);

    const pressure = factors.reduce((sum, f) => sum + f.value, 0);
    return { pressure, scale, peaceValue: pressure * scale, factors };
  }

  /* Value of the terms for `ai` in credits (positive = good for it). */
  termsValue(ai: Faction, treaty: PeaceTreaty): number {
    let value = 0;
    for (const item of treaty.items) {
      const sign = item.giverId === ai.id ? -1 : 1;
      if (item.kind === 'credits') value += sign * item.amount;
      else if (item.kind === 'rawmaterials') value += sign * item.amount * EnemyDiplomacyService.RAW_VALUE;
    }
    return value;
  }

  evaluateTreaty(ai: Faction, treaty: PeaceTreaty, ctx: DiplomacyContext): TreatyEvaluation {
    const enemy = ctx.factions.find((f) => f.id === otherParty(treaty, ai.id));
    const validation = validateTreaty(treaty, ctx);
    const assessment = enemy ? this.assessWar(ai, enemy, ctx) : { pressure: 0, scale: 2000, peaceValue: 0, factors: [] };
    const termsValue = this.termsValue(ai, treaty);
    const margin = termsValue + assessment.peaceValue;
    return {
      validation,
      termsValue,
      peaceValue: assessment.peaceValue,
      margin,
      acceptance: clamp(0.5 + margin / (2 * assessment.scale), 0, 1),
      accept: validation.ok && margin >= 0,
      assessment,
    };
  }

  /* The AI's answer to a proposal addressed to it. */
  respondToProposal(ai: Faction, treaty: PeaceTreaty, ctx: DiplomacyContext): ProposalResponse {
    const evaluation = this.evaluateTreaty(ai, treaty, ctx);
    if (evaluation.accept) return { decision: 'accept', evaluation };
    if (!evaluation.validation.ok) return { decision: 'refuse', evaluation };
    const counter = this.counterOffer(ai, treaty, ctx);
    return counter ? { decision: 'counter', evaluation, counter } : { decision: 'refuse', evaluation };
  }

  /* Smallest change to `treaty` the AI would accept, as its own proposal; undefined if none. */
  counterOffer(ai: Faction, treaty: PeaceTreaty, ctx: DiplomacyContext): PeaceTreaty | undefined {
    const otherId = otherParty(treaty, ai.id);
    const other = ctx.factions.find((f) => f.id === otherId);
    if (!other) return undefined;
    let items: TreatyItem[] = treaty.items.map((item) => ({ ...item }));
    const build = (): PeaceTreaty => ({ proposerId: ai.id, recipientId: otherId, items });
    const margin = () => this.evaluateTreaty(ai, build(), ctx).margin;

    // 1. Pay less.
    for (const kind of ['credits', 'rawmaterials'] as const) {
      const item = items.find((i) => i.giverId === ai.id && i.kind === kind) as { amount: number } | undefined;
      const deficit = -margin();
      if (!item || deficit <= 0) continue;
      const unit = kind === 'credits' ? 1 : EnemyDiplomacyService.RAW_VALUE;
      item.amount = Math.max(0, roundDown10(item.amount - deficit / unit));
      if (item.amount === 0) items = items.filter((i) => i !== (item as unknown as TreatyItem));
    }
    // 2. Ask for resources the other side holds.
    for (const kind of ['credits', 'rawmaterials'] as const) {
      const deficit = -margin();
      if (deficit <= 0) break;
      const unit = kind === 'credits' ? 1 : EnemyDiplomacyService.RAW_VALUE;
      const existing = items.find((i) => i.giverId === otherId && i.kind === kind) as { amount: number } | undefined;
      const already = existing?.amount ?? 0;
      const available = Math.floor(other.currencies[kind] ?? 0) - already;
      const ask = Math.min(available, roundUp10(deficit / unit));
      if (ask <= 0) continue;
      if (existing) existing.amount += ask;
      else items.push({ kind, giverId: otherId, amount: ask });
    }
    const counter = build();
    const evaluation = this.evaluateTreaty(ai, counter, ctx);
    if (!evaluation.accept) return undefined;
    if (JSON.stringify(counter.items) === JSON.stringify(treaty.items) && treaty.proposerId === ai.id) return undefined;
    return counter;
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

  /* ---------- Periodic review ---------- */

  private reviewPeace(ai: Faction, ctx: DiplomacyContext): boolean {
    let changed = false;
    for (const enemy of this.warEnemies(ai, ctx)) {
      if (!this.diplomacy.canNegotiate(ai, enemy).ok) continue;
      const mine = this.assessWar(ai, enemy, ctx);
      if (enemy.ai === true) {
        changed = this.settleAiWar(ai, enemy, mine, ctx) || changed;
      } else if (
        mine.pressure >= EnemyDiplomacyService.PROPOSE_MIN_PRESSURE
        && !this.diplomacy.hasOffer(ai.id)
        && !this.offerCooldowns.has(ai.id)
      ) {
        const treaty = this.buildProposal(ai, enemy, mine);
        if (validateTreaty(treaty, ctx).ok && this.evaluateTreaty(ai, treaty, ctx).accept) {
          this.diplomacy.addOffer(treaty);
          this.offerCooldowns.set(ai.id, EnemyDiplomacyService.OFFER_COOLDOWN);
          changed = true;
        }
      }
    }
    return changed;
  }

  /*
   * Two AIs end their war when both peace values together allow it: white
   * peace if both want out; otherwise the more eager side pays the other's
   * price in resources it holds.
   */
  private settleAiWar(ai: Faction, enemy: Faction, mine: WarAssessment, ctx: DiplomacyContext): boolean {
    const theirs = this.assessWar(enemy, ai, ctx);
    if (mine.peaceValue + theirs.peaceValue < 0) return false;
    let treaty: PeaceTreaty = { proposerId: ai.id, recipientId: enemy.id, items: [] };
    if (mine.peaceValue < 0 || theirs.peaceValue < 0) {
      const [payer, price] = mine.peaceValue >= theirs.peaceValue
        ? [ai, -theirs.peaceValue]
        : [enemy, -mine.peaceValue];
      const items = this.resourcePayment(payer, roundUp10(price));
      if (!items) return false;
      treaty = { ...treaty, items };
    }
    if (!this.evaluateTreaty(ai, treaty, ctx).accept || !this.evaluateTreaty(enemy, { ...treaty, proposerId: enemy.id, recipientId: ai.id }, ctx).accept) {
      return false;
    }
    return this.diplomacy.executeTreaty(ctx, treaty).ok;
  }

  /* Credits first, then raw materials, covering `value`; undefined if the payer cannot. */
  private resourcePayment(payer: Faction, value: number): TreatyItem[] | undefined {
    if (value <= 0) return [];
    const credits = Math.min(Math.floor(payer.currencies['credits'] ?? 0), value);
    const rest = value - credits;
    const raw = rest > 0 ? roundUp10(rest / EnemyDiplomacyService.RAW_VALUE) : 0;
    if (raw > Math.floor(payer.currencies['rawmaterials'] ?? 0)) return undefined;
    const items: TreatyItem[] = [];
    if (credits > 0) items.push({ kind: 'credits', giverId: payer.id, amount: credits });
    if (raw > 0) items.push({ kind: 'rawmaterials', giverId: payer.id, amount: raw });
    return items;
  }

  /* AI proposal to the human: white peace plus credits worth up to half its surplus will for peace. */
  private buildProposal(ai: Faction, human: Faction, mine: WarAssessment): PeaceTreaty {
    const credits = roundDown10(Math.min(mine.peaceValue * 0.5, (ai.currencies['credits'] ?? 0) * 0.4));
    const items: TreatyItem[] = credits >= 100 ? [{ kind: 'credits', giverId: ai.id, amount: credits }] : [];
    return { proposerId: ai.id, recipientId: human.id, items };
  }

  private reviewWar(ai: Faction, ctx: DiplomacyContext): boolean {
    const profile = this.profileOf(ai);
    if (this.warEnemies(ai, ctx).length >= profile.maxWars) return false;
    if (getFactionWarExhaustion(ai) >= EnemyDiplomacyService.NO_NEW_WAR_EXHAUSTION) return false;
    let best: { target: Faction; ratio: number; distance: number; breach: boolean } | undefined;
    for (const other of ctx.factions) {
      if (!isTreatyPair(ai, other) || !isFactionAlive(other.id, ctx)) continue;
      if (getRelation(ai, other)?.state !== 'peace') continue;
      const ratio = this.strengthRatio(other, ai, ctx);
      const distance = this.empireDistance(ai.id, other.id, ctx);
      const opinion = getEffectiveOpinion(ai, other);
      if (distance > EnemyDiplomacyService.WAR_REACH || ratio > profile.warRatio || opinion > profile.warOpinionMax) continue;
      const breach = isTruceActive(ai, other);
      if (breach && !(profile.treachery && ratio <= profile.warRatio * 0.5 && opinion <= -40)) continue;
      if (!best || ratio < best.ratio || (ratio === best.ratio && distance < best.distance)) {
        best = { target: other, ratio, distance, breach };
      }
    }
    if (!best) return false;
    return best.breach ? this.diplomacy.breakTreaty(ai, best.target).ok : this.diplomacy.declareWar(ai, best.target).ok;
  }

  /* ---------- Helpers ---------- */

  private warEnemies(ai: Faction, ctx: DiplomacyContext): Faction[] {
    return ctx.factions.filter((other) => getRelation(ai, other)?.state === 'war' && isFactionAlive(other.id, ctx));
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

  private strengthRatio(other: Faction, self: Faction, ctx: DiplomacyContext): number {
    return this.militaryStrength(other.id, ctx.fleets) / Math.max(1, this.militaryStrength(self.id, ctx.fleets));
  }

  /* About one minute of income: population pays 0.1 credits/s per inhabitant. */
  private scaleOf(ai: Faction, ctx: DiplomacyContext): number {
    const population = ctx.starSystems
      .flatMap((s) => s.planetsTiles)
      .filter((p) => p.factionId === ai.id)
      .reduce((sum, p) => sum + (p.population ?? 0), 0);
    return Math.max(2000, population * 0.1 * 60);
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

  private profileOf(faction: Faction): DiplomacyProfile {
    return DIPLOMACY_PROFILES[getAiPersonalityProfile(faction).id];
  }
}

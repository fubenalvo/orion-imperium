import { Injectable } from '@angular/core';
import { ShipService } from '../../services/ship.service';
import { DemandFailure, DiplomacyService } from '../../services/diplomacy.service';
import { getAiPersonalityProfile } from './ai-personality';
import { AiPersonality, Faction, FactionProduction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import {
  getDemandsReceived,
  getDemandsRefused,
  getEffectiveOpinion,
  getEmptyThreats,
  getFactionWarExhaustion,
  getRelation,
  getWarExhaustion,
  isTreatyPair,
  isTruceActive,
} from './diplomacy';
import {
  DEMAND_RULES,
  DemandKind,
  DemandValidation,
  DiplomaticDemand,
  MAX_DEMAND_TARGET_SHARE,
  MAX_PAYMENT_SHARE,
  MIN_DEMAND_CREDITS,
  PLAYER_DEMAND_COOLDOWN_SECONDS,
  roundDemandAmount,
  validateDemand,
} from './diplomatic-demand';
import { availableResource } from './resource-transfer';
import { EnemyEconomyService } from './enemy-economy.service';
import { POPULATION_CREDIT_RATE } from '../../services/economy.service';
import {
  PeaceTreaty,
  TreatyItem,
  TreatyValidation,
  isFactionAlive,
  otherParty,
  validateTreaty,
} from './peace-treaty';
import { DysonVictoryService } from './dyson-victory.service';
import { EnemyDysonService } from './enemy-dyson.service';

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
 *  5. Credit demands at peace (diplomatic-demand.ts), between the review
 *     of peace and of war: planDemand picks a target and a kind from the
 *     personality, strength ratio, distance, opinion, own treasury, the
 *     target's spendable credits and earlier refusals; makeDemand is the
 *     one path for every demander (AI or human): an AI target answers at
 *     once (evaluateDemand, a sum of named factors like assessWar), a
 *     demand to the human waits. On a refused threat the AI recomputes
 *     assessFollowThrough from the current state — war through the normal
 *     declareWar, or a bluff. Never random: the same state gives the same
 *     decision, and earlier empty threats push the next decision toward
 *     war while making every empire take its threats less seriously.
 *     An AI never pays more than its spendable credits (above the
 *     EnemyEconomyService spending reserve, at most MAX_PAYMENT_SHARE).
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
  /* Credit demands (diplomatic-demand.ts): */
  /* Game seconds between this AI's own demands (to anyone). */
  demandCooldown: number;
  /* Demand size as a share of its own economic scale (× the kind's multiplier). */
  demandShare: number;
  /* Target/own strength ratio up to which it threatens war. */
  threatRatio: number;
  /* Target/own strength ratio up to which it demands tribute. */
  tributeRatio: number;
  /* Added to the war-or-bluff score when a threat is refused (positive = carries it out). */
  followThrough: number;
  /* Multiplier on its opinion loss when its demand is refused. */
  refusalTolerance: number;
  /* As a target: added to its will to pay tribute and threats. */
  yieldBias: number;
  /* As a target: added to its will to grant financial requests. */
  generosity: number;
}

/*
 * Militarists demand often and large, threaten readily and usually carry
 * their threats out; technologists rarely demand, mostly ask for support,
 * seldom threaten and nearly always bluff; balanced and expansionist sit
 * in between. Tuning lives here only (docs/diplomacy.md lists the table).
 */
const DIPLOMACY_PROFILES: Readonly<Record<AiPersonality, DiplomacyProfile>> = {
  balanced: {
    peaceBias: 0, warRatio: 0.6, maxWars: 1, warOpinionMax: 10, treachery: false,
    demandCooldown: 480, demandShare: 0.5, threatRatio: 0.5, tributeRatio: 0.65, followThrough: -0.3, refusalTolerance: 1, yieldBias: 0, generosity: 0.05,
  },
  expansionist: {
    peaceBias: 0.05, warRatio: 0.65, maxWars: 1, warOpinionMax: 15, treachery: false,
    demandCooldown: 420, demandShare: 0.6, threatRatio: 0.55, tributeRatio: 0.7, followThrough: -0.15, refusalTolerance: 1.1, yieldBias: -0.05, generosity: 0,
  },
  militarist: {
    peaceBias: -0.2, warRatio: 0.85, maxWars: 2, warOpinionMax: 30, treachery: true,
    demandCooldown: 300, demandShare: 0.8, threatRatio: 0.8, tributeRatio: 0.9, followThrough: 0.35, refusalTolerance: 1.4, yieldBias: -0.2, generosity: -0.1,
  },
  technologist: {
    peaceBias: 0.15, warRatio: 0.5, maxWars: 1, warOpinionMax: 0, treachery: false,
    demandCooldown: 720, demandShare: 0.35, threatRatio: 0.3, tributeRatio: 0.45, followThrough: -0.9, refusalTolerance: 0.7, yieldBias: 0.1, generosity: 0.15,
  },
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
  /* Needed for the AI spending reserve when an AI decides how much it can pay. */
  shipStock?: FactionShipStock[];
}

/** An AI target's judgment of a credit demand (named factors, like assessWar). */
export interface DemandEvaluation {
  validation: DemandValidation;
  /** Credits the target can pay: AI = above its spending reserve and ≤ MAX_PAYMENT_SHARE of its stock. */
  spendable: number;
  affordable: boolean;
  /** Sum of the factors; the target pays a feasible, affordable demand when ≥ 0. */
  score: number;
  factors: WarFactor[];
  accept: boolean;
}

/** What became of a demand right away: paid, refused, war or bluff (AI target), or waiting. */
export type DemandOutcomeKind = 'paid' | 'refused' | 'war' | 'bluff' | 'pending' | 'follow_through';

export interface DemandOutcome {
  /** False when the demand could not be made at all (see reason). */
  ok: boolean;
  reason?: DemandFailure;
  waitSeconds?: number;
  demand?: DiplomaticDemand;
  outcome?: DemandOutcomeKind;
  /** The AI target's judgment (only when an AI answered). */
  evaluation?: DemandEvaluation;
}

/** An AI's decision whether to carry out a refused threat. */
export interface FollowThroughAssessment {
  carryOut: boolean;
  score: number;
  factors: WarFactor[];
}

/** A demand an AI wants to make (planDemand). */
export interface DemandPlan {
  target: Faction;
  kind: DemandKind;
  amount: number;
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
    private readonly enemyEconomy: EnemyEconomyService,
    private readonly dysonVictory: DysonVictoryService,
    private readonly enemyDyson: EnemyDysonService,
  ) {}

  /*
   * No peace for the Dyson Swarm (docs/dyson-swarm.md): an AI neither makes
   * nor accepts peace with an empire counting down a warm-up (a truce would
   * shield it), nor with the empire it is hunting for the swarm (a
   * settlement would end the hunt before its fleets arrive).
   */
  private blocksPeace(ai: Faction, enemy: Faction | undefined, ctx: DiplomacyContext): boolean {
    if (!enemy) return false;
    const warmup = this.dysonVictory.warmup;
    if (warmup && warmup.remaining > 0 && warmup.factionId === enemy.id) return true;
    return this.enemyDyson.isHuntTarget(ai, enemy, ctx.factions);
  }

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
    // Unanswered demands to the human count as refused as soon as they
    // expire (not only at decision time), so the timer the player sees is exact.
    let changed = false;
    for (const expired of this.diplomacy.takeExpiredDemands()) {
      this.handleRefusal(expired, ctx);
      changed = true;
    }
    this.accumulator += gameDeltaTime;
    if (this.accumulator < EnemyDiplomacyService.DECISION_INTERVAL) return changed;
    this.accumulator = 0;

    // Fixed faction order keeps the decisions deterministic.
    for (const faction of ctx.factions) {
      if (faction.ai !== true || !isFactionAlive(faction.id, ctx)) continue;
      changed = this.reviewPeace(faction, ctx) || changed;
      changed = this.reviewDemands(faction, ctx) || changed;
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
    if (this.blocksPeace(ai, enemy, ctx)) {
      // Shown on the acceptance meter; evaluateTreaty also refuses outright.
      add('dyson', 'Dyson Swarm', -2);
    }

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
      acceptance: this.blocksPeace(ai, enemy, ctx) ? 0 : clamp(0.5 + margin / (2 * assessment.scale), 0, 1),
      accept: validation.ok && margin >= 0 && !this.blocksPeace(ai, enemy, ctx),
      assessment,
    };
  }

  /* The AI's answer to a proposal addressed to it. */
  respondToProposal(ai: Faction, treaty: PeaceTreaty, ctx: DiplomacyContext): ProposalResponse {
    const evaluation = this.evaluateTreaty(ai, treaty, ctx);
    if (evaluation.accept) return { decision: 'accept', evaluation };
    if (!evaluation.validation.ok) return { decision: 'refuse', evaluation };
    // No terms buy peace from an AI while the other side's Dyson warm-up runs.
    if (this.blocksPeace(ai, ctx.factions.find((f) => f.id === otherParty(treaty, ai.id)), ctx)) {
      return { decision: 'refuse', evaluation };
    }
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

  /* ---------- Credit demands (diplomatic-demand.ts) ---------- */

  /**
   * The one path for making a demand, for an AI or the human demander.
   * Applies DiplomacyService.issueDemand (checks, cooldowns, opinion);
   * an AI target answers at once (answerDemand), a demand to the human is
   * stored and waits for the player.
   */
  makeDemand(demander: Faction, target: Faction, kind: DemandKind, amount: number, ctx: DiplomacyContext): DemandOutcome {
    const cooldown = demander.ai === true ? this.profileOf(demander).demandCooldown : PLAYER_DEMAND_COOLDOWN_SECONDS;
    const issued = this.diplomacy.issueDemand(demander, target, kind, amount, ctx, cooldown);
    if (!issued.ok || !issued.demand) return { ok: false, reason: issued.reason, waitSeconds: issued.waitSeconds };
    if (target.ai !== true) {
      this.diplomacy.addPendingDemand(issued.demand);
      return { ok: true, demand: issued.demand, outcome: 'pending' };
    }
    const answer = this.answerDemand(target, issued.demand, ctx);
    return { ok: true, demand: issued.demand, outcome: answer.outcome, evaluation: answer.evaluation };
  }

  /** An AI target's answer: pays when evaluateDemand accepts and the payment succeeds, refuses otherwise. */
  answerDemand(target: Faction, demand: DiplomaticDemand, ctx: DiplomacyContext): { outcome: DemandOutcomeKind; evaluation: DemandEvaluation } {
    const evaluation = this.evaluateDemand(target, demand, ctx);
    if (evaluation.accept && this.diplomacy.acceptDemand(demand, ctx).ok) return { outcome: 'paid', evaluation };
    return { outcome: this.handleRefusal(demand, ctx), evaluation };
  }

  /**
   * Applies a refusal (by an AI, by the human, or by an unanswered demand
   * expiring). A refused threat is then followed through: an AI demander
   * decides war or bluff now (assessFollowThrough); the human demander
   * gets a follow-through decision with its own timer.
   */
  handleRefusal(demand: DiplomaticDemand, ctx: DiplomacyContext): DemandOutcomeKind {
    const demander = ctx.factions.find((f) => f.id === demand.demanderId);
    const target = ctx.factions.find((f) => f.id === demand.targetId);
    const tolerance = demander?.ai === true ? this.profileOf(demander).refusalTolerance : 1;
    this.diplomacy.refuseDemand(demand, ctx.factions, tolerance);
    if (demand.kind !== 'threat' || !demander || !target) return 'refused';
    if (demander.ai !== true) {
      this.diplomacy.startFollowThrough(demand);
      return 'follow_through';
    }
    const decision = this.assessFollowThrough(demander, target, ctx);
    if (decision.carryOut && this.diplomacy.carryOutThreat(demand, ctx.factions).ok) return 'war';
    this.diplomacy.backDown(demand, ctx.factions);
    return 'bluff';
  }

  /**
   * How `target` (an AI) judges a demand: deterministic named factors.
   * Requests weigh relations, the demander's need and generosity; tribute
   * and threats weigh the balance of power (threats also reach, the
   * demander's capacity for another war and its record of empty threats).
   * Pays iff the demand is valid, within its spendable credits and the
   * score is ≥ 0.
   */
  evaluateDemand(target: Faction, demand: DiplomaticDemand, ctx: DiplomacyContext): DemandEvaluation {
    const validation = validateDemand(demand, ctx);
    const spendable = this.spendableCredits(target, ctx);
    const affordable = demand.amount <= spendable;
    const demander = ctx.factions.find((f) => f.id === demand.demanderId);
    const factors: WarFactor[] = [];
    const add = (key: string, label: string, value: number) => {
      if (Math.abs(value) >= 0.005) factors.push({ key, label, value });
    };
    if (demander) {
      const profile = this.profileOf(target);
      add('burden', 'Cost to the treasury', -clamp((0.6 * demand.amount) / this.scaleOf(target, ctx), 0, 1.5));
      // issueDemand already counted this demand; only earlier ones annoy.
      add('repeated', 'Repeated demands', -0.15 * Math.max(0, getDemandsReceived(target, demander) - 1));
      const opinion = getEffectiveOpinion(target, demander) / 100;
      if (demand.kind === 'request') {
        add('baseline', 'Reluctance', -0.1);
        add('opinion', 'Relations', 0.8 * opinion);
        if ((demander.currencies['credits'] ?? 0) < this.scaleOf(demander, ctx) * 0.25) add('need', 'Their need', 0.15);
        add('personality', 'Generosity', profile.generosity);
      } else {
        const power = this.militaryStrength(demander.id, ctx.fleets) / Math.max(1, this.militaryStrength(target.id, ctx.fleets));
        const balance = clamp(0.5 * Math.log2(Math.max(power, 1 / 16)), -1, 1);
        add('pride', 'Pride', demand.kind === 'tribute' ? -0.25 : -0.15);
        add('power', 'Balance of power', (demand.kind === 'tribute' ? 0.6 : 1) * balance);
        add('opinion', 'Relations', 0.2 * opinion);
        if (demand.kind === 'threat') {
          if (this.empireDistance(demander.id, target.id, ctx) > EnemyDiplomacyService.WAR_REACH) add('reach', 'Out of their reach', -0.4);
          if (!this.canStartWar(demander, ctx)) add('capacity', 'They cannot take on another war', -0.3);
          add('credibility', 'Empty threats', -0.2 * getEmptyThreats(demander));
          if (this.warEnemies(target, ctx).length > 0) add('second_front', 'Already at war', 0.2);
        }
        add('personality', 'Temperament', profile.yieldBias);
      }
    }
    const score = factors.reduce((sum, f) => sum + f.value, 0);
    return { validation, spendable, affordable, score, factors, accept: validation.ok && affordable && !!demander && score >= 0 };
  }

  /**
   * Whether `ai` carries out its refused threat against `target`, from the
   * current state: impossible when war cannot be declared (truce or other
   * declareWar rule), when it is at its war limit or exhausted, or out of
   * reach; otherwise temperament + military balance − relations + the
   * pressure of its own earlier empty threats (credibility to restore) ≥ 0.
   */
  assessFollowThrough(ai: Faction, target: Faction, ctx: DiplomacyContext): FollowThroughAssessment {
    const factors: WarFactor[] = [];
    const blocked = !this.diplomacy.canDeclareWar(ai, target).ok
      || !this.canStartWar(ai, ctx)
      || this.empireDistance(ai.id, target.id, ctx) > EnemyDiplomacyService.WAR_REACH;
    if (blocked) {
      factors.push({ key: 'unable', label: 'Cannot wage this war now', value: -1 });
      return { carryOut: false, score: -1, factors };
    }
    const own = this.militaryStrength(ai.id, ctx.fleets);
    const theirs = this.militaryStrength(target.id, ctx.fleets);
    factors.push({ key: 'personality', label: 'Temperament', value: this.profileOf(ai).followThrough });
    factors.push({ key: 'military', label: 'Military balance', value: clamp(0.4 * Math.log2(Math.max(own, 1) / Math.max(theirs, 1)), -0.8, 0.8) });
    factors.push({ key: 'opinion', label: 'Relations', value: (-0.3 * getEffectiveOpinion(ai, target)) / 100 });
    factors.push({ key: 'credibility', label: 'Credibility to restore', value: 0.15 * getEmptyThreats(ai) });
    const score = factors.reduce((sum, f) => sum + f.value, 0);
    return { carryOut: score >= 0, score, factors };
  }

  /**
   * Credits a faction can pay toward a demand. The human decides alone
   * (its whole stock). An AI keeps EnemyEconomyService's spending reserve
   * and never pays more than MAX_PAYMENT_SHARE of its credits.
   */
  spendableCredits(faction: Faction, ctx: DiplomacyContext): number {
    const credits = availableResource(faction, 'credits');
    if (faction.ai !== true) return credits;
    const reserve = this.enemyEconomy.getSpendingReserve(faction, ctx.starSystems, {
      fleets: ctx.fleets,
      shipStock: ctx.shipStock ?? [],
      production: ctx.production ?? [],
      factions: ctx.factions,
    }, true);
    return Math.max(0, Math.min(Math.floor(credits * MAX_PAYMENT_SHARE), Math.floor(credits - reserve.credits)));
  }

  /**
   * The demand `ai` would make now, or undefined. Per peace partner it may
   * demand from (cooldowns, open demands and the human's queue checked by
   * DiplomacyService.canIssueDemand): a threat when it can fight, the
   * target is in reach, weak enough (threatRatio; ×1.2 after a refusal —
   * it escalates) and not liked; tribute when clearly stronger; a request
   * when its own treasury is low and it does not dislike the target (no
   * more requests after two recent refusals). No tribute or threat during
   * a truce. The amount scales with its own economy and never exceeds
   * MAX_DEMAND_TARGET_SHARE of the target's credits (for an AI target:
   * also its spendable credits). Harshest kind first, then the weakest target.
   */
  planDemand(ai: Faction, ctx: DiplomacyContext): DemandPlan | undefined {
    if ((ai.demandCooldown ?? 0) > 0) return undefined;
    const profile = this.profileOf(ai);
    const scale = this.scaleOf(ai, ctx);
    const struggling = (ai.currencies['credits'] ?? 0) < scale * 0.25;
    const canFight = this.canStartWar(ai, ctx);
    const rank: Record<DemandKind, number> = { request: 1, tribute: 2, threat: 3 };
    let best: (DemandPlan & { rank: number; ratio: number }) | undefined;
    for (const other of ctx.factions) {
      if (!isTreatyPair(ai, other) || getRelation(ai, other)?.state !== 'peace' || !isFactionAlive(other.id, ctx)) continue;
      if (!this.diplomacy.canIssueDemand(ai, other, 'request', MIN_DEMAND_CREDITS, ctx).ok) continue;
      const ratio = this.strengthRatio(other, ai, ctx);
      const distance = this.empireDistance(ai.id, other.id, ctx);
      const opinion = getEffectiveOpinion(ai, other);
      const refused = getDemandsRefused(ai, other);
      const truce = isTruceActive(ai, other);
      const escalation = refused >= 1 ? 1.2 : 1;
      let kind: DemandKind | undefined;
      if (canFight && !truce && distance <= EnemyDiplomacyService.WAR_REACH && ratio <= profile.threatRatio * escalation && opinion <= profile.warOpinionMax + 25) {
        kind = 'threat';
      } else if (!truce && distance <= EnemyDiplomacyService.WAR_REACH * 1.5 && ratio <= profile.tributeRatio && opinion <= 30) {
        kind = 'tribute';
      } else if (struggling && opinion >= 0 && refused < 2) {
        kind = 'request';
      }
      if (!kind) continue;
      const share = Math.floor(availableResource(other, 'credits') * MAX_DEMAND_TARGET_SHARE);
      const cap = other.ai === true ? Math.min(share, this.spendableCredits(other, ctx)) : share;
      const amount = roundDemandAmount(Math.min(scale * profile.demandShare * DEMAND_RULES[kind].amountMultiplier, cap));
      if (amount < MIN_DEMAND_CREDITS) continue;
      if (!best || rank[kind] > best.rank || (rank[kind] === best.rank && ratio < best.ratio)) {
        best = { target: other, kind, amount, rank: rank[kind], ratio };
      }
    }
    return best ? { target: best.target, kind: best.kind, amount: best.amount } : undefined;
  }

  /* ---------- Periodic review ---------- */

  private reviewDemands(ai: Faction, ctx: DiplomacyContext): boolean {
    const plan = this.planDemand(ai, ctx);
    return !!plan && this.makeDemand(ai, plan.target, plan.kind, plan.amount, ctx).ok;
  }

  /* Can `faction` start another war now (AI: war limit; everyone: exhaustion)? */
  private canStartWar(faction: Faction, ctx: DiplomacyContext): boolean {
    if (getFactionWarExhaustion(faction) >= EnemyDiplomacyService.NO_NEW_WAR_EXHAUSTION) return false;
    return faction.ai !== true || this.warEnemies(faction, ctx).length < this.profileOf(faction).maxWars;
  }

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
      // An open demand between the two is answered first: an ultimatum's
      // war, if any, comes from its follow-through, not from a parallel declaration.
      if (this.diplomacy.hasOpenDemand(ai.id, other.id)) continue;
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

  /* About one minute of income: population pays POPULATION_CREDIT_RATE credits/s per inhabitant. */
  private scaleOf(ai: Faction, ctx: DiplomacyContext): number {
    const population = ctx.starSystems
      .flatMap((s) => s.planetsTiles)
      .filter((p) => p.factionId === ai.id)
      .reduce((sum, p) => sum + (p.population ?? 0), 0);
    return Math.max(2000, population * POPULATION_CREDIT_RATE * 60);
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

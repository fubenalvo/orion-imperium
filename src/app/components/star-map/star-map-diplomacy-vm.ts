import { Faction, Fleet, StarSystem, TreatyState } from './star-map.models';
import {
  formatGameDuration,
  getFactionWarExhaustion,
  getOpinion,
  getRelation,
  getReputation,
  getWarExhaustion,
  getWarExhaustionPenalty,
  isTreatyPair,
  isTruceActive,
} from './diplomacy';
import { PeaceTreaty, TreatyItem, describeTreatyInvalid, isFactionAlive } from './peace-treaty';
import { DiplomacyService } from '../../services/diplomacy.service';
import { EnemyDiplomacyService, WarFactor } from './enemy-diplomacy.service';
import { getAiPersonalityProfile } from './ai-personality';
import {
  DEMAND_RULES,
  DemandKind,
  MIN_DEMAND_CREDITS,
  demandMessage,
  roundDemandAmount,
} from './diplomatic-demand';
import { availableResource } from './resource-transfer';

/*
 * View models for the Diplomacy screen and the peace negotiation dialog.
 * Pure presentation: every number comes from diplomacy.ts,
 * DiplomacyService or EnemyDiplomacyService, so the UI shows exactly the
 * values the rules use (docs/diplomacy.md).
 *
 * Time is real game time (the game has no turns): durations are carried in
 * seconds and shown through formatGameDuration, so every timer on the
 * screen reads the same way and pauses with the game.
 */

export interface DiplomacyOfferVm {
  secondsLeft: number;
  /* secondsLeft formatted for display ("1 min 20 s"). */
  timeLeftLabel: string;
  summary: string[];
}

/** An AI demand waiting for the player's answer. */
export interface IncomingDemandVm {
  id: number;
  kind: DemandKind;
  kindLabel: string;
  /* The demand in the demander's voice (tone follows its personality). */
  message: string;
  amount: number;
  secondsLeft: number;
  timeLeftLabel: string;
  /* What refusing may cost; never reveals whether a threat is a bluff. */
  consequence: string;
  /* The player holds the credits right now. */
  affordable: boolean;
}

/** The player's refused ultimatum, waiting for war or backing down. */
export interface FollowThroughVm {
  id: number;
  amount: number;
  timeLeftLabel: string;
  canDeclareWar: boolean;
}

/** Whether and how the player can demand credits from this empire now. */
export interface DemandOptionsVm {
  available: boolean;
  /* Why not (cooldown, open demand, poor target…); null when available. */
  reason: string | null;
  minAmount: number;
  /* Their current credits: a demand can never exceed what they hold. */
  maxAmount: number;
  suggested: number;
  /* No ultimatum during a truce (it could only be enforced by a breach). */
  threatAllowed: boolean;
}

export interface DiplomacyRowVm {
  id: string;
  name: string;
  color: string;
  personality: string;
  state: TreatyState;
  /* False once the faction has no planet and no living fleet. */
  alive: boolean;
  planets: number;
  /* Fleet strength compared with the player's. */
  strength: 'weaker' | 'comparable' | 'stronger';
  /* Their opinion of the player (−100…+100). */
  opinionOfYou: number;
  reputation: number;
  /* At war: exhaustion of each side in this war. */
  yourExhaustion: number;
  theirExhaustion: number;
  /* At war: game seconds the war has lasted so far. */
  warSeconds: number;
  /* At peace: game seconds left on the truce (0 = no truce). */
  truceSecondsLeft: number;
  /* At war: game seconds until negotiation is possible (0 = now). */
  negotiateWait: number;
  /* The three durations above formatted for display. */
  warDurationLabel: string;
  truceLeftLabel: string;
  negotiateWaitLabel: string;
  canNegotiate: boolean;
  canDeclareWar: boolean;
  canBreakTreaty: boolean;
  offer?: DiplomacyOfferVm;
  incomingDemand?: IncomingDemandVm;
  followThrough?: FollowThroughVm;
  demandOptions: DemandOptionsVm;
  atWarWith: string[];
  atPeaceWith: string[];
}

export interface DiplomacySummaryVm {
  reputation: number;
  exhaustion: number;
  /* Economy penalty from exhaustion, in percent. */
  penaltyPercent: number;
  warCount: number;
}

export interface NegotiationSideVm {
  factionId: string;
  name: string;
  color: string;
  credits: number;
  rawmaterials: number;
  exhaustion: number;
  reputation: number;
  /* This side's opinion of the other side. */
  opinion: number;
}

export interface NegotiationEvaluationVm {
  valid: boolean;
  invalidText: string | null;
  accept: boolean;
  /* 0…1, 0.5 = acceptance threshold. */
  acceptance: number;
  /* Credits of value still missing (> 0) or to spare (< 0). */
  shortfall: number;
  factors: WarFactor[];
  peaceValue: number;
  termsValue: number;
}

export interface NegotiationVm {
  /* The player's editable terms (player = proposer). */
  draft: PeaceTreaty;
  you: NegotiationSideVm;
  them: NegotiationSideVm;
  /* Terms on the table from the AI (its proposal or counter-offer). */
  incoming: { kind: 'offer' | 'counter'; treaty: PeaceTreaty; summary: string[]; secondsLeft?: number } | null;
  /* The AI's judgment of the player's current draft. */
  evaluation: NegotiationEvaluationVm;
  message: string | null;
}

interface World {
  factions: Faction[];
  starSystems: StarSystem[];
  fleets: Fleet[];
}

export function buildDiplomacySummary(player: Faction, world: World): DiplomacySummaryVm {
  const exhaustion = getFactionWarExhaustion(player);
  return {
    reputation: Math.round(getReputation(player)),
    exhaustion: Math.round(exhaustion),
    penaltyPercent: Math.round(getWarExhaustionPenalty(player) * 100),
    warCount: world.factions.filter((f) => isTreatyPair(player, f) && isFactionAlive(f.id, world) && getRelation(player, f)?.state === 'war').length,
  };
}

export function buildDiplomacyRows(
  player: Faction,
  world: World,
  diplomacy: DiplomacyService,
  enemyDiplomacy: EnemyDiplomacyService,
): DiplomacyRowVm[] {
  const playerStrength = enemyDiplomacy.militaryStrength(player.id, world.fleets);
  return world.factions
    .filter((f) => isTreatyPair(player, f))
    .map((f) => {
      const relation = getRelation(player, f)!;
      const planets = world.starSystems.reduce((n, s) => n + s.planetsTiles.filter((p) => p.factionId === f.id).length, 0);
      const ratio = enemyDiplomacy.militaryStrength(f.id, world.fleets) / Math.max(1, playerStrength);
      const others = world.factions.filter((o) => o.id !== player.id && isTreatyPair(f, o) && isFactionAlive(o.id, world));
      const offer = diplomacy.getOffer(f.id);
      const negotiate = diplomacy.canNegotiate(player, f);
      const warSeconds = relation.state === 'war' ? relation.warSeconds ?? 0 : 0;
      const truceSecondsLeft = isTruceActive(player, f) ? relation.lockRemaining : 0;
      const negotiateWait = negotiate.reason === 'locked' ? negotiate.waitSeconds ?? 0 : 0;
      return {
        id: f.id,
        name: f.name,
        color: f.color,
        personality: f.ai ? getAiPersonalityProfile(f).label : 'Human',
        state: relation.state,
        alive: isFactionAlive(f.id, world),
        planets,
        strength: ratio < 0.75 ? 'weaker' : ratio > 1.33 ? 'stronger' : 'comparable',
        opinionOfYou: Math.round(getOpinion(f, player)),
        reputation: Math.round(getReputation(f)),
        yourExhaustion: Math.round(getWarExhaustion(player, f)),
        theirExhaustion: Math.round(getWarExhaustion(f, player)),
        warSeconds,
        truceSecondsLeft,
        negotiateWait,
        // Elapsed war time rounds down, remaining times round up (never "0 s" while running).
        warDurationLabel: formatGameDuration(Math.floor(warSeconds)),
        truceLeftLabel: formatGameDuration(truceSecondsLeft),
        negotiateWaitLabel: formatGameDuration(negotiateWait),
        canNegotiate: negotiate.ok && f.ai === true,
        canDeclareWar: diplomacy.canDeclareWar(player, f).ok,
        canBreakTreaty: diplomacy.canBreakTreaty(player, f).ok,
        offer: offer
          ? { secondsLeft: offer.secondsLeft, timeLeftLabel: formatGameDuration(offer.secondsLeft), summary: summarizeTreaty(offer.treaty, player.id, world) }
          : undefined,
        incomingDemand: incomingDemandVm(player, f, diplomacy),
        followThrough: followThroughVm(player, f, diplomacy),
        demandOptions: demandOptionsVm(player, f, world, diplomacy),
        atWarWith: others.filter((o) => getRelation(f, o)?.state === 'war').map((o) => o.name),
        atPeaceWith: others.filter((o) => getRelation(f, o)?.state === 'peace').map((o) => o.name),
      };
    });
}

const DEMAND_CONSEQUENCES: Readonly<Record<DemandKind, string>> = {
  request: 'Refusing sours their opinion of you a little.',
  tribute: 'Refusing will anger them.',
  threat: 'If you refuse, they may declare war on you.',
};

function incomingDemandVm(player: Faction, ai: Faction, diplomacy: DiplomacyService): IncomingDemandVm | undefined {
  const demand = diplomacy.getPendingDemandsFor(player.id).find((d) => d.demanderId === ai.id);
  if (!demand) return undefined;
  return {
    id: demand.id,
    kind: demand.kind,
    kindLabel: DEMAND_RULES[demand.kind].label,
    message: demandMessage(demand.kind, ai.ai === true ? getAiPersonalityProfile(ai).id : 'human', demand.amount),
    amount: demand.amount,
    secondsLeft: demand.secondsLeft,
    timeLeftLabel: formatGameDuration(demand.secondsLeft),
    consequence: DEMAND_CONSEQUENCES[demand.kind],
    affordable: availableResource(player, 'credits') >= demand.amount,
  };
}

function followThroughVm(player: Faction, ai: Faction, diplomacy: DiplomacyService): FollowThroughVm | undefined {
  const demand = diplomacy.getDemands().find((d) => d.stage === 'follow_through' && d.demanderId === player.id && d.targetId === ai.id);
  if (!demand) return undefined;
  return {
    id: demand.id,
    amount: demand.amount,
    timeLeftLabel: formatGameDuration(demand.secondsLeft),
    canDeclareWar: diplomacy.canDeclareWar(player, ai).ok,
  };
}

function demandOptionsVm(player: Faction, ai: Faction, world: World, diplomacy: DiplomacyService): DemandOptionsVm {
  const maxAmount = availableResource(ai, 'credits');
  const check = diplomacy.canIssueDemand(player, ai, 'request', MIN_DEMAND_CREDITS, world);
  let reason: string | null = null;
  if (ai.ai !== true) reason = 'Only AI empires answer demands.';
  else if (!check.ok) {
    switch (check.reason) {
      case 'cooldown': reason = `Next demand possible in ${formatGameDuration(check.waitSeconds ?? 0)}.`; break;
      case 'open_demand': reason = 'A demand between you is still open.'; break;
      case 'insufficient_credits': reason = `They hold fewer than ${MIN_DEMAND_CREDITS} credits.`; break;
      default: reason = 'No demand is possible now.';
    }
  }
  return {
    available: reason === null,
    reason,
    minAmount: MIN_DEMAND_CREDITS,
    maxAmount,
    suggested: Math.min(maxAmount, Math.max(MIN_DEMAND_CREDITS, roundDemandAmount(maxAmount * 0.25))),
    threatAllowed: !isTruceActive(player, ai),
  };
}

function sideVm(self: Faction, other: Faction): NegotiationSideVm {
  return {
    factionId: self.id,
    name: self.name,
    color: self.color,
    credits: Math.floor(self.currencies['credits'] ?? 0),
    rawmaterials: Math.floor(self.currencies['rawmaterials'] ?? 0),
    exhaustion: Math.round(getWarExhaustion(self, other)),
    reputation: Math.round(getReputation(self)),
    opinion: Math.round(getOpinion(self, other)),
  };
}

export function buildNegotiationVm(
  player: Faction,
  ai: Faction,
  draft: PeaceTreaty,
  incoming: NegotiationVm['incoming'],
  message: string | null,
  world: World,
  enemyDiplomacy: EnemyDiplomacyService,
): NegotiationVm {
  const evaluation = enemyDiplomacy.evaluateTreaty(ai, draft, world);
  return {
    draft,
    you: sideVm(player, ai),
    them: sideVm(ai, player),
    incoming,
    evaluation: {
      valid: evaluation.validation.ok,
      invalidText: evaluation.validation.ok ? null : describeTreatyInvalid(evaluation.validation.reason),
      accept: evaluation.accept,
      acceptance: evaluation.acceptance,
      shortfall: Math.round(-evaluation.margin),
      factors: evaluation.assessment.factors,
      peaceValue: Math.round(evaluation.peaceValue),
      termsValue: Math.round(evaluation.termsValue),
    },
    message,
  };
}

/* Human-readable terms, from `viewerId`'s point of view. */
export function summarizeTreaty(treaty: PeaceTreaty, viewerId: string, world: Pick<World, 'starSystems' | 'factions'>): string[] {
  const nameOf = (id: string) => (id === viewerId ? 'You' : world.factions.find((f) => f.id === id)?.name ?? id);
  const lines: string[] = [];
  for (const item of treaty.items) {
    lines.push(`${nameOf(item.giverId)} ${item.giverId === viewerId ? 'give' : 'gives'} ${describeItem(item)}`);
  }
  if (lines.length === 0) lines.push('White peace: no concessions on either side.');
  return lines;
}

function describeItem(item: TreatyItem): string {
  return item.kind === 'credits'
    ? `${item.amount.toLocaleString('en-US')} credits`
    : `${item.amount.toLocaleString('en-US')} raw materials`;
}

import { Faction, Fleet, StarSystem, TreatyState } from './star-map.models';
import {
  DIPLOMACY_TURN_SECONDS,
  getFactionWarExhaustion,
  getOpinion,
  getRelation,
  getReputation,
  getWarExhaustion,
  getWarExhaustionPenalty,
  isTreatyPair,
  isTruceActive,
} from './diplomacy';
import { PeaceTreaty, TreatyItem, cededPlanets, describeTreatyInvalid, isFactionAlive } from './peace-treaty';
import { DiplomacyService } from '../../services/diplomacy.service';
import { EnemyDiplomacyService, WarFactor } from './enemy-diplomacy.service';
import { getAiPersonalityProfile } from './ai-personality';

/*
 * View models for the Diplomacy screen and the peace negotiation dialog.
 * Pure presentation: every number comes from diplomacy.ts,
 * DiplomacyService or EnemyDiplomacyService, so the UI shows exactly the
 * values the rules use (docs/diplomacy.md).
 */

export interface DiplomacyOfferVm {
  secondsLeft: number;
  summary: string[];
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
  /* Turns of war so far (at war). */
  warTurns: number;
  /* At peace: turns left on the truce (0 = no truce). */
  truceTurns: number;
  /* At war: seconds until negotiation is possible (0 = now). */
  negotiateWait: number;
  canNegotiate: boolean;
  canDeclareWar: boolean;
  canBreakTreaty: boolean;
  offer?: DiplomacyOfferVm;
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

export interface NegotiationPlanetVm {
  id: number;
  name: string;
  systemId: string;
  systemName: string;
  population: number;
  buildings: number;
  value: number;
}

export interface NegotiationSystemVm {
  id: string;
  name: string;
  planetIds: number[];
  value: number;
}

export interface NegotiationSideVm {
  factionId: string;
  name: string;
  color: string;
  credits: number;
  rawmaterials: number;
  planets: NegotiationPlanetVm[];
  systems: NegotiationSystemVm[];
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

const turnsOf = (seconds: number): number => Math.ceil(Math.max(0, seconds) / DIPLOMACY_TURN_SECONDS);

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
        warTurns: relation.state === 'war' ? Math.floor((relation.warSeconds ?? 0) / DIPLOMACY_TURN_SECONDS) : 0,
        truceTurns: isTruceActive(player, f) ? turnsOf(relation.lockRemaining) : 0,
        negotiateWait: negotiate.reason === 'locked' ? Math.ceil(negotiate.waitSeconds ?? 0) : 0,
        canNegotiate: negotiate.ok && f.ai === true,
        canDeclareWar: diplomacy.canDeclareWar(player, f).ok,
        canBreakTreaty: diplomacy.canBreakTreaty(player, f).ok,
        offer: offer ? { secondsLeft: Math.ceil(offer.secondsLeft), summary: summarizeTreaty(offer.treaty, player.id, world) } : undefined,
        atWarWith: others.filter((o) => getRelation(f, o)?.state === 'war').map((o) => o.name),
        atPeaceWith: others.filter((o) => getRelation(f, o)?.state === 'peace').map((o) => o.name),
      };
    });
}

function sideVm(self: Faction, other: Faction, world: World, enemyDiplomacy: EnemyDiplomacyService): NegotiationSideVm {
  const planets: NegotiationPlanetVm[] = [];
  const systems: NegotiationSystemVm[] = [];
  for (const system of world.starSystems) {
    const owned = system.planetsTiles.filter((p) => p.factionId === self.id);
    if (owned.length === 0) continue;
    let systemValue = 0;
    for (const planet of owned) {
      const value = Math.round(enemyDiplomacy.planetValue(planet));
      systemValue += value;
      planets.push({
        id: planet.id,
        name: planet.name,
        systemId: system.id,
        systemName: system.name,
        population: Math.round(planet.population ?? 0),
        buildings: planet.buildings?.length ?? 0,
        value,
      });
    }
    systems.push({ id: system.id, name: system.name, planetIds: owned.map((p) => p.id), value: systemValue });
  }
  planets.sort((a, b) => b.value - a.value || a.id - b.id);
  return {
    factionId: self.id,
    name: self.name,
    color: self.color,
    credits: Math.floor(self.currencies['credits'] ?? 0),
    rawmaterials: Math.floor(self.currencies['rawmaterials'] ?? 0),
    planets,
    systems,
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
    you: sideVm(player, ai, world, enemyDiplomacy),
    them: sideVm(ai, player, world, enemyDiplomacy),
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
    lines.push(`${nameOf(item.giverId)} ${item.giverId === viewerId ? 'give' : 'gives'} ${describeItem(item, world)}`);
  }
  if (lines.length === 0) lines.push('White peace: no concessions on either side.');
  return lines;
}

function describeItem(item: TreatyItem, world: Pick<World, 'starSystems'>): string {
  switch (item.kind) {
    case 'credits':
      return `${item.amount.toLocaleString('en-US')} credits`;
    case 'rawmaterials':
      return `${item.amount.toLocaleString('en-US')} raw materials`;
    case 'planet': {
      const found = cededPlanets({ proposerId: item.giverId, recipientId: '', items: [item] }, world.starSystems)[0];
      return found ? `the planet ${found.planet.name} (${found.system.name})` : 'a planet that no longer exists';
    }
    case 'system': {
      const system = world.starSystems.find((s) => s.id === item.systemId);
      const count = system?.planetsTiles.filter((p) => p.factionId === item.giverId).length ?? 0;
      return system ? `the ${system.name} system (${count} planet${count === 1 ? '' : 's'})` : 'a system that no longer exists';
    }
  }
}

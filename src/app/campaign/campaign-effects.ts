import { Faction } from '../components/star-map/star-map.models';
import { adjustOpinion } from '../components/star-map/diplomacy';
import { CampaignSessionState, Effect } from './campaign.models';

/*
 * =========================================================
 * CAMPAIGN EFFECTS (pure rules)
 * =========================================================
 *
 * Applies mission effects to the session state and the factions
 * (docs/campaign-design.md §13). Effects that need a dialog or a lookup in
 * the mission definition (`event`) are returned to CampaignService instead
 * of being handled here, and effects that must go through a StarMap-owned
 * service (wars, peace, demands: DiplomacyService keeps their events and
 * bookkeeping) are returned as `diplomacy` actions for StarMap to apply.
 *
 * Effects are applied exactly once: objectives complete once and events
 * fire once (both recorded in the session before the next save), so a
 * reload can never repeat a reward.
 */

export interface EffectResult {
  notices: string[];
  /* Story events to fire (ids), in order. */
  events: string[];
  /* The research horizon changed; ResearchService must be updated. */
  horizonChanged: boolean;
  /* Areas StarMap marks as explored (it owns the explored cells). */
  reveals: { x: number; y: number; radius: number }[];
  /* Wormhole state changes StarMap applies (it owns the wormholes). */
  wormholeStates: { wormholeId: string; state: 'dormant' | 'active' }[];
  /* War, peace and demand effects, in order (StarMap applies them through DiplomacyService). */
  diplomacy: CampaignDiplomacyAction[];
  /* Fleets to create (StarMap owns fleet ids). */
  spawns: CampaignSpawn[];
}

export type CampaignSpawn = Extract<Effect, { kind: 'spawn_fleet' }>;

export type CampaignDiplomacyAction = Extract<Effect, { kind: 'start_war' | 'start_peace' | 'force_demand' }>;

export function emptyEffectResult(): EffectResult {
  return { notices: [], events: [], horizonChanged: false, reveals: [], wormholeStates: [], diplomacy: [], spawns: [] };
}

export function applyEffects(effects: readonly Effect[] | undefined, session: CampaignSessionState, factions: readonly Faction[]): EffectResult {
  const result = emptyEffectResult();
  for (const effect of effects ?? []) applyEffect(effect, session, factions, result);
  return result;
}

export function mergeEffectResults(into: EffectResult, from: EffectResult): EffectResult {
  into.notices.push(...from.notices);
  into.events.push(...from.events);
  into.horizonChanged ||= from.horizonChanged;
  into.reveals.push(...from.reveals);
  into.wormholeStates.push(...from.wormholeStates);
  into.diplomacy.push(...from.diplomacy);
  into.spawns.push(...from.spawns);
  return into;
}

function applyEffect(effect: Effect, session: CampaignSessionState, factions: readonly Faction[], result: EffectResult): void {
  switch (effect.kind) {
    case 'notice':
      result.notices.push(effect.text);
      return;
    case 'event':
      result.events.push(effect.eventId);
      return;
    case 'flag':
      session.flags[effect.flag] = effect.value;
      return;
    case 'value':
      session.values[effect.key] = (session.values[effect.key] ?? 0) + effect.delta;
      return;
    case 'reveal_objective': {
      const state = session.objectives[effect.id];
      if (state) state.revealed = true;
      return;
    }
    case 'resources': {
      const faction = factions.find((f) => f.id === effect.factionId);
      if (!faction) return;
      // Costs never push a currency below zero; rewards are plain additions.
      for (const key of ['credits', 'rawmaterials', 'research'] as const) {
        const delta = effect[key];
        if (!delta) continue;
        faction.currencies[key] = Math.max(0, (faction.currencies[key] ?? 0) + delta);
      }
      return;
    }
    case 'grant_technology': {
      const faction = factions.find((f) => f.id === effect.factionId);
      if (!faction) return;
      faction.researchedTechnologies ??= [];
      if (!faction.researchedTechnologies.includes(effect.technologyId)) {
        faction.researchedTechnologies.push(effect.technologyId);
      }
      return;
    }
    case 'reveal_technology': {
      const list = effect.factionId
        ? (session.horizonExtras[effect.factionId] ??= [])
        : session.researchHorizon;
      for (const id of effect.technologyIds) {
        if (!list.includes(id)) {
          list.push(id);
          result.horizonChanged = true;
        }
      }
      return;
    }
    case 'wormhole_state':
      result.wormholeStates.push({ wormholeId: effect.wormholeId, state: effect.state });
      return;
    case 'reveal_area':
      result.reveals.push({ x: effect.x, y: effect.y, radius: effect.radius });
      return;
    case 'contact': {
      const list = (session.forcedContacts ??= []);
      if (!list.includes(effect.factionId)) list.push(effect.factionId);
      return;
    }
    case 'start_war':
    case 'start_peace':
    case 'force_demand':
      result.diplomacy.push(effect);
      return;
    case 'spawn_fleet':
      result.spawns.push(effect);
      return;
    case 'opinion': {
      const holder = factions.find((f) => f.id === effect.holder);
      const of = factions.find((f) => f.id === effect.of);
      if (holder && of) adjustOpinion(holder, of, effect.delta);
      return;
    }
    case 'tribute_pact': {
      const pacts = (session.tributePacts ??= []);
      // One pact per receiver: a second offer replaces the terms.
      const others = pacts.filter((p) => p.receiver !== effect.receiver);
      const interval = Math.max(10, effect.intervalSeconds);
      session.tributePacts = [...others, { receiver: effect.receiver, amount: Math.max(0, Math.floor(effect.amount)), intervalSeconds: interval, untilNext: interval }];
      return;
    }
    case 'protect_planet': {
      const others = (session.protectedPlanets ?? []).filter((p) => p.planetName !== effect.planetName);
      session.protectedPlanets = effect.protect
        ? [...others, { planetName: effect.planetName, ...(effect.except?.length ? { except: [...effect.except] } : {}) }]
        : others;
      return;
    }
    case 'end_tribute_pact':
      if (session.tributePacts) session.tributePacts = session.tributePacts.filter((p) => p.receiver !== effect.receiver);
      return;
    case 'end_mission':
      session.outcome ??= { kind: 'victory', endingId: effect.endingId };
      return;
    case 'fail_mission':
      session.outcome ??= { kind: 'defeat', reason: effect.reason };
      return;
  }
}

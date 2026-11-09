import { Faction } from '../components/star-map/star-map.models';
import { CampaignSessionState, Effect } from './campaign.models';

/*
 * =========================================================
 * CAMPAIGN EFFECTS (pure rules)
 * =========================================================
 *
 * Applies mission effects to the session state and the factions
 * (docs/campaign-design.md §13). Effects that need a dialog or a lookup in
 * the mission definition (`event`) are returned to CampaignService instead
 * of being handled here.
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
}

export function emptyEffectResult(): EffectResult {
  return { notices: [], events: [], horizonChanged: false };
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
    case 'end_mission':
      session.outcome ??= { kind: 'victory', endingId: effect.endingId };
      return;
    case 'fail_mission':
      session.outcome ??= { kind: 'defeat', reason: effect.reason };
      return;
  }
}

import { Injectable } from '@angular/core';
import { ResearchService } from '../services/research.service';
import { getMissionDefinition } from './missions';
import { CampaignProgressService } from './campaign-progress.service';
import {
  CampaignEventKind,
  CampaignOutcome,
  CampaignSessionState,
  Effect,
  MissionDefinition,
  ObjectiveDef,
  ObjectiveState,
  StoryEventDef,
} from './campaign.models';
import { CampaignWorld, evaluateCondition, objectiveProgress } from './campaign-objectives';
import { EffectResult, applyEffects, emptyEffectResult, mergeEffectResults } from './campaign-effects';

/*
 * =========================================================
 * CAMPAIGN SERVICE (live session)
 * =========================================================
 *
 * Owns the running mission's state between StarMap loads, like
 * TutorialService and AnomalyService (docs/campaign-design.md §12).
 *
 * Lifecycle:
 * - `restore` on every StarMap load (null for a non-campaign game, which
 *   also clears the research horizon). The whole session lives in the save,
 *   so the reload after a battle screen needs no merge: the battle screen
 *   only edits the autosave written right before it opened.
 * - `notify` counts events that cannot be read from the world later
 *   (battles won, peace signed). StarMap feeds it from the handlers it
 *   already has; this service never drains another service's events.
 * - `tick` once per economy tick (1 s of game time): objectives, story
 *   event triggers, endings and defeats. Returns `changed` so StarMap saves
 *   at once — every campaign change is persisted before anything else can
 *   reload the autosave, which is what makes rewards apply exactly once.
 *
 * It never mutates the world except through campaign effects (rewards,
 * granted technologies) applied in `tick` / `chooseEventOption`.
 */

export interface CampaignTickResult {
  changed: boolean;
  notices: string[];
  /* Areas to mark as explored (reveal_area effects). */
  reveals: { x: number; y: number; radius: number }[];
  /* Set on the tick the mission was decided. */
  outcome: CampaignOutcome | null;
}

export interface ObjectiveView {
  id: string;
  title: string;
  description?: string;
  optional: boolean;
  status: ObjectiveState['status'];
  progress: { current: number; target: number } | null;
}

/* Upper bound for chained objective unlocks within one tick (a data cycle cannot loop). */
const MAX_UNLOCK_PASSES = 8;

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private session: CampaignSessionState | null = null;
  private definition: MissionDefinition | null = null;
  private dirty = false;

  constructor(
    private readonly research: ResearchService,
    private readonly progress: CampaignProgressService,
  ) {}

  get active(): boolean {
    return this.session !== null;
  }

  get state(): Readonly<CampaignSessionState> | null {
    return this.session;
  }

  get mission(): MissionDefinition | null {
    return this.definition;
  }

  get outcome(): CampaignOutcome | null {
    return this.session?.outcome ?? null;
  }

  piratesAllowed(): boolean {
    return this.session ? this.session.rules.pirates : true;
  }

  /*
   * Restores the session from a save. A missing or unusable block means a
   * non-campaign game. A session whose mission is unknown to this game
   * version cannot be evaluated; it is dropped (the save still plays as a
   * normal game) rather than half-run.
   */
  restore(saved: unknown): void {
    this.session = null;
    this.definition = null;
    this.dirty = false;
    const definition = isSessionShape(saved) ? getMissionDefinition(saved.missionId) : undefined;
    if (isSessionShape(saved) && !definition) {
      console.warn(`[campaign] unknown mission "${saved.missionId}"; playing the save without its campaign rules`);
    }
    if (definition && isSessionShape(saved)) {
      this.definition = definition;
      this.session = sanitizeSession(structuredClone(saved), definition);
    }
    this.applyHorizon();
  }

  serialize(): CampaignSessionState | undefined {
    return this.session ? structuredClone(this.session) : undefined;
  }

  /* Leaving the game (main menu): no campaign rules may leak into the next session. */
  leave(): void {
    this.restore(null);
  }

  notify(kind: CampaignEventKind, count = 1): void {
    if (!this.session || this.session.outcome) return;
    this.session.counters[kind] = (this.session.counters[kind] ?? 0) + count;
    this.dirty = true;
  }

  tick(dt: number, world: CampaignWorld): CampaignTickResult {
    const result: CampaignTickResult = { changed: this.dirty, notices: [], reveals: [], outcome: null };
    this.dirty = false;
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.outcome) return result;

    const effects = emptyEffectResult();
    let advanced = false;
    for (let pass = 0; pass < MAX_UNLOCK_PASSES; pass++) {
      // Timers advance on the first pass only; later passes only settle
      // objectives that were unlocked by this tick's completions.
      const passDt = advanced ? 0 : dt;
      advanced = true;
      if (!this.updateObjectives(mission, session, world, passDt, effects)) break;
      result.changed = true;
    }
    if (this.fireTriggeredEvents(mission, session, world, effects)) result.changed = true;
    this.fireEffectEvents(mission, session, effects);
    if (effects.notices.length > 0 || effects.events.length > 0) result.changed = true;
    if (effects.horizonChanged) this.applyHorizon();

    if (!session.outcome) {
      const ctx = { world, session, dt: 0 };
      const defeat = mission.defeat?.find((d) => evaluateCondition(d.condition, ctx));
      if (defeat) {
        session.outcome = { kind: 'defeat', reason: defeat.reason };
      } else {
        const ending = mission.endings.find((e) => evaluateCondition(e.condition, ctx));
        if (ending) session.outcome = { kind: 'victory', endingId: ending.id };
      }
    }
    if (session.outcome) {
      result.changed = true;
      result.outcome = session.outcome;
      this.recordVictory(world);
    }
    result.notices = effects.notices;
    result.reveals = effects.reveals;
    return result;
  }

  /*
   * Effects from outside the mission definition, applied at once: the story
   * effects of a resolved campaign anomaly (AnomalyService returns them).
   * Events they request fire as usual; the outcome is checked on the next tick.
   */
  applyExternalEffects(effectsToApply: readonly Effect[], world: CampaignWorld): CampaignTickResult {
    const result: CampaignTickResult = { changed: false, notices: [], reveals: [], outcome: null };
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.outcome || effectsToApply.length === 0) return result;
    const effects = applyEffects(effectsToApply, session, world.factions);
    this.fireEffectEvents(mission, session, effects);
    if (effects.horizonChanged) this.applyHorizon();
    result.changed = true;
    result.notices = effects.notices;
    result.reveals = effects.reveals;
    this.dirty = true;
    return result;
  }

  /* The oldest modal story event waiting for the player. */
  get pendingEvent(): StoryEventDef | null {
    const id = this.session?.pendingEvents[0];
    return (id && this.definition?.events?.find((e) => e.id === id)) || null;
  }

  /*
   * The player answered the pending event (`choiceId` null for an event
   * without choices). Applies the choice's effects once and removes the
   * event from the queue; a stale or unavailable choice changes nothing.
   */
  chooseEventOption(eventId: string, choiceId: string | null, world: CampaignWorld): CampaignTickResult {
    const result: CampaignTickResult = { changed: false, notices: [], reveals: [], outcome: null };
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.pendingEvents[0] !== eventId) return result;
    const event = mission.events?.find((e) => e.id === eventId);
    if (!event) return result;
    const decidedBefore = session.outcome !== undefined;
    const effects = emptyEffectResult();
    if (choiceId !== null) {
      const choice = event.choices?.find((c) => c.id === choiceId);
      if (!choice) return result;
      if (choice.requires && !evaluateCondition(choice.requires, { world, session, dt: 0 })) return result;
      mergeEffectResults(effects, applyEffects(choice.effects, session, world.factions));
    } else if ((event.choices?.length ?? 0) > 0) {
      return result;
    }
    session.pendingEvents.shift();
    this.fireEffectEvents(mission, session, effects);
    if (effects.horizonChanged) this.applyHorizon();
    result.changed = true;
    result.notices = effects.notices;
    result.reveals = effects.reveals;
    if (session.outcome && !decidedBefore) {
      result.outcome = session.outcome;
      this.recordVictory(world);
    }
    return result;
  }

  /* Listed objectives for the tracker (hidden ones only once revealed or active). */
  objectiveViews(world: CampaignWorld): ObjectiveView[] {
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission) return [];
    const views: ObjectiveView[] = [];
    for (const def of mission.objectives) {
      const state = session.objectives[def.id];
      if (!state || state.status === 'locked') continue;
      if (def.hidden && !state.revealed && state.status !== 'active') continue;
      views.push({
        id: def.id,
        title: def.title,
        description: def.description,
        optional: def.optional === true,
        status: state.status,
        progress: state.status === 'active' ? objectiveProgress(def, world, session) : null,
      });
    }
    return views;
  }

  /* One settling pass; true when any status changed. */
  private updateObjectives(mission: MissionDefinition, session: CampaignSessionState, world: CampaignWorld, dt: number, effects: EffectResult): boolean {
    let changed = false;
    const ctx = { world, session, dt };
    for (const def of mission.objectives) {
      const state = session.objectives[def.id];
      if (!state) continue;
      if (state.status === 'locked' && this.prerequisitesDone(def, session)) {
        state.status = 'active';
        state.elapsed = 0;
        changed = true;
      }
      if (state.status !== 'active') continue;
      state.elapsed = (state.elapsed ?? 0) + dt;
      if (def.failIf && evaluateCondition(def.failIf, ctx)) {
        this.finishObjective(def, state, 'failed', session, world, effects);
        changed = true;
      } else if (evaluateCondition(def.condition, ctx)) {
        this.finishObjective(def, state, 'done', session, world, effects);
        changed = true;
      } else if (def.timeLimitSeconds !== undefined && state.elapsed >= def.timeLimitSeconds) {
        this.finishObjective(def, state, 'failed', session, world, effects);
        changed = true;
      }
    }
    return changed;
  }

  private prerequisitesDone(def: ObjectiveDef, session: CampaignSessionState): boolean {
    return (def.after ?? []).every((id) => session.objectives[id]?.status === 'done');
  }

  private finishObjective(def: ObjectiveDef, state: ObjectiveState, status: 'done' | 'failed', session: CampaignSessionState, world: CampaignWorld, effects: EffectResult): void {
    state.status = status;
    delete state.elapsed;
    mergeEffectResults(effects, applyEffects(status === 'done' ? def.onComplete : def.onFail, session, world.factions));
  }

  private fireTriggeredEvents(mission: MissionDefinition, session: CampaignSessionState, world: CampaignWorld, effects: EffectResult): boolean {
    let fired = false;
    for (const event of mission.events ?? []) {
      if (!event.trigger || session.firedEvents.includes(event.id)) continue;
      if (evaluateCondition(event.trigger, { world, session, dt: 0 })) {
        this.fireEvent(event, session, effects);
        fired = true;
      }
    }
    return fired;
  }

  /* Events requested by effects; an event fires at most once per mission. */
  private fireEffectEvents(mission: MissionDefinition, session: CampaignSessionState, effects: EffectResult): void {
    for (const id of effects.events.splice(0)) {
      const event = mission.events?.find((e) => e.id === id);
      if (event && !session.firedEvents.includes(id)) this.fireEvent(event, session, effects);
    }
  }

  private fireEvent(event: StoryEventDef, session: CampaignSessionState, effects: EffectResult): void {
    session.firedEvents.push(event.id);
    if (event.pause || (event.choices?.length ?? 0) > 0) {
      session.pendingEvents.push(event.id);
    } else {
      effects.notices.push(`${event.title}: ${event.text}`);
    }
  }

  private recordVictory(world: CampaignWorld): void {
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.outcome?.kind !== 'victory') return;
    const ending = mission.endings.find((e) => e.id === session.outcome!.endingId);
    const player = world.factions.find((f) => f.id === 'player');
    // Overwrites the record of an earlier win of the same mission (replay).
    this.progress.recordCompletion(mission.id, {
      endingId: session.outcome.endingId ?? '',
      difficulty: session.difficulty,
      records: {
        ...(ending?.records ?? {}),
        ...Object.fromEntries((ending?.recordFlags ?? []).filter((f) => session.flags[f] !== undefined).map((f) => [f, session.flags[f]])),
      },
      researchedTechnologies: [...(player?.researchedTechnologies ?? [])],
    });
  }

  private applyHorizon(): void {
    this.research.setCampaignHorizon(this.session
      ? { technologies: this.session.researchHorizon, extras: this.session.horizonExtras }
      : null);
  }
}

function isSessionShape(value: unknown): value is CampaignSessionState {
  const s = value as CampaignSessionState;
  return !!s && typeof s === 'object' && typeof s.missionId === 'string';
}

/*
 * Fills missing parts and drops what the current definition does not know,
 * so a save made with an older mission version still plays.
 */
function sanitizeSession(saved: CampaignSessionState, mission: MissionDefinition): CampaignSessionState {
  const record = <T>(value: unknown, fallback: T): T => (value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback);
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const eventIds = new Set((mission.events ?? []).map((e) => e.id));
  const savedObjectives = record<Record<string, ObjectiveState>>(saved.objectives, {});
  const objectives: Record<string, ObjectiveState> = {};
  for (const def of mission.objectives) {
    const state = savedObjectives[def.id];
    objectives[def.id] = state && ['locked', 'active', 'done', 'failed'].includes(state.status)
      ? state
      : { status: 'locked' };
  }
  const difficulty = saved.difficulty === 'easy' || saved.difficulty === 'hard' ? saved.difficulty : 'normal';
  return {
    version: 1,
    missionId: mission.id,
    missionVersion: typeof saved.missionVersion === 'number' ? saved.missionVersion : mission.version,
    difficulty,
    carry: {
      flags: record(saved.carry?.flags, {}),
      technologies: strings(saved.carry?.technologies),
    },
    rules: { ...mission.rules, ...record(saved.rules, {}) },
    flags: record(saved.flags, {}),
    values: record(saved.values, {}),
    counters: record(saved.counters, {}),
    objectives,
    heldTimers: record(saved.heldTimers, {}),
    firedEvents: strings(saved.firedEvents),
    pendingEvents: strings(saved.pendingEvents).filter((id) => eventIds.has(id)),
    fleetTags: record(saved.fleetTags, {}),
    researchHorizon: Array.isArray(saved.researchHorizon) ? strings(saved.researchHorizon) : [...mission.researchHorizon],
    horizonExtras: record(saved.horizonExtras, structuredClone(mission.horizonExtras ?? {})),
    ...(saved.outcome && (saved.outcome.kind === 'victory' || saved.outcome.kind === 'defeat') ? { outcome: saved.outcome } : {}),
  };
}

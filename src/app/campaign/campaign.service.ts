import { Injectable } from '@angular/core';
import { ResearchService } from '../services/research.service';
import { getMissionDefinition } from './missions';
import { CampaignProgressService } from './campaign-progress.service';
import {
  CampaignEventKind,
  CampaignOutcome,
  CampaignSessionState,
  ContactOverride,
  Effect,
  MissionDefinition,
  ObjectiveDef,
  ObjectiveState,
  StoryEventDef,
  TributePactState,
  ValueSource,
} from './campaign.models';
import { CampaignWorld, evaluateCondition, objectiveProgress } from './campaign-objectives';
import { CampaignDiplomacyAction, EffectResult, applyEffects, emptyEffectResult, mergeEffectResults } from './campaign-effects';
import { getRelation, inContact } from '../components/star-map/diplomacy';

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
 * - `tick` once per economy tick (1 s of game time): tribute pact
 *   payments, planet-loss and war-exhaustion bookkeeping, objectives, story
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
  /* Wormholes to wake or close (wormhole_state effects). */
  wormholeStates: { wormholeId: string; state: 'dormant' | 'active' }[];
  /* Wars, peace treaties and demands to apply through DiplomacyService. */
  diplomacy: CampaignDiplomacyAction[];
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

function emptyTickResult(changed = false): CampaignTickResult {
  return { changed, notices: [], reveals: [], wormholeStates: [], diplomacy: [], outcome: null };
}

function copyEffects(result: CampaignTickResult, effects: EffectResult): void {
  result.notices = effects.notices;
  result.reveals = effects.reveals;
  result.wormholeStates = effects.wormholeStates;
  result.diplomacy = effects.diplomacy;
}

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

  /*
   * Adds to a mission value from outside the definition (trade income from
   * deliveries). Counted like an event: saved with the next tick.
   */
  addValue(key: string, delta: number): void {
    if (!this.session || this.session.outcome || delta === 0) return;
    this.session.values[key] = (this.session.values[key] ?? 0) + delta;
    this.dirty = true;
  }

  /* `factionId`: the other empire involved; also counted under "<kind>:<factionId>". */
  notify(kind: CampaignEventKind, count = 1, factionId?: string): void {
    if (!this.session || this.session.outcome) return;
    const counters = this.session.counters;
    counters[kind] = (counters[kind] ?? 0) + count;
    if (factionId) counters[`${kind}:${factionId}`] = (counters[`${kind}:${factionId}`] ?? 0) + count;
    this.dirty = true;
  }

  /* Empires a `contact` effect brought to the player whose dialogue is not answered yet. */
  get forcedContacts(): readonly string[] {
    return this.session?.forcedContacts ?? [];
  }

  /* Does `payer` pay `receiver` a running tribute pact (the receiver's AI then leaves it alone)? */
  hasTributePact(receiverId: string, payerId: string): boolean {
    return payerId === 'player' && (this.session?.tributePacts ?? []).some((p) => p.receiver === receiverId);
  }

  /*
   * Must the AI `aiId` leave `otherId` alone (no own demands, no war
   * declaration)? A tribute pact the player pays, or the mission's scripted
   * relations (MissionDefinition.aiRestraint) before their flag.
   */
  restrains(aiId: string, otherId: string): boolean {
    if (!this.session) return false;
    if (this.hasTributePact(aiId, otherId)) return true;
    const flags = this.session.flags;
    const flagSet = (flag: string | undefined) => flag !== undefined && flags[flag] !== undefined && flags[flag] !== false;
    return (this.definition?.aiRestraint ?? []).some((r) => r.factionId === aiId && (r.target ?? 'player') === otherId && !flagSet(r.untilFlag));
  }

  /* Is this planet protected from assaults by the AI `attackerId` (`protect_planet`)? */
  protects(attackerId: string, planetName: string): boolean {
    const entry = this.session?.protectedPlanets?.find((p) => p.planetName === planetName);
    return !!entry && !(entry.except ?? []).includes(attackerId);
  }

  /*
   * Value sources (MissionDefinition.valueSources), reported by StarMap:
   * a player trader's delivery, a battle the player won (where, against
   * whom) and resource-exchange volume. Each adds to its key up to its cap.
   */
  recordDelivery(destinationPlanetName: string | undefined): void {
    for (const source of this.valueSources('delivery')) {
      if (destinationPlanetName && source.toPlanets.includes(destinationPlanetName)) this.addCapped(source.key, source.amount, source.cap);
    }
  }

  recordBattleWon(opponentId: string | undefined, x: number, y: number, world: CampaignWorld): void {
    for (const source of this.valueSources('battle_won')) {
      if (source.against !== undefined && source.against !== opponentId) continue;
      const near = world.starSystems.some((s) => source.nearSystems.includes(s.id) && Math.hypot(s.x - x, s.y - y) <= source.radius);
      if (near) this.addCapped(source.key, source.amount, source.cap);
    }
  }

  recordExchange(credits: number): void {
    for (const source of this.valueSources('exchange')) this.addCapped(source.key, (Math.max(0, credits) / 1000) * source.perThousand, source.cap);
  }

  private valueSources<K extends ValueSource['kind']>(kind: K): Extract<ValueSource, { kind: K }>[] {
    if (!this.session || this.session.outcome) return [];
    return (this.definition?.valueSources ?? []).filter((s): s is Extract<ValueSource, { kind: K }> => s.kind === kind);
  }

  private addCapped(key: string, delta: number, cap: number | undefined): void {
    const values = this.session!.values;
    const current = values[key] ?? 0;
    const next = cap === undefined ? current + delta : Math.max(current, Math.min(cap, current + delta));
    if (next === current) return;
    // Whole tenths, so the tracker and saves show tidy numbers.
    values[key] = Math.round(next * 10) / 10;
    this.dirty = true;
  }

  /* The contact override of a scripted meeting (MissionDefinition.contactOverrides). */
  contactOverride(factionId: string): ContactOverride | null {
    return this.definition?.contactOverrides?.[factionId] ?? null;
  }

  tick(dt: number, world: CampaignWorld): CampaignTickResult {
    const result = emptyTickResult(this.dirty);
    this.dirty = false;
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.outcome) return result;

    const effects = emptyEffectResult();
    if (this.updateBookkeeping(session, world, dt, effects)) result.changed = true;
    let advanced = false;
    for (let pass = 0; pass < MAX_UNLOCK_PASSES; pass++) {
      // Timers advance on the first pass only; later passes only settle
      // objectives that were unlocked by this tick's completions.
      const passDt = advanced ? 0 : dt;
      advanced = true;
      if (!this.updateObjectives(mission, session, world, passDt, effects)) break;
      result.changed = true;
    }
    if (this.fireTriggeredEvents(mission, session, world, dt, effects)) result.changed = true;
    this.fireEffectEvents(mission, session, effects, world);
    if (effects.notices.length > 0 || effects.events.length > 0 || effects.diplomacy.length > 0) result.changed = true;
    if (effects.horizonChanged) this.applyHorizon();

    if (!session.outcome) {
      // Endings and defeats are checked once per tick, so their held_for timers advance by dt.
      const ctx = { world, session, dt };
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
    copyEffects(result, effects);
    return result;
  }

  /*
   * World bookkeeping before the objectives:
   * - forced contacts that have been answered leave the list;
   * - tribute pacts pay (or break: the receiver declares war) and end when
   *   the two are at war anyway;
   * - a player planet that changed hands counts as `planet_lost` (by its
   *   new owner) whatever the reason, so no capture path needs a hook;
   * - `war_exhaustion:<id>`: the highest war exhaustion an empire reached
   *   in a war with the player (endings that reward wearing an enemy down).
   */
  private updateBookkeeping(session: CampaignSessionState, world: CampaignWorld, dt: number, effects: EffectResult): boolean {
    let changed = false;
    const player = world.factions.find((f) => f.id === 'player');
    const byId = (id: string) => world.factions.find((f) => f.id === id);

    if (session.forcedContacts?.length) {
      const open = session.forcedContacts.filter((id) => !inContact(player, byId(id)));
      if (open.length !== session.forcedContacts.length) {
        session.forcedContacts = open;
        changed = true;
      }
    }

    for (const pact of [...(session.tributePacts ?? [])]) {
      const receiver = byId(pact.receiver);
      const remove = () => {
        session.tributePacts = (session.tributePacts ?? []).filter((p) => p !== pact);
        changed = true;
      };
      if (!player || !receiver) {
        remove();
        continue;
      }
      if (getRelation(receiver, player)?.state === 'war') {
        remove();
        session.flags['tribute_pact_broken'] = true;
        effects.notices.push(`The tribute pact with ${receiver.name} is over: you are at war.`);
        continue;
      }
      pact.untilNext -= dt;
      if (pact.untilNext > 0) continue;
      if ((player.currencies['credits'] ?? 0) < pact.amount) {
        remove();
        session.flags['tribute_pact_broken'] = true;
        effects.notices.push(`You could not pay the tribute to ${receiver.name}. The pact is broken.`);
        effects.diplomacy.push({ kind: 'start_war', a: pact.receiver, b: 'player', declarer: pact.receiver });
        continue;
      }
      player.currencies['credits'] -= pact.amount;
      receiver.currencies['credits'] = (receiver.currencies['credits'] ?? 0) + pact.amount;
      const paidKey = `tribute_paid:${pact.receiver}`;
      session.values[paidKey] = (session.values[paidKey] ?? 0) + pact.amount;
      pact.untilNext += pact.intervalSeconds;
      effects.notices.push(`Tribute paid to ${receiver.name}: ${pact.amount.toLocaleString('en-US')} credits.`);
      changed = true;
    }

    const owners = new Map<string, string>();
    for (const system of world.starSystems) {
      for (const planet of system.planetsTiles) owners.set(planet.name, planet.factionId);
    }
    const current = [...owners].filter(([, owner]) => owner === 'player').map(([name]) => name);
    const before = session.playerPlanets;
    for (const name of before ?? []) {
      const owner = owners.get(name);
      if (owner === 'player') continue;
      session.counters['planet_lost'] = (session.counters['planet_lost'] ?? 0) + 1;
      if (owner) session.counters[`planet_lost:${owner}`] = (session.counters[`planet_lost:${owner}`] ?? 0) + 1;
    }
    if (!before || before.length !== current.length || current.some((name, i) => before[i] !== name)) {
      session.playerPlanets = current;
      changed = true;
    }

    for (const faction of world.factions) {
      const relation = player && faction !== player ? getRelation(faction, player) : undefined;
      if (relation?.state !== 'war') continue;
      const key = `war_exhaustion:${faction.id}`;
      const exhaustion = Math.floor(relation.warExhaustion ?? 0);
      if (exhaustion > (session.values[key] ?? 0)) {
        session.values[key] = exhaustion;
        changed = true;
      }
    }
    return changed;
  }

  /*
   * Effects from outside the mission definition, applied at once: the story
   * effects of a resolved campaign anomaly (AnomalyService returns them).
   * Events they request fire as usual; the outcome is checked on the next tick.
   */
  applyExternalEffects(effectsToApply: readonly Effect[], world: CampaignWorld): CampaignTickResult {
    const result = emptyTickResult();
    const session = this.session;
    const mission = this.definition;
    if (!session || !mission || session.outcome || effectsToApply.length === 0) return result;
    const effects = applyEffects(effectsToApply, session, world.factions);
    this.fireEffectEvents(mission, session, effects, world);
    if (effects.horizonChanged) this.applyHorizon();
    result.changed = true;
    copyEffects(result, effects);
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
    const result = emptyTickResult();
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
    this.fireEffectEvents(mission, session, effects, world);
    if (effects.horizonChanged) this.applyHorizon();
    result.changed = true;
    copyEffects(result, effects);
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

  /* Once per tick, so held_for timers in triggers advance by the tick's dt (a fired event's timers stop). */
  private fireTriggeredEvents(mission: MissionDefinition, session: CampaignSessionState, world: CampaignWorld, dt: number, effects: EffectResult): boolean {
    let fired = false;
    for (const event of mission.events ?? []) {
      if (!event.trigger || session.firedEvents.includes(event.id)) continue;
      if (evaluateCondition(event.trigger, { world, session, dt })) {
        this.fireEvent(event, session, effects, world);
        fired = true;
      }
    }
    return fired;
  }

  /*
   * Events requested by effects; an event fires at most once per mission.
   * Loops until the queue is empty: a fired event's own effects may request
   * further events (bounded, since each event fires once).
   */
  private fireEffectEvents(mission: MissionDefinition, session: CampaignSessionState, effects: EffectResult, world: CampaignWorld): void {
    while (effects.events.length > 0) {
      const id = effects.events.shift()!;
      const event = mission.events?.find((e) => e.id === id);
      if (event && !session.firedEvents.includes(id)) this.fireEvent(event, session, effects, world);
    }
  }

  private fireEvent(event: StoryEventDef, session: CampaignSessionState, effects: EffectResult, world: CampaignWorld): void {
    session.firedEvents.push(event.id);
    // Applied at once, so a later trigger in the same tick already sees them.
    mergeEffectResults(effects, applyEffects(event.effects, session, world.factions));
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
        ...Object.fromEntries((ending?.recordValues ?? []).map((v) => [v, session.values[v] ?? 0])),
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

function isPactShape(value: unknown): value is TributePactState {
  const p = value as TributePactState;
  return !!p && typeof p.receiver === 'string' && [p.amount, p.intervalSeconds, p.untilNext].every((n) => typeof n === 'number' && Number.isFinite(n));
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
    ...(Array.isArray(saved.forcedContacts) ? { forcedContacts: strings(saved.forcedContacts) } : {}),
    ...(Array.isArray(saved.tributePacts) ? { tributePacts: saved.tributePacts.filter(isPactShape) } : {}),
    ...(Array.isArray(saved.playerPlanets) ? { playerPlanets: strings(saved.playerPlanets) } : {}),
    ...(Array.isArray(saved.protectedPlanets)
      ? { protectedPlanets: saved.protectedPlanets.filter((p) => !!p && typeof p.planetName === 'string').map((p) => ({ planetName: p.planetName, ...(Array.isArray(p.except) ? { except: strings(p.except) } : {}) })) }
      : {}),
    ...(saved.outcome && (saved.outcome.kind === 'victory' || saved.outcome.kind === 'defeat') ? { outcome: saved.outcome } : {}),
  };
}

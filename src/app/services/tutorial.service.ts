import { Injectable, signal } from '@angular/core';
import { TutorialState } from '../components/star-map/star-map.models';
import {
  TutorialContext,
  TutorialEvent,
  TutorialScene,
  TutorialStep,
  emptyTutorialContext,
  satisfiedSteps,
  stepsDoneByEvent,
  triggeredSteps,
  rearmedSteps,
  tutorialCandidates,
} from '../components/tutorial/tutorial-steps';

/*
 * Tutorial hint state (docs/tutorial-hints.md).
 *
 * Holds, for the running game, whether the tutorial is on and which steps are
 * done; both are saved in StarMapData.tutorial (StarMap serializes them). The
 * New Game checkbox decides the initial `enabled`; a save without the field
 * (older games) has the tutorial off.
 *
 * Inputs: StarMap publishes a TutorialContext snapshot a few times a second
 * and on view changes; components report one-off UI actions via notify().
 * The battle screen only patches the scene and its own pause state.
 * Output: `candidates`, the steps that may show now, in priority order. The
 * hint overlay (TutorialHintComponent) shows the first one whose anchor is
 * registered and visible on screen.
 *
 * The service only reads game state. It never pauses or changes the game;
 * the paused start of a tutorial game is applied by StarMap
 * (`shouldStartPaused`).
 */
@Injectable({ providedIn: 'root' })
export class TutorialService {
  private readonly _enabled = signal(false);
  readonly enabled = this._enabled.asReadonly();
  /* True while a game is loaded (StarMap or the battle screen of that game). */
  private readonly _inGame = signal(false);
  readonly inGame = this._inGame.asReadonly();
  private readonly _candidates = signal<readonly TutorialStep[]>([]);
  readonly candidates = this._candidates.asReadonly();
  /* Bumped when an anchor registers or unregisters, so the overlay re-resolves. */
  private readonly _anchorVersion = signal(0);
  readonly anchorVersion = this._anchorVersion.asReadonly();

  private done = new Set<string>();
  /*
   * Steps a campaign mission switches off (e.g. Diplomacy in a mission
   * without empires). They count as done for selection and `after`, but are
   * not saved as done, so a later normal game is unaffected.
   */
  private excluded = new Set<string>();
  /* Steps whose latched `trigger` has held (see TutorialStep.trigger). */
  private unlocked = new Set<string>();
  private ctx: TutorialContext = emptyTutorialContext();
  private readonly anchors = new Map<string, HTMLElement>();

  /*
   * Called by StarMap on every load. A reload after the battle screen
   * (`keepSession`) reads the pre-battle autosave, so it must not lose steps
   * finished in the battle: the in-memory state is merged in.
   */
  restore(state: TutorialState | undefined, keepSession = false): void {
    const saved = new Set(state?.done ?? []);
    const savedUnlocked = new Set(state?.unlocked ?? []);
    if (keepSession && this._inGame()) {
      for (const id of this.done) saved.add(id);
      for (const id of this.unlocked) savedUnlocked.add(id);
      this.done = saved;
      this.unlocked = savedUnlocked;
    } else {
      this.done = saved;
      this.unlocked = savedUnlocked;
      this._enabled.set(state?.enabled ?? false);
      this.ctx = emptyTutorialContext();
    }
    this._inGame.set(true);
    this.recompute();
  }

  /* Called by StarMap on every load: the running mission's excluded steps (empty otherwise). */
  setExcludedSteps(stepIds: readonly string[]): void {
    this.excluded = new Set(stepIds);
    this.recompute();
  }

  serialize(): TutorialState {
    return { enabled: this._enabled(), done: [...this.done], unlocked: [...this.unlocked] };
  }

  /* The main menu ends the game session: no hints, no Options toggle. */
  leaveGame(): void {
    this._inGame.set(false);
    this.ctx = emptyTutorialContext();
    this.recompute();
  }

  /* A brand-new tutorial game starts paused, so the first hints can be read. */
  shouldStartPaused(gameSeconds: number): boolean {
    return this._enabled() && gameSeconds <= 0 && !this.done.has('time');
  }

  setEnabled(enabled: boolean): void {
    this._enabled.set(enabled);
    this.recompute();
  }

  /* Options: RESET TUTORIAL. Steps already satisfied are skipped again on the next context. */
  reset(): void {
    this.done.clear();
    this.unlocked.clear();
    this._enabled.set(true);
    this.recompute();
  }

  dismiss(stepId: string): void {
    this.done.add(stepId);
    this.recompute();
  }

  setContext(ctx: TutorialContext): void {
    this.ctx = ctx;
    this.recompute();
  }

  /* Battle screen: keeps the last star-map facts and swaps in the battle scene. */
  setBattleScene(paused: boolean): void {
    if (this.ctx.scene === 'battle' && this.ctx.paused === paused) return;
    this.ctx = { ...this.ctx, scene: 'battle', paused, modalOpen: false };
    this.recompute();
  }

  setScene(scene: TutorialScene): void {
    if (this.ctx.scene === scene) return;
    this.ctx = { ...this.ctx, scene };
    this.recompute();
  }

  notify(event: TutorialEvent): void {
    const ids = stepsDoneByEvent(event, this.done);
    if (ids.length === 0) return;
    for (const id of ids) this.done.add(id);
    this.recompute();
  }

  isDone(stepId: string): boolean {
    return this.done.has(stepId);
  }

  get context(): TutorialContext {
    return this.ctx;
  }

  registerAnchor(key: string, element: HTMLElement): void {
    this.anchors.set(key, element);
    this._anchorVersion.update((v) => v + 1);
  }

  /* Only removes the key if it still points at `element` (a newer owner may have taken it). */
  unregisterAnchor(key: string, element: HTMLElement): void {
    if (this.anchors.get(key) !== element) return;
    this.anchors.delete(key);
    this._anchorVersion.update((v) => v + 1);
  }

  anchor(key: string): HTMLElement | null {
    return this.anchors.get(key) ?? null;
  }

  private recompute(): void {
    // The skip rule applies even while hints are off, so turning the tutorial
    // back on later does not replay what the player has already done. Only on
    // a real snapshot: the empty context reads as "not paused" and would
    // wrongly finish the time step before the first frame.
    if (this._inGame() && this.ctx.scene !== 'none') {
      for (const id of satisfiedSteps(this.ctx, this.done)) this.done.add(id);
      for (const id of triggeredSteps(this.ctx, this.unlocked)) this.unlocked.add(id);
      for (const id of rearmedSteps(this.ctx, this.done)) this.done.delete(id);
    }
    const doneForSelection = this.excluded.size === 0 ? this.done : new Set([...this.done, ...this.excluded]);
    const next = this._enabled() && this._inGame() ? tutorialCandidates(this.ctx, doneForSelection, this.unlocked) : [];
    const current = this._candidates();
    if (next.length !== current.length || next.some((s, i) => s !== current[i])) {
      this._candidates.set(next);
    }
  }
}

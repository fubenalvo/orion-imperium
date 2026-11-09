/*
 * Tutorial hint steps (docs/tutorial-hints.md).
 *
 * The step table is data: each step names the UI anchors it points at, one
 * short sentence, when it may show and when it counts as done. Selection is
 * pure (`tutorialCandidates`), so it is unit tested without a DOM; the hint
 * overlay then shows the first candidate whose anchor is on screen.
 *
 * Rules that keep the tutorial robust:
 * - A step is marked done as soon as its `done` predicate holds or one of its
 *   `doneOn` events arrives, even before it was ever shown (the skip rule).
 *   A player who acts ahead of the tutorial, or loads a mid-game save, never
 *   sees a hint for something already done.
 * - `anchors` lists alternatives, most specific first; the overlay uses the
 *   first one that is registered and visible (e.g. the BUILD button inside an
 *   expanded build row before the row itself).
 * - Contextual steps (time-sensitive one-offs) come before core steps; core
 *   steps keep the table order.
 *
 * Anchor keys are registered by `TutorialAnchorDirective` in the templates;
 * a key used here must exist in a template, or the step never shows.
 */

export type TutorialScene = 'none' | 'planet' | 'system' | 'map' | 'battle';

/* Snapshot of the game state the steps read. Built by StarMap (tutorial-context.ts). */
export interface TutorialContext {
  scene: TutorialScene;
  paused: boolean;
  gameSeconds: number;
  /* A dialog that covers the game is open (Fleet Command, research tree, …): no hints. */
  modalOpen: boolean;
  /* Player buildings by building id (planet-data.json), all planets together. */
  buildings: Readonly<Record<string, { sites: number; complete: number }>>;
  /* Construction sites on all player planets. */
  constructionSites: number;
  stockShips: number;
  queuedOrders: number;
  playerPlanets: number;
  playerFleetIds: readonly number[];
  selectedPlayerFleetId: number | null;
  /* Some player fleet has a move target. */
  playerFleetMoving: boolean;
  /* First player fleet carrying a Colonizer, if any. */
  colonizerFleetId: number | null;
  colonizerMoving: boolean;
  /* The Colonizer fleet is parked on a planet it may colonize now. */
  colonizerReady: boolean;
  /* First visible hostile fleet (at war with the player). */
  hostileFleetId: number | null;
  hasTradingPost: boolean;
  rawMaterials: number;
  /* AI empires the player has met (docs/first-contact.md); the Diplomacy hint waits for the first. */
  metEmpires: number;
}

export type TutorialSide = 'top' | 'bottom' | 'left' | 'right';

export interface TutorialStep {
  id: string;
  text: string;
  /* Variant for touch screens (right-click → long-press); falls back to `text`. */
  touchText?: string;
  anchors: (ctx: TutorialContext) => readonly string[];
  side: TutorialSide;
  contextual?: boolean;
  when?: (ctx: TutorialContext) => boolean;
  /*
   * Latched start condition: once it has held, it counts as held until the
   * step is done (TutorialService keeps the unlocked set). For triggers that
   * can flip back, such as "a fleet is moving": a live check made the hint
   * flash and vanish when the fleet arrived. `when` stays a live check
   * (screen, dialogs).
   */
  trigger?: (ctx: TutorialContext) => boolean;
  done?: (ctx: TutorialContext) => boolean;
  doneOn?: readonly string[];
  /* Eligible only once all these steps are done (the closing hint). */
  after?: readonly string[];
  /*
   * Closing or finishing it lasts only until `when` turns false; then it may
   * come back. For "go back to the planet": done once the planet is opened,
   * shown again on a later return to the map while planet work is pending.
   */
  repeatable?: boolean;
}

/* Events the game reports through TutorialService.notify. */
export type TutorialEvent =
  | 'planet-tab:build'
  | 'planet-tab:production'
  | 'planet-tab:assembly'
  | 'pick:mining_complex'
  | 'pick:spaceship_factory'
  | 'pick:spaceport'
  | 'fleet-assembled'
  | 'system-entered'
  | 'research-opened'
  | 'planet-opened'
  | 'stock-opened'
  | 'diplomacy-opened';

/* Game time after which the star-map steps show even if the build steps were ignored. */
export const TUTORIAL_MAP_STEPS_AFTER_SECONDS = 90;
export const TUTORIAL_RESEARCH_AFTER_SECONDS = 180;
/* Raw materials below this, with a Trading Post, point at the exchange. */
export const TUTORIAL_RAW_LOW = 300;

const has = (ctx: TutorialContext, id: string): boolean =>
  (ctx.buildings[id]?.sites ?? 0) + (ctx.buildings[id]?.complete ?? 0) > 0;
const built = (ctx: TutorialContext, id: string): boolean => (ctx.buildings[id]?.complete ?? 0) > 0;
const fixed = (...keys: string[]) => (): readonly string[] => keys;
/*
 * The row's BUILD button (expanded info box) first, then the row itself, then
 * the BUILD tab: rows exist only on the BUILD tab, and without the tab
 * fallback a player on another tab got no hint at all.
 */
const buildRow = (id: string) => fixed(`build.start.${id}`, `build.row.${id}`, 'planet.tab.build');
const onFleetScreen = (ctx: TutorialContext): boolean => ctx.scene === 'map' || ctx.scene === 'system';
/* Where an own fleet can be clicked: its panel when selected, else the roster (map) or its marker (system view). */
const fleetAnchors = (ctx: TutorialContext, id: number | null): string[] => {
  if (id === null) return [];
  if (ctx.selectedPlayerFleetId === id) return ['fleet.panel'];
  return ctx.scene === 'system' ? [`system.fleet.${id}`] : [`roster.fleet.${id}`];
};
/*
 * Work that only the planet screen offers is open: the build chain is
 * unfinished, the factory has nothing ordered yet, or ships wait in stock at
 * a finished Spaceport.
 */
const planetWorkPending = (c: TutorialContext): boolean =>
  !has(c, 'spaceport') ||
  (built(c, 'spaceship_factory') && c.queuedOrders === 0 && c.stockShips === 0 && c.colonizerFleetId === null && c.playerPlanets < 2) ||
  (built(c, 'spaceport') && c.stockShips > 0);

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // --- Contextual one-offs (shown before core steps while they apply) ---
  {
    id: 'battle-start',
    contextual: true,
    text: 'The battle is paused — give orders, then pick a speed to fight.',
    anchors: fixed('hud.time'),
    side: 'bottom',
    when: (c) => c.scene === 'battle' && c.paused,
    done: (c) => c.scene === 'battle' && !c.paused,
  },
  {
    id: 'enemy-fleet',
    contextual: true,
    text: 'Hostile fleet — select yours and right-click it to attack.',
    touchText: 'Hostile fleet — select yours and long-press it to attack.',
    anchors: (c) => (c.hostileFleetId !== null ? [`map.fleet.${c.hostileFleetId}`] : []),
    side: 'top',
    when: (c) => c.scene === 'map' && c.hostileFleetId !== null,
  },
  {
    id: 'energy',
    contextual: true,
    text: 'This would leave the planet short on energy — build power first.',
    anchors: fixed('build.energy-short'),
    side: 'left',
  },
  {
    id: 'anomaly',
    contextual: true,
    text: 'Anomalies hide events — fly a fleet there to find out.',
    anchors: fixed('map.anomaly'),
    side: 'top',
    when: (c) => c.scene === 'map',
  },
  {
    id: 'asteroid',
    contextual: true,
    text: 'Intercept drifting asteroids with a fleet for free resources.',
    anchors: fixed('map.asteroid'),
    side: 'top',
    when: (c) => c.scene === 'map',
  },
  {
    id: 'raw-low',
    contextual: true,
    text: 'Short on raw materials? Buy them here with credits.',
    anchors: fixed('hud.raw'),
    side: 'bottom',
    when: (c) => c.hasTradingPost && c.rawMaterials < TUTORIAL_RAW_LOW,
  },

  // --- A. Homeworld ---
  {
    id: 'resources',
    text: 'Credits, raw materials and research pay for everything you build.',
    anchors: fixed('hud.resources'),
    side: 'bottom',
    when: (c) => c.scene !== 'battle',
    done: (c) => !c.paused,
  },
  {
    id: 'time',
    text: 'The game is paused — press play when ready; time runs in real time.',
    anchors: fixed('hud.time'),
    side: 'bottom',
    when: (c) => c.scene !== 'battle',
    done: (c) => c.scene !== 'battle' && !c.paused,
  },
  {
    id: 'build-tab',
    text: 'Open BUILD to construct buildings on your homeworld.',
    anchors: fixed('planet.tab.build'),
    side: 'left',
    when: (c) => c.scene === 'planet',
    done: (c) => has(c, 'mining_complex'),
    doneOn: ['planet-tab:build'],
  },
  {
    id: 'build-mine',
    text: 'A Mining Complex extracts the raw materials ships are made of.',
    anchors: buildRow('mining_complex'),
    side: 'left',
    when: (c) => c.scene === 'planet',
    done: (c) => has(c, 'mining_complex'),
    doneOn: ['pick:mining_complex'],
  },
  {
    id: 'place-mine',
    text: 'Click the marked spot next to the deposit, then press BUILD.',
    anchors: fixed('build.confirm.mining_complex', 'surface.mine-spot'),
    side: 'right',
    when: (c) => c.scene === 'planet',
    done: (c) => has(c, 'mining_complex'),
  },
  {
    id: 'construction',
    text: 'Construction takes time; several sites can build at once.',
    anchors: fixed('planet.construction'),
    side: 'left',
    when: (c) => c.scene === 'planet' && c.constructionSites > 0,
    done: (c) => built(c, 'mining_complex') || built(c, 'spaceship_factory'),
  },
  {
    id: 'build-factory',
    text: 'A Spaceship Factory produces ships — build one next.',
    anchors: buildRow('spaceship_factory'),
    side: 'left',
    when: (c) => c.scene === 'planet' && has(c, 'mining_complex'),
    done: (c) => has(c, 'spaceship_factory'),
    doneOn: ['pick:spaceship_factory'],
  },
  {
    id: 'build-spaceport',
    text: 'A Spaceport turns produced ships into fleets.',
    anchors: buildRow('spaceport'),
    side: 'left',
    when: (c) => c.scene === 'planet' && has(c, 'spaceship_factory'),
    done: (c) => has(c, 'spaceport'),
    doneOn: ['pick:spaceport'],
  },

  // --- B. Ships ---
  {
    id: 'production',
    text: 'Queue a Colonizer here to settle new worlds.',
    anchors: fixed('production.queue', 'production.type.colonizer', 'production.add', 'planet.tab.production'),
    side: 'left',
    when: (c) => c.scene === 'planet' && built(c, 'spaceship_factory'),
    done: (c) => c.queuedOrders > 0 || c.stockShips > 0 || c.colonizerFleetId !== null,
  },
  {
    id: 'stock',
    text: 'Finished ships wait here until a Spaceport assembles them into a fleet.',
    anchors: fixed('hud.stock'),
    side: 'bottom',
    when: (c) => c.stockShips > 0,
    // Done on opening the stock too: it comes before `assembly` in priority,
    // so waiting for an assembled fleet hid the assembly hint behind it.
    doneOn: ['stock-opened', 'fleet-assembled'],
  },
  {
    id: 'assembly',
    text: 'Pick ships from the stock and create a fleet at your Spaceport.',
    // On the galaxy map it points at the planet roster, the way back to the Spaceport.
    anchors: fixed('assembly.create', 'assembly.add', 'planet.tab.assembly', 'roster.planet'),
    side: 'left',
    when: (c) => (c.scene === 'planet' || c.scene === 'map') && c.stockShips > 0 && built(c, 'spaceport'),
    doneOn: ['fleet-assembled'],
  },

  {
    id: 'spaceport-wait',
    text: 'Ships wait in stock until the Spaceport is finished.',
    anchors: fixed('planet.construction'),
    side: 'left',
    when: (c) => c.scene === 'planet' && c.stockShips > 0 && has(c, 'spaceport') && !built(c, 'spaceport'),
    done: (c) => built(c, 'spaceport'),
  },

  // --- C. Star map ---
  {
    id: 'to-map',
    text: 'Head out to the star map.',
    anchors: fixed('hud.back'),
    side: 'bottom',
    // Not while a fleet is selected: right after assembly the game is in the
    // system view with the new fleet selected, and the move hint comes first.
    when: (c) => (c.scene === 'planet' || c.scene === 'system') && c.selectedPlayerFleetId === null,
    trigger: (c) => has(c, 'spaceport') || c.gameSeconds >= TUTORIAL_MAP_STEPS_AFTER_SECONDS,
    done: (c) => c.scene === 'map',
  },
  {
    id: 'select-fleet',
    text: 'Select your scout fleet.',
    anchors: (c) => (c.playerFleetIds.length > 0 ? [`roster.fleet.${c.playerFleetIds[0]}`] : []),
    side: 'right',
    when: (c) => c.scene === 'map',
    done: (c) => c.selectedPlayerFleetId !== null || c.playerFleetMoving,
  },
  {
    id: 'move',
    text: 'Right-click the map to send it — fleets reveal what they pass.',
    touchText: 'Long-press the map to send it — fleets reveal what they pass.',
    anchors: fixed('fleet.panel'),
    side: 'left',
    when: (c) => onFleetScreen(c) && c.selectedPlayerFleetId !== null,
    done: (c) => c.playerFleetMoving,
  },
  {
    id: 'enter-system',
    text: 'Enter a system to see its planets up close.',
    anchors: fixed('system.enter'),
    side: 'left',
    when: (c) => c.scene === 'map',
    doneOn: ['system-entered'],
  },
  {
    // The Colonizer is sent from the map or system view; on the planet the
    // way there is the back button. Repeatable: shown again on a later
    // planet visit while the Colonizer still waits.
    id: 'colonizer-leave-planet',
    text: 'Your Colonizer fleet is ready — head out to send it.',
    anchors: fixed('hud.back'),
    side: 'bottom',
    repeatable: true,
    when: (c) => c.scene === 'planet' && c.colonizerFleetId !== null && !c.colonizerMoving && c.playerPlanets < 2,
  },
  {
    id: 'colonizer-move',
    text: 'Select the Colonizer and right-click a free planet to send it.',
    touchText: 'Select the Colonizer and long-press a free planet to send it.',
    // The roster exists on the galaxy map only; in the system view the
    // selected Colonizer's own panel is the anchor.
    anchors: (c) => fleetAnchors(c, c.colonizerFleetId),
    side: 'right',
    when: (c) => onFleetScreen(c) && c.colonizerFleetId !== null && !c.colonizerMoving && !c.colonizerReady,
    done: (c) => c.playerPlanets > 1,
  },
  {
    id: 'colonize',
    text: 'Press COLONIZE to found a new colony here.',
    anchors: (c) => ['fleet.colonize', ...fleetAnchors(c, c.colonizerFleetId)],
    side: 'left',
    when: (c) => onFleetScreen(c) && c.colonizerReady,
    done: (c) => c.playerPlanets > 1,
  },
  {
    id: 'research',
    text: 'Click research to choose new technologies.',
    anchors: fixed('hud.research'),
    side: 'bottom',
    when: (c) => c.scene !== 'battle',
    trigger: (c) => c.gameSeconds >= TUTORIAL_RESEARCH_AFTER_SECONDS || c.playerFleetMoving,
    doneOn: ['research-opened'],
  },
  {
    // The build, production and assembly steps only show on the planet;
    // without this a player on the map had no hint on how to get back.
    id: 'back-to-planet',
    text: 'Open your planet here to continue.',
    anchors: fixed('roster.planet'),
    side: 'right',
    repeatable: true,
    when: (c) => c.scene === 'map' && planetWorkPending(c),
    doneOn: ['planet-opened'],
  },
  {
    id: 'diplomacy',
    text: 'You have met another empire — war, peace and demands are handled here.',
    anchors: fixed('hud.diplomacy'),
    side: 'bottom',
    when: (c) => c.scene !== 'battle',
    // Before the first contact the screen would be empty (docs/first-contact.md).
    trigger: (c) => c.metEmpires > 0,
    doneOn: ['diplomacy-opened'],
  },
  {
    // Says the tutorial is over, so silence afterwards is not mistaken for a stuck hint.
    id: 'finished',
    text: "That's the basics — grow, research and defend your empire. Good luck!",
    anchors: fixed('hud.resources'),
    side: 'bottom',
    when: (c) => c.scene !== 'battle',
    after: ['colonize', 'research', 'diplomacy'],
  },
];

/* Steps whose latched trigger holds now (TutorialService adds them to its unlocked set). */
export function triggeredSteps(ctx: TutorialContext, unlocked: ReadonlySet<string>): string[] {
  return TUTORIAL_STEPS.filter((s) => s.trigger && !unlocked.has(s.id) && s.trigger(ctx)).map((s) => s.id);
}

/* Repeatable steps marked done whose `when` no longer holds: they may come back. */
export function rearmedSteps(ctx: TutorialContext, done: ReadonlySet<string>): string[] {
  return TUTORIAL_STEPS.filter((s) => s.repeatable && done.has(s.id) && !(s.when?.(ctx) ?? true)).map((s) => s.id);
}

/* Steps whose done condition holds now (the skip rule). */
export function satisfiedSteps(ctx: TutorialContext, done: ReadonlySet<string>): string[] {
  return TUTORIAL_STEPS.filter((s) => !done.has(s.id) && s.done?.(ctx)).map((s) => s.id);
}

/* Steps completed by one game event. */
export function stepsDoneByEvent(event: TutorialEvent, done: ReadonlySet<string>): string[] {
  return TUTORIAL_STEPS.filter((s) => !done.has(s.id) && s.doneOn?.includes(event)).map((s) => s.id);
}

/*
 * Steps that may show now, in priority order (contextual first, then table
 * order). The overlay picks the first one whose anchor is visible.
 */
export function tutorialCandidates(
  ctx: TutorialContext,
  done: ReadonlySet<string>,
  unlocked: ReadonlySet<string> = new Set(),
): TutorialStep[] {
  if (ctx.modalOpen || ctx.scene === 'none') return [];
  const eligible = TUTORIAL_STEPS.filter(
    (s) =>
      !done.has(s.id) &&
      !s.done?.(ctx) &&
      (s.when?.(ctx) ?? true) &&
      (!s.trigger || unlocked.has(s.id) || s.trigger(ctx)) &&
      (s.after ?? []).every((id) => done.has(id)) &&
      s.anchors(ctx).length > 0,
  );
  return [...eligible.filter((s) => s.contextual), ...eligible.filter((s) => !s.contextual)];
}

export function emptyTutorialContext(scene: TutorialScene = 'none'): TutorialContext {
  return {
    scene,
    paused: false,
    gameSeconds: 0,
    modalOpen: false,
    buildings: {},
    constructionSites: 0,
    stockShips: 0,
    queuedOrders: 0,
    playerPlanets: 0,
    playerFleetIds: [],
    selectedPlayerFleetId: null,
    playerFleetMoving: false,
    colonizerFleetId: null,
    colonizerMoving: false,
    colonizerReady: false,
    hostileFleetId: null,
    hasTradingPost: false,
    rawMaterials: 0,
    metEmpires: 0,
  };
}

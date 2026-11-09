import { TestBed } from '@angular/core/testing';
import { TutorialService } from '../../services/tutorial.service';
import { TutorialContext, emptyTutorialContext, tutorialCandidates } from './tutorial-steps';
import { buildTutorialContext } from './tutorial-context';
import { Fleet, StarSystem } from '../star-map/star-map.models';

/* The opening of a new tutorial game: homeworld planet view, paused. */
function opening(patch: Partial<TutorialContext> = {}): TutorialContext {
  return {
    ...emptyTutorialContext('planet'),
    paused: true,
    playerPlanets: 1,
    playerFleetIds: [1],
    buildings: { capital: { sites: 0, complete: 1 } },
    ...patch,
  };
}

const ids = (ctx: TutorialContext, done: string[] = []) => tutorialCandidates(ctx, new Set(done)).map((s) => s.id);
/*
 * Core steps only. Contextual steps whose anchor exists only in a given state
 * (the energy-shortage line, a map marker) are always candidates; the overlay
 * shows them only when that anchor is on screen.
 */
const coreIds = (ctx: TutorialContext, done: string[] = []) =>
  tutorialCandidates(ctx, new Set(done)).filter((s) => !s.contextual).map((s) => s.id);

describe('tutorial steps', () => {
  it('starts with resources, then time, then the BUILD tab', () => {
    expect(coreIds(opening()).slice(0, 2)).toEqual(['resources', 'time']);
    expect(coreIds(opening(), ['resources', 'time'])[0]).toBe('build-tab');
  });

  it('shows nothing while a dialog covers the game or outside a game', () => {
    expect(ids(opening({ modalOpen: true }))).toEqual([]);
    expect(ids(emptyTutorialContext())).toEqual([]);
  });

  it('puts contextual hints before core steps', () => {
    const list = ids(opening({ scene: 'map', paused: false, hostileFleetId: 7 }));
    expect(list[0]).toBe('enemy-fleet');
  });

  it('only offers the factory after a Mining Complex exists', () => {
    expect(ids(opening({ paused: false }))).not.toContain('build-factory');
    const withMine = opening({ paused: false, buildings: { mining_complex: { sites: 1, complete: 0 } } });
    expect(ids(withMine)).toContain('build-factory');
    expect(ids(withMine)).not.toContain('build-mine');
  });

  it('asks for the star map once the Spaceport is placed, but not while a fleet is selected', () => {
    const ctx = opening({ paused: false, buildings: { spaceport: { sites: 1, complete: 0 } } });
    expect(ids(ctx)).toContain('to-map');
    expect(ids({ ...ctx, selectedPlayerFleetId: 1 })).not.toContain('to-map');
  });

  it('points at the Colonizer panel when it is selected, else at the roster', () => {
    const base = opening({ scene: 'map', paused: false, colonizerFleetId: 5 });
    const step = tutorialCandidates(base, new Set()).find((s) => s.id === 'colonizer-move')!;
    expect(step.anchors(base)).toEqual(['roster.fleet.5']);
    expect(step.anchors({ ...base, selectedPlayerFleetId: 5 })).toEqual(['fleet.panel']);
  });

  it('finds an unselected Colonizer by its marker in the system view', () => {
    const ctx = opening({ scene: 'system', paused: false, colonizerFleetId: 5 });
    const step = tutorialCandidates(ctx, new Set()).find((s) => s.id === 'colonizer-move')!;
    expect(step.anchors(ctx)).toEqual(['system.fleet.5']);
  });

  it('explains the wait when ships are in stock and the Spaceport is still being built', () => {
    const ctx = opening({ paused: false, stockShips: 1, buildings: { spaceport: { sites: 1, complete: 0 } } });
    expect(ids(ctx)).toContain('spaceport-wait');
  });

  it('points at the BUILD tab when a build step is due on another tab', () => {
    const ctx = opening({ paused: false, buildings: { mining_complex: { sites: 0, complete: 1 } } });
    const step = tutorialCandidates(ctx, new Set()).find((s) => s.id === 'build-factory')!;
    expect(step.anchors(ctx)).toContain('planet.tab.build');
  });

  it('sends a player on the planet out when the Colonizer fleet waits', () => {
    const ctx = opening({ paused: false, colonizerFleetId: 5 });
    expect(ids(ctx)).toContain('colonizer-leave-planet');
    expect(ids({ ...ctx, colonizerMoving: true })).not.toContain('colonizer-leave-planet');
  });

  it('offers diplomacy at the end of the opening grace', () => {
    expect(ids(opening({ paused: false, gameSeconds: 200 }))).not.toContain('diplomacy');
    expect(ids(opening({ paused: false, gameSeconds: 240 }))).toContain('diplomacy');
  });
});

describe('TutorialService', () => {
  let service: TutorialService;

  beforeEach(() => {
    service = TestBed.inject(TutorialService);
  });

  it('keeps a game without tutorial state off', () => {
    service.restore(undefined);
    service.setContext(opening());
    expect(service.enabled()).toBe(false);
    expect(service.candidates()).toEqual([]);
  });

  it('starts a new tutorial game paused until the time step is done', () => {
    service.restore({ enabled: true, done: [] });
    expect(service.shouldStartPaused(0)).toBe(true);
    expect(service.shouldStartPaused(30)).toBe(false);
    service.setContext(opening({ paused: false }));
    expect(service.isDone('time')).toBe(true);
    expect(service.shouldStartPaused(0)).toBe(false);
  });

  it('does not finish steps from the empty pre-load context', () => {
    service.restore({ enabled: true, done: [] });
    // The empty context reads as "not paused"; it must not count as pressing play.
    expect(service.isDone('time')).toBe(false);
    expect(service.isDone('resources')).toBe(false);
  });

  it('skips steps the player already did (skip rule)', () => {
    service.restore({ enabled: true, done: [] });
    service.setContext(opening({ paused: false, buildings: { mining_complex: { sites: 0, complete: 1 } } }));
    for (const id of ['resources', 'time', 'build-tab', 'build-mine', 'place-mine', 'construction']) {
      expect(service.isDone(id), id).toBe(true);
    }
  });

  it('closes one hint, and TUTORIAL OFF hides all', () => {
    service.restore({ enabled: true, done: [] });
    service.setContext(opening());
    const firstCore = () => service.candidates().find((s) => !s.contextual)?.id;
    expect(firstCore()).toBe('resources');
    service.dismiss('resources');
    expect(firstCore()).toBe('time');
    service.setEnabled(false);
    expect(service.candidates()).toEqual([]);
    expect(service.serialize()).toEqual({ enabled: false, done: ['resources'], unlocked: [] });
  });

  it('finishes event steps on notify', () => {
    service.restore({ enabled: true, done: [] });
    service.notify('research-opened');
    expect(service.isDone('research')).toBe(true);
  });

  it('keeps steps finished in a battle across the battle-return reload', () => {
    service.restore({ enabled: true, done: [] });
    service.setContext(opening({ scene: 'map', paused: false }));
    service.setBattleScene(true);
    service.setBattleScene(false);
    expect(service.isDone('battle-start')).toBe(true);
    // The autosave read on return was written before the battle.
    service.restore({ enabled: true, done: ['resources', 'time'] }, true);
    expect(service.isDone('battle-start')).toBe(true);
  });

  it('keeps a hint whose trigger flips back (fleet stops at an anomaly)', () => {
    service.restore({ enabled: true, done: ['resources', 'time', 'select-fleet', 'move'] });
    const map = opening({ scene: 'map', paused: false, gameSeconds: 60 });
    service.setContext({ ...map, playerFleetMoving: true });
    expect(service.candidates().map((s) => s.id)).toContain('research');
    // The scout arrived: nothing is moving any more, before the 3-minute mark.
    service.setContext(map);
    expect(service.candidates().map((s) => s.id)).toContain('research');
    expect(service.serialize().unlocked).toContain('research');
  });

  it('sends a player on the map back to the planet while the build steps are open', () => {
    service.restore({ enabled: true, done: [] });
    service.setContext(opening({ scene: 'map', paused: false }));
    expect(service.candidates().map((s) => s.id)).toContain('back-to-planet');
    service.notify('planet-opened');
    expect(service.isDone('back-to-planet')).toBe(true);
  });

  it('opening the stock clears the stock hint so the assembly hint can show', () => {
    service.restore({ enabled: true, done: [] });
    const ctx = opening({
      paused: false,
      stockShips: 1,
      buildings: { spaceport: { sites: 0, complete: 1 }, spaceship_factory: { sites: 0, complete: 1 } },
    });
    service.setContext(ctx);
    const core = () => service.candidates().filter((s) => !s.contextual).map((s) => s.id);
    expect(core().indexOf('stock')).toBeLessThan(core().indexOf('assembly'));
    service.notify('stock-opened');
    expect(core()).not.toContain('stock');
    expect(core()).toContain('assembly');
  });

  it('sends the player back to the planet again on each return while planet work is pending', () => {
    service.restore({ enabled: true, done: [] });
    const map = opening({ scene: 'map', paused: false });
    service.setContext(map);
    service.notify('planet-opened');
    expect(service.isDone('back-to-planet')).toBe(true);
    service.setContext({ ...map, scene: 'planet' });
    service.setContext(map);
    expect(service.candidates().map((s) => s.id)).toContain('back-to-planet');
  });

  it('ends with a closing hint once colonize, research and diplomacy are done', () => {
    service.restore({ enabled: true, done: ['colonize', 'research'] });
    service.setContext(opening({ scene: 'map', paused: false, playerPlanets: 2 }));
    expect(service.candidates().map((s) => s.id)).not.toContain('finished');
    service.notify('diplomacy-opened');
    expect(service.candidates().map((s) => s.id)).toContain('finished');
  });

  it('a fresh load replaces the previous game state', () => {
    service.restore({ enabled: true, done: ['resources'] });
    service.restore({ enabled: false, done: [] });
    expect(service.isDone('resources')).toBe(false);
    expect(service.enabled()).toBe(false);
  });

  it('only unregisters an anchor owned by the same element', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    service.registerAnchor('hud.time', a);
    service.registerAnchor('hud.time', b);
    service.unregisterAnchor('hud.time', a);
    expect(service.anchor('hud.time')).toBe(b);
  });
});

describe('buildTutorialContext', () => {
  it('counts player buildings by id and finds the Colonizer fleet', () => {
    const systems = [
      {
        id: 's1',
        planetsTiles: [
          {
            factionId: 'player',
            buildings: [
              { name: 'Mining Complex', size: 2, x: 0, y: 0, constructionRemaining: 10 },
              { name: 'Spaceship Factory', size: 2, x: 3, y: 0 },
            ],
          },
          { factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 2, x: 0, y: 0 }] },
        ],
      },
    ] as unknown as StarSystem[];
    const fleets = [
      { id: 1, factionId: 'player', targetX: null, targetY: null, ships: [{ id: 1, name: 'S', type: 'scout' }] },
      { id: 2, factionId: 'player', targetX: 4, targetY: 4, ships: [{ id: 2, name: 'C', type: 'colonizer' }] },
    ] as unknown as Fleet[];
    const ctx = buildTutorialContext({
      scene: 'map',
      paused: false,
      gameSeconds: 12,
      modalOpen: false,
      starSystems: systems,
      fleets,
      factions: [],
      shipStock: [],
      production: [{ factionId: 'player', ordersByPlanet: { 1: [{} as never, {} as never] } }],
      selectedFleet: null,
      colonizerReady: () => false,
      hostileFleetId: null,
    });
    expect(ctx.buildings['mining_complex']).toEqual({ sites: 1, complete: 0 });
    expect(ctx.buildings['spaceship_factory']).toEqual({ sites: 0, complete: 1 });
    expect(ctx.buildings['spaceport']).toBeUndefined();
    expect(ctx.constructionSites).toBe(1);
    expect(ctx.queuedOrders).toBe(2);
    expect(ctx.colonizerFleetId).toBe(2);
    expect(ctx.colonizerMoving).toBe(true);
    expect(ctx.playerFleetMoving).toBe(true);
  });
});

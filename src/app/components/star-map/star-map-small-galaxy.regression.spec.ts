import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { GalaxyGeneratorService, mapCenter } from '../../services/galaxy-generator.service';
import { validateGeneratedGalaxy } from '../../services/galaxy-validation';
import { createDefaultNewGameConfig, setGalaxySize, addPlayer } from '../../services/new-game-config';
import { GALAXY_SIZE_PRESETS, NewGameConfig } from '../../services/new-game.models';
import { GalaxySize, StarMapData } from './star-map.models';

/*
 * Regression: in a new Small galaxy only the human's home system was
 * visible. The data was complete, but generator v1 started every other
 * system with `explored: false`, and the galaxy view + minimap only draw
 * explored systems; sensor ranges (3–5 cells) never reached the nearest
 * system (20+ cells away). These tests run the real NewGameService and
 * StarMap (no generator mocks) and inspect the rendered DOM.
 */
describe('Small galaxy regression', () => {
  let saves: SaveGameService;

  const smallConfig = (seed: number, players = 3): NewGameConfig => {
    let config = setGalaxySize(createDefaultNewGameConfig('small'), 'small');
    while (config.players.length < players) config = addPlayer(config);
    return { ...config, players: config.players.slice(0, players), seed };
  };

  const startGame = (config: NewGameConfig): StarMapData => {
    const result = TestBed.inject(NewGameService).startNewGame(config, 1);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return structuredClone(saves.loadFromSlot(SaveSlotId.AUTOSAVE)!);
  };

  /* Boots the StarMap and switches to the galaxy view exactly like the player does. */
  const openGalaxyView = () => {
    const fixture = TestBed.createComponent(StarMap);
    const map = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → loadGame
    map.leavePlanetView();
    map.leaveSystem();
    map['updateSensorVisibility'](true);
    map['cdr'].detectChanges();
    return { map, el: fixture.nativeElement as HTMLElement };
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    saves = TestBed.inject(SaveGameService);
    saves.currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('generates multiple systems and planets sized for Small, with a centered black hole', () => {
    const preset = GALAXY_SIZE_PRESETS.small;
    for (const seed of [1, 2, 3, 189352119, 4242]) {
      const data = new GalaxyGeneratorService().generate(smallConfig(seed), seed);
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems).toHaveLength(preset.systemCount);
      expect(planets.length).toBeGreaterThanOrEqual(preset.systemCount);
      expect(planets.length).toBeLessThanOrEqual(preset.systemCount * preset.planetCountWeights.length);
      expect(data.starSystems.every((s) => s.planetsTiles.length > 0)).toBe(true);
      const hole = data.specialObjects!.find((o) => o.type === 'blackhole')!;
      const center = mapCenter(data.map.width, data.map.height);
      expect(hole.x + (hole.width - 1) / 2).toBe(center.x);
      expect(hole.y + (hole.height - 1) / 2).toBe(center.y);
    }
  });

  it('initializes every faction with homeworld, fleets and resources; not everything is the human’s', () => {
    const data = startGame(smallConfig(77));
    const planets = data.starSystems.flatMap((s) => s.planetsTiles);
    const participants = data.factions.filter((f) => f.team !== 0);
    expect(participants.map((f) => f.id)).toEqual(['player', 'enemy1', 'enemy2']);

    for (const faction of participants) {
      const owned = planets.filter((p) => p.factionId === faction.id);
      expect(owned.length, faction.id).toBeGreaterThanOrEqual(1);
      expect(owned[0].buildings.length).toBeGreaterThan(0);
      expect(data.fleets.filter((f) => f.factionId === faction.id && f.ships.length > 0).length).toBeGreaterThan(0);
      expect(faction.currencies['credits']).toBeGreaterThan(0);
    }
    // Ownership rules: the human owns only its homeworld; Normal AIs own
    // homeworld + 1 colony; everything else starts 'unhabited'.
    expect(planets.filter((p) => p.factionId === 'player')).toHaveLength(1);
    expect(planets.filter((p) => p.factionId === 'enemy1')).toHaveLength(2);
    expect(planets.filter((p) => p.factionId === 'enemy2')).toHaveLength(2);
    expect(planets.filter((p) => p.factionId === 'unhabited')).toHaveLength(planets.length - 5);
    expect(planets.filter((p) => p.factionId === 'independent')).toHaveLength(0);
  });

  it('renders every generated star system on the galaxy view and minimap', () => {
    const data = startGame(smallConfig(189352119));
    const { map, el } = openGalaxyView();

    expect(map.currentView).toBe('map');
    // StarMap holds the complete generated map, unfiltered.
    expect(map.starSystems.map((s) => s.id)).toEqual(data.starSystems.map((s) => s.id));
    expect(map.starSystems.flatMap((s) => s.planetsTiles)).toHaveLength(
      data.starSystems.flatMap((s) => s.planetsTiles).length,
    );
    expect(map.exploredStarSystems).toHaveLength(data.starSystems.length);

    const rendered = Array.from(el.querySelectorAll('app-star-map-galaxy-view .star-system__name')).map((n) =>
      n.textContent!.trim(),
    );
    expect(rendered.sort()).toEqual(data.starSystems.map((s) => s.name).sort());
    expect(el.querySelectorAll('app-star-map-blackhole')).toHaveLength(1);
    expect(el.querySelectorAll('app-star-map-minimap .minimap__system')).toHaveLength(data.starSystems.length);
  });

  it('keeps fog of war: unexplored cells are fogged, enemy fleets and foreign planets stay hidden', () => {
    startGame(smallConfig(189352119));
    const { map, el } = openGalaxyView();

    expect(el.querySelectorAll('app-star-map-galaxy-view .fog-cell').length).toBeGreaterThan(0);
    expect(map.exploredGridCells.size).toBeLessThan((map.mapWidth * map.mapHeight) / 4);
    expect(map.visibleFleets.every((f) => f.factionId === 'player')).toBe(true);
    const foreign = map.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId !== 'player');
    expect(foreign.every((p) => !p.explored)).toBe(true);
  });

  it('lets the player select another system and order a fleet there', () => {
    startGame(smallConfig(189352119));
    const { map } = openGalaxyView();
    const target = map.starSystems.find((s) => !s.planetsTiles.some((p) => p.factionId === 'player'))!;
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;

    map.selectFleet(fleet);
    map.setFleetAction('move');
    map.moveSelectedFleet(target.x, target.y);
    expect(fleet.targetX).toBe(target.x);
    expect(fleet.targetY).toBe(target.y);
  });

  it('repairs Small saves created by generator v1 without regenerating them', () => {
    const data = startGame(smallConfig(5));
    // Recreate the v1 bug state in the stored save.
    data.galaxy!.generatorVersion = 1;
    for (const s of data.starSystems) s.explored = s.planetsTiles.some((p) => p.factionId === 'player');
    saves.saveToSlot(2, data);
    const generate = vi.spyOn(TestBed.inject(GalaxyGeneratorService), 'generate');

    saves.currentSlot = null;
    expect(saves.activateSlot(2)).toBe(true);
    const { map } = openGalaxyView();

    expect(generate).not.toHaveBeenCalled();
    expect(map.exploredStarSystems).toHaveLength(data.starSystems.length);
    expect(map.starSystems.map((s) => [s.id, s.x, s.y])).toEqual(data.starSystems.map((s) => [s.id, s.x, s.y]));
    // Planet-level fog is preserved by the repair.
    const planetsExplored = map.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.explored).length;
    expect(planetsExplored).toBe(data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.explored).length);
  });

  it('save → load restores the same Small galaxy', () => {
    const data = startGame(smallConfig(31));
    const first = openGalaxyView().map;
    first.getPlayerFaction()!.currencies['credits'] = 1234;
    first.saveFromMenu(3);
    saves.currentSlot = null;
    expect(saves.activateSlot(3)).toBe(true);
    const { map } = openGalaxyView();
    expect(map.getPlayerFaction()!.currencies['credits']).toBe(1234);
    expect(map.starSystems.map((s) => s.id)).toEqual(data.starSystems.map((s) => s.id));
    expect(map.galaxy).toEqual(data.galaxy);
  });

  it('produces no duplicate ids or broken references over repeated generations of every size', () => {
    const generator = new GalaxyGeneratorService();
    for (const size of ['small', 'medium', 'large'] as GalaxySize[]) {
      for (let seed = 0; seed < 40; seed++) {
        let config = setGalaxySize(createDefaultNewGameConfig(size), size);
        while (config.players.length < GALAXY_SIZE_PRESETS[size].maxPlayers) config = addPlayer(config);
        const data = generator.generate(config, seed * 2654435761);
        expect(validateGeneratedGalaxy(data, config).errors, `${size} seed ${seed}`).toEqual([]);
        expect(data.starSystems.every((s) => s.explored)).toBe(true);
      }
    }
  });
});

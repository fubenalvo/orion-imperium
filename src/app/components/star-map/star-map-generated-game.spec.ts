import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { StarMapData } from './star-map.models';

/*
 * End-to-end check that a procedurally generated game is a normal,
 * playable StarMap session and that it survives save/load unchanged.
 */
describe('StarMap with a generated galaxy', () => {
  let saves: SaveGameService;
  let generated: StarMapData;

  const createStarMap = (): StarMap => {
    const fixture = TestBed.createComponent(StarMap);
    const component = fixture.componentInstance;
    vi.spyOn(component['cdr'], 'detectChanges').mockImplementation(() => {});
    component.ngOnInit();
    return component;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [
        { provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } },
      ],
    }).compileComponents();

    saves = TestBed.inject(SaveGameService);
    saves.currentSlot = null;
    const config = { ...createDefaultNewGameConfig('medium'), seed: 31337 };
    const result = TestBed.inject(NewGameService).startNewGame(config, 1);
    expect(result.ok).toBe(true);
    if (result.ok) generated = structuredClone(result.data);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens the generated galaxy on the human homeworld', () => {
    const map = createStarMap();

    expect(map.loadError).toBe('');
    expect(map.mapWidth).toBe(240);
    expect(map.mapHeight).toBe(144);
    expect(map.movementService.gridColumns).toBe(240);
    expect(map.movementService.gridRows).toBe(144);
    expect(map.specialObjects).toEqual(generated.specialObjects);
    expect(map.galaxy).toEqual(generated.galaxy);
    expect(map.gameOutcome).toBe('inProgress');

    expect(map.currentView).toBe('planet');
    expect(map.selectedSystem?.id).toBe(generated.defaultView!.systemId);
    expect(map.selectedPlanetTile?.id).toBe(generated.defaultView!.planetId);
    expect(map.selectedPlanetTile?.factionId).toBe('player');
    expect(map.getPlayerFaction()?.name).toBe(generated.factions[0].name);

    // Fog of war is active: sensors (which only run outside planet view)
    // reveal the home area, but most of the galaxy stays unexplored.
    expect(map.exploredGridCells.size).toBe(0);
    map.currentView = 'map';
    map['updateSensorVisibility'](true);
    expect(map.exploredGridCells.size).toBeGreaterThan(0);
    expect(map.exploredGridCells.size).toBeLessThan(map.mapWidth * map.mapHeight / 4);
    expect(map.starSystems.flatMap((s) => s.planetsTiles).some((p) => !p.explored)).toBe(true);
    expect(map.factions.filter((f) => f.ai).map((f) => f.id)).toEqual(['enemy1', 'enemy2']);
  });

  it('saves and reloads the same galaxy and progress without regenerating it', () => {
    const generate = vi.spyOn(TestBed.inject(GalaxyGeneratorService), 'generate');
    const first = createStarMap();
    first.getPlayerFaction()!.currencies['credits'] = 5555;
    first.fleets[0].x += 2;
    first['saveGame']();
    first.saveFromMenu(2);
    const savedSystems = structuredClone(first.starSystems);
    const savedFleets = structuredClone(first.fleets);

    // Re-open the session from the autosave (e.g. returning from a battle).
    const second = createStarMap();
    expect(second.getPlayerFaction()!.currencies['credits']).toBe(5555);
    expect(second.fleets.map((f) => [f.id, f.x, f.y])).toEqual(savedFleets.map((f) => [f.id, f.x, f.y]));
    expect(second.starSystems.map((s) => [s.id, s.x, s.y, s.planetsTiles.length])).toEqual(
      savedSystems.map((s) => [s.id, s.x, s.y, s.planetsTiles.length]),
    );
    expect(second.mapWidth).toBe(240);
    expect(second.galaxy).toEqual(generated.galaxy);

    // Loading the manual slot from the menu restores the same world.
    saves.currentSlot = null;
    expect(saves.activateSlot(2)).toBe(true);
    const third = createStarMap();
    expect(third.getPlayerFaction()!.currencies['credits']).toBe(5555);
    expect(third.specialObjects).toEqual(generated.specialObjects);
    expect(third.starSystems.map((s) => s.id)).toEqual(generated.starSystems.map((s) => s.id));

    expect(generate).not.toHaveBeenCalled();
    expect(saves.loadFromSlot(SaveSlotId.AUTOSAVE)!.galaxy).toEqual(generated.galaxy);
  });
});

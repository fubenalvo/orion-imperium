import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GalaxyGeneratorService, GalaxyGenerationError } from './galaxy-generator.service';
import { NewGameService, MAX_GENERATION_ATTEMPTS } from './new-game.service';
import { SaveGameService, SaveSlotId } from './save-game.service';
import { createDefaultNewGameConfig } from './new-game-config';
import { NewGameConfig } from './new-game.models';

describe('NewGameService', () => {
  let generator: GalaxyGeneratorService;
  let saves: SaveGameService;
  let service: NewGameService;
  let config: NewGameConfig;

  beforeEach(() => {
    localStorage.clear();
    generator = new GalaxyGeneratorService();
    saves = new SaveGameService();
    service = new NewGameService(generator, saves);
    config = { ...createDefaultNewGameConfig('small'), seed: 777 };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('generates, stores and activates the new galaxy', () => {
    const result = service.startNewGame(config, 2);
    expect(result.ok).toBe(true);
    expect(saves.currentSlot).toBe(SaveSlotId.AUTOSAVE);

    const manual = saves.loadFromSlot(2)!;
    const active = saves.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    expect(manual.galaxy).toMatchObject({ size: 'small', seed: 777, requestedSeed: 777 });
    expect(active.starSystems).toEqual(manual.starSystems);
    expect(active.map).toMatchObject({ width: 180, height: 108 });
  });

  it('reproduces the same galaxy from the same seed', () => {
    const a = service.createGame(config);
    const b = service.createGame(config);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.data).toEqual(b.data);
  });

  it('rejects an invalid configuration without touching any save', () => {
    const generate = vi.spyOn(generator, 'generate');
    const bad = { ...config, players: config.players.map((p) => ({ ...p, controller: 'ai' as const })) };
    const result = service.startNewGame(bad, 1);
    expect(result.ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(saves.hasAnySave()).toBe(false);
    expect(saves.currentSlot).toBeNull();
  });

  it('rejects the autosave slot as a new game target', () => {
    expect(service.startNewGame(config, SaveSlotId.AUTOSAVE).ok).toBe(false);
    expect(saves.hasAnySave()).toBe(false);
  });

  it('retries with a derived seed when generation fails, and records the seed used', () => {
    const real = generator.generate.bind(generator);
    const generate = vi
      .spyOn(generator, 'generate')
      .mockImplementationOnce(() => {
        throw new GalaxyGenerationError('boom');
      })
      .mockImplementation(real);
    const result = service.createGame(config);
    expect(result.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    const usedSeed = generate.mock.calls[1][1];
    expect(usedSeed).not.toBe(777);
    if (result.ok) {
      expect(result.data.galaxy!.seed).toBe(usedSeed);
      expect(result.data.galaxy!.requestedSeed).toBe(777);
    }
  });

  it('retries when the generated galaxy fails validation', () => {
    const real = generator.generate.bind(generator);
    vi.spyOn(generator, 'generate')
      .mockImplementationOnce((c, s) => {
        const broken = real(c, s);
        broken.specialObjects = [];
        return broken;
      })
      .mockImplementation(real);
    const result = service.createGame(config);
    expect(result.ok).toBe(true);
  });

  it('fails gracefully and starts nothing when generation keeps failing', () => {
    const generate = vi.spyOn(generator, 'generate').mockImplementation(() => {
      throw new GalaxyGenerationError('no room');
    });
    const result = service.startNewGame(config, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('no room');
    expect(generate).toHaveBeenCalledTimes(MAX_GENERATION_ATTEMPTS);
    expect(saves.hasAnySave()).toBe(false);
    expect(saves.currentSlot).toBeNull();
  });

  it('reports a storage failure instead of starting the game', () => {
    vi.spyOn(saves, 'saveToSlot').mockReturnValue(false);
    const result = service.startNewGame(config, 1);
    expect(result.ok).toBe(false);
    expect(saves.currentSlot).toBeNull();
  });

  it('save → load restores the exact generated galaxy and progress without regenerating', () => {
    expect(service.startNewGame({ ...config, galaxySize: 'medium' }, 1).ok).toBe(true);
    const generate = vi.spyOn(generator, 'generate');

    // Simulate progress in the active session, then a manual save.
    const session = saves.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    session.fleets[0].x += 3;
    session.fleets[0].targetX = 50;
    session.factions[0].currencies['credits'] = 4321;
    session.starSystems[2].explored = true;
    session.exploredGridCells = ['10-10', '11-10'];
    session.gameOutcome = 'inProgress';
    expect(saves.saveToSlot(3, session)).toBe(true);

    // Load the manual slot the way MainMenu.loadGame does.
    expect(saves.activateSlot(3)).toBe(true);
    const loaded = saves.loadFromSlot(SaveSlotId.AUTOSAVE)!;

    expect(generate).not.toHaveBeenCalled();
    expect(loaded.galaxy).toEqual(session.galaxy);
    expect(loaded.map).toEqual(session.map);
    expect(loaded.specialObjects).toEqual(session.specialObjects);
    expect(loaded.starSystems).toEqual(session.starSystems);
    expect(loaded.fleets).toEqual(session.fleets);
    expect(loaded.factions).toEqual(session.factions);
    expect(loaded.exploredGridCells).toEqual(['10-10', '11-10']);
    expect(loaded.factions[0].currencies['credits']).toBe(4321);
    expect(loaded.factions.find((f) => f.id === 'enemy1')!.aiDifficulty).toBe('normal');
  });
});

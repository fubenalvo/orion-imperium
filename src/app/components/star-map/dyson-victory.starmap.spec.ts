import { makeContact } from './diplomacy';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig, setGalaxySize } from '../../services/new-game-config';
import { SpaceBaseService } from './space-base.service';
import { DysonRingService } from './dyson-ring.service';
import { DYSON_WARMUP_SECONDS } from './dyson-victory';
import { dysonAnchorName } from './dyson-anchor';
import { SpaceBase } from './star-map.models';

/*
 * Dyson victory in a real StarMap session (docs/dyson-swarm.md, phase 4):
 * a complete ring starts the countdown banner, the warm-up survives a save
 * round trip, and its end decides the game with the Dyson wording.
 */
describe('Dyson victory (StarMap session)', () => {
  let saves: SaveGameService;

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

  const start = (): StarMap => {
    const config = { ...setGalaxySize(createDefaultNewGameConfig('small'), 'small'), seed: 11 };
    expect(TestBed.inject(NewGameService).startNewGame(config, 1).ok).toBe(true);
    const fixture = TestBed.createComponent(StarMap);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  /* A completed anchor of `factionId` on every ring slot. */
  const fullRing = (factionId: string): SpaceBase[] =>
    TestBed.inject(DysonRingService).ring!.slots.map((slot) => ({
      id: slot.index + 1, name: dysonAnchorName(slot.index), factionId, x: slot.col, y: slot.row, kind: 'dyson' as const, dysonSlot: slot.index,
    }));

  const tick = (map: StarMap, seconds: number) => (map as unknown as { gameLoopCallback(dt: number): void }).gameLoopCallback(seconds);

  it('the player holding the whole ring wins after the warm-up', () => {
    const map = start();
    TestBed.inject(SpaceBaseService).restore(fullRing('player'));
    tick(map, 1);
    expect(map.dysonCountdown).toMatchObject({ own: true, ownerName: 'You' });
    expect(map.mapNotice).toContain('Hold every anchor');

    // The countdown survives a save round trip.
    map['saveGame']();
    expect(saves.loadFromSlot(SaveSlotId.AUTOSAVE)!.dysonWarmup).toEqual({ factionId: 'player', remaining: DYSON_WARMUP_SECONDS - 1 });

    tick(map, DYSON_WARMUP_SECONDS);
    expect(map.gameOutcome).toBe('victory');
    expect(map.dysonWinnerName).toBe('You');
    expect(saves.loadFromSlot(SaveSlotId.AUTOSAVE)!.gameOutcome).toBe('victory');
  });

  it('an AI holding the ring means defeat, and losing an anchor cancels the warm-up', () => {
    const map = start();
    const ai = map.factions.find((f) => f.ai)!;
    // An empire the player has not met is shown as "Unknown" (docs/first-contact.md).
    makeContact(map.factions.find((f) => f.id === 'player')!, ai);
    const bases = TestBed.inject(SpaceBaseService);
    bases.restore(fullRing(ai.id));
    tick(map, 100);
    expect(map.dysonCountdown).toMatchObject({ own: false, ownerName: ai.name });

    bases.destroy(3);
    tick(map, 1);
    expect(map.dysonCountdown).toBeNull();
    expect(map.mapNotice).toContain('interrupted');
    expect(map.gameOutcome).toBe('inProgress');

    bases.restore(fullRing(ai.id));
    tick(map, DYSON_WARMUP_SECONDS - 1);
    expect(map.gameOutcome).toBe('inProgress');
    tick(map, 1);
    expect(map.gameOutcome).toBe('defeat');
    expect(map.dysonWinnerName).toBe(ai.name);
  });
});

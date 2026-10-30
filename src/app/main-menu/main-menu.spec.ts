import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { MainMenu } from './main-menu';
import { SaveGameService, SaveSlotId } from '../services/save-game.service';
import { NewGameService } from '../services/new-game.service';
import { createDefaultNewGameConfig } from '../services/new-game-config';

interface MockBeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function createMockPromptEvent(
  promptFn: () => void,
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>,
): MockBeforeInstallPromptEvent {
  return Object.assign(new Event('beforeinstallprompt'), {
    prompt: promptFn,
    userChoice,
  }) as MockBeforeInstallPromptEvent;
}

describe('MainMenu', () => {
  let component: MainMenu;
  let fixture: ComponentFixture<MainMenu>;
  let saveGameService: SaveGameService;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainMenu],
    }).compileComponents();

    saveGameService = TestBed.inject(SaveGameService);
    saveGameService.currentSlot = null;
    localStorage.clear();

    fixture = TestBed.createComponent(MainMenu);
    component = fixture.componentInstance;
    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate');
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /*
   * New game and manual load must activate the selected slot so the active
   * session is backed by the autosave slot. Otherwise a stale manual
   * snapshot can resurrect fleets destroyed in earlier battles.
   */
  it('should activate the chosen slot before navigating on new game', () => {
    component.newGame(1);

    expect(saveGameService.currentSlot).toBe(SaveSlotId.AUTOSAVE);
    expect(navigateSpy).toHaveBeenCalledWith(['/star-map']);

    // The active session reflects the fresh snapshot.
    const active = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    expect(active).not.toBeNull();
  });

  it('should activate the chosen slot before navigating on load game', () => {
    // Seed a manual slot.
    saveGameService.saveToSlot(1, {
      factions: [{ id: 'player', name: 'Player', color: '#fff', team: 1, ai: false, currencies: { credits: 0, rawmaterials: 0, research: 0 } }],
      map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [
        { id: 'sol', name: 'Sol', x: 1, y: 1, planets: 0, color: '#fff', planetsTiles: [], explored: true },
      ],
      fleets: [{ id: 1, name: 'Saved Fleet', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, ships: [], destroyed: false, system: null }],
      currentView: 'map',
      cameraX: 0,
      cameraY: 0,
      selectedSystemId: null,
      selectedFleetId: null,
      selectedPlanetTileId: null,
      selectedFleetAction: null,
      targetX: null,
      targetY: null,
      destroyedFleetId: null,
      exploredGridCells: [],
      shipStock: [],
      production: [],
    });

    component.loadGame(1);

    expect(saveGameService.currentSlot).toBe(SaveSlotId.AUTOSAVE);
    expect(navigateSpy).toHaveBeenCalledWith(['/star-map']);

    const active = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    expect(active!.fleets[0].name).toBe('Saved Fleet');
  });

  it('opens the new game setup screen instead of starting immediately', () => {
    const newGameButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.querySelector('.menu-item__label')?.textContent?.trim() === 'NEW GAME')!;
    newGameButton.click();
    fixture.detectChanges();

    expect(component.showNewGameSetup).toBe(true);
    expect(fixture.nativeElement.querySelector('app-new-game-setup')).not.toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('starts a generated game from the setup screen with the configured players', () => {
    const config = createDefaultNewGameConfig('small');
    config.players[0].name = 'Commander';
    config.players[1].difficulty = 'hard';

    component.onStartNewGame({ config, slotIndex: 3 });

    expect(navigateSpy).toHaveBeenCalledWith(['/star-map']);
    const active = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    expect(active.galaxy?.size).toBe('small');
    expect(active.factions.find((f) => f.id === 'player')?.name).toBe('Commander');
    expect(active.factions.find((f) => f.id === 'enemy1')?.aiDifficulty).toBe('hard');
    expect(saveGameService.loadFromSlot(3)!.starSystems).toEqual(active.starSystems);
  });

  it('shows the error and stays on the menu when game initialization fails', () => {
    vi.spyOn(TestBed.inject(NewGameService), 'startNewGame').mockReturnValue({
      ok: false,
      errors: ['Could not generate a valid galaxy.'],
    });
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.querySelector('.menu-item__label')?.textContent?.trim() === 'NEW GAME')!
      .click();
    fixture.detectChanges();

    // Start through the setup screen's real output binding.
    fixture.nativeElement.querySelector('.setup-actions__start').click();
    fixture.detectChanges();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.newGameErrors).toEqual(['Could not generate a valid galaxy.']);
    expect(fixture.nativeElement.textContent).toContain('Could not generate a valid galaxy.');
    expect(saveGameService.currentSlot).toBeNull();
  });

  it('should not navigate when loading an empty slot', () => {
    component.loadGame(2);

    expect(saveGameService.currentSlot).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  describe('PWA install', () => {
    let standaloneWasAdded = false;

    beforeEach(() => {
      if (fixture) {
        fixture.destroy();
      }
      fixture = TestBed.createComponent(MainMenu);
      component = fixture.componentInstance;
      (window as any).innerWidth = 390;
    });

    afterEach(() => {
      (window as any).innerWidth = 1280;
      if (standaloneWasAdded) {
        delete (window.navigator as any).standalone;
        standaloneWasAdded = false;
      }
    });

    it('should show install button on mobile when not standalone', () => {
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      fixture.detectChanges();

      expect(component.showInstallButton).toBe(true);
    });

    it('should not show install button when in standalone mode', () => {
      (window.navigator as any).standalone = true;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      fixture.detectChanges();

      expect(component.showInstallButton).toBe(false);
      expect(component.showIOSGuide).toBe(false);
    });

    it('should not show install button on desktop', () => {
      (window as any).innerWidth = 1280;
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      fixture.detectChanges();

      expect(component.showInstallButton).toBe(false);
    });

    it('should show iOS guide on install click when no deferred prompt', () => {
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      fixture.detectChanges();
      component.onInstallClick();

      expect(component.showIOSGuide).toBe(true);
    });

    it('should trigger native install dialog when deferred prompt exists', () => {
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const mockPrompt = vi.fn();
      const mockUserChoice = Promise.resolve({ outcome: 'accepted' as const });
      (component as any).deferredPrompt = {
        prompt: mockPrompt,
        userChoice: mockUserChoice,
      };

      fixture.detectChanges();
      component.onInstallClick();

      expect(mockPrompt).toHaveBeenCalled();
      expect(component.showIOSGuide).toBe(false);
    });

    it('should hide install button on appinstalled event', () => {
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      component.showInstallButton = true;
      fixture.detectChanges();

      const event = new Event('appinstalled');
      window.dispatchEvent(event);

      expect(component.showInstallButton).toBe(false);
      expect(component.showIOSGuide).toBe(false);
    });

    it('should handle beforeinstallprompt event', () => {
      (window.navigator as any).standalone = undefined;
      standaloneWasAdded = true;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      fixture.detectChanges();

      const mockPrompt = vi.fn();
      const mockUserChoice = Promise.resolve({ outcome: 'dismissed' as const });
      const event = createMockPromptEvent(mockPrompt, mockUserChoice);

      window.dispatchEvent(event);

      expect(component.showInstallButton).toBe(true);
      expect((component as any).deferredPrompt).toBe(event);
    });
  });
});

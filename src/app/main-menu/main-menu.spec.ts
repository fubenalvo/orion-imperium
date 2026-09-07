import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { MainMenu } from './main-menu';
import { SaveGameService, SaveSlotId } from '../services/save-game.service';

describe('MainMenu', () => {
  let component: MainMenu;
  let fixture: ComponentFixture<MainMenu>;
  let saveGameService: SaveGameService;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

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
      starSystems: [],
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

  it('should not navigate when loading an empty slot', () => {
    component.loadGame(2);

    expect(saveGameService.currentSlot).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { Fleet } from './star-map.models';

/*
 * Right-click orders on the star map: move / attack (pursuit) depending on
 * what is under the cursor, with the MOVE button flow left intact.
 */
describe('StarMap right-click orders', () => {
  const SLOT = 1;

  const startGame = (): StarMap => {
    TestBed.inject(NewGameService).startNewGame({ ...createDefaultNewGameConfig('small'), seed: 2026 }, SLOT);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    map.currentView = 'map';
    return map;
  };

  /* A right-click event whose currentTarget is a viewport at the page origin. */
  const rightClick = (clientX = 0, clientY = 0): MouseEvent => {
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const event = new MouseEvent('contextmenu', { clientX, clientY, button: 2, cancelable: true });
    Object.defineProperty(event, 'currentTarget', { value: viewport });
    return event;
  };

  /* Places an enemy fleet a few cells from `near`, toward the map center (open space). */
  const placeEnemyNear = (map: StarMap, near: Fleet, offset: number): Fleet => {
    const enemy = map.fleets.find((f) => f.factionId !== 'player' && !f.destroyed)!;
    const dir = near.x < map.mapWidth / 2 ? 1 : -1;
    enemy.x = near.x + dir * offset;
    enemy.y = near.y;
    enemy.targetX = null;
    enemy.targetY = null;
    enemy.system = null;
    return enemy;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('right-click on empty space moves the selected player fleet without the MOVE button', () => {
    const map = startGame();
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    map.selectFleet(fleet);
    map.cameraX = 0;
    map.cameraY = 0;
    const event = rightClick(window.innerWidth / 2, 10);
    map.onMapContextMenu(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fleet.targetX).not.toBeNull();
    expect(map.selectedFleetAction).toBeNull();
    expect(map.selectedFleet).toBe(fleet);
  });

  it('right-click still orders a move after the camera was dragged (regression)', () => {
    const map = startGame();
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    map.selectFleet(fleet);
    map.cameraX = 0;
    map.cameraY = 0;
    // A finished left-button camera pan leaves dragMoved = true until the next left press.
    map['dragMoved'] = true;
    map['isDragging'] = false;
    map.onMapContextMenu(rightClick(window.innerWidth / 2, 10));
    expect(fleet.targetX).not.toBeNull();
  });

  it('right-click on a hostile fleet issues an attack order that follows the quarry', () => {
    const map = startGame();
    map.sensorRangeEnabled = false; // keep the quarry visible regardless of sensor layout
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    const enemy = placeEnemyNear(map, fleet, 6);
    expect(map.areFleetsHostile(fleet, enemy)).toBe(true);
    map.selectFleet(fleet);

    map.onFleetContextMenu(enemy, rightClick());
    expect(fleet.attackFleetId).toBe(enemy.id);
    expect([fleet.targetX, fleet.targetY]).toEqual([enemy.x, enemy.y]);

    // The quarry slips away: the next frame re-aims the pursuit.
    enemy.y += 2;
    map['gameLoopCallback'](0.016);
    expect(fleet.attackFleetId).toBe(enemy.id);
    expect(fleet.targetY).toBeCloseTo(enemy.y, 0);

    // A manual move cancels the attack.
    map.moveSelectedFleet(fleet.x, fleet.y + 1);
    expect(fleet.attackFleetId).toBeNull();
  });

  it('drops the attack order when the quarry leaves sensor range', () => {
    const map = startGame();
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    const enemy = placeEnemyNear(map, fleet, 3);
    map['gameLoopCallback'](0.016); // refresh sensors with the enemy close by
    map.selectFleet(fleet);
    map.onFleetContextMenu(enemy, rightClick());
    expect(fleet.attackFleetId).toBe(enemy.id);

    enemy.x = fleet.x < map.mapWidth / 2 ? map.mapWidth - 1 : 2;
    enemy.y = fleet.y < map.mapHeight / 2 ? map.mapHeight - 1 : 2;
    map['gameLoopCallback'](0.016);
    map['gameLoopCallback'](0.016);
    expect(fleet.attackFleetId).toBeNull();
  });

  it('right-click on the selected fleet or without a commandable fleet only deselects', () => {
    const map = startGame();
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    map.selectFleet(fleet);
    map.onFleetContextMenu(fleet, rightClick());
    expect(map.selectedFleet).toBeNull();
    expect(fleet.targetX).toBeNull();

    const enemy = map.fleets.find((f) => f.factionId !== 'player')!;
    map.selectFleet(enemy);
    const before = { x: enemy.targetX, y: enemy.targetY };
    map.onMapContextMenu(rightClick(100, 100));
    expect({ x: enemy.targetX, y: enemy.targetY }).toEqual(before);
  });

  it('keeps the MOVE button flow working', () => {
    const map = startGame();
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    map.selectFleet(fleet);
    map.setFleetAction('move');
    map.cameraX = 0;
    map.cameraY = 0;
    const click = rightClick(window.innerWidth / 2, 10);
    map.onMapClick(click);
    expect(fleet.targetX).not.toBeNull();
    expect(map.selectedFleetAction).toBeNull();
  });
});

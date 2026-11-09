import { TestBed } from '@angular/core/testing';
import { OrientationGateComponent } from './orientation-gate.component';
import { GameTimeService } from '../../services/game-time.service';
import { BattleTimeService } from '../battle-screen/battle/battle-time.service';

describe('OrientationGateComponent', () => {
  let listener: ((e: { matches: boolean }) => void) | null;
  const original = window.matchMedia;

  function mockMatchMedia(matches: boolean): void {
    listener = null;
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => (listener = cb),
      removeEventListener: () => (listener = null),
    })) as unknown as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = original;
  });

  function create() {
    const fixture = TestBed.createComponent(OrientationGateComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('stays hidden in landscape or on desktop', () => {
    mockMatchMedia(false);
    const fixture = create();
    expect(fixture.nativeElement.querySelector('.orientation-gate')).toBeNull();
  });

  it('covers the screen with the logo in portrait on touch devices and pauses both clocks', () => {
    mockMatchMedia(true);
    const gameTime = TestBed.inject(GameTimeService);
    const battleTime = TestBed.inject(BattleTimeService);
    gameTime.resume();
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.orientation-gate')).not.toBeNull();
    expect(el.querySelector('.orientation-gate__logo')).not.toBeNull();
    expect(gameTime.isPaused).toBe(true);
    expect(battleTime.isPaused).toBe(true);
  });

  it('follows orientation changes and does not resume on its own', () => {
    mockMatchMedia(false);
    const gameTime = TestBed.inject(GameTimeService);
    gameTime.resume();
    const fixture = create();

    listener!({ matches: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.orientation-gate')).not.toBeNull();
    expect(gameTime.isPaused).toBe(true);

    listener!({ matches: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.orientation-gate')).toBeNull();
    expect(gameTime.isPaused).toBe(true);
  });
});

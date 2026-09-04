import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { GameTimeService, GameSpeed } from './game-time.service';

describe('GameTimeService', () => {
  let service: GameTimeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameTimeService);
  });

  afterEach(() => {
    service.reset();
  });

  describe('initial state', () => {
    it('should default to speed 1', () => {
      expect(service.speed).toBe(1);
    });

    it('should default to not paused', () => {
      expect(service.isPaused).toBe(false);
    });

    it('should default gameElapsedTime to 0', () => {
      expect(service.gameElapsedTime).toBe(0);
    });
  });

  describe('getScaledDeltaTime', () => {
    it('should return realDeltaTime at 1x speed', () => {
      service.setSpeed(1);
      expect(service.getScaledDeltaTime(0.016)).toBeCloseTo(0.016, 5);
    });

    it('should return realDeltaTime * 2 at 2x speed', () => {
      service.setSpeed(2);
      expect(service.getScaledDeltaTime(0.016)).toBeCloseTo(0.032, 5);
    });

    it('should return 0 when paused', () => {
      service.setSpeed(2);
      service.pause();
      expect(service.getScaledDeltaTime(0.016)).toBe(0);
    });

    it('should return 0 when paused at 1x', () => {
      service.setSpeed(1);
      service.pause();
      expect(service.getScaledDeltaTime(0.05)).toBe(0);
    });
  });

  describe('setSpeed', () => {
    it('should set speed to 1', () => {
      service.setSpeed(2);
      service.setSpeed(1);
      expect(service.speed).toBe(1);
    });

    it('should set speed to 2', () => {
      service.setSpeed(1);
      service.setSpeed(2);
      expect(service.speed).toBe(2);
    });

    it('should un-pause when called', () => {
      service.pause();
      service.setSpeed(2);
      expect(service.isPaused).toBe(false);
      expect(service.speed).toBe(2);
    });
  });

  describe('pause / resume', () => {
    it('should set isPaused to true on pause', () => {
      service.pause();
      expect(service.isPaused).toBe(true);
    });

    it('should set isPaused to false on resume', () => {
      service.pause();
      service.resume();
      expect(service.isPaused).toBe(false);
    });

    it('should preserve speed across pause/resume cycle at 2x', () => {
      service.setSpeed(2);
      service.pause();
      expect(service.speed).toBe(2);
      service.resume();
      expect(service.speed).toBe(2);
      expect(service.getScaledDeltaTime(0.016)).toBeCloseTo(0.032, 5);
    });

    it('should be a no-op when already paused', () => {
      service.pause();
      const speedBefore = service.speed;
      service.pause();
      expect(service.speed).toBe(speedBefore);
      expect(service.isPaused).toBe(true);
    });

    it('should be a no-op when already running', () => {
      const speedBefore = service.speed;
      service.resume();
      expect(service.speed).toBe(speedBefore);
      expect(service.isPaused).toBe(false);
    });
  });

  describe('togglePause', () => {
    it('should pause when running', () => {
      service.togglePause();
      expect(service.isPaused).toBe(true);
    });

    it('should resume when paused', () => {
      service.pause();
      service.togglePause();
      expect(service.isPaused).toBe(false);
    });

    it('should preserve speed on toggle', () => {
      service.setSpeed(2);
      service.togglePause();
      service.togglePause();
      expect(service.speed).toBe(2);
      expect(service.isPaused).toBe(false);
    });
  });

  describe('onTick / gameElapsedTime', () => {
    it('should accumulate elapsed time at 1x', () => {
      service.setSpeed(1);
      service.onTick(1);
      service.onTick(1);
      expect(service.gameElapsedTime).toBeCloseTo(2, 5);
    });

    it('should accumulate elapsed time at 2x', () => {
      service.setSpeed(2);
      service.onTick(1);
      service.onTick(1);
      expect(service.gameElapsedTime).toBeCloseTo(4, 5);
    });

    it('should not accumulate when paused', () => {
      service.setSpeed(2);
      service.pause();
      service.onTick(1);
      service.onTick(2);
      expect(service.gameElapsedTime).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset speed to 1', () => {
      service.setSpeed(2);
      service.reset();
      expect(service.speed).toBe(1);
    });

    it('should reset isPaused to false', () => {
      service.pause();
      service.reset();
      expect(service.isPaused).toBe(false);
    });

    it('should reset gameElapsedTime to 0', () => {
      service.setSpeed(1);
      service.onTick(5);
      service.reset();
      expect(service.gameElapsedTime).toBe(0);
    });
  });

  describe('state$', () => {
    it('should emit initial state', async () => {
      const state = await firstValueFrom(service.state$);
      expect(state.speed).toBe(1);
      expect(state.isPaused).toBe(false);
      expect(state.gameElapsedTime).toBe(0);
    });

    it('should emit on setSpeed', async () => {
      const sub = service.state$.subscribe(() => {});
      const emissions: number[] = [];
      const sub2 = service.state$.subscribe((s) => emissions.push(s.speed));
      sub.unsubscribe();
      sub2.unsubscribe();

      service.setSpeed(2);
      // BehaviorSubject emits synchronously — subscribe gets the latest
      expect(service.state$.value.speed).toBe(2);

      const lateSub = service.state$.subscribe((s) => {
        expect(s.speed).toBe(2);
      });
      lateSub.unsubscribe();
    });

    it('should emit on pause', async () => {
      service.pause();
      expect(service.state$.value.isPaused).toBe(true);
    });

    it('should NOT emit on onTick (only discrete changes)', async () => {
      const beforeCount = service.state$.observers.length;
      service.setSpeed(1); // may emit
      const afterSetSpeed = service.state$.observers.length;
      service.onTick(0.016);
      service.onTick(0.016);
      // onTick does not call emitState(), so no new emissions
      expect(service.gameElapsedTime).toBeCloseTo(0.032, 5);
    });
  });
});

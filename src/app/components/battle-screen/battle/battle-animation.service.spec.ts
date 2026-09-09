import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BattleAnimationService } from './battle-animation.service';

describe('BattleAnimationService', () => {
  let service: BattleAnimationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BattleAnimationService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    service.reset();
    vi.useRealTimers();
  });

  it('is not busy initially', () => {
    expect(service.isBusy).toBe(false);
    expect(service.busy()).toBe(false);
  });

  it('begin/end toggles the busy flag and increments/decrements the counter', () => {
    service.begin();
    expect(service.isBusy).toBe(true);
    service.begin();
    expect(service.isBusy).toBe(true);
    service.end();
    expect(service.isBusy).toBe(true);
    service.end();
    expect(service.isBusy).toBe(false);
  });

  it('run balances begin/end around the wrapped promise, even on success', async () => {
    const result = await service.run(async () => 'ok');
    expect(result).toBe('ok');
    expect(service.isBusy).toBe(false);
  });

  it('run balances begin/end even when the wrapped function throws', async () => {
    await expect(service.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(service.isBusy).toBe(false);
  });

  it('run awaits the inner duration before releasing the lock', async () => {
    let resolved = false;
    const p = service.run(async () => {
      await service.wait(300);
      resolved = true;
    });
    expect(service.isBusy).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(service.isBusy).toBe(true);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    await expect(p).resolves.toBeUndefined();
    expect(resolved).toBe(true);
    expect(service.isBusy).toBe(false);
  });

  it('tick emits on ticks$', () => {
    let count = 0;
    service.ticks$.subscribe(() => count++);
    service.tick();
    service.tick();
    expect(count).toBe(2);
  });

  it('reset drains the counter and clears the busy flag', () => {
    service.begin();
    service.begin();
    service.reset();
    expect(service.isBusy).toBe(false);
    expect(service.busy()).toBe(false);
    service.end();
    expect(service.isBusy).toBe(false);
  });
});

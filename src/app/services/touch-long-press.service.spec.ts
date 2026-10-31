import { TestBed } from '@angular/core/testing';
import { LONG_PRESS_MS, TouchLongPressService } from './touch-long-press.service';

function pointer(type: string, target: Element, init: Partial<PointerEventInit> = {}): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );
}

describe('TouchLongPressService', () => {
  let target: HTMLDivElement;
  let contextMenus: MouseEvent[];
  let clicks: number;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.inject(TouchLongPressService).install();
    target = document.createElement('div');
    document.body.appendChild(target);
    contextMenus = [];
    clicks = 0;
    target.addEventListener('contextmenu', (e) => contextMenus.push(e as MouseEvent));
    target.addEventListener('click', () => clicks++);
  });

  afterEach(() => {
    target.remove();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('turns a still touch press into a contextmenu at the press position', () => {
    pointer('pointerdown', target);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(1);
    expect(contextMenus[0].clientX).toBe(100);
    expect(contextMenus[0].clientY).toBe(100);
    expect(contextMenus[0].button).toBe(2);
  });

  it('does not fire for a short tap', () => {
    pointer('pointerdown', target);
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    pointer('pointerup', target);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(0);
  });

  it('is cancelled when the finger pans', () => {
    pointer('pointerdown', target);
    pointer('pointermove', target, { clientX: 130 });
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(0);
  });

  it('tolerates small finger jitter', () => {
    pointer('pointerdown', target);
    pointer('pointermove', target, { clientX: 104, clientY: 103 });
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(1);
  });

  it('is cancelled by a second finger', () => {
    pointer('pointerdown', target);
    pointer('pointerdown', target, { pointerId: 2 });
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(0);
  });

  it('ignores mouse presses', () => {
    pointer('pointerdown', target, { pointerType: 'mouse' });
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(contextMenus.length).toBe(0);
  });

  it('drops the click that follows a fired long press, but not later taps', () => {
    pointer('pointerdown', target);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer('pointerup', target);
    target.click();

    expect(clicks).toBe(0);

    vi.advanceTimersByTime(1000);
    target.click();
    expect(clicks).toBe(1);
  });
});

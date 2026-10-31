import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';

/** How long a finger must rest before the press counts as a right-click. */
export const LONG_PRESS_MS = 500;
/** Finger travel (px) that turns a press into a pan and cancels it. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/** Window after the finger lifts in which the browser's follow-up click is dropped. */
const CLICK_SUPPRESS_MS = 700;

interface PendingPress {
  pointerId: number;
  target: Element;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Touch long-press = mouse right-click, for the whole app.
 *
 * The game's orders and selection-clearing live in `(contextmenu)` handlers
 * (star map, system view; see star-map.ts "Right-click orders"). Touch
 * browsers do not deliver those reliably: iOS Safari never fires
 * `contextmenu` for a long press, and Android Chrome fires it at a
 * system-defined moment while the map already treats the touch as the start
 * of a camera drag. Instead of touching every handler, this service turns a
 * still, single-finger press into a synthetic `contextmenu` MouseEvent
 * dispatched on the element under the finger, so every existing right-click
 * handler works unchanged.
 *
 * Rules:
 * - Only `pointerType === 'touch'`; mouse and pen keep their native behavior.
 * - The press is cancelled by moving more than LONG_PRESS_MOVE_TOLERANCE_PX,
 *   lifting the finger, `pointercancel` (native scroll took over) or a
 *   second finger (pinch).
 * - Native (trusted) `contextmenu` events raised by a touch are swallowed, so
 *   Android never runs a handler twice and never shows its own menu.
 *   Synthetic events have `isTrusted === false`, which is how they get through.
 * - After a long press fired, the click the browser may send when the finger
 *   lifts is dropped; otherwise it would immediately select / deselect what
 *   the "right-click" just acted on.
 * - Text inputs are left alone so long-press paste keeps working.
 *
 * Handlers that started a camera drag on pointerdown must end it when the
 * contextmenu arrives (StarMap.consumeRightClick does), or the lift would be
 * read as a tap.
 *
 * Listeners run outside the Angular zone (they fire on every pointer move);
 * the dispatch goes back into the zone so the handlers' change detection runs.
 */
@Injectable({ providedIn: 'root' })
export class TouchLongPressService implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  private removers: Array<() => void> = [];
  private press: PendingPress | null = null;
  private readonly activeTouches = new Set<number>();
  /** Pointer whose long press already fired; its lift must not count as a click. */
  private firedPointerId: number | null = null;
  private suppressClickUntil = 0;

  install(): void {
    const win = this.doc.defaultView;
    if (this.removers.length > 0 || !win) return;
    this.zone.runOutsideAngular(() => {
      this.listen(win, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
      this.listen(win, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
      this.listen(win, 'pointerup', (e) => this.onPointerEnd(e as PointerEvent));
      this.listen(win, 'pointercancel', (e) => this.onPointerEnd(e as PointerEvent));
      this.listen(win, 'contextmenu', (e) => this.onNativeContextMenu(e as MouseEvent));
      this.listen(win, 'click', (e) => this.onClick(e as MouseEvent));
    });
  }

  ngOnDestroy(): void {
    this.cancelPress();
    this.removers.forEach((remove) => remove());
    this.removers = [];
  }

  private listen(win: Window, type: string, handler: (e: Event) => void): void {
    // Capture phase on window: runs before any component handler, so the
    // swallowed events never reach them.
    win.addEventListener(type, handler, { capture: true });
    this.removers.push(() => win.removeEventListener(type, handler, { capture: true }));
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.activeTouches.add(e.pointerId);
    this.cancelPress();
    if (this.activeTouches.size > 1) return;
    const target = e.target as Element | null;
    if (!target || isTextEntry(target)) return;
    this.press = {
      pointerId: e.pointerId,
      target,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => this.fire(), LONG_PRESS_MS),
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      this.cancelPress();
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.activeTouches.delete(e.pointerId);
    if (this.press?.pointerId === e.pointerId) {
      this.cancelPress();
    }
    if (this.firedPointerId === e.pointerId) {
      this.firedPointerId = null;
      this.suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
    }
  }

  private fire(): void {
    const press = this.press;
    this.press = null;
    if (!press || !press.target.isConnected) return;
    this.firedPointerId = press.pointerId;
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      clientX: press.x,
      clientY: press.y,
    });
    this.zone.run(() => press.target.dispatchEvent(event));
  }

  private onNativeContextMenu(e: MouseEvent): void {
    if (!e.isTrusted) return;
    const fromTouch =
      this.activeTouches.size > 0 || (e as PointerEvent).pointerType === 'touch';
    if (!fromTouch || isTextEntry(e.target as Element | null)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private onClick(e: MouseEvent): void {
    if (performance.now() >= this.suppressClickUntil) return;
    this.suppressClickUntil = 0;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private cancelPress(): void {
    if (this.press) {
      clearTimeout(this.press.timer);
      this.press = null;
    }
  }
}

function isTextEntry(el: Element | null): boolean {
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

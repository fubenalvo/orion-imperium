import { Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

/*
 * Flashes a displayed number when it JUMPS and floats the jump next to it
 * ("−1,500" in red after a purchase, "+800" in green after a delivery);
 * see docs/ui-styling.md#motion-and-sound. Styles: styles/_motion.scss
 * (.ui-flash-up / .ui-flash-down / .ui-delta).
 *
 * Resources change every economy tick, so a flash on every change would
 * never stop. The directive learns the size of the routine change (an
 * average of recent small steps) and only reacts to a change at least
 * JUMP_FACTOR times larger and at least MIN_JUMP. The baseline is learned
 * from routine steps only, so a big purchase does not raise it.
 */
const JUMP_FACTOR = 4;
const MIN_JUMP = 10;
const BASELINE_WEIGHT = 0.2;
const DELTA_LIFETIME_MS = 1200;

@Directive({
  selector: '[uiValueFlash]',
  standalone: true,
})
export class ValueFlashDirective implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private previous: number | null = null;
  private baseline = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  @Input() set uiValueFlash(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return;
    const previous = this.previous;
    this.previous = value;
    if (previous === null) return;
    const delta = value - previous;
    if (delta === 0) return;
    // The first change only teaches the routine step size.
    if (this.baseline > 0 && this.isJump(delta)) {
      this.flash(delta);
    } else {
      this.baseline = this.baseline === 0 ? Math.abs(delta) : this.baseline + (Math.abs(delta) - this.baseline) * BASELINE_WEIGHT;
    }
  }

  /* Exposed for the spec: whether a change of `delta` counts as a jump right now. */
  isJump(delta: number): boolean {
    return Math.abs(delta) >= Math.max(MIN_JUMP, this.baseline * JUMP_FACTOR);
  }

  private flash(delta: number): void {
    const up = delta > 0;
    const host = this.host;
    host.classList.remove('ui-flash-up', 'ui-flash-down');
    // Reading layout restarts the CSS animation when the same class comes back.
    void host.offsetWidth;
    host.classList.add(up ? 'ui-flash-up' : 'ui-flash-down');

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const tag = host.ownerDocument.createElement('span');
    tag.className = `ui-delta ui-delta--${up ? 'up' : 'down'}`;
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = `${up ? '+' : '−'}${Math.round(Math.abs(delta)).toLocaleString('en-US')}`;
    host.appendChild(tag);
    this.timers.push(setTimeout(() => tag.remove(), DELTA_LIFETIME_MS));
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
  }
}

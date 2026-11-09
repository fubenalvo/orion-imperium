import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TutorialService } from '../../services/tutorial.service';
import { TutorialSide, TutorialStep } from './tutorial-steps';

/*
 * The tutorial hint overlay (docs/tutorial-hints.md): a highlight ring around
 * the anchor and a small bubble next to it with an arrow pointing at it.
 * Rendered once in app.html so it works on every screen.
 *
 * Every animation frame it picks the first candidate step whose anchor is
 * visible and positions ring, bubble and arrow by writing styles directly.
 * Positions never go through signals: a signal write per frame would run
 * change detection for the whole (default-strategy) game every frame. Only a
 * change of the shown step or anchor touches the `shown` signal.
 *
 * Neither the ring nor the overlay takes pointer events, so the highlighted
 * control stays clickable; only the bubble itself does.
 */

interface ShownHint {
  step: TutorialStep;
  anchorKey: string;
  text: string;
}

const MARGIN = 8;
const GAP = 14;
const RING_PAD = 4;

@Component({
  selector: 'app-tutorial-hint',
  templateUrl: './tutorial-hint.component.html',
  styleUrl: './tutorial-hint.component.scss',
})
export class TutorialHintComponent {
  private readonly tutorial = inject(TutorialService);
  readonly shown = signal<ShownHint | null>(null);
  readonly visible = computed(() => this.shown() !== null);

  private readonly ring = viewChild<ElementRef<HTMLElement>>('ring');
  private readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');
  private readonly arrow = viewChild<ElementRef<HTMLElement>>('arrow');

  private frame = 0;
  private readonly touch =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  constructor() {
    afterNextRender(() => {
      const loop = () => {
        this.update();
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    });
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame);
      if (this.offNoticeTimer !== null) clearTimeout(this.offNoticeTimer);
    });
  }

  close(): void {
    const hint = this.shown();
    if (hint) this.tutorial.dismiss(hint.step.id);
  }

  /* Short confirmation after TUTORIAL OFF, saying where to turn it back on. */
  readonly offNotice = signal(false);
  private offNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  turnOff(): void {
    this.tutorial.setEnabled(false);
    this.offNotice.set(true);
    if (this.offNoticeTimer !== null) clearTimeout(this.offNoticeTimer);
    this.offNoticeTimer = setTimeout(() => this.offNotice.set(false), 4000);
  }

  private update(): void {
    const next = this.pick();
    const current = this.shown();
    if (next?.step !== current?.step || next?.anchorKey !== current?.anchorKey) {
      this.shown.set(next);
      // The bubble is created by this change; position it on the next frame.
      return;
    }
    if (next) this.position(this.tutorial.anchor(next.anchorKey)!, next.step.side);
  }

  private pick(): ShownHint | null {
    for (const step of this.tutorial.candidates()) {
      for (const key of step.anchors(this.tutorial.context)) {
        const el = this.tutorial.anchor(key);
        if (el && isOnScreen(el)) {
          return { step, anchorKey: key, text: (this.touch && step.touchText) || step.text };
        }
      }
    }
    return null;
  }

  private position(anchor: HTMLElement, preferred: TutorialSide): void {
    const ring = this.ring()?.nativeElement;
    const bubble = this.bubble()?.nativeElement;
    const arrow = this.arrow()?.nativeElement;
    if (!ring || !bubble || !arrow) return;

    const a = anchor.getBoundingClientRect();
    ring.style.transform = `translate(${a.left - RING_PAD}px, ${a.top - RING_PAD}px)`;
    ring.style.width = `${a.width + RING_PAD * 2}px`;
    ring.style.height = `${a.height + RING_PAD * 2}px`;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const side = chooseSide(preferred, a, bw, bh, vw, vh);

    let left: number;
    let top: number;
    if (side === 'top' || side === 'bottom') {
      left = a.left + a.width / 2 - bw / 2;
      top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - bh;
    } else {
      left = side === 'right' ? a.right + GAP : a.left - GAP - bw;
      top = a.top + a.height / 2 - bh / 2;
    }
    left = clamp(left, MARGIN, vw - bw - MARGIN);
    top = clamp(top, MARGIN, vh - bh - MARGIN);
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;

    // The arrow sits on the edge facing the anchor and slides along it to
    // keep pointing at the anchor's center when the bubble was clamped.
    arrow.dataset['side'] = side;
    if (side === 'top' || side === 'bottom') {
      const x = clamp(a.left + a.width / 2 - left, 12, bw - 12);
      arrow.style.left = `${x}px`;
      arrow.style.top = '';
    } else {
      const y = clamp(a.top + a.height / 2 - top, 12, bh - 12);
      arrow.style.top = `${y}px`;
      arrow.style.left = '';
    }
    ring.style.visibility = 'visible';
    bubble.style.visibility = 'visible';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const OPPOSITE: Record<TutorialSide, TutorialSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function fits(side: TutorialSide, a: DOMRect, bw: number, bh: number, vw: number, vh: number): boolean {
  switch (side) {
    case 'top':
      return a.top - GAP - bh >= MARGIN;
    case 'bottom':
      return a.bottom + GAP + bh <= vh - MARGIN;
    case 'left':
      return a.left - GAP - bw >= MARGIN;
    case 'right':
      return a.right + GAP + bw <= vw - MARGIN;
  }
}

/* Preferred side, else its opposite, else the remaining sides; the preferred one if nothing fits. */
function chooseSide(preferred: TutorialSide, a: DOMRect, bw: number, bh: number, vw: number, vh: number): TutorialSide {
  const order: TutorialSide[] = [preferred, OPPOSITE[preferred]];
  for (const side of ['bottom', 'top', 'right', 'left'] as TutorialSide[]) {
    if (!order.includes(side)) order.push(side);
  }
  return order.find((side) => fits(side, a, bw, bh, vw, vh)) ?? preferred;
}

/*
 * The anchor is laid out, its center is inside the window, and no dialog
 * covers it. Elements with pointer-events: none (map markers) are not hit by
 * elementFromPoint, so only a covering dialog counts as hidden, not any
 * element on top.
 */
function isOnScreen(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
  const hit = document.elementFromPoint(cx, cy);
  const cover = hit?.closest('[role="dialog"], [aria-modal="true"], .hud-overlay, .production-panel__overlay');
  return !cover || cover.contains(el);
}

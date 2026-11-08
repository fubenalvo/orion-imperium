import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'orion_ui_sounds';

/*
 * =========================================================
 * UI SOUND SERVICE — synthesized console feedback sounds
 * =========================================================
 *
 * Short interface sounds made with the Web Audio API (no audio files):
 * a tick when the mouse moves onto a button, a key "thock" on press, a
 * buzz on a disabled button, a rising sweep when a dialog powers on and a
 * falling one when it powers off, and a tiny blip when a panel boots.
 * See docs/ui-styling.md#motion-and-sound.
 *
 * Wiring is global (install(), called once by App): document listeners
 * for pointerover / pointerdown on buttons, and for `animationstart` of
 * the shared keyframes in styles/_motion.scss (ui-crt-on, ui-crt-off,
 * ui-panel-boot). Components therefore get sounds without any code, and
 * a dialog that has the power-on animation also has the power-on sound.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is
 * created on the first pointerdown; until then every sound is silent.
 * Without Web Audio (tests, old browsers) the service does nothing.
 * The on/off preference lives in localStorage (not in saves), default on.
 */
@Injectable({ providedIn: 'root' })
export class UiSoundService {
  private readonly _enabled = signal(true);
  readonly enabled = this._enabled.asReadonly();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastHovered: Element | null = null;
  private lastPlayed: Record<string, number> = {};
  private installed = false;

  constructor() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null && typeof JSON.parse(stored) === 'boolean') this._enabled.set(JSON.parse(stored));
    } catch {
      // Keep the default.
    }
  }

  setEnabled(enabled: boolean): void {
    this._enabled.set(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Storage unavailable: the choice lasts for this session.
    }
  }

  toggle(): void {
    this.setEnabled(!this._enabled());
  }

  /* Attaches the global listeners once. */
  install(doc: Document = document): void {
    if (this.installed) return;
    this.installed = true;
    const buttonOf = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? (target.closest('button, .button-style, [role="button"]') as HTMLElement | null) : null;
    const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';

    doc.addEventListener(
      'pointerover',
      (e) => {
        if ((e as PointerEvent).pointerType !== 'mouse') return;
        const el = buttonOf(e.target);
        if (el === this.lastHovered) return;
        this.lastHovered = el;
        if (el && !isDisabled(el)) this.play('hover');
      },
      { passive: true },
    );
    doc.addEventListener(
      'pointerdown',
      (e) => {
        if ((e as PointerEvent).button !== 0) return;
        this.unlock();
        const el = buttonOf(e.target);
        if (el) this.play(isDisabled(el) ? 'deny' : 'press');
      },
      { passive: true, capture: true },
    );
    doc.addEventListener(
      'animationstart',
      (e) => {
        const name = (e as AnimationEvent).animationName;
        if (name === 'ui-crt-on') this.play('open');
        else if (name === 'ui-crt-off') this.play('close');
        else if (name === 'ui-panel-boot') this.play('boot');
      },
      { passive: true },
    );
  }

  /* Creates (or resumes) the AudioContext; must run inside a user gesture. */
  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const length = Math.floor(this.ctx.sampleRate * 0.3);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  /* Minimum gap per sound, so a row of panels booting at once or a fast
     mouse sweep over a toolbar does not turn into a buzz. */
  private static readonly MIN_GAP_MS: Record<string, number> = { hover: 45, boot: 140, press: 30, deny: 120, open: 120, close: 120 };

  play(sound: 'hover' | 'press' | 'deny' | 'open' | 'close' | 'boot'): void {
    if (!this._enabled() || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastPlayed[sound] ?? -Infinity) < UiSoundService.MIN_GAP_MS[sound]) return;
    // The power-on sound already covers the panels booting inside a dialog.
    if (sound === 'boot' && now - (this.lastPlayed['open'] ?? -Infinity) < 400) return;
    this.lastPlayed[sound] = now;
    const t = this.ctx.currentTime;
    switch (sound) {
      case 'hover':
        this.tone('sine', 1900, 2300, t, 0.025, 0.035);
        break;
      case 'press':
        this.tone('triangle', 520, 170, t, 0.07, 0.16);
        this.burst(t, 0.018, 0.06, 'highpass', 2500, 2500);
        break;
      case 'deny':
        this.tone('square', 140, 120, t, 0.05, 0.05, 900);
        this.tone('square', 140, 120, t + 0.07, 0.05, 0.05, 900);
        break;
      case 'open':
        this.tone('sine', 180, 1100, t, 0.24, 0.08);
        this.burst(t, 0.28, 0.05, 'bandpass', 400, 3200);
        break;
      case 'close':
        this.tone('sine', 900, 160, t, 0.17, 0.07);
        this.burst(t, 0.16, 0.035, 'bandpass', 2600, 300);
        break;
      case 'boot':
        this.tone('sine', 1320, 1320, t, 0.03, 0.03);
        this.tone('sine', 1760, 1760, t + 0.035, 0.03, 0.025);
        break;
    }
  }

  /* One oscillator note with a pitch glide and a fast attack / exponential release. */
  private tone(type: OscillatorType, from: number, to: number, start: number, duration: number, gain: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.008, duration / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    let out: AudioNode = osc;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      osc.connect(filter);
      out = filter;
    }
    out.connect(amp).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /* Filtered noise with a moving filter: clicks and whooshes. */
  private burst(start: number, duration: number, gain: number, type: BiquadFilterType, fromHz: number, toHz: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(fromHz, start);
    filter.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, duration / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(amp).connect(this.master!);
    src.start(start);
    src.stop(start + duration + 0.02);
  }
}

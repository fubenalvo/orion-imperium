import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'orion_ui_sounds';

/*
 * =========================================================
 * UI SOUND SERVICE — synthesized console feedback sounds
 * =========================================================
 *
 * Short retro sci-fi interface sounds made with the Web Audio API (no
 * audio files): an 8-bit chirp when the mouse moves onto a button, a
 * two-note beep with a metallic FM click on press, a low saw buzz on a
 * disabled button, a rising arpeggio with a warbling sweep when a dialog
 * powers on and a falling one when it powers off, and a short data
 * chatter when a panel boots.
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
        const ready = this.unlock();
        const el = buttonOf(e.target);
        if (!el) return;
        const sound = isDisabled(el) ? 'deny' : 'press';
        // A context that was just created or resumed may still be
        // 'suspended' here; play once it is running, or the first press is lost.
        if (ready) void ready.then(() => this.play(sound));
        else this.play(sound);
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

  /* Creates (or resumes) the AudioContext; must run inside a user gesture.
     Returns a promise when the context is not running yet, null otherwise. */
  private unlock(): Promise<void> | null {
    if (!this.ctx) this.createContext();
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume().catch(() => undefined);
    return null;
  }

  private createContext(): void {
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
    // Retro sci-fi palette: lowpassed square waves for 8-bit computer
    // chirps, quick arpeggios for dialog power on / off, FM for a metallic
    // key click, and a vibrato "warp" sweep under the dialog sounds.
    switch (sound) {
      case 'hover':
        this.tone('square', 2600, 1900, t, 0.022, 0.02, { lowpass: 3800 });
        break;
      case 'press':
        this.tone('square', 1046.5, 1046.5, t, 0.03, 0.05, { lowpass: 3000 });
        this.tone('square', 1568, 1568, t + 0.035, 0.045, 0.045, { lowpass: 3000 });
        this.fm(180, 3.5, 420, t, 0.07, 0.11);
        break;
      case 'deny':
        this.tone('sawtooth', 196, 185, t, 0.08, 0.07, { lowpass: 1100 });
        this.tone('sawtooth', 147, 139, t + 0.09, 0.13, 0.07, { lowpass: 1100 });
        break;
      case 'open':
        [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
          this.tone('square', hz, hz, t + i * 0.04, 0.05, 0.035, { lowpass: 3200 }),
        );
        this.tone('sine', 140, 1400, t, 0.34, 0.06, { vibrato: { rate: 26, depth: 45 } });
        this.burst(t, 0.3, 0.035, 'bandpass', 300, 4000);
        break;
      case 'close':
        [1046.5, 783.99, 523.25].forEach((hz, i) =>
          this.tone('square', hz, hz, t + i * 0.04, 0.045, 0.03, { lowpass: 2800 }),
        );
        this.tone('sine', 1200, 110, t, 0.24, 0.06, { vibrato: { rate: 22, depth: 35 } });
        this.burst(t, 0.2, 0.025, 'bandpass', 3000, 250);
        break;
      case 'boot':
        // Short "data chatter": a fixed pattern of high computer blips.
        [2093, 1568, 2637, 1760].forEach((hz, i) =>
          this.tone('square', hz, hz, t + i * 0.022, 0.016, 0.018, { lowpass: 4200 }),
        );
        break;
    }
  }

  /* One oscillator note with a pitch glide and a fast attack / exponential
     release; optional lowpass (softens square / saw edges) and vibrato. */
  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    start: number,
    duration: number,
    gain: number,
    opts: { lowpass?: number; vibrato?: { rate: number; depth: number } } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = opts.vibrato.rate;
      depth.gain.value = opts.vibrato.depth;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + duration + 0.02);
    }
    this.envelope(amp, start, duration, gain);
    let out: AudioNode = osc;
    if (opts.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.lowpass;
      osc.connect(filter);
      out = filter;
    }
    out.connect(amp).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /* Two-operator FM: a decaying modulation index gives a short metallic
     "clank" that settles into a plain tone. */
  private fm(carrierHz: number, ratio: number, indexHz: number, start: number, duration: number, gain: number): void {
    const ctx = this.ctx!;
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const amp = ctx.createGain();
    carrier.frequency.value = carrierHz;
    mod.frequency.value = carrierHz * ratio;
    modGain.gain.setValueAtTime(indexHz, start);
    modGain.gain.exponentialRampToValueAtTime(1, start + duration);
    mod.connect(modGain).connect(carrier.frequency);
    this.envelope(amp, start, duration, gain);
    carrier.connect(amp).connect(this.master!);
    for (const o of [carrier, mod]) {
      o.start(start);
      o.stop(start + duration + 0.02);
    }
  }

  private envelope(amp: GainNode, start: number, duration: number, gain: number): void {
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.006, duration / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
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

import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'orion_ui_sounds';

/* Interface sounds, played by the global listeners in install(). */
export type UiSound = 'hover' | 'press' | 'deny' | 'open' | 'close' | 'boot';
/* Game event sounds, played by the code that owns the event. */
export type GameSound =
  | 'order-move'
  | 'order-attack'
  | 'fire-energy'
  | 'fire-kinetic'
  | 'fire-missile'
  | 'hit'
  | 'shield-hit'
  | 'ship-lost'
  | 'stack-destroyed';

/*
 * =========================================================
 * UI SOUND SERVICE — synthesized console feedback sounds
 * =========================================================
 *
 * Short retro sci-fi interface sounds made with the Web Audio API (no
 * audio files): a soft click when the mouse moves onto a button, a
 * two-note beep with a metallic FM click on press, a low saw buzz on a
 * disabled button, a 1960s bridge-console style sine whistle and burble
 * when a dialog powers on, a falling whistle when it powers off, and a
 * short data chatter when a panel boots.
 * See docs/ui-styling.md#motion-and-sound.
 *
 * It also plays the game event sounds (GameSound), which callers trigger
 * directly: fleet / battle-stack orders (StarMap, BattleScreenComponent)
 * and battle fire, hits and explosions (BattleCombatService). Battle
 * sounds take a stereo pan from the stack's x position and a pitch factor
 * from its hull class. The UI SOUNDS toggle covers both groups.
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
  /* Where tone()/fm()/burst() connect: the master, or a per-call stereo panner. */
  private out: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  /* Input of the battle chain (createBattleBus); fire, hits and explosions go here. */
  private battleBus: AudioNode | null = null;
  /* Battle chain input without the saturation, for the recorded samples
     (already mastered; the tanh curve would distort them). */
  private battleClean: AudioNode | null = null;
  /* Per-call destination for sample(): battleClean or a panner into it. */
  private cleanOut: AudioNode | null = null;
  /* Decoded public/sfx samples by file name (without extension). */
  private readonly samples = new Map<string, AudioBuffer>();
  private laserIndex = 0;
  private engine: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private engineOn = false;
  private engineStopTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (!enabled) this.setEngineLoop(false);
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
      const rate = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, rate * 2, rate);
      const white = this.noise.getChannelData(0);
      for (let i = 0; i < white.length; i++) white[i] = Math.random() * 2 - 1;
      // Brown noise (integrated white): the deep body of rumbles and engines.
      this.brown = this.ctx.createBuffer(1, rate * 3, rate);
      const brown = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < brown.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        brown[i] = last * 3.5;
      }
      this.battleBus = this.createBattleBus();
      this.loadSamples();
    } catch {
      this.ctx = null;
    }
  }

  /* Fetches and decodes the battle samples once, right after the context
     exists (the first click, long before any battle). A sample that fails
     to load or decode (e.g. no Ogg support) just stays missing, and its
     sound falls back to the synthesized version. */
  private loadSamples(): void {
    const ctx = this.ctx!;
    for (const name of SAMPLE_FILES) {
      fetch(`sfx/${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.samples.set(name, buffer))
        .catch(() => undefined);
    }
  }

  /*
   * Shared chain for the battle sounds: soft saturation (warmth, and
   * loud explosions clip musically instead of digitally), a compressor
   * that glues many simultaneous shots together and keeps the mix from
   * clipping, and a send into a synthetic-room reverb so every shot and
   * explosion has a tail instead of stopping dead.
   */
  private createBattleBus(): AudioNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const k = 2.5;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    // The tanh curve has a small-signal gain of ~2.5; bring it back down.
    const post = ctx.createGain();
    post.gain.value = 0.45;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    input.connect(shaper).connect(post).connect(comp).connect(this.master!);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.roomImpulse(2.4);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    input.connect(send).connect(reverb).connect(this.master!);

    // Samples skip the saturation and get less reverb (they carry their own
    // ambience) but share the compressor, so they mix with the synth layers.
    const clean = ctx.createGain();
    clean.connect(comp);
    const cleanSend = ctx.createGain();
    cleanSend.gain.value = 0.15;
    clean.connect(cleanSend).connect(reverb);
    this.battleClean = clean;
    return input;
  }

  /*
   * Battle engine hum: one looping sample for the whole field, faded in
   * quickly while any ship moves or turns and faded out once none does.
   * The battle screen calls this every frame; it only acts on changes.
   */
  setEngineLoop(on: boolean): void {
    const ctx = this.ctx;
    const buffer = this.samples.get('engineloop');
    const want = on && this._enabled() && !!ctx && ctx.state === 'running' && !!buffer && !!this.battleClean;
    if (want) {
      if (this.engineStopTimer !== null) {
        clearTimeout(this.engineStopTimer);
        this.engineStopTimer = null;
      }
      if (!this.engine) {
        const src = ctx!.createBufferSource();
        src.buffer = buffer!;
        src.loop = true;
        const gain = ctx!.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.battleClean!);
        src.start();
        this.engine = { src, gain };
      }
      if (!this.engineOn) {
        this.engineOn = true;
        this.engine.gain.gain.cancelScheduledValues(ctx!.currentTime);
        this.engine.gain.gain.setTargetAtTime(ENGINE_LEVEL, ctx!.currentTime, 0.07);
      }
    } else if (this.engineOn) {
      this.engineOn = false;
      if (this.engine && ctx) {
        this.engine.gain.gain.cancelScheduledValues(ctx.currentTime);
        this.engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      }
      // Free the looping source once it is inaudible; a restart before then reuses it.
      this.engineStopTimer = setTimeout(() => {
        this.engineStopTimer = null;
        this.engine?.src.stop();
        this.engine = null;
      }, 1500);
    }
  }

  /* One recorded sample through the clean battle input (panned like the
     synth layers via this.out's panner, when there is one). */
  private sample(name: string, gain: number, rate: number): boolean {
    const buffer = this.samples.get(name);
    if (!buffer || !this.ctx || !this.battleClean) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const amp = this.ctx.createGain();
    amp.gain.value = gain;
    src.connect(amp).connect(this.cleanOut ?? this.battleClean);
    src.start();
    return true;
  }

  /* Stereo impulse response: decaying, slightly darkened noise per channel. */
  private roomImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < length; i++) {
        y += 0.3 * (Math.random() * 2 - 1 - y);
        data[i] = y * Math.pow(1 - i / length, 3);
      }
    }
    return buffer;
  }

  /* Minimum gap per sound, so a row of panels booting at once, a fast
     mouse sweep over a toolbar or a dozen stacks firing in the same frame
     does not turn into a buzz (or clip). */
  private static readonly MIN_GAP_MS: Record<UiSound | GameSound, number> = {
    hover: 45,
    boot: 140,
    press: 30,
    deny: 120,
    open: 120,
    close: 120,
    'order-move': 80,
    'order-attack': 80,
    'fire-energy': 70,
    'fire-kinetic': 70,
    'fire-missile': 90,
    hit: 60,
    'shield-hit': 60,
    'ship-lost': 90,
    'stack-destroyed': 150,
  };

  /**
   * Plays one sound if sounds are on and audio is unlocked.
   * `pan` is -1 (left) … 1 (right); `pitch` multiplies the weapon sound
   * frequencies (heavier hulls lower). The UI sounds ignore `pitch`.
   */
  play(sound: UiSound | GameSound, opts: { pan?: number; pitch?: number } = {}): void {
    if (!this._enabled() || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastPlayed[sound] ?? -Infinity) < UiSoundService.MIN_GAP_MS[sound]) return;
    // The power-on sound already covers the panels booting inside a dialog.
    if (sound === 'boot' && now - (this.lastPlayed['open'] ?? -Infinity) < 400) return;
    // A destroyed stack's big explosion already covers its last ship.
    if (sound === 'ship-lost' && now - (this.lastPlayed['stack-destroyed'] ?? -Infinity) < 150) return;
    this.lastPlayed[sound] = now;
    const bus = BATTLE_SOUNDS.has(sound) && this.battleBus ? this.battleBus : this.master;
    this.out = bus;
    this.cleanOut = this.battleClean;
    if (opts.pan && typeof this.ctx.createStereoPanner === 'function') {
      const pan = Math.max(-1, Math.min(1, opts.pan));
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      panner.connect(bus);
      this.out = panner;
      if (this.battleClean && BATTLE_SOUNDS.has(sound)) {
        const cleanPanner = this.ctx.createStereoPanner();
        cleanPanner.pan.value = pan;
        cleanPanner.connect(this.battleClean);
        this.cleanOut = cleanPanner;
      }
    }
    // Battle sounds vary a little per shot so a long fight never repeats
    // the same sample-like sound (sound only; game logic stays deterministic).
    const p = (opts.pitch ?? 1) * (BATTLE_SOUNDS.has(sound) ? rand(0.92, 1.08) : 1);
    const t = this.ctx.currentTime;
    // Retro sci-fi palette: lowpassed square waves for 8-bit computer
    // chirps, FM for a metallic key click, and soft sine whistles and
    // bloops (classic bridge-console style) for dialog power on / off.
    switch (sound) {
      case 'hover':
        // A soft mechanical tick, quieter and shorter than a press: a
        // band-passed noise transient over a tiny falling sine "tock".
        this.noiseHit({ start: t, dur: 0.012, gain: 0.045, type: 'bandpass', from: 4800, to: 2600, q: 1.4 });
        this.tone('sine', 1750, 1150, t, 0.02, 0.022);
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
        // 1960s bridge-console style: a sine whistle that slides up and holds
        // with a slow vibrato, then a quick burble of descending sine "bloops".
        this.tone('sine', 900, 1800, t, 0.17, 0.05, { glide: 0.05, vibrato: { rate: 9, depth: 22 } });
        [1975, 1480, 2217].forEach((hz, i) => this.tone('sine', hz, hz * 0.85, t + 0.18 + i * 0.045, 0.035, 0.04));
        break;
      case 'close':
        this.tone('sine', 1700, 650, t, 0.12, 0.05, { vibrato: { rate: 9, depth: 18 } });
        this.tone('sine', 520, 440, t + 0.12, 0.05, 0.045);
        break;
      case 'boot':
        // Short "data chatter": a fixed pattern of high computer blips.
        [2093, 1568, 2637, 1760].forEach((hz, i) =>
          this.tone('square', hz, hz, t + i * 0.022, 0.016, 0.018, { lowpass: 4200 }),
        );
        break;
      // Orders: bridge-console acknowledgements, softer than a button press.
      case 'order-move':
        this.tone('sine', 880, 990, t, 0.05, 0.06, { glide: 0.02 });
        this.tone('sine', 1320, 1480, t + 0.06, 0.07, 0.055, { glide: 0.02, vibrato: { rate: 14, depth: 20 } });
        break;
      case 'order-attack':
        [660, 880, 1320].forEach((hz, i) =>
          this.tone('square', hz, hz * 1.04, t + i * 0.05, 0.045, 0.04, { lowpass: 2600 }),
        );
        this.tone('sawtooth', 220, 330, t, 0.16, 0.035, { lowpass: 900 });
        break;
      // Battle: layered sounds through the battle bus (saturation,
      // compression, reverb). Weapon by damage type, pitched by hull class.
      // Recorded samples (public/sfx) come first; each synth case below is
      // the fallback while a sample is still loading or failed to decode.
      // Sample playback rate follows the hull pitch at half strength, so
      // heavy guns sound deeper without the recording turning to mud.
      case 'fire-energy': {
        // Four laser recordings in rotation, so a volley line never repeats one.
        const laser = LASER_SAMPLES[this.laserIndex++ % LASER_SAMPLES.length];
        if (this.sample(laser, 0.5, 1 + (p - 1) * 0.5)) break;
        // Two detuned saws under a resonant lowpass that closes as the
        // pitch falls: a thick, hissing beam "zap" with a bright FM shimmer.
        this.voice(['sawtooth', 'sawtooth'], [-14, 12], 2400 * p, 380 * p, t, 0.2, 0.07, {
          type: 'lowpass', from: 6500, to: 800, q: 9,
        });
        this.fm(1400 * p, 2.01, 900 * p, t, 0.13, 0.025);
        this.noiseHit({ start: t, dur: 0.03, gain: 0.05, type: 'highpass', from: 6000, to: 3500 });
        break;
      }
      case 'fire-kinetic':
      {
        // Mass driver, built from noise only: a pitched sine "thump" here
        // sounded like a tom drum next to the recorded samples. Layers: a
        // bright supersonic crack, a broadband muzzle blast that darkens, a
        // gritty mid bark, a short brown-noise punch for weight, a rolling
        // brown-noise tail and a faint metal ring from the barrel. A small
        // random spread keeps a volley line from repeating one shot.
        const f = p * rand(0.92, 1.08);
        this.noiseHit({ start: t, dur: 0.022, gain: 0.2, type: 'highpass', from: 4800, to: 2600 });
        this.noiseHit({ start: t, dur: 0.34, gain: 0.22, type: 'lowpass', from: 7000 * f, to: 260, q: 0.6 });
        this.noiseHit({ start: t, dur: 0.12, gain: 0.12, type: 'bandpass', from: 1900 * f, to: 650 * f, q: 1.5 });
        this.noiseHit({ start: t, dur: 0.09, gain: 0.32, type: 'lowpass', from: 320 * f, to: 90, brown: true });
        this.noiseHit({
          start: t + 0.01, dur: 0.55, gain: 0.22, type: 'lowpass', from: 600 * f, to: 80, attack: 0.02, brown: true,
        });
        this.fm(rand(560, 700) * p, 1.41, 280, t + 0.005, 0.22, 0.012);
        break;
      }
      case 'fire-missile':
        if (this.sample('rocket1', 0.6, 1 + (p - 1) * 0.5)) break;
        // Ignition pop, a swelling rising whoosh, and a deep motor rumble.
        this.noiseHit({ start: t, dur: 0.09, gain: 0.1, type: 'lowpass', from: 1800, to: 400 });
        this.noiseHit({ start: t, dur: 0.6, gain: 0.09, type: 'bandpass', from: 350 * p, to: 2800 * p, q: 1.6, attack: 0.12 });
        this.noiseHit({ start: t, dur: 0.55, gain: 0.16, type: 'lowpass', from: 420 * p, to: 140, attack: 0.03, brown: true });
        break;
      case 'hit':
        // Hull impact: a short crunch and a metallic ping at a random pitch.
        this.noiseHit({ start: t, dur: 0.08, gain: 0.07, type: 'bandpass', from: 3200, to: 1100, q: 2 });
        this.fm(rand(900, 1500), 2.76, 600, t, 0.2, 0.022);
        break;
      case 'shield-hit':
        // A hit absorbed by a shield; the synth fallback is a plain hit.
        if (this.sample('shiedhit1', 0.5, rand(0.94, 1.06))) break;
        this.noiseHit({ start: t, dur: 0.08, gain: 0.07, type: 'bandpass', from: 3200, to: 1100, q: 2 });
        this.fm(rand(900, 1500), 2.76, 600, t, 0.2, 0.022);
        break;
      case 'ship-lost':
        // Smaller and brighter than a whole stack going up.
        if (this.sample('explosion1', 0.55, rand(1.08, 1.2))) break;
        this.explosion(t, 0.55);
        break;
      case 'stack-destroyed':
        // Deeper and louder, with a synthesized sub-bass thump underneath.
        if (this.sample('explosion1', 0.9, rand(0.85, 0.95))) {
          this.tone('sine', 75, 28, t, 0.6, 0.3);
          break;
        }
        this.explosion(t, 1);
        break;
    }
  }

  /*
   * Layered explosion, `size` 0..1: a sharp crack, a noise body whose
   * filter darkens as it burns out, a long brown-noise rumble, a sub-bass
   * thump, and debris crackle that thins out over time. Every layer is
   * randomized a little, so no two explosions sound the same.
   */
  private explosion(t: number, size: number): void {
    const f = rand(0.85, 1.15);
    this.noiseHit({ start: t, dur: 0.03, gain: 0.2 * size, type: 'highpass', from: 2500, to: 1800 });
    this.noiseHit({ start: t, dur: 0.3 + 0.9 * size, gain: 0.3 * size, type: 'lowpass', from: 5000 * f, to: 150, q: 0.9 });
    this.noiseHit({
      start: t, dur: 0.4 + 1.6 * size, gain: 0.45 * size, type: 'lowpass', from: 260 * f, to: 80, attack: 0.03, brown: true,
    });
    this.tone('sine', 75 * f, 28, t, 0.2 + 0.6 * size, 0.35 * size);
    const grains = Math.round(4 + 8 * size);
    for (let i = 0; i < grains; i++) {
      // Squared random delay: dense right after the blast, sparse later.
      const delay = 0.05 + Math.pow(Math.random(), 1.6) * 0.9 * size;
      const hz = rand(1200, 6000);
      this.noiseHit({ start: t + delay, dur: rand(0.004, 0.016), gain: rand(0.02, 0.06) * size, type: 'bandpass', from: hz, to: hz * 0.7, q: 4 });
    }
  }

  /* Several detuned oscillators sharing one sweeping filter and envelope. */
  private voice(
    types: OscillatorType[],
    detune: number[],
    from: number,
    to: number,
    start: number,
    duration: number,
    gain: number,
    filter: { type: BiquadFilterType; from: number; to: number; q: number },
  ): void {
    const ctx = this.ctx!;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.Q.value = filter.q;
    biquad.frequency.setValueAtTime(filter.from, start);
    biquad.frequency.exponentialRampToValueAtTime(filter.to, start + duration);
    const amp = ctx.createGain();
    this.envelope(amp, start, duration, gain);
    biquad.connect(amp).connect(this.out!);
    types.forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = detune[i] ?? 0;
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(to, start + duration);
      osc.connect(biquad);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }

  /* One oscillator note with a pitch glide and a fast attack / exponential
     release; optional lowpass (softens square / saw edges), glide and vibrato. */
  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    start: number,
    duration: number,
    gain: number,
    opts: { lowpass?: number; glide?: number; vibrato?: { rate: number; depth: number } } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    // With `glide` the pitch reaches `to` early and holds there.
    osc.frequency.exponentialRampToValueAtTime(to, start + Math.min(opts.glide ?? duration, duration));
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
    out.connect(amp).connect(this.out!);
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
    carrier.connect(amp).connect(this.out!);
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

  /* Filtered noise with a moving filter: shots, crackles and explosions. */
  /* White (or brown) noise through a sweeping filter with its own attack.
     Each call reads from a random offset, so repeated hits do not share
     the same noise grain. */
  private noiseHit(o: {
    start: number;
    dur: number;
    gain: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
    attack?: number;
    brown?: boolean;
  }): void {
    const ctx = this.ctx!;
    const buffer = (o.brown ? this.brown : this.noise)!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? (o.type === 'bandpass' ? 1.2 : 0.7);
    filter.frequency.setValueAtTime(o.from, o.start);
    filter.frequency.exponentialRampToValueAtTime(o.to, o.start + o.dur);
    const amp = ctx.createGain();
    const attack = Math.min(o.attack ?? 0.003, o.dur / 2);
    amp.gain.setValueAtTime(0.0001, o.start);
    amp.gain.exponentialRampToValueAtTime(o.gain, o.start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, o.start + o.dur);
    src.connect(filter).connect(amp).connect(this.out!);
    const offset = Math.random() * Math.max(0, buffer.duration - o.dur - 0.05);
    src.start(o.start, offset);
    src.stop(o.start + o.dur + 0.02);
  }
}

/* Sounds routed through the battle bus (saturation, compression, reverb). */
const BATTLE_SOUNDS: ReadonlySet<UiSound | GameSound> = new Set<UiSound | GameSound>([
  'fire-energy',
  'fire-kinetic',
  'fire-missile',
  'hit',
  'shield-hit',
  'ship-lost',
  'stack-destroyed',
]);

/* Recorded battle samples in public/sfx (<name>.ogg); 'shiedhit1' is the file's own spelling. */
const LASER_SAMPLES = ['laser1', 'laser2', 'laser3', 'laser4'];
const SAMPLE_FILES = [...LASER_SAMPLES, 'rocket1', 'explosion1', 'shiedhit1', 'engineloop'];
/* Engine loop gain at full fade-in (before the master). */
const ENGINE_LEVEL = 0.35;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

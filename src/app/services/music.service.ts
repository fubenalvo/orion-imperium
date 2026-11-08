import { Injectable, inject, signal } from '@angular/core';
import { UiSoundService } from './ui-sound.service';

const STORAGE_KEY = 'orion_music';

/* Which background track the current screen wants. */
export type MusicScene = 'title' | 'space' | 'planet' | 'battle';
/* One-shot event music played over the background track. */
export type MusicStinger = 'notification' | 'fanfare';

interface SceneTrack {
  src: string;
  /* Start from the beginning on every entry (an intro worth hearing again);
     otherwise the track resumes where it faded out. */
  restartOnEnter: boolean;
}

const SCENE_TRACKS: Record<MusicScene, SceneTrack> = {
  title: { src: 'music/title.mp3', restartOnEnter: true },
  space: { src: 'music/sector.mp3', restartOnEnter: false },
  planet: { src: 'music/airy.mp3', restartOnEnter: false },
  battle: { src: 'music/urgent.mp3', restartOnEnter: true },
};

const STINGERS: Record<MusicStinger, { src: string; volume: number; minGapMs: number }> = {
  notification: { src: 'music/hover.mp3', volume: 0.6, minGapMs: 800 },
  fanfare: { src: 'music/victory.mp3', volume: 0.8, minGapMs: 1000 },
};

/* Seconds for a full crossfade; entering a battle cuts in faster. */
const CROSSFADE_S = 2.5;
const BATTLE_FADE_S = 1.2;
/* Background level while a stinger plays, so the stinger reads clearly. */
const DUCK_LEVEL = 0.35;
const TICK_MS = 50;

/*
 * =========================================================
 * MUSIC SERVICE — background music with crossfades, event stingers
 * =========================================================
 *
 * Screens declare their scene (setScene): MainMenu → title, StarMap →
 * space (galaxy and system view) or planet (surface view, through its
 * currentView setter), BattleScreenComponent → battle. Every scene owns
 * one looping <audio> element (public/music/*.mp3); a timer moves each
 * element's volume toward its target (the active scene at the music
 * volume, all others at 0), so changing scenes is always a crossfade,
 * also when the scene changes again mid-fade. A track that has faded
 * out is paused, keeping its position (space / planet resume; title and
 * battle restart, see SCENE_TRACKS).
 *
 * Stingers (playStinger) are one-shots over the music, which is ducked
 * while they play: `notification` for every map notice, `fanfare` for
 * the victory popup, the battle result popup (wins only), the Diplomacy
 * screen and exploration events.
 * stopStinger('fanfare') fades it out when its popup closes. Stingers
 * follow the UI SOUNDS toggle (UiSoundService); the music has its own
 * MUSIC toggle and volume (localStorage, not in saves).
 *
 * Browsers block audio until a user gesture: a refused play() is retried
 * on the next pointerdown / keydown. Under jsdom (the unit tests) media
 * playback does not exist, so the service stays silent and creates no
 * elements.
 */
@Injectable({ providedIn: 'root' })
export class MusicService {
  private readonly uiSound = inject(UiSoundService);

  private readonly _enabled = signal(true);
  readonly enabled = this._enabled.asReadonly();
  private readonly _volume = signal(0.5);
  readonly volume = this._volume.asReadonly();

  // Not readonly: specs switch it on with a fake Audio.
  private available =
    typeof Audio !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);

  private scene: MusicScene | null = null;
  private readonly tracks = new Map<MusicScene, HTMLAudioElement>();
  private readonly levels = new Map<MusicScene, number>();
  private readonly stingers = new Map<MusicStinger, HTMLAudioElement>();
  private readonly stingerLastPlayed: Partial<Record<MusicStinger, number>> = {};
  private readonly fadingStingers = new Set<MusicStinger>();
  private fadeSeconds = CROSSFADE_S;
  private timer: ReturnType<typeof setInterval> | null = null;
  private waitingForGesture = false;

  constructor() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { enabled?: unknown; volume?: unknown } | null;
      if (typeof stored?.enabled === 'boolean') this._enabled.set(stored.enabled);
      if (typeof stored?.volume === 'number' && stored.volume >= 0 && stored.volume <= 1) this._volume.set(stored.volume);
    } catch {
      // Keep the defaults.
    }
  }

  setEnabled(enabled: boolean): void {
    this._enabled.set(enabled);
    this.persist();
    this.startTimer();
  }

  toggle(): void {
    this.setEnabled(!this._enabled());
  }

  setVolume(volume: number): void {
    this._volume.set(Math.max(0, Math.min(1, volume)));
    this.persist();
    this.startTimer();
  }

  /* Declares the scene of the current screen; repeated calls are cheap. */
  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.fadeSeconds = scene === 'battle' ? BATTLE_FADE_S : CROSSFADE_S;
    if (!this.available) return;
    const el = this.track(scene);
    if (SCENE_TRACKS[scene].restartOnEnter && (this.levels.get(scene) ?? 0) === 0) {
      el.currentTime = 0;
    }
    this.startTimer();
  }

  playStinger(stinger: MusicStinger): void {
    if (!this.available || !this.uiSound.enabled()) return;
    const now = performance.now();
    const config = STINGERS[stinger];
    if (now - (this.stingerLastPlayed[stinger] ?? -Infinity) < config.minGapMs) return;
    this.stingerLastPlayed[stinger] = now;
    let el = this.stingers.get(stinger);
    if (!el) {
      el = new Audio(config.src);
      el.preload = 'auto';
      el.addEventListener('ended', () => this.startTimer());
      this.stingers.set(stinger, el);
    }
    this.fadingStingers.delete(stinger);
    el.volume = config.volume;
    el.currentTime = 0;
    this.tryPlay(el);
    this.startTimer();
  }

  /* Fades a stinger out (its popup closed before it finished). */
  stopStinger(stinger: MusicStinger): void {
    const el = this.stingers.get(stinger);
    if (!el || el.paused) return;
    this.fadingStingers.add(stinger);
    this.startTimer();
  }

  private track(scene: MusicScene): HTMLAudioElement {
    let el = this.tracks.get(scene);
    if (!el) {
      el = new Audio(SCENE_TRACKS[scene].src);
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      this.tracks.set(scene, el);
      this.levels.set(scene, 0);
    }
    return el;
  }

  private stingerPlaying(): boolean {
    for (const [id, el] of this.stingers) {
      if (!el.paused && !el.ended && !this.fadingStingers.has(id)) return true;
    }
    return false;
  }

  private startTimer(): void {
    if (!this.available || this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /*
   * One fade step. Levels are 0..1 per track (crossfade position); the
   * element volume is level × music volume × duck. Stops itself once
   * every track has reached its target and no stinger is fading.
   */
  private tick(): void {
    const step = TICK_MS / 1000 / this.fadeSeconds;
    const duck = this.stingerPlaying() ? DUCK_LEVEL : 1;
    let settled = true;
    for (const [scene, el] of this.tracks) {
      const target = this._enabled() && scene === this.scene ? 1 : 0;
      let level = this.levels.get(scene) ?? 0;
      if (level !== target) {
        level = target > level ? Math.min(target, level + step) : Math.max(target, level - step);
        this.levels.set(scene, level);
        settled = false;
      }
      const volume = level * this._volume() * duck;
      if (Math.abs(el.volume - volume) > 0.001) {
        // Duck changes glide too, instead of jumping.
        el.volume = Math.abs(el.volume - volume) < 0.02 ? volume : el.volume + (volume - el.volume) * 0.25;
        settled = false;
      }
      if (level > 0 && el.paused) this.tryPlay(el);
      if (level === 0 && !el.paused) el.pause();
    }
    for (const id of this.fadingStingers) {
      const el = this.stingers.get(id)!;
      el.volume = Math.max(0, el.volume - STINGERS[id].volume * (TICK_MS / 600));
      if (el.volume === 0) {
        el.pause();
        this.fadingStingers.delete(id);
      } else {
        settled = false;
      }
    }
    if (this.stingerPlaying()) settled = false;
    if (settled && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tryPlay(el: HTMLAudioElement): void {
    const result = el.play();
    if (result && typeof result.catch === 'function') {
      result.catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'NotAllowedError') this.waitForGesture();
      });
    }
  }

  /* Autoplay was refused: retry the active track on the next user gesture. */
  private waitForGesture(): void {
    if (this.waitingForGesture) return;
    this.waitingForGesture = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('keydown', retry, true);
      this.waitingForGesture = false;
      const el = this.scene ? this.tracks.get(this.scene) : undefined;
      if (el && el.paused && (this.levels.get(this.scene!) ?? 0) > 0) this.tryPlay(el);
      this.startTimer();
    };
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('keydown', retry, true);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: this._enabled(), volume: this._volume() }));
    } catch {
      // Storage unavailable: the choice lasts for this session.
    }
  }
}

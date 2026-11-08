import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MusicService } from './music.service';

/* Minimal HTMLAudioElement stand-in: records play/pause and volume. */
class FakeAudio {
  static created: FakeAudio[] = [];
  volume = 1;
  loop = false;
  preload = '';
  currentTime = 0;
  paused = true;
  ended = false;
  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(): void {}
}

describe('MusicService', () => {
  let music: MusicService;
  const audio = (file: string) => FakeAudio.created.find((a) => a.src.endsWith(file))!;

  beforeEach(() => {
    localStorage.removeItem('orion_music');
    FakeAudio.created = [];
    vi.useFakeTimers();
    vi.stubGlobal('Audio', FakeAudio);
    music = TestBed.inject(MusicService);
    (music as unknown as { available: boolean }).available = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem('orion_music');
  });

  it('crossfades from the space track to the battle track and pauses the old one', () => {
    music.setScene('space');
    vi.advanceTimersByTime(5000);
    expect(audio('sector.mp3').paused).toBe(false);
    expect(audio('sector.mp3').volume).toBeCloseTo(0.5, 2);

    music.setScene('battle');
    vi.advanceTimersByTime(300);
    // Mid-fade both tracks are audible.
    expect(audio('urgent.mp3').volume).toBeGreaterThan(0);
    expect(audio('sector.mp3').volume).toBeGreaterThan(0);

    vi.advanceTimersByTime(5000);
    expect(audio('urgent.mp3').volume).toBeCloseTo(0.5, 2);
    expect(audio('sector.mp3').volume).toBe(0);
    expect(audio('sector.mp3').paused).toBe(true);
  });

  it('fades out when switched off and remembers the settings', () => {
    music.setScene('planet');
    vi.advanceTimersByTime(5000);
    music.setVolume(0.8);
    music.toggle();
    vi.advanceTimersByTime(5000);
    expect(audio('airy.mp3').paused).toBe(true);
    expect(JSON.parse(localStorage.getItem('orion_music')!)).toEqual({ enabled: false, volume: 0.8 });
  });

  it('ducks the music while a stinger plays', () => {
    music.setScene('space');
    vi.advanceTimersByTime(5000);
    music.playStinger('notification');
    vi.advanceTimersByTime(1000);
    expect(audio('hover.mp3').paused).toBe(false);
    expect(audio('sector.mp3').volume).toBeCloseTo(0.5 * 0.35, 2);
  });
});

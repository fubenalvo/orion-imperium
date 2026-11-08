import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UiSoundService } from './ui-sound.service';

describe('UiSoundService', () => {
  beforeEach(() => {
    localStorage.removeItem('orion_ui_sounds');
    TestBed.configureTestingModule({});
  });
  afterEach(() => localStorage.removeItem('orion_ui_sounds'));

  it('is on by default and remembers the toggle', () => {
    const sounds = TestBed.inject(UiSoundService);
    expect(sounds.enabled()).toBe(true);
    sounds.toggle();
    expect(sounds.enabled()).toBe(false);
    expect(localStorage.getItem('orion_ui_sounds')).toBe('false');
  });

  it('reads the stored preference', () => {
    localStorage.setItem('orion_ui_sounds', 'false');
    expect(TestBed.inject(UiSoundService).enabled()).toBe(false);
  });

  it('stays silent and harmless without Web Audio (before any gesture, or in tests)', () => {
    const sounds = TestBed.inject(UiSoundService);
    sounds.install(document);
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(() => {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      sounds.play('open');
    }).not.toThrow();
    button.remove();
  });
});

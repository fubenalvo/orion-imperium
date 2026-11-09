import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AiSettingsService } from './ai-settings.service';
import { isAdaptiveDifficultyEnabled, setAdaptiveDifficultyEnabled } from '../components/star-map/ai-difficulty';

describe('AiSettingsService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    setAdaptiveDifficultyEnabled(false);
  });

  it('turns ADAPTIVE AI on by default and applies it to the global switch', () => {
    const settings = new AiSettingsService();
    expect(settings.adaptive()).toBe(true);
    expect(isAdaptiveDifficultyEnabled()).toBe(true);
  });

  it('remembers the choice across instances and applies it at once', () => {
    new AiSettingsService().setAdaptive(false);
    expect(isAdaptiveDifficultyEnabled()).toBe(false);
    const reloaded = new AiSettingsService();
    expect(reloaded.adaptive()).toBe(false);
    expect(isAdaptiveDifficultyEnabled()).toBe(false);
    reloaded.toggleAdaptive();
    expect(isAdaptiveDifficultyEnabled()).toBe(true);
  });

  it('ignores an unreadable stored value', () => {
    localStorage.setItem('orion_ai_adaptive', 'not json');
    expect(new AiSettingsService().adaptive()).toBe(true);
  });
});

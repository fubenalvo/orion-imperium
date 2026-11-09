import { TestBed } from '@angular/core/testing';
import { CAMPAIGN_PROGRESS_KEY, CampaignProgressService } from './campaign-progress.service';
import { MissionDefinition } from './campaign.models';
import { M0_FIXTURE } from './missions/m0-fixture';

describe('CampaignProgressService', () => {
  let progress: CampaignProgressService;
  const record = (endingId: string, records = {}, researchedTechnologies: string[] = []) =>
    ({ endingId, difficulty: 'normal' as const, records, researchedTechnologies });

  beforeEach(() => {
    localStorage.clear();
    progress = TestBed.inject(CampaignProgressService);
  });

  afterEach(() => localStorage.clear());

  it('starts empty and records a victory', () => {
    expect(progress.load().missions).toEqual({});
    progress.recordCompletion('m1', record('a'));
    expect(progress.isCompleted('m1')).toBe(true);
    expect(progress.getRecord('m1')?.endingId).toBe('a');
  });

  it('quarantines a corrupt value and starts empty instead of failing', () => {
    localStorage.setItem(CAMPAIGN_PROGRESS_KEY, '{not json');
    expect(progress.load().missions).toEqual({});
    expect(localStorage.getItem('orion_campaign_corrupt_backup')).toBe('{not json');
  });

  it('drops malformed records but keeps the valid ones', () => {
    localStorage.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify({
      version: 1,
      lastDifficulty: 'hard',
      missions: { good: { ...record('x'), completedAt: 'now' }, bad: { endingId: 3 } },
    }));
    const loaded = progress.load();
    expect(Object.keys(loaded.missions)).toEqual(['good']);
    expect(loaded.lastDifficulty).toBe('hard');
  });

  it('unlocks a mission once its requirements are completed', () => {
    const second: MissionDefinition = { ...M0_FIXTURE, id: 'm2', requires: ['m1'] };
    expect(progress.isUnlocked(second)).toBe(false);
    progress.recordCompletion('m1', record('a'));
    expect(progress.isUnlocked(second)).toBe(true);
  });

  it('carries flags of every completed mission and the technologies of the required one; a replay replaces its record', () => {
    const third: MissionDefinition = { ...M0_FIXTURE, id: 'm3', requires: ['m2'], carryIn: { alignment: 'none', other: 1 } };
    progress.recordCompletion('m1', record('a', { alignment: 'concordium' }, ['t1']));
    progress.recordCompletion('m2', record('b', { charter: 'open' }, ['t1', 't2']));
    expect(progress.carryFor(third, ['m1', 'm2', 'm3'])).toEqual({
      flags: { alignment: 'concordium', other: 1, charter: 'open' },
      technologies: ['t1', 't2'],
    });
    progress.recordCompletion('m1', record('a2', { alignment: 'varkon' }, []));
    expect(progress.carryFor(third, ['m1', 'm2', 'm3']).flags['alignment']).toBe('varkon');
  });
});

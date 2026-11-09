import { Injectable } from '@angular/core';
import { AiDifficulty } from '../components/star-map/star-map.models';
import { CampaignProgress, FlagValue, MissionCarry, MissionDefinition, MissionRecord } from './campaign.models';

export const CAMPAIGN_PROGRESS_KEY = 'orion_campaign';
const CAMPAIGN_PROGRESS_BACKUP_KEY = 'orion_campaign_corrupt_backup';

/*
 * =========================================================
 * CAMPAIGN PROGRESS SERVICE
 * =========================================================
 *
 * Unlocks and results across missions, in its own localStorage key — not in
 * a save slot, because progress belongs to the player, not to one game
 * (docs/campaign-design.md §14). A mission start copies what it needs from
 * here into the new save (MissionCarry), so a running mission never depends
 * on progress written later (replaying an earlier mission cannot change a
 * mission already in progress).
 *
 * Only victories are recorded. A replayed mission replaces its record.
 * A corrupt value is quarantined to a backup key and progress starts empty.
 */
@Injectable({ providedIn: 'root' })
export class CampaignProgressService {
  load(): CampaignProgress {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(CAMPAIGN_PROGRESS_KEY);
    } catch {
      return emptyProgress();
    }
    if (!raw) return emptyProgress();
    try {
      const parsed = JSON.parse(raw) as Partial<CampaignProgress>;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.missions !== 'object' || parsed.missions === null) {
        throw new Error('malformed');
      }
      const missions: Record<string, MissionRecord> = {};
      for (const [id, record] of Object.entries(parsed.missions)) {
        if (isMissionRecord(record)) missions[id] = record;
      }
      return { version: 1, lastDifficulty: isDifficulty(parsed.lastDifficulty) ? parsed.lastDifficulty : 'normal', missions };
    } catch {
      try {
        localStorage.setItem(CAMPAIGN_PROGRESS_BACKUP_KEY, raw);
      } catch {
        // Quota: the backup is best effort.
      }
      return emptyProgress();
    }
  }

  getRecord(missionId: string): MissionRecord | undefined {
    return this.load().missions[missionId];
  }

  isCompleted(missionId: string): boolean {
    return this.getRecord(missionId) !== undefined;
  }

  isUnlocked(mission: MissionDefinition): boolean {
    const progress = this.load();
    return mission.requires.every((id) => progress.missions[id] !== undefined);
  }

  recordCompletion(missionId: string, record: Omit<MissionRecord, 'completedAt'>): boolean {
    const progress = this.load();
    progress.missions[missionId] = { ...record, completedAt: new Date().toISOString() };
    progress.lastDifficulty = record.difficulty;
    return this.write(progress);
  }

  setLastDifficulty(difficulty: AiDifficulty): void {
    const progress = this.load();
    progress.lastDifficulty = difficulty;
    this.write(progress);
  }

  /*
   * What a new start of `mission` takes from earlier missions: the flags of
   * every completed mission (later records override earlier ones, in
   * registry order), the mission's own defaults for flags nobody recorded,
   * and the technologies of the most recently required mission.
   */
  carryFor(mission: MissionDefinition, registryOrder: readonly string[]): MissionCarry {
    const progress = this.load();
    const flags: Record<string, FlagValue> = { ...(mission.carryIn ?? {}) };
    for (const id of registryOrder) {
      const record = progress.missions[id];
      if (record && id !== mission.id) Object.assign(flags, record.records);
    }
    const previous = [...mission.requires].reverse().map((id) => progress.missions[id]).find(Boolean);
    return { flags, technologies: previous ? [...previous.researchedTechnologies] : [] };
  }

  private write(progress: CampaignProgress): boolean {
    try {
      localStorage.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify(progress));
      return true;
    } catch {
      return false;
    }
  }
}

function emptyProgress(): CampaignProgress {
  return { version: 1, lastDifficulty: 'normal', missions: {} };
}

function isDifficulty(value: unknown): value is AiDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function isMissionRecord(value: unknown): value is MissionRecord {
  const r = value as MissionRecord;
  return !!r && typeof r === 'object'
    && typeof r.endingId === 'string'
    && typeof r.completedAt === 'string'
    && isDifficulty(r.difficulty)
    && typeof r.records === 'object' && r.records !== null
    && Array.isArray(r.researchedTechnologies) && r.researchedTechnologies.every((t) => typeof t === 'string');
}

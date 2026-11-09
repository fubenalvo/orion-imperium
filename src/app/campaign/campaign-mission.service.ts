import { Injectable } from '@angular/core';
import { AiDifficulty, StarMapData } from '../components/star-map/star-map.models';
import { MANUAL_SLOT_START, SaveGameService, TOTAL_SLOT_COUNT } from '../services/save-game.service';
import { validateSaveData } from '../services/save-validation';
import { MISSION_DEFINITIONS, getMissionDefinition } from './missions';
import { CampaignProgressService } from './campaign-progress.service';
import { MissionCarry } from './campaign.models';
import { buildMission } from './mission-builder';
import { validateMission } from './mission-validation';

export type MissionStartResult = { ok: true; data: StarMapData } | { ok: false; errors: string[] };

/*
 * =========================================================
 * CAMPAIGN MISSION SERVICE
 * =========================================================
 *
 * Starts a mission the way NewGameService starts a skirmish: validate →
 * build → validate the save → write it to the chosen manual slot → activate
 * the slot (autosave = live session). Only on success does the caller
 * navigate to /star-map, so a broken mission never becomes the session.
 */
@Injectable({ providedIn: 'root' })
export class CampaignMissionService {
  constructor(
    private readonly saveGameService: SaveGameService,
    private readonly progress: CampaignProgressService,
  ) {}

  /* Builds and validates without persisting (tests, previews). */
  createMission(missionId: string, difficulty: AiDifficulty, carry?: MissionCarry): MissionStartResult {
    const mission = getMissionDefinition(missionId);
    if (!mission) return { ok: false, errors: [`Unknown mission "${missionId}".`] };
    const missionErrors = validateMission(mission);
    if (missionErrors.length > 0) return { ok: false, errors: ['The mission data is invalid.', ...missionErrors] };
    const data = buildMission(mission, {
      difficulty,
      carry: carry ?? this.progress.carryFor(mission, MISSION_DEFINITIONS.map((m) => m.id)),
    });
    const saveCheck = validateSaveData(data);
    if (!saveCheck.ok) return { ok: false, errors: ['The mission could not be built.', ...saveCheck.errors.map((e) => e.message)] };
    return { ok: true, data };
  }

  startMission(missionId: string, difficulty: AiDifficulty, slotIndex: number, carry?: MissionCarry): MissionStartResult {
    if (!Number.isInteger(slotIndex) || slotIndex < MANUAL_SLOT_START || slotIndex >= TOTAL_SLOT_COUNT) {
      return { ok: false, errors: ['Select a save slot for the mission.'] };
    }
    const mission = getMissionDefinition(missionId);
    if (mission && !mission.devOnly && !carry && !this.progress.isUnlocked(mission)) {
      return { ok: false, errors: ['This mission is not unlocked yet.'] };
    }
    const result = this.createMission(missionId, difficulty, carry);
    if (!result.ok) return result;
    this.progress.setLastDifficulty(difficulty);
    if (!this.saveGameService.saveToSlot(slotIndex, result.data)) {
      return { ok: false, errors: [`Could not save the mission (${this.saveGameService.lastError ?? 'storage error'}).`] };
    }
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return { ok: false, errors: [`Could not start the mission (${this.saveGameService.lastError ?? 'activation failed'}).`] };
    }
    return result;
  }

  /*
   * RESTART MISSION: rebuilds the running mission from its definition with
   * the same difficulty and the same carry it started with, into autosave.
   */
  restartFromSave(current: StarMapData): MissionStartResult {
    const session = current.campaign;
    if (!session) return { ok: false, errors: ['This game is not a campaign mission.'] };
    const result = this.createMission(session.missionId, session.difficulty, session.carry);
    if (!result.ok) return result;
    if (!this.saveGameService.saveToSlot(0, result.data) || !this.saveGameService.activateSlot(0)) {
      return { ok: false, errors: [`Could not restart the mission (${this.saveGameService.lastError ?? 'storage error'}).`] };
    }
    return result;
  }
}

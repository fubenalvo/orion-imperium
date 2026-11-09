import { Component, EventEmitter, Input, OnInit, Output, isDevMode } from '@angular/core';
import { AiDifficulty } from '../../components/star-map/star-map.models';
import { AI_DIFFICULTIES, AI_DIFFICULTY_PROFILES } from '../../components/star-map/ai-difficulty';
import { MANUAL_SLOT_START, SaveSlot } from '../../services/save-game.service';
import { CampaignProgressService } from '../../campaign/campaign-progress.service';
import { MissionDefinition } from '../../campaign/campaign.models';
import { MISSION_DEFINITIONS } from '../../campaign/missions';

export interface CampaignStartRequest {
  missionId: string;
  difficulty: AiDifficulty;
  slotIndex: number;
}

export type MissionCardStatus = 'locked' | 'available' | 'completed';

export interface MissionCardVm {
  mission: MissionDefinition;
  number: number;
  status: MissionCardStatus;
  /* Title of the ending the player reached (completed missions). */
  endingTitle: string | null;
}

/*
 * Campaign screen (docs/campaign-design.md §12, UI). Hosted in the main
 * menu's sheet like NewGameSetupComponent: it shows the missions with their
 * status, the selected mission's briefing, difficulty and save slot, and
 * emits a start request; MainMenu runs CampaignMissionService and navigates.
 *
 * Developer missions (`devOnly`) are listed only in dev mode, so the engine
 * fixture can be played from `ng serve` but never appears in a release.
 */
@Component({
  selector: 'app-campaign-screen',
  templateUrl: './campaign-screen.component.html',
  styleUrl: './campaign-screen.component.scss',
})
export class CampaignScreenComponent implements OnInit {
  @Input() slots: SaveSlot[] = [];
  @Input() startError: string[] = [];
  @Input() starting = false;
  /* Mission to select on open (NEXT MISSION from a debrief). */
  @Input() initialMissionId: string | null = null;

  @Output() start = new EventEmitter<CampaignStartRequest>();
  @Output() cancel = new EventEmitter<void>();

  cards: MissionCardVm[] = [];
  selectedId: string | null = null;
  difficulty: AiDifficulty = 'normal';
  slotIndex: number = MANUAL_SLOT_START;

  readonly difficulties = AI_DIFFICULTIES.map((id) => AI_DIFFICULTY_PROFILES[id]);

  constructor(private readonly progress: CampaignProgressService) {}

  ngOnInit(): void {
    this.difficulty = this.progress.load().lastDifficulty;
    this.cards = this.buildCards(isDevMode());
    const firstEmpty = this.manualSlots.find((s) => !s.slot.data);
    this.slotIndex = firstEmpty?.index ?? MANUAL_SLOT_START;
    const initial = this.cards.find((c) => c.mission.id === this.initialMissionId && c.status !== 'locked');
    // Default: the requested mission, else the first one not yet completed, else the first.
    this.selectedId = (initial ?? this.cards.find((c) => c.status === 'available') ?? this.cards[0])?.mission.id ?? null;
  }

  /* Story missions in campaign order; developer missions after them (dev builds only). */
  buildCards(includeDevMissions: boolean): MissionCardVm[] {
    const missions = MISSION_DEFINITIONS.filter((m) => includeDevMissions || !m.devOnly);
    const story = missions.filter((m) => !m.devOnly);
    return missions.map((mission) => {
      const record = this.progress.getRecord(mission.id);
      const status: MissionCardStatus = record ? 'completed' : this.progress.isUnlocked(mission) ? 'available' : 'locked';
      return {
        mission,
        number: mission.devOnly ? 0 : story.indexOf(mission) + 1,
        status,
        endingTitle: record ? mission.endings.find((e) => e.id === record.endingId)?.title ?? null : null,
      };
    });
  }

  get selected(): MissionCardVm | null {
    return this.cards.find((c) => c.mission.id === this.selectedId) ?? null;
  }

  get manualSlots(): { index: number; slot: SaveSlot }[] {
    return this.slots.map((slot, index) => ({ index, slot })).filter((s) => s.index >= MANUAL_SLOT_START);
  }

  get selectedSlotHasSave(): boolean {
    return !!this.slots[this.slotIndex]?.data;
  }

  /* Technologies the selected mission would take over from the previous one. */
  get carriedTechnologyCount(): number {
    const mission = this.selected?.mission;
    if (!mission) return 0;
    const carried = this.progress.carryFor(mission, MISSION_DEFINITIONS.map((m) => m.id)).technologies;
    const horizon = new Set(mission.researchHorizon);
    return carried.filter((id) => horizon.has(id)).length;
  }

  get canStart(): boolean {
    return !this.starting && !!this.selected && this.selected.status !== 'locked';
  }

  select(card: MissionCardVm): void {
    if (card.status === 'locked') return;
    this.selectedId = card.mission.id;
  }

  setDifficulty(difficulty: AiDifficulty): void {
    this.difficulty = difficulty;
  }

  setSlot(event: Event): void {
    this.slotIndex = Number((event.target as HTMLSelectElement).value);
  }

  statusLabel(card: MissionCardVm): string {
    if (card.mission.devOnly) return 'DEV';
    if (card.status === 'completed') return 'COMPLETED';
    return card.status === 'locked' ? 'LOCKED' : 'AVAILABLE';
  }

  formatSlotDate(date: string | null): string {
    return date ? new Date(date).toLocaleString() : 'Empty';
  }

  onStart(): void {
    if (!this.canStart || !this.selectedId) return;
    this.start.emit({ missionId: this.selectedId, difficulty: this.difficulty, slotIndex: this.slotIndex });
  }
}

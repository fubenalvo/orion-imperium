import { MissionDefinition } from '../campaign.models';
import { M0_FIXTURE } from './m0-fixture';
import { M1_DISCOVERY } from './m1-discovery';
import { M2_BEYOND_THE_GATE } from './m2-beyond-the-gate';
import { M3_FIRST_CONTACT } from './m3-first-contact';
import { M4_MERIDIAN_EXCHANGE } from './m4-meridian-exchange';
import { M5_BORDER_CONFLICT } from './m5-border-conflict';
import { M6_SILENT_REMNANT } from './m6-silent-remnant';

/*
 * The mission registry: every mission the game knows, in campaign order.
 * A saved session refers to its mission by id; CampaignService looks the
 * definition up here on every load.
 */
export const MISSION_DEFINITIONS: readonly MissionDefinition[] = [M1_DISCOVERY, M2_BEYOND_THE_GATE, M3_FIRST_CONTACT, M4_MERIDIAN_EXCHANGE, M5_BORDER_CONFLICT, M6_SILENT_REMNANT, M0_FIXTURE];

/* Extra definitions registered by unit tests only; never used by the game. */
const testMissions: MissionDefinition[] = [];

export function registerTestMission(mission: MissionDefinition): void {
  testMissions.push(mission);
}

export function clearTestMissions(): void {
  testMissions.length = 0;
}

export function getMissionDefinition(id: string): MissionDefinition | undefined {
  return MISSION_DEFINITIONS.find((m) => m.id === id) ?? testMissions.find((m) => m.id === id);
}

/* The story campaign as the player sees it (developer missions excluded). */
export function campaignMissions(): MissionDefinition[] {
  return MISSION_DEFINITIONS.filter((m) => !m.devOnly);
}

/* "Campaign · <mission>" for save slot lists; null for a non-campaign save. */
export function campaignSlotLabel(data: { campaign?: { missionId: string } } | null | undefined): string | null {
  const missionId = data?.campaign?.missionId;
  if (!missionId) return null;
  return `Campaign · ${getMissionDefinition(missionId)?.title ?? missionId}`;
}

import { MissionDefinition } from '../campaign.models';
import { M0_FIXTURE } from './m0-fixture';

/*
 * The mission registry: every mission the game knows, in campaign order.
 * A saved session refers to its mission by id; CampaignService looks the
 * definition up here on every load.
 */
export const MISSION_DEFINITIONS: readonly MissionDefinition[] = [M0_FIXTURE];

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

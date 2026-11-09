import { MissionDefinition } from '../campaign.models';

/*
 * Developer fixture mission: the smallest map that exercises the whole
 * campaign engine (build, start, objectives, events, endings, save/load,
 * battle return). Not part of the story campaign (`devOnly`); the campaign
 * screen hides it. Tests rely on its exact content — change them together.
 */
export const M0_FIXTURE: MissionDefinition = {
  id: 'm0_fixture',
  version: 1,
  devOnly: true,
  title: 'Proving Ground',
  subtitle: 'Campaign engine fixture',
  briefing: ['A two-system test range for the campaign engine.'],
  seed: 20261109,
  requires: [],
  rules: { standardVictory: false, pirates: false },
  map: {
    width: 100,
    height: 60,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 2000, rawmaterials: 2500, research: 1000 },
      },
      {
        id: 'remnant',
        name: 'Remnant Sentinels',
        color: '#9b7bd8',
        kind: 'outlaw',
        currencies: { credits: 0, rawmaterials: 0, research: 0 },
      },
    ],
    systems: [
      {
        id: 'sol',
        name: 'Sol',
        x: 25,
        y: 32,
        color: '#ffcc00',
        planets: [
          { name: 'Earth', type: 'earthlike', size: 'big', owner: 'player', population: 1200, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Mars', type: 'marslike', size: 'small', explored: true },
        ],
      },
      {
        id: 'proxima',
        name: 'Proxima',
        x: 70,
        y: 26,
        color: '#d65757',
        planets: [{ name: 'Proxima b', type: 'ice', size: 'small' }],
      },
    ],
    fleets: [
      { name: 'ORION', factionId: 'player', atPlanet: 'Earth', ships: ['scout', 'scout', 'fighter'], speed: 8 },
      { name: 'SENTINEL', factionId: 'remnant', x: 72, y: 28, ships: ['fighter'], tag: 'sentinel' },
    ],
    relations: [],
    defaultView: { systemId: 'sol', planetName: 'Earth' },
  },
  researchHorizon: [
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
  ],
  baselineTechnologies: [],
  objectives: [
    {
      id: 'chart_proxima',
      title: 'Scout Proxima',
      condition: { kind: 'system_charted', systemId: 'proxima' },
      onComplete: [{ kind: 'notice', text: 'Proxima charted.' }, { kind: 'flag', flag: 'proxima_charted', value: true }],
    },
    {
      id: 'destroy_sentinel',
      title: 'Destroy the sentinel',
      after: ['chart_proxima'],
      condition: { kind: 'fleet_tag_destroyed', tag: 'sentinel' },
      onComplete: [{ kind: 'event', eventId: 'sentinel_down' }],
    },
    {
      id: 'research_radar',
      title: 'Research Basic Radar',
      optional: true,
      condition: { kind: 'technology', technologyId: 'basic_radar' },
      onComplete: [{ kind: 'resources', factionId: 'player', credits: 500 }],
    },
  ],
  events: [
    { id: 'welcome', trigger: { kind: 'game_time_at_least', seconds: 1 }, speaker: 'narrator', title: 'Proving Ground', text: 'The range is live.', pause: false },
    {
      id: 'sentinel_down',
      speaker: 'narrator',
      title: 'Sentinel destroyed',
      text: 'The range is clear. Report back?',
      pause: true,
      choices: [{ id: 'report', label: 'Report back', consequences: 'Ends the test.', effects: [{ kind: 'end_mission', endingId: 'cleared' }] }],
    },
  ],
  endings: [
    { id: 'cleared', title: 'Range Cleared', debrief: 'The engine works.', condition: { kind: 'flag', flag: 'never_set' }, records: { m0_cleared: true } },
  ],
  defeat: [{ condition: { kind: 'flag', flag: 'force_defeat' }, reason: 'Test defeat.' }],
};

import { MissionDefinition } from '../campaign.models';

/*
 * Mission 2 — Beyond the Gate (docs/campaign-design.md §6, §7).
 *
 * Exploration, colonization and the first neutral contact; still no AI
 * empire. Two tracks run in parallel — settle (population, colonies) and
 * explore (chart systems, find Tessaly Hold, start trading) — and the
 * finale is decoding the relay at Far Echo, which a Remnant drone guards.
 *
 * Map rules this data relies on (m2-beyond-the-gate.spec.ts):
 * - Tessaly is hidden (StarSystem.explored false) inside the Shroud nebula;
 *   the Echo Beacon in open space charts it, or a fleet finds it;
 * - one belt splits the west from Tessaly: the routes go north around it
 *   through the Shroud (slow, hidden) or south past Sunder Drift;
 * - Sunder Drift's in-system belt holds the map's large deposits (the
 *   mining-station lesson);
 * - Tessaly Hold is an independent civilization with the region's only
 *   Trading Post: a player Trading Post makes trade possible at all.
 *
 * League standing (`league_standing`) is a campaign value, not a faction
 * opinion: civilizations have no diplomacy (docs/campaign-design.md §10).
 */

const TESSALY = { x: 112, y: 22 };
const FAR_ECHO = { x: 118, y: 64 };

export const M2_BEYOND_THE_GATE: MissionDefinition = {
  id: 'm2_beyond_the_gate',
  version: 1,
  title: 'Beyond the Gate',
  subtitle: 'Stranded, and not alone',
  briefing: [
    'The expedition emerged at Threshold and founded Landfall. Then the gate went dark behind it.',
    'Grow the colony, chart the region and find out who else is out here.',
  ],
  seed: 1_202_612,
  requires: ['m1_discovery'],
  rules: { standardVictory: false, pirates: false },
  tutorialExcludedSteps: ['diplomacy'],
  map: {
    width: 140,
    height: 84,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 2000, rawmaterials: 2500, research: 800 },
      },
      {
        id: 'remnant',
        name: 'Remnant Sentinels',
        color: '#b07cff',
        kind: 'outlaw',
        currencies: { credits: 0, rawmaterials: 0, research: 0 },
      },
    ],
    systems: [
      {
        id: 'threshold',
        name: 'Threshold',
        x: 20,
        y: 44,
        color: '#ffcc00',
        planets: [
          { name: 'Landfall', type: 'earthlike', size: 'medium', owner: 'player', population: 800, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Ashfall', type: 'marslike', size: 'small', explored: true },
        ],
      },
      {
        id: 'cinder',
        name: 'Cinder',
        x: 44,
        y: 20,
        color: '#d65757',
        planets: [
          { name: 'Cinder Prime', type: 'desert', size: 'medium' },
          { name: 'Cinder Rime', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'veyl',
        name: 'Veyl',
        x: 52,
        y: 62,
        color: '#39b8a8',
        planets: [
          { name: 'Veyl', type: 'venuslike', size: 'medium' },
          { name: 'Veyl Major', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'sunder_drift',
        name: 'Sunder Drift',
        x: 80,
        y: 44,
        color: '#f3f3f3',
        planets: [{ name: 'Sunder', type: 'desert', size: 'tiny' }],
        richAsteroids: [18_000, 15_000, 12_000],
      },
      {
        id: 'tessaly',
        name: 'Tessaly',
        x: TESSALY.x,
        y: TESSALY.y,
        color: '#5ca8ff',
        hidden: true,
        planets: [
          {
            name: 'Tessaly Hold', type: 'earthlike', size: 'big', owner: 'independent', civilization: 'Tessaly Hold',
            population: 800, satisfaction: 60, layout: 'civilization_capital',
          },
          { name: 'Tessaly Minor', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'far_echo',
        name: 'Far Echo',
        x: FAR_ECHO.x,
        y: FAR_ECHO.y,
        color: '#888888',
        planets: [{ name: 'Echo', type: 'ice', size: 'tiny' }],
      },
    ],
    fleets: [
      { name: 'EXPEDITION', factionId: 'player', atPlanet: 'Landfall', ships: ['fighter', 'fighter', 'scout'], speed: 8 },
      { name: 'WARDEN', factionId: 'remnant', x: FAR_ECHO.x, y: FAR_ECHO.y, ships: ['fighter', 'fighter', 'fighter'], tag: 'echo_sentinel' },
    ],
    nebulae: [
      { id: 1, x: 102, y: 16, radius: 15, lobes: [1, 0.86, 1.12, 0.94, 1.2, 0.9, 1.05, 0.8, 1.15, 0.98, 1.08], rotation: 0.4, color: '#7c5cd6' },
      { id: 2, x: 56, y: 66, radius: 11, lobes: [1.05, 0.9, 1.18, 0.84, 1, 1.12, 0.92, 1.08, 0.88], rotation: 1.9, color: '#3fa5a0' },
    ],
    asteroidBelts: [{ id: 1, points: [{ x: 66, y: 10 }, { x: 70, y: 38 }], halfWidth: 2, visualSeed: 11 }],
    wormholes: [{ id: 'threshold_gate', name: 'Threshold Gate (dormant)', mouths: [{ x: 13, y: 38 }], state: 'dormant' }],
    anomalies: [
      { key: 'm2_echo', type: 'echo_beacon', x: 64, y: 52 },
      { key: 'm2_relay', type: 'relay_signal', systemId: 'far_echo' },
    ],
    relations: [],
    defaultView: { systemId: 'threshold', planetName: 'Landfall' },
  },
  researchHorizon: [
    // Mission 1
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
    // New in Mission 2
    'advanced_construction', 'advanced_industry', 'colonization_technology', 'advanced_radar',
    'turret_research_1', 'corvette_technology', 'frigate_technology',
  ],
  baselineTechnologies: ['basic_radar'],
  objectives: [
    // Track A — settle
    {
      id: 'grow_population',
      title: 'Grow your population to 1,500',
      description: 'Housing is the growth building; Medium Residential Blocks need Advanced Construction.',
      condition: { kind: 'population_at_least', value: 1500 },
      progress: { label: 'Population', metric: 'population', target: 1500 },
    },
    {
      id: 'found_colonies',
      title: 'Settle 3 planets',
      description: 'Landfall and two new colonies: build Colonizers and settle planets in the region.',
      condition: { kind: 'planets_owned', count: 3 },
      progress: { label: 'Planets', metric: 'planets_owned', target: 3 },
    },
    // Track B — explore
    {
      id: 'chart_region',
      title: 'Chart 5 of the 6 systems',
      description: 'Systems count once your sensors have seen them.',
      condition: { kind: 'systems_charted', count: 5 },
      progress: { label: 'Systems', metric: 'systems_charted', target: 5 },
    },
    {
      id: 'contact_tessaly',
      title: 'Find who else is out here',
      description: 'Something in the north-eastern nebula is sending signals.',
      condition: { kind: 'flag', flag: 'm2_tessaly_met' },
    },
    {
      id: 'open_trade',
      title: 'Trade with Tessaly Hold',
      description: 'Build a Trading Post: traders fly between posts and pay their owners. Or win their trust.',
      after: ['contact_tessaly'],
      condition: {
        kind: 'any',
        of: [
          { kind: 'value_at_least', key: 'trade_income', value: 3000 },
          { kind: 'value_at_least', key: 'league_standing', value: 30 },
        ],
      },
      progress: { label: 'Trade income', metric: { value: 'trade_income' }, target: 3000 },
    },
    // Finale
    {
      id: 'decode_relay',
      title: 'Decode the relay at Far Echo',
      description: 'A Remnant warden guards it.',
      after: ['grow_population', 'found_colonies', 'chart_region', 'open_trade'],
      condition: { kind: 'flag', flag: 'm2_relay_decoded' },
      onComplete: [{ kind: 'end_mission', endingId: 'first_signal' }],
    },
    // Optional
    {
      id: 'trading_post',
      title: 'Build a Trading Post',
      optional: true,
      condition: { kind: 'building_complete', buildingId: 'trading_post' },
      onComplete: [{ kind: 'value', key: 'league_standing', delta: 10 }, { kind: 'notice', text: 'Tessaly Hold welcomes a new trading partner. League standing +10.' }],
    },
    {
      id: 'mine_sunder',
      title: 'Build a mining station at Sunder Drift',
      description: 'Outpost ships deploy stations on surveyed asteroids; Sunder Drift is rich.',
      optional: true,
      condition: { kind: 'mining_station', systemId: 'sunder_drift' },
    },
    {
      id: 'clear_far_echo',
      title: 'Destroy the warden at Far Echo',
      optional: true,
      condition: { kind: 'fleet_tag_destroyed', tag: 'echo_sentinel' },
      onComplete: [{ kind: 'value', key: 'league_standing', delta: 10 }, { kind: 'notice', text: 'Tessaly traders can fly past Far Echo again. League standing +10.' }],
    },
    {
      id: 'advanced_radar',
      title: 'Research Advanced Radar',
      optional: true,
      condition: { kind: 'technology', technologyId: 'advanced_radar' },
    },
  ],
  events: [
    {
      id: 'landfall',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'narrator',
      speakerName: 'Landfall Command',
      title: 'The Gate Is Dark',
      text:
        'The gate collapsed behind the expedition. No signal reaches Sol any more. ' +
        'Landfall is all we have: grow it, chart this region and find out who else is out here.',
      pause: true,
    },
    {
      id: 'tessaly_contact',
      trigger: { kind: 'fleet_at', x: TESSALY.x, y: TESSALY.y, radius: 3 },
      speaker: 'independent',
      speakerName: 'Tessaly Hold',
      speakerColor: '#ffcc00',
      title: 'First Contact',
      text:
        'A calm voice answers on an open channel: "Tessaly Hold greets the newcomers. We trade with anyone who comes in peace, ' +
        'as the Meridian League taught us. What brings you to the Shroud?"',
      pause: true,
      choices: [
        {
          id: 'friendship',
          label: 'Offer friendship and our star charts',
          consequences: 'League standing +20',
          effects: [{ kind: 'value', key: 'league_standing', delta: 20 }, { kind: 'flag', flag: 'm2_tessaly_met', value: 'friendship' }],
        },
        {
          id: 'trade',
          label: 'Ask about trade',
          consequences: 'League standing +10, +500 credits (a welcome gift)',
          effects: [
            { kind: 'value', key: 'league_standing', delta: 10 },
            { kind: 'resources', factionId: 'player', credits: 500 },
            { kind: 'flag', flag: 'm2_tessaly_met', value: 'trade' },
          ],
        },
        {
          id: 'distance',
          label: 'Keep our distance',
          consequences: 'No standing',
          effects: [{ kind: 'flag', flag: 'm2_tessaly_met', value: 'distance' }],
        },
      ],
    },
    {
      id: 'warden_sighted',
      trigger: { kind: 'system_charted', systemId: 'far_echo' },
      speaker: 'narrator',
      speakerName: 'Landfall Command',
      title: 'Far Echo',
      text: 'A Remnant warden holds Far Echo, next to an ancient relay that is still transmitting.',
      pause: false,
    },
  ],
  endings: [
    {
      id: 'first_signal',
      title: 'The First Signal',
      debrief: 'Landfall stands, Tessaly Hold trades with us, and the relay carried a name: the Concordium.',
      condition: { kind: 'objective_done', id: 'decode_relay' },
      recordFlags: ['m2_tessaly_met'],
      recordValues: ['league_standing'],
    },
  ],
};

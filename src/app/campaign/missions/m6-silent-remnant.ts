import { Condition, Effect, MissionDefinition } from '../campaign.models';

/*
 * Mission 6 — The Silent Remnant (docs/campaign-design.md §6, §7).
 *
 * A race for three Remnant archives (campaign sites, campaign-sites.ts),
 * each guarded by a Remnant platform (an outlaw space base). Holding an
 * archive for 90 s with no hostile fleet or base in range claims it and
 * grants its ancient technology (`ancient` in research-tree.json: owned
 * only through a claim, never researchable). Two archives open the Lacuna
 * core; opening it reveals Stellar Engineering and ends the mission.
 *
 * - The AI races through EnemyCampaignService directives: Varkon early and
 *   bold (archive II from minute 5, then I from 25 and III from 30), the
 *   Concordium late and cautious (archive I from minute 20, only with a
 *   comfortable forecast),
 *   the Meridian League not at all — it offers to buy the player's surveys.
 * - The archives form a triangle, each nearer one rival: I north (the
 *   Concordium), II south-east inside a nebula (Varkon), III west behind a
 *   belt (the player). m6-silent-remnant.spec.ts checks the race is fair.
 * - Defeat: two archives in AI hands (the core can no longer be opened), or
 *   the core claimed by anyone else.
 *
 * Carry-over: `m6_shared_with` (the choice at the core), `site:<archive>`
 * (who holds which archive), and the technologies owned, ancient ones
 * included.
 */

const ARCHIVES = ['archive_1', 'archive_2', 'archive_3'];
const ARCHIVE_I = { x: 124, y: 36 };
const ARCHIVE_II = { x: 200, y: 128 };
const ARCHIVE_III = { x: 80, y: 94 };
const LACUNA = { x: 140, y: 82 };
const LACUNA_GATE = { x: 146, y: 88 };

const CORE_OPEN: Condition = { kind: 'site_claimed', siteId: 'lacuna_core', factionId: 'player' };
const share = (value: string): Effect[] => [
  { kind: 'flag', flag: 'm6_shared_with', value },
  { kind: 'end_mission', endingId: 'm6_core' },
];

export const M6_SILENT_REMNANT: MissionDefinition = {
  id: 'm6_silent_remnant',
  version: 1,
  title: 'The Silent Remnant',
  subtitle: 'Who switched the network off, and why',
  briefing: [
    'An abandoned research station drifts over Lacuna, in the middle of the Frontier. It was built by the same hands as the gates.',
    'Find out what it guards. Every empire on the Frontier is already on its way.',
  ],
  seed: 1_606_449,
  requires: ['m5_border_conflict'],
  rules: { standardVictory: false, pirates: false },
  carryIn: { m5_role: 'none' },
  sites: [
    {
      id: 'archive_1', name: 'Archive I', x: ARCHIVE_I.x, y: ARCHIVE_I.y, radius: 1, holdSeconds: 90, minWarships: 2,
      grantTechnology: 'remnant_sensor_lattice',
    },
    {
      id: 'archive_2', name: 'Archive II', x: ARCHIVE_II.x, y: ARCHIVE_II.y, radius: 1, holdSeconds: 90, minWarships: 2,
      grantTechnology: 'remnant_shield_matrix',
    },
    {
      id: 'archive_3', name: 'Archive III', x: ARCHIVE_III.x, y: ARCHIVE_III.y, radius: 1, holdSeconds: 90, minWarships: 2,
      grantTechnology: 'remnant_drive',
    },
    {
      id: 'lacuna_core', name: 'Lacuna Core', x: LACUNA.x, y: LACUNA.y, radius: 1, holdSeconds: 90, minWarships: 1,
      grantTechnology: 'remnant_aegis_grid',
      activeWhen: { kind: 'sites_claimed', siteIds: ARCHIVES, count: 2 },
      onClaim: {
        player: [
          { kind: 'reveal_technology', technologyIds: ['stellar_engineering'], factionId: 'player' },
          { kind: 'wormhole_state', wormholeId: 'lacuna_gate', state: 'active' },
          { kind: 'event', eventId: 'core_opened' },
        ],
      },
    },
  ],
  aiDirectives: [
    { factionId: 'varkon', siteId: 'archive_2', mode: 'claim', after: 300, minWarships: 3, minSurvival: 0.25 },
    { factionId: 'varkon', siteId: 'archive_2', mode: 'guard' },
    { factionId: 'varkon', siteId: 'archive_1', mode: 'claim', after: 1500, minWarships: 3, minSurvival: 0.3 },
    { factionId: 'varkon', siteId: 'archive_3', mode: 'claim', after: 1800, minWarships: 3, minSurvival: 0.3 },
    { factionId: 'concordium', siteId: 'archive_1', mode: 'claim', after: 1200, minWarships: 3, minSurvival: 0.6 },
  ],
  map: {
    width: 270,
    height: 162,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 5000, rawmaterials: 4000, research: 1500 },
      },
      {
        id: 'concordium',
        name: 'The Concordium',
        color: '#5fd3c8',
        kind: 'ai',
        personality: 'technologist',
        currencies: { credits: 6000, rawmaterials: 5000, research: 3000 },
        technologies: [
          'improved_power', 'fusion_power', 'basic_radar', 'advanced_radar', 'scout_technology', 'fighter_technology',
          'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research',
          'colonization_technology', 'frigate_technology', 'laser_optics', 'military_engineering', 'energy_shielding',
          'destroyer_technology', 'turret_research_1', 'turret_research_2', 'advanced_manufacturing', 'orbital_engineering',
          'advanced_shipyards', 'cruiser_technology', 'applied_science',
        ],
      },
      {
        id: 'varkon',
        name: 'Varkon Dominion',
        color: '#e0563c',
        kind: 'ai',
        personality: 'militarist',
        currencies: { credits: 6000, rawmaterials: 6000, research: 2000 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'missile_technology',
          'advanced_engineering', 'military_engineering', 'frigate_technology', 'destroyer_technology', 'guided_missiles',
          'corvette_technology', 'ion_drives', 'advanced_construction', 'advanced_science', 'colonization_technology',
          'mass_drivers', 'turret_research_1', 'turret_research_2', 'advanced_weapons', 'orbital_engineering', 'advanced_shipyards',
          'cruiser_technology',
        ],
      },
      {
        id: 'meridian',
        name: 'Meridian League',
        color: '#ffcc00',
        kind: 'ai',
        personality: 'mercantile',
        currencies: { credits: 9000, rawmaterials: 4000, research: 2000 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'advanced_engineering',
          'advanced_construction', 'advanced_industry', 'advanced_manufacturing', 'advanced_science',
          'colonization_technology', 'frigate_technology', 'corvette_technology', 'turret_research_1',
          'orbital_engineering', 'orbital_repair_docks',
        ],
      },
      {
        id: 'remnant',
        name: 'Remnant Sentinels',
        color: '#b07cff',
        kind: 'outlaw',
        currencies: { credits: 0, rawmaterials: 0, research: 0 },
        technologies: ['turret_research_1', 'military_engineering', 'turret_research_2'],
      },
    ],
    systems: [
      {
        id: 'carrow', name: 'Carrow', x: 40, y: 100, color: '#ffcc00',
        planets: [
          { name: 'Carrow', type: 'earthlike', size: 'big', owner: 'player', population: 1600, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Carrow Reach', type: 'marslike', size: 'small', explored: true },
        ],
      },
      {
        id: 'concord_spire', name: 'Concord Spire', x: 85, y: 18, color: '#5ca8ff',
        planets: [
          { name: 'Concord Spire', type: 'earthlike', size: 'big', owner: 'concordium', population: 1700, layout: 'homeworld', deposit: true },
          { name: 'Spire Vault', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'varkos_deep', name: 'Varkos Deep', x: 238, y: 138, color: '#d65757',
        planets: [
          { name: 'Varkos Deep', type: 'marslike', size: 'big', owner: 'varkon', population: 1700, layout: 'homeworld', deposit: true },
          { name: 'Deep Forge', type: 'desert', size: 'small' },
        ],
      },
      {
        id: 'dravik', name: 'Dravik', x: 220, y: 92, color: '#d65757',
        planets: [
          { name: 'Dravik', type: 'desert', size: 'medium', owner: 'varkon', population: 700, layout: 'colony' },
          { name: 'Dravik Minor', type: 'ice', size: 'tiny' },
        ],
      },
      {
        id: 'meridian_gate', name: 'Meridian Gate', x: 248, y: 40, color: '#ffcc00',
        planets: [
          { name: 'Meridian Gate', type: 'earthlike', size: 'big', owner: 'meridian', population: 1600, layout: 'homeworld', deposit: true },
          { name: 'Gate Exchange', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'sela', name: 'Sela', x: 30, y: 30, color: '#5ca8ff',
        planets: [
          {
            name: 'Sela', type: 'earthlike', size: 'medium', owner: 'independent', civilization: 'Sela Concord',
            population: 800, satisfaction: 60, layout: 'civilization_capital',
          },
          { name: 'Sela Minor', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'oruun', name: 'Oruun', x: 160, y: 148, color: '#5ca8ff',
        planets: [
          {
            name: 'Oruun', type: 'marslike', size: 'medium', owner: 'independent', civilization: 'Oruun Fellowship',
            population: 800, satisfaction: 60, layout: 'civilization_capital',
          },
          { name: 'Oruun Ice', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'lacuna', name: 'Lacuna', x: LACUNA.x, y: LACUNA.y, color: '#b07cff',
        planets: [
          { name: 'Lacuna', type: 'ice', size: 'small' },
          { name: 'Lacuna Shard', type: 'desert', size: 'tiny' },
        ],
      },
      {
        id: 'vesper', name: 'Vesper', x: 95, y: 66, color: '#ff9a3c',
        planets: [
          { name: 'Vesper', type: 'desert', size: 'medium' },
          { name: 'Vesper Deep', type: 'gasgiant', size: 'big' },
          { name: 'Vesper Rock', type: 'marslike', size: 'tiny' },
        ],
        richAsteroids: [16_000, 12_000, 9_000],
      },
      {
        id: 'hollow', name: 'Hollow', x: 180, y: 58, color: '#ff9a3c',
        planets: [
          { name: 'Hollow', type: 'venuslike', size: 'medium' },
          { name: 'Hollow Deep', type: 'gasgiant', size: 'big' },
          { name: 'Hollow Shard', type: 'ice', size: 'tiny' },
        ],
        richAsteroids: [16_000, 12_000, 9_000],
      },
      {
        id: 'tarn', name: 'Tarn', x: 70, y: 140, color: '#f3f3f3',
        planets: [
          { name: 'Tarn', type: 'desert', size: 'medium' },
          { name: 'Tarn Ice', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'ebon', name: 'Ebon', x: 200, y: 20, color: '#f3f3f3',
        planets: [
          { name: 'Ebon', type: 'marslike', size: 'medium' },
          { name: 'Ebon Veil', type: 'venuslike', size: 'small' },
        ],
      },
      {
        id: 'quill', name: 'Quill', x: 120, y: 122, color: '#39b8a8',
        planets: [
          { name: 'Quill', type: 'earthlike', size: 'small' },
          { name: 'Quill Deep', type: 'gasgiant', size: 'medium' },
        ],
      },
    ],
    fleets: [
      { name: 'CARROW FLEET', factionId: 'player', atPlanet: 'Carrow', ships: ['frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'corvette', 'corvette'], speed: 6 },
      { name: 'EXPEDITION', factionId: 'player', atPlanet: 'Carrow', ships: ['frigate', 'frigate', 'destroyer', 'scout'], speed: 6 },
      { name: 'CONCORD FLEET', factionId: 'concordium', x: 85, y: 18, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'cruiser'] },
      { name: 'DOMINION ARMADA', factionId: 'varkon', x: 238, y: 138, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'destroyer', 'cruiser'] },
      { name: 'DRAVIK STRIKE', factionId: 'varkon', x: 220, y: 92, ships: ['frigate', 'frigate', 'frigate', 'destroyer', 'destroyer'] },
      { name: 'LEAGUE ESCORT', factionId: 'meridian', x: 248, y: 40, ships: ['frigate', 'frigate', 'corvette', 'corvette'] },
    ],
    spaceBases: [
      { name: 'Warden of Archive I', factionId: 'remnant', x: ARCHIVE_I.x, y: ARCHIVE_I.y },
      { name: 'Warden of Archive II', factionId: 'remnant', x: ARCHIVE_II.x, y: ARCHIVE_II.y },
      { name: 'Warden of Archive III', factionId: 'remnant', x: ARCHIVE_III.x, y: ARCHIVE_III.y },
    ],
    nebulae: [
      // Archive II hides inside it: its warden is only seen up close.
      { id: 1, x: ARCHIVE_II.x, y: ARCHIVE_II.y, radius: 10, lobes: [1, 0.88, 1.14, 0.92, 1.18, 0.86, 1.06, 0.82, 1.12, 0.96, 1.04], rotation: 0.6, color: '#7c5cd6' },
      { id: 2, x: 120, y: 58, radius: 8, lobes: [1.05, 0.9, 1.15, 0.86, 1, 1.1, 0.92, 1.06, 0.88], rotation: 1.4, color: '#3fa5a0' },
      { id: 3, x: 40, y: 62, radius: 9, lobes: [0.95, 1.12, 0.9, 1.08, 1, 0.86, 1.16, 0.94, 1.02], rotation: 2.1, color: '#8a7a6a' },
      { id: 4, x: 232, y: 70, radius: 8, lobes: [1, 1.1, 0.9, 1.05, 0.95, 1.12, 0.88, 1.02], rotation: 0.2, color: '#b0466a' },
    ],
    asteroidBelts: [
      // Archive III's choke: Carrow reaches it around the north or the south end.
      { id: 1, points: [{ x: 62, y: 86 }, { x: 63, y: 108 }], halfWidth: 2, visualSeed: 83 },
      { id: 2, points: [{ x: 110, y: 44 }, { x: 156, y: 46 }], halfWidth: 2, visualSeed: 89 },
      { id: 3, points: [{ x: 172, y: 108 }, { x: 178, y: 140 }], halfWidth: 2, visualSeed: 97 },
    ],
    wormholes: [{ id: 'lacuna_gate', name: 'Lacuna Gate', mouths: [LACUNA_GATE], state: 'dormant' }],
    anomalies: [
      { key: 'm6_lacuna', type: 'lacuna_station', systemId: 'lacuna' },
      { key: 'm6_wreck_west', type: 'ancient_wreck', x: 100, y: 100 },
      { key: 'm6_wreck_north', type: 'ancient_wreck', x: 160, y: 30 },
      { key: 'm6_derelict', type: 'derelict_outpost', x: 150, y: 110 },
      { key: 'm6_distress', type: 'distress_signal', factionId: 'meridian', x: 210, y: 60 },
    ],
    relations: [
      { a: 'player', b: 'concordium', state: 'peace', opinion: 10 },
      { a: 'player', b: 'varkon', state: 'peace', opinion: -10 },
      { a: 'player', b: 'meridian', state: 'peace', opinion: 15 },
      { a: 'concordium', b: 'varkon', state: 'peace', opinion: -30 },
      { a: 'concordium', b: 'meridian', state: 'peace', opinion: 20 },
      { a: 'varkon', b: 'meridian', state: 'peace', opinion: -10 },
    ],
    defaultView: { systemId: 'carrow', planetName: 'Carrow' },
  },
  researchHorizon: [
    // Missions 1–5
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
    'advanced_construction', 'advanced_industry', 'colonization_technology', 'advanced_radar',
    'turret_research_1', 'corvette_technology', 'frigate_technology',
    'military_engineering', 'destroyer_technology', 'fusion_power', 'advanced_research',
    'laser_optics', 'ion_drives', 'guided_missiles', 'energy_shielding',
    'advanced_manufacturing', 'orbital_engineering', 'orbital_repair_docks', 'turret_research_2', 'mass_drivers',
    'advanced_shipyards', 'cruiser_technology', 'carrier_technology', 'advanced_weapons', 'kinetic_armor',
    'point_defense', 'fusion_drives', 'urban_infrastructure', 'applied_science',
    // New in Mission 6 (Stellar Engineering is revealed at the Lacuna core)
    'capital_ship_technology', 'advanced_power', 'long_range_radar', 'turret_research_3', 'warp_field_theory', 'shield_harmonics',
  ],
  baselineTechnologies: [
    'basic_radar', 'improved_power', 'scout_technology', 'fighter_technology', 'advanced_engineering',
    'advanced_construction', 'advanced_science', 'colonization_technology', 'frigate_technology', 'corvette_technology',
    'military_engineering', 'destroyer_technology',
  ],
  objectives: [
    {
      id: 'investigate',
      title: 'Investigate Lacuna Station',
      description: 'The dark station over Lacuna, in the middle of the Frontier.',
      condition: { kind: 'anomaly_resolved', key: 'm6_lacuna' },
    },
    {
      id: 'claim_archives',
      title: 'Claim 2 of the 3 Remnant archives',
      description: 'Destroy an archive\'s warden, then hold the archive for 90 s with no hostile ship in range.',
      condition: { kind: 'sites_claimed', siteIds: ARCHIVES, count: 2 },
    },
    {
      id: 'open_core',
      title: 'Open the Lacuna core',
      description: 'Hold the core at Lacuna for 90 s.',
      after: ['claim_archives'],
      condition: CORE_OPEN,
      progress: { label: 'Core', metric: { site: 'lacuna_core' }, target: 90 },
    },
    // Optional
    {
      id: 'all_archives',
      title: 'Claim all three archives',
      optional: true,
      condition: { kind: 'sites_claimed', siteIds: ARCHIVES, count: 3 },
    },
    {
      id: 'gate_telemetry',
      title: 'Record the dormant Lacuna Gate',
      description: 'Keep a fleet at the dead gate south-east of Lacuna for 60 s.',
      optional: true,
      condition: { kind: 'held_for', id: 'gate_scan', seconds: 60, condition: { kind: 'fleet_at', x: LACUNA_GATE.x, y: LACUNA_GATE.y, radius: 1 } },
      onComplete: [{ kind: 'resources', factionId: 'player', research: 600 }, { kind: 'notice', text: 'Gate telemetry recorded: +600 research.' }],
    },
    {
      id: 'concordium_peace',
      title: 'Stay at peace with the Concordium',
      optional: true,
      condition: CORE_OPEN,
      failIf: { kind: 'relation', a: 'player', b: 'concordium', state: 'war' },
    },
  ],
  events: [
    {
      id: 'arrival',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'narrator',
      speakerName: 'Carrow Command',
      title: 'The Dark Station',
      text:
        'Long-range scans found a station over Lacuna, dark for longer than any of us has existed. ' +
        'The Concordium and the Dominion have seen it too. Get there first.',
      pause: true,
    },
    {
      id: 'race_begins',
      trigger: { kind: 'flag', flag: 'm6_station' },
      speaker: 'narrator',
      speakerName: 'Carrow Command',
      title: 'Three Archives',
      text:
        'The archives are charted, and each is guarded by a Remnant warden platform. ' +
        'Two of them would open the core. Varkon ships are already moving.',
      pause: false,
    },
    {
      id: 'league_offer',
      trigger: { kind: 'all', of: [{ kind: 'flag', flag: 'm6_station' }, { kind: 'game_time_at_least', seconds: 900 }] },
      speaker: 'meridian',
      title: 'An Offer',
      text: '"The League does not fight for ruins. It buys what others find. Your station surveys, for 2,500 credits?"',
      pause: true,
      choices: [
        {
          id: 'sell',
          label: 'Sell the surveys',
          consequences: '+2,500 credits. League opinion +10. The Concordium learns of it (opinion −5).',
          effects: [
            { kind: 'resources', factionId: 'player', credits: 2500 },
            { kind: 'flag', flag: 'm6_sold_to_league', value: true },
            { kind: 'opinion', holder: 'meridian', of: 'player', delta: 10 },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -5 },
          ],
        },
        {
          id: 'keep',
          label: 'Keep them',
          consequences: 'Nothing changes.',
          effects: [],
        },
      ],
    },
    {
      id: 'core_unsealed',
      trigger: { kind: 'sites_claimed', siteIds: ARCHIVES, count: 2 },
      speaker: 'narrator',
      speakerName: 'Carrow Command',
      title: 'The Core Unseals',
      text: 'Two archives answered. The core under Lacuna Station is open to whoever holds it.',
      pause: false,
    },
    {
      id: 'core_opened',
      speaker: 'narrator',
      speakerName: 'The Observers',
      speakerColor: '#c8d6ff',
      title: 'The Lacuna Core',
      text:
        'The core shows why the network went dark: a swarm around the Lacuna Heart that could power every gate at once. ' +
        'Stellar Engineering is now within reach. Then a voice on every channel: "You are not the first to read this." ' +
        'Who will humanity share it with?',
      pause: true,
      choices: [
        { id: 'concordium', label: 'With the Concordium', consequences: 'Remembered in the finale.', effects: share('concordium') },
        { id: 'league', label: 'With the Meridian League', consequences: 'Remembered in the finale.', effects: share('league') },
        { id: 'observers', label: 'With the ones who spoke', consequences: 'Remembered in the finale.', effects: share('observers') },
        { id: 'none', label: 'With no one', consequences: 'Remembered in the finale.', effects: share('none') },
      ],
    },
  ],
  endings: [
    {
      id: 'm6_core',
      title: 'The Silent Remnant',
      debrief: 'The Lacuna core is open. Humanity knows what powered the network, and that someone has been watching all along.',
      condition: { kind: 'flag', flag: 'm6_shared_with' },
      recordFlags: ['m6_shared_with', 'site:archive_1', 'site:archive_2', 'site:archive_3'],
    },
  ],
  defeat: [
    {
      condition: { kind: 'sites_claimed', siteIds: ARCHIVES, count: 2, anyAi: true },
      reason: 'Two archives fell to other empires. The Lacuna core can no longer be opened.',
    },
    {
      condition: { kind: 'all', of: [{ kind: 'site_claimed', siteId: 'lacuna_core' }, { kind: 'not', of: CORE_OPEN }] },
      reason: 'Another empire opened the Lacuna core.',
    },
  ],
};

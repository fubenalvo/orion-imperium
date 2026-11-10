import { Condition, Effect, MissionDefinition } from '../campaign.models';

/*
 * Mission 5 — The Border Conflict (docs/campaign-design.md §6, §7).
 *
 * Territory, bases and a war the player does not have to win by conquest.
 * Three AI empires: the Concordium (technologist, north), the Varkon
 * Dominion (militarist, south) and the Meridian League, now an empire of
 * its own (the campaign-only `mercantile` personality, east). Between them
 * the Kessan Reach: three resource-rich systems.
 *
 * - Minute 5 Varkon claims the Reach (story notice). Minute 10 the
 *   Concordium declares war on Varkon (a scripted `start_war`); minute 15
 *   when the player paid Varkon in Mission 3 (`m3_alignment` 'varkon').
 *   Until then neither attacks the other on its own (`aiRestraint`).
 * - The player picks a role when the war starts (flag `m5_role`): ally of
 *   the Concordium (war with Varkon), mediator, Varkon's partner (a tribute
 *   pact: the Dominion keeps no other peace) or opportunist.
 * - Mediation is offered while the player is at peace with both and both
 *   have war exhaustion ≥ 30 against each other; it ends their war through
 *   the white-peace treaty path (`start_peace`).
 * - The Kessan Gate links the heart of the Reach with the player's western
 *   flank: whoever holds the Reach has a short road into human space.
 *
 * Every ending needs presence in the Reach (2 of 3 systems in the player's
 * territory: a planet or a space base) and one way of ending the war:
 * mediated peace; peace with Varkon while the player or the Concordium
 * controls 2 Reach systems (held 5 minutes, after the war began); or peace
 * with Varkon after its war exhaustion reached 60. Defeat: Varkon controls
 * all three Reach systems for 10 minutes, or a second lost planet.
 */

const REACH = ['kessan_alpha', 'kessan_beta', 'kessan_heart'];

const WAR_ON: Condition = { kind: 'flag', flag: 'm5_border_war' };
const PEACE_WITH_VARKON: Condition = { kind: 'relation', a: 'player', b: 'varkon', state: 'peace' };
const PLAYER_HOLDS_REACH: Condition = { kind: 'systems_controlled', systemIds: REACH, count: 2, factionId: 'player' };
const CONCORDIUM_HOLDS_REACH: Condition = { kind: 'systems_controlled', systemIds: REACH, count: 2, factionId: 'concordium' };
const flagIs = (flag: string, value: string): Condition => ({ kind: 'flag', flag, equals: value });
const BORDER_WAR: Effect[] = [
  { kind: 'flag', flag: 'm5_border_war', value: true },
  { kind: 'start_war', a: 'concordium', b: 'varkon', declarer: 'concordium' },
];

export const M5_BORDER_CONFLICT: MissionDefinition = {
  id: 'm5_border_conflict',
  version: 1,
  title: 'The Border Conflict',
  subtitle: 'A war at the edge of human space',
  briefing: [
    'Three powers press on the Kessan Reach, the richest systems of the Frontier. The Concordium and the Dominion will not share it.',
    'Plant humanity\'s flag in the Reach and end the border war: as an ally, a mediator, a partner, or an opportunist.',
  ],
  seed: 1_505_337,
  requires: ['m4_meridian_exchange'],
  rules: { standardVictory: false, pirates: false },
  carryIn: { m3_alignment: 'none', m4_path: 'none', m4_charter: 'none' },
  aiRestraint: [
    // Their war is the script's: neither starts it on its own.
    { factionId: 'varkon', target: 'concordium', untilFlag: 'm5_border_war' },
    { factionId: 'concordium', target: 'varkon', untilFlag: 'm5_border_war' },
  ],
  map: {
    width: 240,
    height: 144,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 4000, rawmaterials: 3000, research: 1200 },
      },
      {
        id: 'concordium',
        name: 'The Concordium',
        color: '#5fd3c8',
        kind: 'ai',
        personality: 'technologist',
        currencies: { credits: 5000, rawmaterials: 4000, research: 2500 },
        technologies: [
          'improved_power', 'fusion_power', 'basic_radar', 'advanced_radar', 'scout_technology', 'fighter_technology',
          'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research',
          'colonization_technology', 'frigate_technology', 'laser_optics', 'military_engineering', 'energy_shielding',
          'destroyer_technology', 'turret_research_1', 'turret_research_2', 'advanced_manufacturing', 'orbital_engineering',
        ],
      },
      {
        id: 'varkon',
        name: 'Varkon Dominion',
        color: '#e0563c',
        kind: 'ai',
        personality: 'militarist',
        currencies: { credits: 5000, rawmaterials: 4500, research: 1500 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'missile_technology',
          'advanced_engineering', 'military_engineering', 'frigate_technology', 'destroyer_technology', 'guided_missiles',
          'corvette_technology', 'ion_drives', 'advanced_construction', 'advanced_science', 'colonization_technology',
          'mass_drivers', 'turret_research_1', 'turret_research_2',
        ],
      },
      {
        id: 'meridian',
        name: 'Meridian League',
        color: '#ffcc00',
        kind: 'ai',
        personality: 'mercantile',
        currencies: { credits: 8000, rawmaterials: 3000, research: 1500 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'advanced_engineering',
          'advanced_construction', 'advanced_industry', 'advanced_manufacturing', 'advanced_science',
          'colonization_technology', 'frigate_technology', 'corvette_technology', 'turret_research_1',
          'orbital_engineering', 'orbital_repair_docks',
        ],
      },
    ],
    systems: [
      {
        id: 'westmarch',
        name: 'Westmarch',
        x: 30,
        y: 72,
        color: '#ffcc00',
        planets: [
          { name: 'Westmarch', type: 'earthlike', size: 'big', owner: 'player', population: 1500, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Westmarch Moon', type: 'marslike', size: 'small', explored: true },
        ],
      },
      {
        id: 'thale',
        name: 'Thale',
        x: 62,
        y: 38,
        color: '#f3f3f3',
        planets: [
          { name: 'Thale', type: 'desert', size: 'medium' },
          { name: 'Thale Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'dorrin',
        name: 'Dorrin',
        x: 32,
        y: 126,
        color: '#5ca8ff',
        planets: [
          {
            name: 'Dorrin', type: 'earthlike', size: 'medium', owner: 'independent', civilization: 'Dorrin Assembly',
            population: 800, satisfaction: 60, layout: 'civilization_capital',
          },
          { name: 'Dorrin Minor', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'concord_ascent',
        name: 'Concord Ascent',
        x: 120,
        y: 18,
        color: '#5ca8ff',
        planets: [
          { name: 'Concord Ascent', type: 'earthlike', size: 'big', owner: 'concordium', population: 1600, layout: 'homeworld', deposit: true },
          { name: 'Ascent Vault', type: 'marslike', size: 'small' },
        ],
      },
      {
        id: 'kessan_alpha',
        name: 'Kessan Alpha',
        x: 104,
        y: 62,
        color: '#ff9a3c',
        planets: [
          { name: 'Kessan Alpha', type: 'marslike', size: 'medium' },
          { name: 'Alpha Shard', type: 'desert', size: 'tiny' },
        ],
        richAsteroids: [18_000, 14_000, 10_000],
      },
      {
        id: 'kessan_beta',
        name: 'Kessan Beta',
        x: 136,
        y: 62,
        color: '#ff9a3c',
        planets: [
          { name: 'Kessan Beta', type: 'desert', size: 'medium' },
          { name: 'Beta Ice', type: 'ice', size: 'small' },
        ],
        richAsteroids: [18_000, 14_000, 10_000],
      },
      {
        id: 'kessan_heart',
        name: 'Kessan Heart',
        x: 120,
        y: 86,
        color: '#ffcc00',
        planets: [
          { name: 'Kessan Heart', type: 'earthlike', size: 'medium' },
          { name: 'Heart Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'varkos_prime',
        name: 'Varkos Prime',
        x: 120,
        y: 128,
        color: '#d65757',
        planets: [
          { name: 'Varkos Prime', type: 'marslike', size: 'big', owner: 'varkon', population: 1600, layout: 'homeworld', deposit: true },
          { name: 'Prime Forge', type: 'desert', size: 'small' },
        ],
      },
      {
        id: 'brask',
        name: 'Brask',
        x: 172,
        y: 112,
        color: '#f3f3f3',
        planets: [
          { name: 'Brask', type: 'venuslike', size: 'medium' },
          { name: 'Brask Rock', type: 'desert', size: 'tiny' },
        ],
      },
      {
        id: 'meridian_prime',
        name: 'Meridian Prime',
        x: 210,
        y: 72,
        color: '#ffcc00',
        planets: [
          { name: 'Meridian Prime', type: 'earthlike', size: 'big', owner: 'meridian', population: 1500, layout: 'homeworld', deposit: true },
          { name: 'Prime Exchange', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'ilwen',
        name: 'Ilwen',
        x: 208,
        y: 20,
        color: '#5ca8ff',
        planets: [
          {
            name: 'Ilwen', type: 'marslike', size: 'medium', owner: 'independent', civilization: 'Ilwen Covenant',
            population: 800, satisfaction: 60, layout: 'civilization_capital',
          },
          { name: 'Ilwen Minor', type: 'ice', size: 'small' },
        ],
      },
    ],
    fleets: [
      { name: 'WESTMARCH FLEET', factionId: 'player', atPlanet: 'Westmarch', ships: ['frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'corvette', 'corvette'], speed: 6 },
      { name: 'SURVEY WING', factionId: 'player', atPlanet: 'Westmarch', ships: ['outpost_ship', 'scout'], speed: 6 },
      { name: 'CONCORD FLEET', factionId: 'concordium', x: 120, y: 18, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer'] },
      { name: 'DOMINION ARMADA', factionId: 'varkon', x: 120, y: 128, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'destroyer'] },
      { name: 'GARROW PICKET', factionId: 'varkon', x: 112, y: 106, ships: ['frigate', 'frigate'] },
      { name: 'LEAGUE ESCORT', factionId: 'meridian', x: 210, y: 72, ships: ['frigate', 'corvette', 'corvette', 'corvette'] },
    ],
    spaceBases: [{ name: "Garrow's Gate", factionId: 'varkon', x: 112, y: 106 }],
    nebulae: [
      // Ashen Veil: the slow corridor around the north of the western belt.
      { id: 1, x: 74, y: 30, radius: 11, lobes: [1, 0.88, 1.14, 0.92, 1.18, 0.86, 1.06, 0.82, 1.12, 0.96, 1.04], rotation: 0.9, color: '#8a7a6a' },
      { id: 2, x: 160, y: 92, radius: 9, lobes: [1.05, 0.9, 1.15, 0.86, 1, 1.1, 0.92, 1.06, 0.88], rotation: 1.2, color: '#b0466a' },
      { id: 3, x: 160, y: 34, radius: 8, lobes: [0.95, 1.12, 0.9, 1.08, 1, 0.86, 1.16, 0.94, 1.02], rotation: 2.2, color: '#3fa5a0' },
    ],
    asteroidBelts: [
      // West of the Reach: one direct gap (y ≈ 64–80) and the long way around the north.
      { id: 1, points: [{ x: 86, y: 32 }, { x: 88, y: 64 }], halfWidth: 2, visualSeed: 71 },
      { id: 2, points: [{ x: 88, y: 80 }, { x: 102, y: 106 }], halfWidth: 2, visualSeed: 73 },
      // North of the Reach: the Concordium comes through the gap west of it or around its east end.
      { id: 3, points: [{ x: 104, y: 44 }, { x: 146, y: 44 }], halfWidth: 2, visualSeed: 79 },
    ],
    wormholes: [{ id: 'kessan_gate', name: 'Kessan Gate', mouths: [{ x: 120, y: 78 }, { x: 46, y: 92 }], state: 'active' }],
    anomalies: [
      { key: 'm5_wreck', type: 'ancient_wreck', x: 150, y: 98 },
      { key: 'm5_distress', type: 'distress_signal', factionId: 'meridian', x: 182, y: 50 },
    ],
    relations: [
      { a: 'player', b: 'concordium', state: 'peace', opinion: 10 },
      { a: 'player', b: 'varkon', state: 'peace', opinion: -10 },
      { a: 'player', b: 'meridian', state: 'peace', opinion: 15 },
      { a: 'concordium', b: 'varkon', state: 'peace', opinion: -40 },
      { a: 'concordium', b: 'meridian', state: 'peace', opinion: 20 },
      { a: 'varkon', b: 'meridian', state: 'peace', opinion: -10 },
    ],
    defaultView: { systemId: 'westmarch', planetName: 'Westmarch' },
  },
  researchHorizon: [
    // Missions 1–4
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
    'advanced_construction', 'advanced_industry', 'colonization_technology', 'advanced_radar',
    'turret_research_1', 'corvette_technology', 'frigate_technology',
    'military_engineering', 'destroyer_technology', 'fusion_power', 'advanced_research',
    'laser_optics', 'ion_drives', 'guided_missiles', 'energy_shielding',
    'advanced_manufacturing', 'orbital_engineering', 'orbital_repair_docks', 'turret_research_2', 'mass_drivers',
    // New in Mission 5
    'advanced_shipyards', 'cruiser_technology', 'carrier_technology', 'advanced_weapons', 'kinetic_armor',
    'point_defense', 'fusion_drives', 'urban_infrastructure', 'applied_science',
  ],
  baselineTechnologies: [
    'basic_radar', 'improved_power', 'scout_technology', 'fighter_technology', 'advanced_engineering',
    'advanced_construction', 'advanced_science', 'colonization_technology', 'frigate_technology', 'corvette_technology',
    'military_engineering', 'destroyer_technology',
  ],
  objectives: [
    {
      id: 'reach_presence',
      title: 'Establish presence in the Kessan Reach',
      description: 'Two of its three systems in your territory: settle a planet or deploy a space base there.',
      condition: PLAYER_HOLDS_REACH,
    },
    {
      id: 'keep_colonies',
      title: 'Lose at most one planet',
      description: 'A second lost planet ends the mission.',
      condition: { kind: 'flag', flag: 'm5_never' },
      failIf: { kind: 'event_count', event: 'planet_lost', atLeast: 2 },
      onFail: [{ kind: 'fail_mission', reason: 'Too many colonies lost.' }],
    },
    {
      id: 'end_war',
      title: 'End the border war',
      description:
        'Mediate a peace between the Concordium and Varkon; or keep peace with Varkon while you or the Concordium hold 2 Reach systems; ' +
        'or wear Varkon down (war exhaustion 60) and sign peace.',
      after: ['reach_presence'],
      condition: { kind: 'flag', flag: 'm5_never' },
    },
    // Optional
    {
      id: 'garrows_gate',
      title: "Destroy the Varkon base at Garrow's Gate",
      optional: true,
      condition: { kind: 'base_destroyed', name: "Garrow's Gate" },
    },
    {
      id: 'league_neutral',
      title: 'Stay at peace with the Meridian League until minute 60',
      optional: true,
      condition: { kind: 'game_time_at_least', seconds: 3600 },
      failIf: { kind: 'relation', a: 'player', b: 'meridian', state: 'war' },
    },
    {
      id: 'turret_research_2',
      title: 'Research Turret Research II',
      optional: true,
      condition: { kind: 'technology', technologyId: 'turret_research_2' },
    },
  ],
  events: [
    {
      id: 'arrival',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'narrator',
      speakerName: 'Westmarch Command',
      title: 'The Kessan Reach',
      text:
        'East of Westmarch lies the Kessan Reach, rich enough to start a war. The Concordium and the Dominion both want it. ' +
        'The Kessan Gate opens right on our western flank: whoever holds the Reach is a short jump from us.',
      pause: true,
    },
    // Earlier missions colour the start.
    {
      id: 'alignment_concordium',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, flagIs('m3_alignment', 'concordium')] },
      speaker: 'concordium',
      title: 'Old Friends',
      text: 'The Concordium greets the signatories of the Accord.',
      pause: false,
      effects: [
        { kind: 'opinion', holder: 'concordium', of: 'player', delta: 20 },
        { kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 },
      ],
    },
    {
      id: 'alignment_varkon',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, flagIs('m3_alignment', 'varkon')] },
      speaker: 'varkon',
      title: 'Old Tribute',
      text: 'The Dominion remembers who paid it. It may want to be paid again.',
      pause: false,
      effects: [{ kind: 'opinion', holder: 'varkon', of: 'player', delta: 15 }],
    },
    {
      id: 'league_cold',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, flagIs('m4_path', 'dominance')] },
      speaker: 'meridian',
      title: 'A Cold Market',
      text: 'The League has not forgotten who took its worlds at the Exchange.',
      pause: false,
      effects: [{ kind: 'opinion', holder: 'meridian', of: 'player', delta: -30 }],
    },
    {
      id: 'league_warm',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, flagIs('m4_path', 'exchange')] },
      speaker: 'meridian',
      title: 'Trusted Traders',
      text: 'The League remembers who kept the Exchange free.',
      pause: false,
      effects: [{ kind: 'opinion', holder: 'meridian', of: 'player', delta: 15 }],
    },
    {
      id: 'varkon_claims',
      trigger: { kind: 'game_time_at_least', seconds: 300 },
      speaker: 'varkon',
      title: 'The Reach Is Ours',
      text: '"The Kessan Reach belongs to the Dominion. Whoever settles there settles on our soil."',
      pause: false,
      effects: [{ kind: 'reveal_area', x: 120, y: 72, radius: 26 }],
    },
    {
      id: 'border_war',
      trigger: {
        kind: 'any',
        of: [
          { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 600 }, { kind: 'not', of: flagIs('m3_alignment', 'varkon') }] },
          { kind: 'game_time_at_least', seconds: 900 },
        ],
      },
      speaker: 'concordium',
      title: 'The Border War',
      text: '"The Dominion\'s claim on the Reach is a declaration of war. The Concordium answers it."',
      pause: true,
      effects: BORDER_WAR,
    },
    {
      id: 'choose_role',
      trigger: WAR_ON,
      speaker: 'narrator',
      speakerName: 'Westmarch Command',
      title: 'Humanity\'s Part',
      text: 'The Concordium and the Dominion are at war over the Reach, next door to us. What is humanity\'s part in it?',
      pause: true,
      choices: [
        {
          id: 'ally',
          label: 'Stand with the Concordium',
          consequences: 'War with Varkon. Concordium opinion +20.',
          effects: [
            { kind: 'flag', flag: 'm5_role', value: 'ally' },
            { kind: 'start_war', a: 'player', b: 'varkon', declarer: 'player' },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: 20 },
          ],
        },
        {
          id: 'mediator',
          label: 'Stay neutral and offer to mediate',
          consequences: 'Peace with both. Mediation becomes possible once both are worn down (war exhaustion 30).',
          effects: [
            { kind: 'flag', flag: 'm5_role', value: 'mediator' },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: 5 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: 5 },
          ],
        },
        {
          id: 'partner',
          label: 'Pay the Dominion for its friendship',
          consequences: 'A tribute pact with Varkon: 300 credits every 2 minutes. Concordium opinion −20.',
          effects: [
            { kind: 'flag', flag: 'm5_role', value: 'partner' },
            { kind: 'tribute_pact', receiver: 'varkon', amount: 300, intervalSeconds: 120 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: 20 },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -20 },
          ],
        },
        {
          id: 'opportunist',
          label: 'Let them bleed, and take the Reach',
          consequences: 'No commitment. Both empires trust you a little less (opinion −5).',
          effects: [
            { kind: 'flag', flag: 'm5_role', value: 'opportunist' },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -5 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: -5 },
          ],
        },
      ],
    },
    {
      id: 'mediation',
      trigger: {
        kind: 'all',
        of: [
          WAR_ON,
          { kind: 'relation', a: 'concordium', b: 'varkon', state: 'war' },
          { kind: 'relation', a: 'player', b: 'concordium', state: 'peace' },
          PEACE_WITH_VARKON,
          { kind: 'war_exhaustion_at_least', holder: 'concordium', against: 'varkon', value: 30 },
          { kind: 'war_exhaustion_at_least', holder: 'varkon', against: 'concordium', value: 30 },
        ],
      },
      speaker: 'narrator',
      speakerName: 'Westmarch Command',
      title: 'A Chance for Peace',
      text: 'Both sides are worn down. Their envoys would meet at Westmarch if humanity called them. Once.',
      pause: true,
      choices: [
        {
          id: 'mediate',
          label: 'Call the envoys and broker a peace',
          consequences: 'The Concordium and Varkon sign a white peace. Both think better of you (opinion +10).',
          effects: [
            { kind: 'start_peace', a: 'concordium', b: 'varkon' },
            { kind: 'flag', flag: 'm5_mediated', value: true },
            { kind: 'flag', flag: 'm5_role', value: 'mediator' },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: 10 },
          ],
        },
        {
          id: 'wait',
          label: 'Not yet',
          consequences: 'The chance passes; the war goes on.',
          effects: [],
        },
      ],
    },
    {
      id: 'varkon_holds_reach',
      trigger: { kind: 'systems_controlled', systemIds: REACH, count: 3, factionId: 'varkon' },
      speaker: 'narrator',
      speakerName: 'Westmarch Command',
      title: 'The Reach Falls',
      text: 'The Dominion holds the whole Reach. If it keeps it for ten minutes, its fleets will be at our door.',
      pause: false,
    },
  ],
  endings: [
    {
      id: 'm5_mediated',
      title: 'The Kessan Accord',
      debrief: 'Humanity brought the Concordium and the Dominion to the table. The Reach is shared, and the guns are silent.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'reach_presence' },
          { kind: 'flag', flag: 'm5_mediated' },
          { kind: 'relation', a: 'concordium', b: 'varkon', state: 'peace' },
        ],
      },
      records: { m5_reach_controller: 'shared' },
      recordFlags: ['m5_role'],
    },
    {
      id: 'm5_human_reach',
      title: 'The Human Reach',
      debrief: 'The Reach flies human flags, and the Dominion has accepted it, for now.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'reach_presence' },
          WAR_ON,
          { kind: 'held_for', id: 'human_settlement', seconds: 300, condition: { kind: 'all', of: [PEACE_WITH_VARKON, PLAYER_HOLDS_REACH] } },
        ],
      },
      records: { m5_reach_controller: 'player' },
      recordFlags: ['m5_role'],
    },
    {
      id: 'm5_concordium_reach',
      title: 'The Concordium Line',
      debrief: 'The Concordium holds the Reach, humanity keeps its foothold, and the Dominion stays south of the line.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'reach_presence' },
          WAR_ON,
          { kind: 'held_for', id: 'concordium_settlement', seconds: 300, condition: { kind: 'all', of: [PEACE_WITH_VARKON, CONCORDIUM_HOLDS_REACH] } },
        ],
      },
      records: { m5_reach_controller: 'concordium' },
      recordFlags: ['m5_role'],
    },
    {
      id: 'm5_dominion_broken',
      title: 'The Broken Dominion',
      debrief: 'The Dominion bled itself white against humanity and signed the peace we offered.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'reach_presence' },
          { kind: 'event_count', event: 'peace_signed', factionId: 'varkon', atLeast: 1 },
          { kind: 'value_at_least', key: 'war_exhaustion:varkon', value: 60 },
          PEACE_WITH_VARKON,
        ],
      },
      records: { m5_reach_controller: 'contested' },
      recordFlags: ['m5_role'],
    },
  ],
  defeat: [
    {
      condition: { kind: 'held_for', id: 'varkon_reach', seconds: 600, condition: { kind: 'systems_controlled', systemIds: REACH, count: 3, factionId: 'varkon' } },
      reason: 'The Dominion held the whole Kessan Reach for ten minutes. Its fleets are at Westmarch.',
    },
  ],
};

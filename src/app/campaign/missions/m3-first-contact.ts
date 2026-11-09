import { Condition, MissionDefinition } from '../campaign.models';

/*
 * Mission 3 — First Contact (docs/campaign-design.md §6, §7).
 *
 * The first AI empires: the Concordium (technologist) in the north-east and
 * the Varkon Dominion (militarist) in the south-east, both unknown at the
 * start (docs/first-contact.md). The mission is about diplomacy:
 *
 * - Meetings use the ordinary contact dialogue. Sightings usually come
 *   first; otherwise each empire's envoy arrives (a `contact` effect) at
 *   minute 6 (Concordium) and 9 (Varkon).
 * - The Varkon meeting is scripted (`contactOverrides`): a cold peace with
 *   a low opinion whatever the answers, so its pressure always starts at
 *   peace. Its tribute demand follows a minute later (20 s and higher when
 *   the player offered tribute in the dialogue), its ultimatum ~9 minutes
 *   after that unless a tribute pact runs. Both go through the ordinary
 *   demand path (`force_demand`), so the threat's war-or-bluff follow
 *   through is the AI's usual decision. Until the ultimatum Varkon's own AI
 *   makes no demands of the player and declares no war on it
 *   (`aiRestraint`); the two empires never attack each other here.
 * - The Ostra wormhole wakes at minute 20; its second mouth opens south of
 *   Mirelle, a short route from the Varkon side into human space.
 *
 * Three endings (`m3_alignment` is read by later missions):
 * - Accord: the Concordium's trust (opinion 40 or the Accord of Passage),
 *   the Varkon pressure answered, no planet lost to Varkon, and 10 minutes
 *   held after the Ostra gate wakes (so not before minute 30);
 * - Appeasement: a Varkon tribute pact kept for 15 minutes;
 * - Show of force: peace with Varkon after its war exhaustion reached 30.
 *
 * Map rules this data relies on (m3-first-contact.spec.ts): belt A shields
 * Haven from Varkos (around the south edge or through Ostra), belt B keeps
 * Corran from Concord Prime, and the Grey Reach nebula hides the Varkon
 * approach to Ostra.
 */

const OSTRA = { x: 88, y: 54 };

const MET_VARKON: Condition = { kind: 'in_contact', a: 'player', b: 'varkon' };
const AT_PEACE_WITH_VARKON: Condition = { kind: 'relation', a: 'player', b: 'varkon', state: 'peace' };

export const M3_FIRST_CONTACT: MissionDefinition = {
  id: 'm3_first_contact',
  version: 1,
  title: 'First Contact',
  subtitle: 'Two empires, two answers',
  briefing: [
    'The relay at Far Echo carried a name: the Concordium. Haven, our new frontier colony, now hears two signals from the east.',
    'Meet whoever is out there, keep Haven safe, and decide what kind of neighbour humanity will be.',
  ],
  seed: 1_303_517,
  requires: ['m2_beyond_the_gate'],
  rules: { standardVictory: false, pirates: false },
  contactOverrides: {
    // The Dominion never starts friendly here: a cold peace at best, so its demands can follow.
    varkon: { outcome: 'cold_peace', maxOpinion: -10 },
  },
  aiRestraint: [
    // Until its ultimatum the Dominion's pressure is the script's tribute demand, not its own AI.
    { factionId: 'varkon', untilFlag: 'm3_varkon_ultimatum' },
    // Wary neighbours, not yet enemies: their war is Mission 5's story.
    { factionId: 'varkon', target: 'concordium' },
    { factionId: 'concordium', target: 'varkon' },
  ],
  map: {
    width: 180,
    height: 108,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 3000, rawmaterials: 3000, research: 1000 },
      },
      {
        id: 'concordium',
        name: 'The Concordium',
        color: '#5fd3c8',
        kind: 'ai',
        personality: 'technologist',
        currencies: { credits: 3000, rawmaterials: 3000, research: 1500 },
        technologies: [
          'improved_power', 'fusion_power', 'basic_radar', 'advanced_radar', 'scout_technology', 'fighter_technology',
          'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research',
          'colonization_technology', 'frigate_technology', 'laser_optics',
        ],
      },
      {
        id: 'varkon',
        name: 'Varkon Dominion',
        color: '#e0563c',
        kind: 'ai',
        personality: 'militarist',
        currencies: { credits: 3000, rawmaterials: 3500, research: 800 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'missile_technology',
          'advanced_engineering', 'military_engineering', 'frigate_technology', 'destroyer_technology', 'guided_missiles',
          // The Dominion expands toward Tirel and Ostra.
          'advanced_construction', 'advanced_science', 'colonization_technology',
        ],
      },
    ],
    systems: [
      {
        id: 'haven',
        name: 'Haven',
        x: 26,
        y: 56,
        color: '#ffcc00',
        planets: [
          { name: 'Haven', type: 'earthlike', size: 'medium', owner: 'player', population: 1200, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Haven Minor', type: 'ice', size: 'small', explored: true },
        ],
      },
      {
        id: 'corran',
        name: 'Corran',
        x: 50,
        y: 26,
        color: '#f3f3f3',
        planets: [
          { name: 'Corran', type: 'desert', size: 'medium' },
          { name: 'Corran Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'mirelle',
        name: 'Mirelle',
        x: 54,
        y: 84,
        color: '#39b8a8',
        planets: [
          { name: 'Mirelle', type: 'venuslike', size: 'medium' },
          { name: 'Mirelle Ice', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'ostra',
        name: 'Ostra',
        x: OSTRA.x,
        y: OSTRA.y,
        color: '#ff9a3c',
        planets: [
          { name: 'Ostra Prime', type: 'marslike', size: 'medium' },
          { name: 'Ostra Rock', type: 'desert', size: 'tiny' },
        ],
        richAsteroids: [15_000, 12_000, 10_000],
      },
      {
        id: 'concord_prime',
        name: 'Concord Prime',
        x: 130,
        y: 22,
        color: '#5ca8ff',
        planets: [
          { name: 'Concord', type: 'earthlike', size: 'big', owner: 'concordium', population: 1200, layout: 'homeworld', deposit: true },
          { name: 'Concord Vault', type: 'marslike', size: 'small' },
        ],
      },
      {
        id: 'varkos',
        name: 'Varkos',
        x: 140,
        y: 86,
        color: '#d65757',
        planets: [
          { name: 'Varkos', type: 'marslike', size: 'big', owner: 'varkon', population: 1200, layout: 'homeworld', deposit: true },
          { name: 'Varkos Forge', type: 'desert', size: 'small' },
        ],
      },
      {
        id: 'tirel',
        name: 'Tirel',
        x: 108,
        y: 92,
        color: '#f3f3f3',
        planets: [
          { name: 'Tirel', type: 'desert', size: 'medium' },
          { name: 'Tirel Shard', type: 'ice', size: 'tiny' },
        ],
      },
      {
        id: 'saffra',
        name: 'Saffra',
        x: 158,
        y: 52,
        color: '#ffcc00',
        planets: [
          {
            name: 'Saffra', type: 'earthlike', size: 'medium', owner: 'independent', civilization: 'Saffra Compact',
            population: 900, satisfaction: 60, layout: 'civilization_capital',
          },
        ],
      },
    ],
    fleets: [
      { name: 'HAVEN GUARD', factionId: 'player', atPlanet: 'Haven', ships: ['frigate', 'frigate', 'fighter', 'fighter', 'fighter'], speed: 6 },
      { name: 'PATHFINDER', factionId: 'player', atPlanet: 'Haven', ships: ['scout'], speed: 10 },
      { name: 'CONCORD WATCH', factionId: 'concordium', x: 130, y: 22, ships: ['frigate', 'frigate', 'frigate', 'frigate'] },
      { name: 'DOMINION HOST', factionId: 'varkon', x: 140, y: 86, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer'] },
    ],
    nebulae: [
      { id: 1, x: 110, y: 70, radius: 12, lobes: [1, 0.88, 1.14, 0.92, 1.18, 0.86, 1.06, 0.82, 1.12, 0.96, 1.04], rotation: 0.7, color: '#7c5cd6' },
      { id: 2, x: 42, y: 94, radius: 10, lobes: [1.05, 0.9, 1.15, 0.86, 1, 1.1, 0.92, 1.06, 0.88], rotation: 2.3, color: '#3fa5a0' },
    ],
    asteroidBelts: [
      // Belt A: Varkos reaches Haven through Ostra or around the south edge.
      { id: 1, points: [{ x: 70, y: 66 }, { x: 76, y: 104 }], halfWidth: 2, visualSeed: 31 },
      // Belt B: Corran and Concord Prime meet through Ostra.
      { id: 2, points: [{ x: 100, y: 4 }, { x: 104, y: 40 }], halfWidth: 2, visualSeed: 47 },
    ],
    wormholes: [{ id: 'ostra_gate', name: 'Ostra Gate', mouths: [{ x: 92, y: 60 }, { x: 44, y: 96 }], state: 'dormant' }],
    anomalies: [{ key: 'm3_distress', type: 'distress_signal', factionId: 'concordium', x: 96, y: 46 }],
    relations: [
      { a: 'player', b: 'concordium', state: 'peace', contact: false },
      { a: 'player', b: 'varkon', state: 'peace', contact: false },
      { a: 'concordium', b: 'varkon', state: 'peace', opinion: -20 },
    ],
    defaultView: { systemId: 'haven', planetName: 'Haven' },
  },
  researchHorizon: [
    // Missions 1–2
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
    'advanced_construction', 'advanced_industry', 'colonization_technology', 'advanced_radar',
    'turret_research_1', 'corvette_technology', 'frigate_technology',
    // New in Mission 3
    'military_engineering', 'destroyer_technology', 'fusion_power', 'advanced_research',
    'laser_optics', 'ion_drives', 'guided_missiles', 'energy_shielding',
  ],
  // A standalone start (no Mission 2 record) gets what Mission 2 teaches.
  baselineTechnologies: [
    'basic_radar', 'improved_power', 'scout_technology', 'fighter_technology', 'advanced_engineering',
    'advanced_construction', 'advanced_science', 'colonization_technology', 'frigate_technology',
  ],
  objectives: [
    {
      id: 'meet_concordium',
      title: 'Make contact with the Concordium',
      description: 'Their survey buoys point north-east. If we do not find them, they will find us.',
      condition: { kind: 'in_contact', a: 'player', b: 'concordium' },
    },
    {
      id: 'meet_varkon',
      title: 'Make contact with the Varkon Dominion',
      description: 'Something is moving in the south-east, behind the Grey Reach nebula.',
      condition: MET_VARKON,
    },
    {
      id: 'answer_varkon',
      title: 'Answer the Varkon pressure',
      description: 'Pay what they demand; or refuse and hold every planet for 10 minutes; or defeat a Varkon fleet.',
      after: ['meet_varkon'],
      condition: {
        kind: 'any',
        of: [
          { kind: 'event_count', event: 'demand_paid', factionId: 'varkon', atLeast: 1 },
          {
            kind: 'held_for',
            id: 'held_after_refusal',
            seconds: 600,
            condition: {
              kind: 'all',
              of: [
                { kind: 'event_count', event: 'demand_refused', factionId: 'varkon', atLeast: 1 },
                { kind: 'not', of: { kind: 'event_count', event: 'planet_lost', atLeast: 1 } },
              ],
            },
          },
          { kind: 'event_count', event: 'battle_won', factionId: 'varkon', atLeast: 1 },
        ],
      },
    },
    {
      id: 'concordium_trust',
      title: 'Earn the trust of the Concordium',
      description: 'Their opinion of us at 40, or the Accord of Passage they may offer.',
      after: ['meet_concordium'],
      condition: {
        kind: 'any',
        of: [
          { kind: 'opinion_at_least', holder: 'concordium', of: 'player', value: 40 },
          { kind: 'flag', flag: 'm3_accord' },
        ],
      },
    },
    {
      id: 'watch_ostra',
      title: 'Hold the line at the Ostra gate',
      description: 'Ostra is dormant now, but our probes say it will not stay so. Once it opens, lose no planet to Varkon for 10 minutes.',
      condition: {
        kind: 'held_for',
        id: 'ostra_watch',
        seconds: 600,
        condition: {
          kind: 'all',
          of: [
            { kind: 'flag', flag: 'm3_ostra_awake' },
            { kind: 'not', of: { kind: 'event_count', event: 'planet_lost', factionId: 'varkon', atLeast: 1 } },
          ],
        },
      },
    },
    // Optional
    {
      id: 'rescue_science_ship',
      title: 'Answer the distress call near Ostra',
      description: 'A stranded Concordium science ship. Helping costs credits and earns their gratitude.',
      optional: true,
      condition: { kind: 'anomaly_resolved', key: 'm3_distress', choiceId: 'assist' },
    },
    {
      id: 'settle_ostra',
      title: 'Settle Ostra Prime',
      description: 'Ostra sits between both empires, on a rich asteroid belt.',
      optional: true,
      condition: { kind: 'planet_owned_by', planetName: 'Ostra Prime', factionId: 'player' },
    },
  ],
  events: [
    {
      id: 'arrival',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'narrator',
      speakerName: 'Haven Command',
      title: 'Two Signals',
      text:
        'The relay named the Concordium, but our sensors hear two different signal patterns from the east. ' +
        'Whoever they are, they will judge humanity by our first words.',
      pause: true,
    },
    {
      id: 'concordium_envoy',
      trigger: {
        kind: 'all',
        of: [{ kind: 'game_time_at_least', seconds: 360 }, { kind: 'not', of: { kind: 'in_contact', a: 'player', b: 'concordium' } }],
      },
      speaker: 'concordium',
      title: 'An Envoy Arrives',
      text: 'A Concordium survey ship drops out of the dark next to Haven and opens a channel.',
      pause: false,
      effects: [{ kind: 'contact', factionId: 'concordium' }],
    },
    {
      id: 'varkon_envoy',
      trigger: {
        kind: 'all',
        of: [{ kind: 'game_time_at_least', seconds: 540 }, { kind: 'not', of: MET_VARKON }],
      },
      speaker: 'varkon',
      title: 'A Warship at the Border',
      text: 'A Varkon raider crosses into our space and hails Haven. It does not lower its weapons.',
      pause: false,
      effects: [{ kind: 'contact', factionId: 'varkon' }],
    },
    // The player offered tribute in the dialogue: the Dominion collects sooner, and more.
    {
      id: 'varkon_tribute_eager',
      trigger: {
        kind: 'all',
        of: [
          { kind: 'flag', flag: 'offered_tribute' },
          { kind: 'not', of: { kind: 'flag', flag: 'm3_varkon_demanded' } },
          { kind: 'held_for', id: 'eager_tribute_clock', seconds: 20, condition: { kind: 'all', of: [MET_VARKON, AT_PEACE_WITH_VARKON] } },
        ],
      },
      speaker: 'varkon',
      title: 'Tribute',
      text: 'The Dominion remembers your offer. It expects you to keep it.',
      pause: false,
      effects: [
        { kind: 'flag', flag: 'm3_varkon_demanded', value: true },
        { kind: 'force_demand', demander: 'varkon', target: 'player', demandKind: 'tribute', amount: 700 },
      ],
    },
    {
      id: 'varkon_tribute',
      trigger: {
        kind: 'all',
        of: [
          { kind: 'not', of: { kind: 'flag', flag: 'm3_varkon_demanded' } },
          { kind: 'held_for', id: 'tribute_clock', seconds: 60, condition: { kind: 'all', of: [MET_VARKON, AT_PEACE_WITH_VARKON] } },
        ],
      },
      speaker: 'varkon',
      title: 'Tribute',
      text: 'The Dominion takes tribute from its neighbours. Haven is now its neighbour.',
      pause: false,
      effects: [
        { kind: 'flag', flag: 'm3_varkon_demanded', value: true },
        { kind: 'force_demand', demander: 'varkon', target: 'player', demandKind: 'tribute', amount: 400 },
      ],
    },
    {
      id: 'varkon_ultimatum',
      trigger: {
        kind: 'held_for',
        id: 'ultimatum_clock',
        seconds: 540,
        condition: {
          kind: 'all',
          of: [
            { kind: 'flag', flag: 'm3_varkon_demanded' },
            AT_PEACE_WITH_VARKON,
            { kind: 'not', of: { kind: 'tribute_pact', receiver: 'varkon' } },
          ],
        },
      },
      speaker: 'varkon',
      title: 'Ultimatum',
      text: 'The Dominion has waited long enough. Pay, or its fleets will collect.',
      pause: false,
      effects: [
        { kind: 'flag', flag: 'm3_varkon_ultimatum', value: true },
        { kind: 'force_demand', demander: 'varkon', target: 'player', demandKind: 'threat', amount: 800 },
      ],
    },
    {
      id: 'varkon_pact_offer',
      trigger: {
        kind: 'all',
        of: [{ kind: 'event_count', event: 'demand_paid', factionId: 'varkon', atLeast: 1 }, AT_PEACE_WITH_VARKON],
      },
      speaker: 'varkon',
      title: 'The Tribute Pact',
      text:
        '"You pay. Good. Pay us every two minutes and the Dominion will look elsewhere for its wars. ' +
        'Miss one payment and we will come for it ourselves."',
      pause: true,
      choices: [
        {
          id: 'accept',
          label: 'Accept the pact',
          consequences: '250 credits every 2 minutes; Varkon makes no war and no demands on you while you pay. A missed payment means war.',
          effects: [
            { kind: 'tribute_pact', receiver: 'varkon', amount: 250, intervalSeconds: 120 },
            { kind: 'flag', flag: 'm3_pact_accepted', value: true },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: 15 },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -10 },
          ],
        },
        {
          id: 'refuse',
          label: 'One payment was enough',
          consequences: 'No pact. Varkon opinion −10.',
          effects: [{ kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 }],
        },
      ],
    },
    {
      id: 'concordium_accord',
      trigger: {
        kind: 'all',
        of: [
          { kind: 'in_contact', a: 'player', b: 'concordium' },
          { kind: 'relation', a: 'player', b: 'concordium', state: 'peace' },
          { kind: 'opinion_at_least', holder: 'concordium', of: 'player', value: 30 },
        ],
      },
      speaker: 'concordium',
      title: 'The Accord of Passage',
      text:
        '"The Concordium proposes an Accord of Passage: open charts, safe passage for science ships, ' +
        'and a shared watch on the old gates. Will humanity sign?"',
      pause: true,
      choices: [
        {
          id: 'sign',
          label: 'Sign the Accord',
          consequences: 'Concordium opinion +10, their star charts, +400 research. Varkon opinion −10.',
          effects: [
            { kind: 'flag', flag: 'm3_accord', value: true },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 },
            { kind: 'reveal_area', x: 130, y: 22, radius: 14 },
            { kind: 'resources', factionId: 'player', research: 400 },
          ],
        },
        {
          id: 'decline',
          label: 'Not yet',
          consequences: 'No accord. Their trust must be earned another way (opinion 40).',
          effects: [],
        },
      ],
    },
    {
      id: 'ostra_wakes',
      trigger: { kind: 'game_time_at_least', seconds: 1200 },
      speaker: 'narrator',
      speakerName: 'Haven Command',
      title: 'The Ostra Gate',
      text:
        'The dead gate at Ostra just woke. Its twin opened south of Mirelle, inside our space. ' +
        'Whoever holds Ostra now has a short road to Haven.',
      pause: true,
      effects: [
        { kind: 'flag', flag: 'm3_ostra_awake', value: true },
        { kind: 'wormhole_state', wormholeId: 'ostra_gate', state: 'active' },
        { kind: 'reveal_area', x: 92, y: 60, radius: 3 },
        { kind: 'reveal_area', x: 44, y: 96, radius: 3 },
      ],
    },
  ],
  endings: [
    {
      id: 'm3_accord',
      title: 'The Accord',
      debrief: 'Humanity stands with the Concordium, and the Dominion learned that Haven does not break.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'meet_concordium' },
          { kind: 'objective_done', id: 'answer_varkon' },
          { kind: 'objective_done', id: 'concordium_trust' },
          // Also keeps the mission from ending before the Ostra crisis (minute 30 at the earliest).
          { kind: 'objective_done', id: 'watch_ostra' },
          { kind: 'not', of: { kind: 'event_count', event: 'planet_lost', factionId: 'varkon', atLeast: 1 } },
        ],
      },
      records: { m3_alignment: 'concordium' },
      recordFlags: ['m3_accord'],
    },
    {
      id: 'm3_appeasement',
      title: 'Appeasement',
      debrief: 'The Dominion is paid and looks elsewhere for its wars. For now.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'meet_concordium' },
          { kind: 'held_for', id: 'pact_kept', seconds: 900, condition: { kind: 'tribute_pact', receiver: 'varkon' } },
        ],
      },
      records: { m3_alignment: 'varkon' },
      recordFlags: ['m3_pact_accepted'],
    },
    {
      id: 'm3_show_of_force',
      title: 'Show of Force',
      debrief: 'The Dominion tested humanity and paid for it. Peace came on our terms.',
      condition: {
        kind: 'all',
        of: [
          { kind: 'objective_done', id: 'meet_concordium' },
          { kind: 'event_count', event: 'peace_signed', factionId: 'varkon', atLeast: 1 },
          { kind: 'value_at_least', key: 'war_exhaustion:varkon', value: 30 },
        ],
      },
      records: { m3_alignment: 'independent' },
    },
  ],
  defeat: [
    { condition: { kind: 'not', of: { kind: 'planet_owned_by', planetName: 'Haven', factionId: 'player' } }, reason: 'Haven has fallen.' },
  ],
};

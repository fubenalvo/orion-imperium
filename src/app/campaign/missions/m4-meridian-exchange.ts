import { Condition, MissionDefinition } from '../campaign.models';

/*
 * Mission 4 — The Meridian Exchange (docs/campaign-design.md §6, §7).
 *
 * Trade, mining and route security. Two Meridian League worlds (independent
 * civilizations with Trading Posts) anchor the map; the Exchange wormhole
 * links them, so it is the busiest — and most raided — route. League
 * standing (`league_standing`) is a campaign value, not a faction opinion:
 * civilizations have no diplomacy (§10). It comes from deliveries of player
 * traders to League ports, battles the player wins near League worlds,
 * resource-exchange volume (`valueSources`) and the Charter vote.
 *
 * - The Meridian Hub is protected from every AI assault (`protected`) until
 *   minute 35; then Varkon may attack it, unless the player signed the
 *   Varkon protection deal at the Charter vote. Cantor's Rest stays
 *   protected for the whole mission. The player is never restricted.
 * - Varkon's raids on civilian traders are the existing AI raid role. The AI
 *   only raids traders its sensors see near its territory, so Varkon holds
 *   Cantor Minor, next to the League port, and the gate's eastern mouth is
 *   ~14 cells out: League traders cross open space under Varkon sensors.
 * - Varkon and the Concordium never attack each other here (`aiRestraint`):
 *   their war is Mission 5.
 * - Victory: standing 60, 8,000 trade credits, two mining stations and the
 *   Hub still free; or market dominance (Trading Posts on 4 planets, one of
 *   them a captured League world), which costs League standing.
 *
 * Map rules this data relies on (m4-meridian-exchange.spec.ts): two belts
 * at x≈100 leave a gap at the Hub and around the map's north and south
 * edges, so east–west trade passes few choke cells; the Exchange wormhole
 * is active from the start.
 */

const HUB = { x: 100, y: 60 };
const CANTOR = { x: 150, y: 20 };
const FREE_PORT = { x: 120, y: 100 };

const HUB_FREE: Condition = { kind: 'planet_owned_by', planetName: 'Meridian Hub', factionId: 'independent' };
const LEAGUE_WORLD_TAKEN: Condition = {
  kind: 'any',
  of: [
    { kind: 'planet_owned_by', planetName: 'Meridian Hub', factionId: 'player' },
    { kind: 'planet_owned_by', planetName: "Cantor's Rest", factionId: 'player' },
  ],
};
const alignment = (value: string): Condition => ({ kind: 'flag', flag: 'm3_alignment', equals: value });

export const M4_MERIDIAN_EXCHANGE: MissionDefinition = {
  id: 'm4_meridian_exchange',
  version: 1,
  title: 'The Meridian Exchange',
  subtitle: 'Whoever carries the trade, carries the vote',
  briefing: [
    'The Meridian League invites every power to its Exchange. Influence goes to whoever carries the most trade.',
    'Build a trade network, secure your raw materials and keep the Exchange free. The Dominion has noticed the League\'s cargo holds.',
  ],
  seed: 1_404_223,
  requires: ['m3_first_contact'],
  rules: { standardVictory: false, pirates: false },
  carryIn: { m3_alignment: 'none' },
  aiRestraint: [
    { factionId: 'varkon', target: 'concordium' },
    { factionId: 'concordium', target: 'varkon' },
  ],
  valueSources: [
    { kind: 'delivery', toPlanets: ['Meridian Hub', "Cantor's Rest"], key: 'league_standing', amount: 1.5, cap: 40 },
    { kind: 'battle_won', nearSystems: ['meridian_hub', 'cantors_rest'], radius: 8, key: 'league_standing', amount: 5, cap: 100 },
    { kind: 'exchange', key: 'league_standing', perThousand: 2, cap: 20 },
  ],
  map: {
    width: 200,
    height: 120,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 3500, rawmaterials: 2000, research: 1000 },
      },
      {
        id: 'concordium',
        name: 'The Concordium',
        color: '#5fd3c8',
        kind: 'ai',
        personality: 'technologist',
        currencies: { credits: 4000, rawmaterials: 3000, research: 2000 },
        technologies: [
          'improved_power', 'fusion_power', 'basic_radar', 'advanced_radar', 'scout_technology', 'fighter_technology',
          'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research',
          'colonization_technology', 'frigate_technology', 'laser_optics', 'military_engineering', 'energy_shielding',
        ],
      },
      {
        id: 'varkon',
        name: 'Varkon Dominion',
        color: '#e0563c',
        kind: 'ai',
        personality: 'militarist',
        currencies: { credits: 3500, rawmaterials: 3500, research: 1000 },
        technologies: [
          'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'missile_technology',
          'advanced_engineering', 'military_engineering', 'frigate_technology', 'destroyer_technology', 'guided_missiles',
          'corvette_technology', 'ion_drives', 'advanced_construction', 'advanced_science', 'colonization_technology',
        ],
      },
      {
        id: 'free_port',
        name: 'Tangle Freebooters',
        color: '#c9a227',
        kind: 'outlaw',
        currencies: { credits: 0, rawmaterials: 0, research: 0 },
        technologies: ['turret_research_1'],
      },
    ],
    systems: [
      {
        id: 'corvane',
        name: 'Corvane',
        x: 30,
        y: 90,
        color: '#ffcc00',
        planets: [
          { name: 'Corvane', type: 'earthlike', size: 'medium', owner: 'player', population: 1200, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Corvane Outer', type: 'ice', size: 'small', explored: true },
        ],
      },
      {
        id: 'tamsin',
        name: 'Tamsin',
        x: 62,
        y: 102,
        color: '#f3f3f3',
        planets: [
          { name: 'Tamsin', type: 'desert', size: 'medium' },
          { name: 'Tamsin Veil', type: 'venuslike', size: 'small' },
        ],
      },
      {
        id: 'concord_reach',
        name: 'Concord Reach',
        x: 40,
        y: 24,
        color: '#5ca8ff',
        planets: [
          { name: 'Concord Reach', type: 'earthlike', size: 'big', owner: 'concordium', population: 1400, layout: 'homeworld', deposit: true },
          { name: 'Reach Vault', type: 'marslike', size: 'small' },
        ],
      },
      {
        id: 'cinderfall',
        name: 'Cinderfall',
        x: 70,
        y: 42,
        color: '#ff9a3c',
        planets: [
          { name: 'Cinderfall', type: 'marslike', size: 'medium' },
          { name: 'Cinder Shard', type: 'desert', size: 'tiny' },
        ],
        richAsteroids: [16_000, 13_000, 10_000],
      },
      {
        id: 'meridian_hub',
        name: 'Meridian Hub',
        x: HUB.x,
        y: HUB.y,
        color: '#ffcc00',
        planets: [
          {
            name: 'Meridian Hub', type: 'earthlike', size: 'big', owner: 'independent', civilization: 'Meridian League',
            population: 1000, satisfaction: 60, layout: 'civilization_capital', protected: true,
          },
          { name: 'Hub Annex', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'halcyon_drift',
        name: 'Halcyon Drift',
        x: 132,
        y: 88,
        color: '#f3f3f3',
        planets: [
          { name: 'Halcyon', type: 'gasgiant', size: 'big' },
          { name: 'Halcyon Rock', type: 'desert', size: 'tiny' },
        ],
        richAsteroids: [16_000, 13_000, 10_000],
      },
      {
        id: 'cantors_rest',
        name: "Cantor's Rest",
        x: CANTOR.x,
        y: CANTOR.y,
        color: '#5ca8ff',
        planets: [
          {
            name: "Cantor's Rest", type: 'marslike', size: 'medium', owner: 'independent', civilization: 'Meridian League',
            population: 800, satisfaction: 60, layout: 'civilization_capital', protected: true,
          },
          // Varkon's foothold next to the League port: its sensors and territory cover the Cantor's Rest lanes.
          { name: 'Cantor Minor', type: 'ice', size: 'small', owner: 'varkon', population: 500, layout: 'colony' },
        ],
      },
      {
        id: 'orrel',
        name: 'Orrel',
        x: 150,
        y: 56,
        color: '#39b8a8',
        planets: [
          { name: 'Orrel', type: 'venuslike', size: 'medium' },
          { name: 'Orrel Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'varkon_bastion',
        name: 'Varkon Bastion',
        x: 178,
        y: 76,
        color: '#d65757',
        planets: [
          { name: 'Varkon Bastion', type: 'marslike', size: 'big', owner: 'varkon', population: 1400, layout: 'homeworld', deposit: true },
          { name: 'Bastion Forge', type: 'desert', size: 'small' },
        ],
      },
    ],
    fleets: [
      { name: 'CORVANE GUARD', factionId: 'player', atPlanet: 'Corvane', ships: ['frigate', 'frigate', 'corvette', 'corvette', 'fighter', 'fighter'], speed: 6 },
      { name: 'PROSPECTOR', factionId: 'player', atPlanet: 'Corvane', ships: ['outpost_ship', 'scout'], speed: 6 },
      { name: 'CONCORD WATCH', factionId: 'concordium', x: 40, y: 24, ships: ['frigate', 'frigate', 'frigate', 'frigate'] },
      { name: 'DOMINION HOST', factionId: 'varkon', x: 178, y: 76, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer'] },
      { name: 'RAID WING', factionId: 'varkon', x: 166, y: 40, ships: ['frigate', 'frigate', 'corvette'] },
      { name: 'FREEBOOTERS', factionId: 'free_port', x: FREE_PORT.x, y: FREE_PORT.y, ships: ['corvette', 'corvette', 'corvette'], tag: 'freebooters' },
    ],
    spaceBases: [{ name: 'Tangle Free Port', factionId: 'free_port', x: FREE_PORT.x, y: FREE_PORT.y }],
    nebulae: [
      // The Tangle: the free port hides in it.
      { id: 1, x: FREE_PORT.x, y: FREE_PORT.y, radius: 10, lobes: [1, 0.88, 1.14, 0.92, 1.18, 0.86, 1.06, 0.82, 1.12, 0.96, 1.04], rotation: 0.4, color: '#7c5cd6' },
      { id: 2, x: 58, y: 66, radius: 9, lobes: [1.05, 0.9, 1.15, 0.86, 1, 1.1, 0.92, 1.06, 0.88], rotation: 1.6, color: '#3fa5a0' },
      // Raiders wait in it next to Cantor's Rest.
      { id: 3, x: 168, y: 40, radius: 9, lobes: [0.95, 1.12, 0.9, 1.08, 1, 0.86, 1.16, 0.94, 1.02], rotation: 2.6, color: '#b0466a' },
    ],
    asteroidBelts: [
      { id: 1, points: [{ x: 100, y: 14 }, { x: 102, y: 46 }], halfWidth: 2, visualSeed: 53 },
      { id: 2, points: [{ x: 98, y: 74 }, { x: 100, y: 106 }], halfWidth: 2, visualSeed: 61 },
    ],
    // The eastern mouth sits ~14 cells from Cantor's Rest: traders leaving the gate cross open space under Varkon sensors.
    wormholes: [{ id: 'exchange_gate', name: 'Exchange Gate', mouths: [{ x: 104, y: 56 }, { x: 140, y: 30 }], state: 'active' }],
    anomalies: [
      { key: 'm4_distress', type: 'distress_signal', factionId: 'concordium', x: 80, y: 80 },
      { key: 'm4_wreck', type: 'ancient_wreck', x: 58, y: 66 },
      { key: 'm4_derelict', type: 'derelict_outpost', x: 120, y: 74 },
    ],
    relations: [
      { a: 'player', b: 'concordium', state: 'peace', opinion: 10 },
      { a: 'player', b: 'varkon', state: 'peace', opinion: -10 },
      { a: 'concordium', b: 'varkon', state: 'peace', opinion: -30 },
    ],
    defaultView: { systemId: 'corvane', planetName: 'Corvane' },
  },
  researchHorizon: [
    // Missions 1–3
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
    'advanced_construction', 'advanced_industry', 'colonization_technology', 'advanced_radar',
    'turret_research_1', 'corvette_technology', 'frigate_technology',
    'military_engineering', 'destroyer_technology', 'fusion_power', 'advanced_research',
    'laser_optics', 'ion_drives', 'guided_missiles', 'energy_shielding',
    // New in Mission 4
    'advanced_manufacturing', 'orbital_engineering', 'orbital_repair_docks', 'turret_research_2', 'mass_drivers',
  ],
  baselineTechnologies: [
    'basic_radar', 'improved_power', 'scout_technology', 'fighter_technology', 'advanced_engineering',
    'advanced_construction', 'advanced_science', 'colonization_technology', 'frigate_technology', 'corvette_technology',
  ],
  objectives: [
    {
      id: 'trading_posts',
      title: 'Build Trading Posts on 2 planets',
      description: 'Each post sends out two traders. Deliveries to League ports raise your standing.',
      condition: { kind: 'building_complete', buildingId: 'trading_post', count: 2 },
    },
    {
      id: 'trade_income',
      title: 'Earn 8,000 credits from trade',
      description: 'Cargo your traders deliver and port fees at your posts.',
      condition: { kind: 'value_at_least', key: 'trade_income', value: 8000 },
      progress: { label: 'Trade income', metric: { value: 'trade_income' }, target: 8000 },
    },
    {
      id: 'league_standing',
      title: 'Raise League standing to 60',
      description: 'Deliveries to League ports, raiders beaten near League worlds, trade at the exchange, and the Charter vote.',
      condition: { kind: 'value_at_least', key: 'league_standing', value: 60 },
      progress: { label: 'Standing', metric: { value: 'league_standing' }, target: 60 },
    },
    {
      id: 'raw_supply',
      title: 'Own 2 mining stations',
      description: 'Planet deposits are thin here. Cinderfall and Halcyon Drift are rich; outpost ships deploy stations.',
      condition: { kind: 'mining_station', count: 2 },
    },
    {
      id: 'secure_exchange',
      title: 'Keep the Meridian Hub free',
      description: 'The Hub must not fall to anyone.',
      after: ['trading_posts', 'trade_income', 'league_standing', 'raw_supply'],
      condition: HUB_FREE,
      onComplete: [{ kind: 'end_mission', endingId: 'm4_exchange' }],
    },
    // Optional
    {
      id: 'free_port',
      title: 'Destroy the Tangle Free Port',
      description: 'A pirate base inside the Tangle nebula preys on everyone\'s traders.',
      optional: true,
      condition: { kind: 'base_destroyed', name: 'Tangle Free Port' },
      onComplete: [
        { kind: 'value', key: 'league_standing', delta: 10 },
        { kind: 'notice', text: 'The League thanks you for clearing the Tangle. League standing +10.' },
      ],
    },
    {
      id: 'safe_traders',
      title: 'Lose no trader until minute 30',
      optional: true,
      condition: { kind: 'game_time_at_least', seconds: 1800 },
      failIf: { kind: 'event_count', event: 'trader_lost', atLeast: 1 },
    },
  ],
  events: [
    {
      id: 'arrival',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'independent',
      speakerName: 'Meridian League',
      speakerColor: '#ffcc00',
      title: 'The Exchange Opens',
      text:
        '"The Meridian League welcomes every power to the Exchange. Carry our trade, and the League will listen to you. ' +
        'Attack our worlds, and it will not."',
      pause: true,
    },
    // What happened in Mission 3 colours the start.
    {
      id: 'alignment_concordium',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, alignment('concordium')] },
      speaker: 'concordium',
      title: 'The Accord Holds',
      text: 'The Concordium remembers the Accord. The Dominion remembers it too.',
      pause: false,
      effects: [
        { kind: 'opinion', holder: 'concordium', of: 'player', delta: 25 },
        { kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 },
      ],
    },
    {
      id: 'alignment_varkon',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, alignment('varkon')] },
      speaker: 'varkon',
      title: 'Old Tribute',
      text: 'The Dominion counts you among those who pay. The Concordium keeps its distance.',
      pause: false,
      effects: [
        { kind: 'opinion', holder: 'varkon', of: 'player', delta: 20 },
        { kind: 'opinion', holder: 'concordium', of: 'player', delta: -10 },
      ],
    },
    {
      id: 'alignment_independent',
      trigger: { kind: 'all', of: [{ kind: 'game_time_at_least', seconds: 2 }, alignment('independent')] },
      speaker: 'varkon',
      title: 'A Wary Respect',
      text: 'The Dominion has not forgotten the war it lost to you.',
      pause: false,
      effects: [
        { kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 },
        { kind: 'opinion', holder: 'concordium', of: 'player', delta: 5 },
      ],
    },
    {
      id: 'raiders',
      trigger: { kind: 'game_time_at_least', seconds: 720 },
      speaker: 'independent',
      speakerName: 'Meridian League',
      speakerColor: '#ffcc00',
      title: 'Raiders on the Lanes',
      text: 'League captains report Varkon warships stopping traders near Cantor\'s Rest. The League will remember who protects its cargo.',
      pause: false,
    },
    {
      id: 'charter_vote',
      trigger: {
        kind: 'any',
        of: [{ kind: 'game_time_at_least', seconds: 1500 }, { kind: 'value_at_least', key: 'league_standing', value: 50 }],
      },
      speaker: 'independent',
      speakerName: 'Meridian League',
      speakerColor: '#ffcc00',
      title: 'The Charter Vote',
      text: '"The League will grant a trade charter. Tell us what humanity asks for, and we will vote."',
      pause: true,
      choices: [
        {
          id: 'exclusive',
          label: 'An exclusive charter for humanity',
          consequences: 'League standing +25. Concordium opinion −15.',
          effects: [
            { kind: 'flag', flag: 'm4_charter', value: 'exclusive' },
            { kind: 'value', key: 'league_standing', delta: 25 },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -15 },
          ],
        },
        {
          id: 'open',
          label: 'An open charter for every power',
          consequences: 'League standing +12. Concordium opinion +10.',
          effects: [
            { kind: 'flag', flag: 'm4_charter', value: 'open' },
            { kind: 'value', key: 'league_standing', delta: 12 },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 },
          ],
        },
        {
          id: 'varkon',
          label: 'Back the Dominion\'s protection deal',
          consequences: 'Varkon opinion +20 and the Dominion leaves the Hub alone. League standing −15.',
          effects: [
            { kind: 'flag', flag: 'm4_charter', value: 'varkon' },
            { kind: 'value', key: 'league_standing', delta: -15 },
            { kind: 'opinion', holder: 'varkon', of: 'player', delta: 20 },
          ],
        },
      ],
    },
    {
      id: 'varkon_moves',
      trigger: {
        kind: 'all',
        of: [{ kind: 'game_time_at_least', seconds: 2100 }, { kind: 'not', of: { kind: 'flag', flag: 'm4_charter', equals: 'varkon' } }],
      },
      speaker: 'independent',
      speakerName: 'Meridian League',
      speakerColor: '#ffcc00',
      title: 'The Dominion Moves',
      text: '"Varkon has renounced its respect for the Exchange. Its fleets may come for the Hub itself. Stand with us."',
      pause: true,
      effects: [{ kind: 'protect_planet', planetName: 'Meridian Hub', protect: true, except: ['varkon'] }],
    },
    {
      id: 'league_world_taken',
      trigger: LEAGUE_WORLD_TAKEN,
      speaker: 'independent',
      speakerName: 'Meridian League',
      speakerColor: '#ffcc00',
      title: 'The League Remembers',
      text: '"You came as a trader and left as a conqueror. The League will not forget it."',
      pause: false,
      effects: [
        { kind: 'flag', flag: 'm4_league_conquered', value: true },
        { kind: 'value', key: 'league_standing', delta: -40 },
      ],
    },
  ],
  endings: [
    {
      id: 'm4_exchange',
      title: 'The Free Exchange',
      debrief: 'The Exchange stands, its lanes carry human cargo, and the League listens when humanity speaks.',
      condition: { kind: 'objective_done', id: 'secure_exchange' },
      records: { m4_path: 'exchange' },
      recordFlags: ['m4_charter'],
      recordValues: ['league_standing'],
    },
    {
      id: 'm4_market_dominance',
      title: 'Market Dominance',
      debrief: 'Humanity owns the trade of the Frontier. The League trades with us because it must, not because it wants to.',
      condition: {
        kind: 'all',
        of: [{ kind: 'building_complete', buildingId: 'trading_post', count: 4 }, LEAGUE_WORLD_TAKEN],
      },
      records: { m4_path: 'dominance' },
      recordFlags: ['m4_charter', 'm4_league_conquered'],
      recordValues: ['league_standing'],
    },
  ],
  defeat: [
    { condition: { kind: 'planet_owned_by', planetName: 'Meridian Hub', factionId: 'varkon' }, reason: 'The Dominion took the Meridian Hub. The Exchange is closed.' },
  ],
};

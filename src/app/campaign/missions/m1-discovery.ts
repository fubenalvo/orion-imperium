import { MissionDefinition } from '../campaign.models';

/*
 * Mission 1 — The Discovery (docs/campaign-design.md §6, §7).
 *
 * The tutorial mission: three systems, no AI empire. The objective chain
 * walks through the core loop (construction, research, scouting, an anomaly,
 * production, a battle) and ends when the expedition — a Colonizer with at
 * least one warship — stands on the mouth of the Kepler lens.
 *
 * Map rules this data relies on (checked by mission-validation.ts and
 * m1-discovery.spec.ts):
 * - the belt between Sol and Kepler Deep blocks the direct route, so the way
 *   to the lens leads past Proxima (belts are walls, learned by flying);
 * - the Remnant sentinel stands on the lens mouth and never moves (outlaws
 *   have no AI), so reaching the mouth means fighting it;
 * - the probe wreck at Proxima charts the lens (reveal_area) whichever
 *   choice the player makes.
 *
 * Frigates need Advanced Engineering, so the strike group is fighters (basic
 * hulls); Advanced Engineering is in the horizon for players who want more.
 */

const LENS = { x: 86, y: 40 };

export const M1_DISCOVERY: MissionDefinition = {
  id: 'm1_discovery',
  version: 1,
  title: 'The Discovery',
  subtitle: 'A lens that should not exist',
  briefing: [
    'The deep-space probe Far Reach went silent near Kepler Deep after reporting a gravitational lens that no natural object can explain.',
    'Build up Earth, find out what happened to the probe and prepare an expedition.',
  ],
  seed: 1_202_611,
  requires: [],
  rules: { standardVictory: false, pirates: false, tutorial: true },
  tutorialExcludedSteps: ['diplomacy'],
  map: {
    width: 100,
    height: 60,
    factions: [
      {
        id: 'player',
        name: 'Humanity',
        color: '#8cc4ff',
        kind: 'player',
        currencies: { credits: 1000, rawmaterials: 2500, research: 1000 },
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
        id: 'sol',
        name: 'Sol',
        x: 22,
        y: 34,
        color: '#ffcc00',
        planets: [
          { name: 'Earth', type: 'earthlike', size: 'medium', owner: 'player', population: 1200, layout: 'homeworld', deposit: true, explored: true },
          { name: 'Mars', type: 'marslike', size: 'small', explored: true },
          { name: 'Jupiter', type: 'gasgiant', size: 'huge', explored: true },
        ],
      },
      {
        id: 'proxima',
        name: 'Proxima',
        x: 52,
        y: 16,
        color: '#d65757',
        planets: [{ name: 'Proxima b', type: 'ice', size: 'small' }],
      },
      {
        id: 'kepler_deep',
        name: 'Kepler Deep',
        x: 80,
        y: 38,
        color: '#5ca8ff',
        planets: [{ name: 'Deep One', type: 'desert', size: 'tiny' }],
      },
    ],
    fleets: [
      { name: 'ORION', factionId: 'player', atPlanet: 'Earth', ships: ['scout', 'scout', 'fighter'], speed: 8 },
      { name: 'SENTINEL', factionId: 'remnant', x: LENS.x, y: LENS.y, ships: ['fighter', 'fighter'], tag: 'sentinel' },
    ],
    asteroidBelts: [{ id: 1, points: [{ x: 50, y: 28 }, { x: 60, y: 66 }], halfWidth: 2, visualSeed: 7 }],
    wormholes: [{ id: 'kepler_lens', name: 'Kepler Lens', mouths: [{ x: LENS.x, y: LENS.y }], state: 'active' }],
    anomalies: [{ key: 'm1_probe', type: 'probe_wreck', systemId: 'proxima' }],
    relations: [],
    defaultView: { systemId: 'sol', planetName: 'Earth' },
  },
  researchHorizon: [
    'basic_engineering', 'basic_science', 'basic_industry', 'basic_power',
    'improved_power', 'basic_radar', 'scout_technology', 'fighter_technology',
    'missile_technology', 'advanced_science', 'advanced_engineering',
  ],
  baselineTechnologies: [],
  objectives: [
    {
      id: 'start_clock',
      title: 'Start the clock',
      description: 'The game is paused. Press play or a speed button in the header.',
      condition: { kind: 'game_time_at_least', seconds: 1 },
    },
    {
      id: 'build_mine',
      title: 'Build a Mining Complex on Earth',
      description: 'Raw materials build ships. Place it next to the deposit.',
      after: ['start_clock'],
      condition: { kind: 'building_complete', buildingId: 'mining_complex', planetName: 'Earth' },
    },
    {
      id: 'build_shipyard',
      title: 'Build a Spaceship Factory and a Spaceport',
      description: 'The factory builds ships; the Spaceport turns them into fleets.',
      after: ['build_mine'],
      condition: {
        kind: 'all',
        of: [
          { kind: 'building_complete', buildingId: 'spaceship_factory' },
          { kind: 'building_complete', buildingId: 'spaceport' },
        ],
      },
    },
    {
      id: 'research_radar',
      title: 'Research Basic Radar',
      description: 'Open research from the header. Better sensors find the probe.',
      after: ['build_mine'],
      condition: { kind: 'technology', technologyId: 'basic_radar' },
    },
    {
      id: 'scout_proxima',
      title: 'Scout Proxima',
      description: 'Select your fleet and right-click Proxima.',
      after: ['research_radar'],
      condition: { kind: 'system_charted', systemId: 'proxima' },
    },
    {
      id: 'investigate_probe',
      title: 'Investigate the probe signal',
      description: 'Fly a fleet into the Proxima system.',
      after: ['scout_proxima'],
      condition: { kind: 'anomaly_resolved', key: 'm1_probe' },
    },
    {
      id: 'strike_group',
      title: 'Form a strike group of 3 fighters',
      description: 'Queue fighters at the factory, then assemble them into one fleet at the Spaceport.',
      after: ['investigate_probe', 'build_shipyard'],
      condition: { kind: 'fleet_with', ships: { fighter: 3 } },
    },
    {
      id: 'destroy_sentinel',
      title: 'Destroy the sentinel at the lens',
      description: 'Select your strike group and right-click the sentinel at Kepler Deep.',
      after: ['strike_group'],
      condition: { kind: 'fleet_tag_destroyed', tag: 'sentinel' },
      onComplete: [{ kind: 'event', eventId: 'stable_wormhole' }],
    },
    {
      id: 'expedition',
      title: 'Send the expedition through the lens',
      description: 'A fleet with a Colonizer and at least one warship, on the lens.',
      after: ['destroy_sentinel'],
      condition: { kind: 'fleet_at', x: LENS.x, y: LENS.y, radius: 1, ships: { colonizer: 1 }, minCombatShips: 1 },
      onComplete: [{ kind: 'end_mission', endingId: 'through_the_gate' }],
    },
    {
      id: 'colonize_mars',
      title: 'Found a colony on Mars',
      optional: true,
      after: ['start_clock'],
      condition: { kind: 'planet_owned_by', planetName: 'Mars', factionId: 'player' },
      onComplete: [{ kind: 'flag', flag: 'm1_mars_colony', value: true }],
    },
    {
      id: 'fighter_tech',
      title: 'Research Fighter Technology',
      optional: true,
      after: ['research_radar'],
      condition: { kind: 'technology', technologyId: 'fighter_technology' },
    },
  ],
  events: [
    {
      id: 'sol_command',
      trigger: { kind: 'game_time_at_least', seconds: 1 },
      speaker: 'narrator',
      title: 'Sol Command',
      text:
        'Probe Far Reach went silent near Kepler Deep after reporting a gravitational lens that should not exist. ' +
        'Build up Earth and find out what happened. Your objectives stay on screen.',
      pause: true,
    },
    {
      id: 'lens_sighted',
      trigger: { kind: 'system_charted', systemId: 'kepler_deep' },
      speaker: 'narrator',
      title: 'Kepler Deep',
      text: 'Something guards the lens: an automated sentinel of unknown design holds position at its edge.',
      pause: false,
    },
    {
      id: 'stable_wormhole',
      speaker: 'narrator',
      title: 'A Stable Wormhole',
      text:
        'With the sentinel gone, the readings are clear: the lens is a stable wormhole, and it was built. ' +
        'Send an expedition through — a Colonizer, escorted by at least one warship.',
      pause: true,
    },
  ],
  endings: [
    {
      id: 'through_the_gate',
      title: 'Through the Gate',
      debrief: 'The expedition crossed into the unknown. Behind it, the gate went dark.',
      condition: { kind: 'objective_done', id: 'expedition' },
      recordFlags: ['m1_mars_colony'],
    },
  ],
};

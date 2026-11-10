import researchTreeData from '../../components/star-map/research-tree.json';
import { Condition, Effect, MissionDefinition, StoryEventDef } from '../campaign.models';

/*
 * Mission 7 — The New Frontier, the finale (docs/campaign-design.md §6, §7).
 *
 * Fought over the Dyson ring around the Lacuna Heart, the generator's
 * centred black hole (`map.blackHole`): 8 anchor slots, wedge territory,
 * Swarm Constructors, bonuses, the warm-up — all existing Dyson gameplay
 * (docs/dyson-swarm.md). The mission adds (`dyson` rules):
 *
 * - the Dampener bonus (dyson-anchor.ts): no economy bonus, never part of a
 *   warm-up, lowers instability;
 * - instability (campaign value 0–100): + 1.5/min per opener anchor (the
 *   player's own count half), + 2/min during a single-faction warm-up,
 *   − 2/min per Dampener, − 2/min during the Union's coalition warm-up;
 *   100 = the network cascades (defeat for everyone);
 * - per-faction AI plans (EnemyDysonService.planOf): Varkon builds openers
 *   and hunts from 3 anchors; the Observers (`guardian`) build up to 4
 *   Dampeners and hunt every opener; the Concordium and the League build
 *   only as Charter members (at most 3 each) and spare the player's warm-up
 *   while their opinion of the player is ≥ 20;
 * - the Union coalition: once the Charter is signed, the player, the
 *   Concordium and the League may complete the ring together (each ≥ 1,
 *   none > 3) for a coalition warm-up (dyson-victory.ts).
 *
 * Endings: Human Dominion (the player's own warm-up completes), Galactic
 * Union (the coalition's warm-up completes), the Observers' Accord (the
 * Heart quieted with 4 Dampeners and no opener, then all four gate mouths
 * sealed — campaign sites — by the player or the Observers). Defeat:
 * instability 100, or anyone else's warm-up completes.
 *
 * Five network pulses (every 12 minutes) carry the story; pulses 2–4 bring
 * Remnant sentinels to a gate mouth. Belts form a cross that splits the map
 * into quadrants meeting around the Heart; the Alpha and Omega wormholes
 * are the fast lanes (Alpha: the player's quadrant ↔ north of the Heart;
 * Omega: Varkon's quadrant ↔ west of the Heart).
 */

const ALL_STANDARD_TECHNOLOGIES = (researchTreeData as { technologies: { id: string; campaignOnly?: boolean }[] }).technologies
  .filter((t) => t.campaignOnly !== true)
  .map((t) => t.id);

const CENTER = { x: 150.5, y: 90.5 };
const MOUTHS = {
  alphaSouth: { x: 40, y: 150 },
  alphaNorth: { x: 150, y: 66 },
  omegaEast: { x: 260, y: 150 },
  omegaWest: { x: 124, y: 90 },
};
const SEALS = ['seal_alpha_south', 'seal_alpha_north', 'seal_omega_east', 'seal_omega_west'];

const flagIs = (flag: string, value: string): Condition => ({ kind: 'flag', flag, equals: value });
const at = (seconds: number): Condition => ({ kind: 'game_time_at_least', seconds });
const NEVER: Condition = { kind: 'flag', flag: 'm7_never' };

/* Two archives held in Mission 6 (any pair). */
const ARCHIVES_HELD: Condition = {
  kind: 'any',
  of: [
    { kind: 'all', of: [flagIs('site:archive_1', 'player'), flagIs('site:archive_2', 'player')] },
    { kind: 'all', of: [flagIs('site:archive_1', 'player'), flagIs('site:archive_3', 'player')] },
    { kind: 'all', of: [flagIs('site:archive_2', 'player'), flagIs('site:archive_3', 'player')] },
  ],
};
/* The Observers' Accord can be sealed: trust, the archive data, a quiet Heart. */
const ACCORD_READY: Condition = {
  kind: 'all',
  of: [
    { kind: 'opinion_at_least', holder: 'observers', of: 'player', value: 40 },
    { kind: 'any', of: [flagIs('m6_shared_with', 'observers'), ARCHIVES_HELD] },
    { kind: 'anchors', factionIds: ['player', 'observers'], anchorKind: 'dampener', atLeast: 4 },
    { kind: 'anchors', anchorKind: 'opener', atMost: 0 },
  ],
};
const CHARTER_READY: Condition = {
  kind: 'all',
  of: [
    { kind: 'relation', a: 'player', b: 'concordium', state: 'peace' },
    { kind: 'relation', a: 'player', b: 'meridian', state: 'peace' },
    { kind: 'opinion_at_least', holder: 'concordium', of: 'player', value: 50 },
    { kind: 'opinion_at_least', holder: 'meridian', of: 'player', value: 50 },
  ],
};
const SIGN_CHARTER: Effect[] = [
  { kind: 'flag', flag: 'm7_union_charter', value: true },
  { kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 },
  { kind: 'opinion', holder: 'meridian', of: 'player', delta: 10 },
  { kind: 'opinion', holder: 'varkon', of: 'player', delta: -15 },
];

/* Mission 6's archives claimed by an AI empire: it keeps that archive's ancient technology. */
const ARCHIVE_TECHS: [string, string][] = [
  ['archive_1', 'remnant_sensor_lattice'],
  ['archive_2', 'remnant_shield_matrix'],
  ['archive_3', 'remnant_drive'],
];
const archiveEvents: StoryEventDef[] = ARCHIVE_TECHS.flatMap(([site, technologyId]) =>
  ['concordium', 'varkon', 'meridian'].map((factionId) => ({
    id: `inherit_${site}_${factionId}`,
    trigger: { kind: 'all', of: [at(2), flagIs(`site:${site}`, factionId)] } as Condition,
    speaker: factionId,
    title: 'Remnant Knowledge',
    text: 'They kept what they took from the archives.',
    pause: false,
    effects: [{ kind: 'grant_technology', factionId, technologyId } as Effect],
  })),
);

/*
 * The pulses also finish Swarm Constructors: the young empires of the finale
 * cannot fund the swarm race from their income alone (measured, see
 * campaign-design.md), so the story delivers the constructors and the AI
 * Dyson plans decide where they go.
 */
const constructor = (factionId: string, name: string, x: number, y: number, escort: string[]): Effect => ({
  kind: 'spawn_fleet', factionId, name, x, y, ships: ['swarm_constructor', ...escort],
});
const VARKON_YARD = { x: 246, y: 136 };
const VIGIL_YARD = { x: 166, y: 32 };

const sentinels = (name: string, x: number, y: number, tag: string): Effect => ({
  kind: 'spawn_fleet', factionId: 'remnant', name, x, y, ships: ['destroyer', 'destroyer', 'cruiser'], tag,
});

export const M7_NEW_FRONTIER: MissionDefinition = {
  id: 'm7_new_frontier',
  version: 1,
  title: 'The New Frontier',
  subtitle: 'The Lacuna Heart',
  briefing: [
    'At the heart of the Frontier lies the Lacuna Heart, and around it the foundations of the swarm that once powered every gate.',
    'Power it alone, share it, or quiet it for good. Every empire is coming, and the network grows restless with every anchor raised.',
  ],
  seed: 1_707_571,
  requires: ['m6_silent_remnant'],
  rules: { standardVictory: false, pirates: false },
  carryIn: { m3_alignment: 'none', m4_path: 'none', m5_role: 'none', m6_shared_with: 'none' },
  sites: [
    { id: 'seal_alpha_south', name: 'Alpha Gate (south)', ...MOUTHS.alphaSouth, radius: 1, holdSeconds: 120, minWarships: 2, activeWhen: ACCORD_READY },
    { id: 'seal_alpha_north', name: 'Alpha Gate (north)', ...MOUTHS.alphaNorth, radius: 1, holdSeconds: 120, minWarships: 2, activeWhen: ACCORD_READY },
    { id: 'seal_omega_east', name: 'Omega Gate (east)', ...MOUTHS.omegaEast, radius: 1, holdSeconds: 120, minWarships: 2, activeWhen: ACCORD_READY },
    { id: 'seal_omega_west', name: 'Omega Gate (west)', ...MOUTHS.omegaWest, radius: 1, holdSeconds: 120, minWarships: 2, activeWhen: ACCORD_READY },
  ],
  // Measured (campaign-design.md): without it the Observers ran a deficit and parked their fleets.
  aiStipends: { observers: 60, varkon: 30, concordium: 20, meridian: 20 },
  aiDirectives: SEALS.map((siteId) => ({ factionId: 'observers', siteId, mode: 'claim' as const, minWarships: 2, minSurvival: 0.3 })),
  dyson: {
    dampener: true,
    // Young empires fight this finale: a full ring must be affordable within the mission.
    anchorUpkeepFactor: 0.05,
    constructorCostFactor: 0.04,
    plans: [
      { factionId: 'varkon', plan: { build: 'always', huntAnchors: 3, saveForConstructor: true } },
      { factionId: 'observers', plan: { build: 'always', bonus: 'dampener', maxAnchors: 4, openersOnly: true, huntAnchors: 1, saveForConstructor: true } },
      { factionId: 'concordium', whenFlag: 'm7_union_charter', plan: { build: 'always', maxAnchors: 3, huntAnchors: Number.POSITIVE_INFINITY, warmupHuntBelowOpinion: 20, saveForConstructor: true } },
      { factionId: 'concordium', plan: { build: 'never', huntAnchors: Number.POSITIVE_INFINITY, warmupHuntBelowOpinion: 20 } },
      { factionId: 'meridian', whenFlag: 'm7_union_charter', plan: { build: 'always', maxAnchors: 3, huntAnchors: Number.POSITIVE_INFINITY, warmupHuntBelowOpinion: 20, saveForConstructor: true } },
      { factionId: 'meridian', plan: { build: 'rich', maxAnchors: 3, huntAnchors: Number.POSITIVE_INFINITY, warmupHuntBelowOpinion: 20 } },
    ],
    coalition: { id: 'union', name: 'The Galactic Union', members: ['player', 'concordium', 'meridian'], maxPerMember: 3, whenFlag: 'm7_union_charter' },
    instability: { key: 'instability', openerPerMinute: 1.5, playerOpenerFactor: 0.5, warmupPerMinute: 2, dampenerPerMinute: 2, coalitionWarmupPerMinute: 2 },
  },
  map: {
    width: 300,
    height: 180,
    blackHole: true,
    factions: [
      { id: 'player', name: 'Humanity', color: '#8cc4ff', kind: 'player', currencies: { credits: 8000, rawmaterials: 6000, research: 3000 } },
      {
        id: 'concordium', name: 'The Concordium', color: '#5fd3c8', kind: 'ai', personality: 'technologist',
        currencies: { credits: 9000, rawmaterials: 7000, research: 4000 },
        technologies: [
          'improved_power', 'fusion_power', 'advanced_power', 'basic_radar', 'advanced_radar', 'scout_technology', 'fighter_technology',
          'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research', 'applied_science',
          'colonization_technology', 'frigate_technology', 'laser_optics', 'military_engineering', 'energy_shielding',
          'destroyer_technology', 'turret_research_1', 'turret_research_2', 'advanced_manufacturing', 'orbital_engineering',
          'advanced_shipyards', 'cruiser_technology', 'shield_harmonics',
        ],
      },
      {
        id: 'varkon', name: 'Varkon Dominion', color: '#e0563c', kind: 'ai', personality: 'militarist',
        currencies: { credits: 9000, rawmaterials: 9000, research: 3000 },
        technologies: [
          'improved_power', 'fusion_power', 'advanced_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'missile_technology',
          'advanced_engineering', 'military_engineering', 'frigate_technology', 'destroyer_technology', 'guided_missiles',
          'corvette_technology', 'ion_drives', 'advanced_construction', 'advanced_science', 'advanced_research', 'applied_science',
          'colonization_technology', 'mass_drivers', 'turret_research_1', 'turret_research_2', 'advanced_weapons',
          'orbital_engineering', 'advanced_shipyards', 'cruiser_technology', 'stellar_engineering',
        ],
      },
      {
        id: 'meridian', name: 'Meridian League', color: '#ffcc00', kind: 'ai', personality: 'mercantile',
        currencies: { credits: 12000, rawmaterials: 6000, research: 3000 },
        technologies: [
          'improved_power', 'fusion_power', 'advanced_power', 'basic_radar', 'scout_technology', 'fighter_technology', 'advanced_engineering',
          'advanced_construction', 'advanced_industry', 'advanced_manufacturing', 'advanced_science', 'advanced_research', 'applied_science',
          'colonization_technology', 'frigate_technology', 'corvette_technology', 'turret_research_1', 'orbital_engineering', 'orbital_repair_docks',
        ],
      },
      {
        id: 'observers', name: 'The Observers', color: '#c8d6ff', kind: 'ai', personality: 'guardian',
        currencies: { credits: 9000, rawmaterials: 7000, research: 5000 },
        technologies: [
          'improved_power', 'fusion_power', 'advanced_power', 'basic_radar', 'advanced_radar', 'long_range_radar', 'scout_technology',
          'fighter_technology', 'advanced_engineering', 'advanced_construction', 'advanced_industry', 'advanced_science', 'advanced_research',
          'applied_science', 'frigate_technology', 'military_engineering', 'destroyer_technology', 'energy_shielding', 'shield_harmonics',
          'turret_research_1', 'turret_research_2', 'turret_research_3', 'advanced_weapons', 'orbital_engineering', 'advanced_shipyards',
          'cruiser_technology', 'stellar_engineering',
        ],
      },
      { id: 'remnant', name: 'Remnant Sentinels', color: '#b07cff', kind: 'outlaw', currencies: { credits: 0, rawmaterials: 0, research: 0 } },
    ],
    systems: [
      {
        id: 'new_haven', name: 'New Haven', x: 50, y: 140, color: '#ffcc00',
        planets: [
          { name: 'New Haven', type: 'earthlike', size: 'big', owner: 'player', population: 1500, layout: 'stronghold', deposit: true, explored: true },
          { name: 'Haven Belt', type: 'desert', size: 'small', explored: true },
          { name: 'Haven Deep', type: 'gasgiant', size: 'big', explored: true },
        ],
      },
      {
        id: 'ardent', name: 'Ardent', x: 80, y: 118, color: '#39b8a8',
        planets: [
          { name: 'Ardent', type: 'marslike', size: 'medium', owner: 'player', population: 800, layout: 'colony', explored: true },
          { name: 'Ardent Minor', type: 'ice', size: 'small', explored: true },
        ],
      },
      {
        id: 'dunmore', name: 'Dunmore', x: 98, y: 104, color: '#f3f3f3',
        planets: [
          { name: 'Dunmore', type: 'desert', size: 'medium' },
          { name: 'Dunmore Rock', type: 'marslike', size: 'tiny' },
        ],
      },
      {
        id: 'tamar', name: 'Tamar', x: 110, y: 152, color: '#5ca8ff',
        planets: [
          { name: 'Tamar', type: 'earthlike', size: 'medium', owner: 'independent', civilization: 'Tamar Covenant', population: 900, satisfaction: 60, layout: 'civilization_capital' },
          { name: 'Tamar Minor', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'concord_apex', name: 'Concord Apex', x: 50, y: 40, color: '#5ca8ff',
        planets: [
          { name: 'Concord Apex', type: 'earthlike', size: 'big', owner: 'concordium', population: 1500, layout: 'stronghold', deposit: true },
          { name: 'Apex Vault', type: 'marslike', size: 'small' },
          { name: 'Apex Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'sorrel', name: 'Sorrel', x: 96, y: 52, color: '#f3f3f3',
        planets: [
          { name: 'Sorrel', type: 'venuslike', size: 'medium' },
          { name: 'Sorrel Ice', type: 'ice', size: 'small' },
          { name: 'Sorrel Shard', type: 'desert', size: 'tiny' },
        ],
      },
      {
        id: 'ilos', name: 'Ilos', x: 116, y: 20, color: '#f3f3f3',
        planets: [
          { name: 'Ilos', type: 'desert', size: 'medium' },
          { name: 'Ilos Deep', type: 'gasgiant', size: 'medium' },
        ],
      },
      {
        id: 'vigil', name: 'Vigil', x: 168, y: 28, color: '#c8d6ff',
        planets: [
          { name: 'Vigil', type: 'ice', size: 'big', owner: 'observers', population: 1500, layout: 'stronghold', deposit: true },
          { name: 'Vigil Shard', type: 'desert', size: 'tiny' },
        ],
      },
      {
        id: 'evrin', name: 'Evrin', x: 206, y: 24, color: '#5ca8ff',
        planets: [
          { name: 'Evrin', type: 'marslike', size: 'medium', owner: 'independent', civilization: 'Evrin Assembly', population: 900, satisfaction: 60, layout: 'civilization_capital' },
          { name: 'Evrin Ice', type: 'ice', size: 'small' },
          { name: 'Evrin Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'meridian_crown', name: 'Meridian Crown', x: 252, y: 40, color: '#ffcc00',
        planets: [
          { name: 'Meridian Crown', type: 'earthlike', size: 'big', owner: 'meridian', population: 1500, layout: 'stronghold', deposit: true },
          { name: 'Crown Exchange', type: 'ice', size: 'small' },
          { name: 'Crown Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'myre', name: 'Myre', x: 228, y: 66, color: '#ff9a3c',
        planets: [
          { name: 'Myre', type: 'desert', size: 'medium' },
          { name: 'Myre Veil', type: 'venuslike', size: 'small' },
          { name: 'Myre Rock', type: 'marslike', size: 'tiny' },
        ],
        richAsteroids: [18_000, 14_000, 10_000],
      },
      {
        id: 'kesh', name: 'Kesh', x: 214, y: 118, color: '#d65757',
        planets: [
          { name: 'Kesh', type: 'desert', size: 'medium', owner: 'varkon', population: 900, layout: 'colony' },
          { name: 'Kesh Minor', type: 'ice', size: 'small' },
        ],
      },
      {
        id: 'varkos_throne', name: 'Varkos Throne', x: 250, y: 140, color: '#d65757',
        planets: [
          { name: 'Varkos Throne', type: 'marslike', size: 'big', owner: 'varkon', population: 1500, layout: 'stronghold', deposit: true },
          { name: 'Throne Forge', type: 'desert', size: 'small' },
          { name: 'Throne Deep', type: 'gasgiant', size: 'big' },
        ],
      },
      {
        id: 'hask', name: 'Hask', x: 196, y: 152, color: '#ff9a3c',
        planets: [
          { name: 'Hask', type: 'marslike', size: 'medium' },
          { name: 'Hask Ice', type: 'ice', size: 'small' },
        ],
        richAsteroids: [18_000, 14_000, 10_000],
      },
    ],
    fleets: [
      // Fleets sized to the starting economies (upkeep), not to the finale's stakes.
      { name: 'HAVEN ARMADA', factionId: 'player', atPlanet: 'New Haven', ships: ['frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'cruiser'], speed: 6 },
      { name: 'VANGUARD', factionId: 'player', atPlanet: 'New Haven', ships: ['frigate', 'frigate', 'destroyer', 'scout'], speed: 6 },
      { name: 'CONCORD FLEET', factionId: 'concordium', x: 50, y: 40, ships: ['frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'cruiser'] },
      { name: 'DOMINION ARMADA', factionId: 'varkon', x: 250, y: 140, ships: ['frigate', 'frigate', 'frigate', 'frigate', 'destroyer', 'destroyer', 'cruiser'] },
      { name: 'KESH WING', factionId: 'varkon', x: 214, y: 118, ships: ['frigate', 'frigate', 'destroyer'] },
      { name: 'LEAGUE ESCORT', factionId: 'meridian', x: 252, y: 40, ships: ['frigate', 'frigate', 'corvette', 'corvette'] },
      { name: 'VIGIL HOST', factionId: 'observers', x: 168, y: 28, ships: ['frigate', 'frigate', 'destroyer', 'destroyer', 'cruiser'] },
      // The race starts at once: Varkon and the Observers each bring one Swarm Constructor.
      { name: 'DOMINION SWARM BUILDERS', factionId: 'varkon', x: 246, y: 136, ships: ['swarm_constructor', 'frigate', 'frigate'] },
      { name: 'OBSERVER WARDENS', factionId: 'observers', x: 166, y: 32, ships: ['swarm_constructor', 'destroyer'] },
    ],
    nebulae: [
      // The Omega approach (Varkon's advantage) and the Observers' homeworld.
      { id: 1, x: 236, y: 152, radius: 10, lobes: [1, 0.88, 1.14, 0.92, 1.18, 0.86, 1.06, 0.82, 1.12, 0.96, 1.04], rotation: 0.6, color: '#b0466a' },
      { id: 2, x: 176, y: 34, radius: 9, lobes: [1.05, 0.9, 1.15, 0.86, 1, 1.1, 0.92, 1.06, 0.88], rotation: 1.4, color: '#7c5cd6' },
      { id: 3, x: 70, y: 70, radius: 8, lobes: [0.95, 1.12, 0.9, 1.08, 1, 0.86, 1.16, 0.94, 1.02], rotation: 2.1, color: '#3fa5a0' },
      { id: 4, x: 128, y: 134, radius: 8, lobes: [1, 1.1, 0.9, 1.05, 0.95, 1.12, 0.88, 1.02], rotation: 0.2, color: '#8a7a6a' },
    ],
    asteroidBelts: [
      // The cross: four arms from the map edges toward the Heart; the quadrants meet around it.
      { id: 1, points: [{ x: 150, y: 8 }, { x: 150, y: 58 }], halfWidth: 2, visualSeed: 101 },
      { id: 2, points: [{ x: 150, y: 122 }, { x: 150, y: 172 }], halfWidth: 2, visualSeed: 103 },
      { id: 3, points: [{ x: 10, y: 90 }, { x: 114, y: 90 }], halfWidth: 2, visualSeed: 107 },
      { id: 4, points: [{ x: 186, y: 90 }, { x: 290, y: 90 }], halfWidth: 2, visualSeed: 109 },
    ],
    wormholes: [
      { id: 'alpha', name: 'Alpha Gate', mouths: [MOUTHS.alphaSouth, MOUTHS.alphaNorth], state: 'active' },
      { id: 'omega', name: 'Omega Gate', mouths: [MOUTHS.omegaEast, MOUTHS.omegaWest], state: 'active' },
    ],
    anomalies: [
      { key: 'm7_wreck_west', type: 'ancient_wreck', x: 120, y: 112 },
      { key: 'm7_wreck_east', type: 'ancient_wreck', x: 190, y: 66 },
      { key: 'm7_derelict', type: 'derelict_outpost', x: 70, y: 160 },
      { key: 'm7_distress', type: 'distress_signal', factionId: 'meridian', x: 220, y: 30 },
    ],
    relations: [
      { a: 'player', b: 'concordium', state: 'peace', opinion: 20 },
      { a: 'player', b: 'varkon', state: 'peace', opinion: -20 },
      { a: 'player', b: 'meridian', state: 'peace', opinion: 20 },
      { a: 'player', b: 'observers', state: 'peace', opinion: 0, contact: false },
      { a: 'concordium', b: 'varkon', state: 'peace', opinion: -30 },
      { a: 'concordium', b: 'meridian', state: 'peace', opinion: 20 },
      { a: 'concordium', b: 'observers', state: 'peace', opinion: 0 },
      { a: 'varkon', b: 'meridian', state: 'peace', opinion: -10 },
      { a: 'varkon', b: 'observers', state: 'peace', opinion: -20 },
      { a: 'meridian', b: 'observers', state: 'peace', opinion: 0 },
    ],
    defaultView: { systemId: 'new_haven', planetName: 'New Haven' },
  },
  // Everything researchable (Stellar Engineering included); ancient technologies stay grant-only.
  researchHorizon: ALL_STANDARD_TECHNOLOGIES,
  baselineTechnologies: [
    'basic_radar', 'improved_power', 'scout_technology', 'fighter_technology', 'advanced_engineering',
    'advanced_construction', 'advanced_science', 'colonization_technology', 'frigate_technology', 'corvette_technology',
    'military_engineering', 'destroyer_technology', 'fusion_power', 'advanced_research', 'orbital_engineering',
    'advanced_shipyards', 'cruiser_technology',
  ],
  objectives: [
    {
      id: 'stellar_engineering',
      title: 'Master Stellar Engineering',
      description: 'Swarm Constructors build anchors on the ring around the Lacuna Heart.',
      condition: { kind: 'technology', technologyId: 'stellar_engineering' },
    },
    {
      id: 'stability',
      title: 'Keep the network from cascading',
      description:
        'Every opener anchor raises instability (yours count half), a warm-up raises it faster, every Dampener lowers it. At 100 the Frontier goes silent.',
      condition: NEVER,
      progress: { label: 'Instability', metric: { value: 'instability' }, target: 100 },
    },
    {
      id: 'decide',
      title: 'Decide the future of the Heart',
      description:
        'Human Dominion: hold all 8 slots and complete the warm-up. Galactic Union: sign the Charter and complete the ring together (each member 1–3 anchors). ' +
        'Observers\' Accord: 4 Dampeners, no opener on the ring, then seal all four gate mouths (hold each for 120 s).',
      condition: NEVER,
    },
    // Optional
    {
      id: 'first_anchor',
      title: 'Raise your first anchor',
      optional: true,
      condition: { kind: 'anchors', factionIds: ['player'], atLeast: 1 },
    },
    {
      id: 'meet_observers',
      title: 'Meet the Observers',
      optional: true,
      condition: { kind: 'in_contact', a: 'player', b: 'observers' },
    },
  ],
  events: [
    {
      id: 'arrival',
      trigger: at(1),
      speaker: 'narrator',
      speakerName: 'New Haven Command',
      title: 'The Lacuna Heart',
      text:
        'The ring around the Lacuna Heart has eight foundations, and every empire on the Frontier can see them. ' +
        'Whoever raises the swarm decides what the network becomes. Or whether it wakes at all.',
      pause: true,
    },
    // What earlier missions left behind.
    {
      id: 'carry_shared_observers', trigger: { kind: 'all', of: [at(2), flagIs('m6_shared_with', 'observers')] }, speaker: 'narrator',
      speakerName: 'The Observers', speakerColor: '#c8d6ff', title: 'A Debt Remembered', text: 'Those who shared the core are remembered.', pause: false,
      effects: [{ kind: 'opinion', holder: 'observers', of: 'player', delta: 25 }],
    },
    {
      id: 'carry_shared_concordium', trigger: { kind: 'all', of: [at(2), flagIs('m6_shared_with', 'concordium')] }, speaker: 'concordium',
      title: 'Shared Knowledge', text: 'The Concordium has studied the core data you gave it.', pause: false,
      effects: [{ kind: 'opinion', holder: 'concordium', of: 'player', delta: 20 }],
    },
    {
      id: 'carry_shared_league', trigger: { kind: 'all', of: [at(2), flagIs('m6_shared_with', 'league')] }, speaker: 'meridian',
      title: 'A Good Investment', text: 'The League values partners who share what they find.', pause: false,
      effects: [{ kind: 'opinion', holder: 'meridian', of: 'player', delta: 20 }],
    },
    {
      id: 'carry_ally', trigger: { kind: 'all', of: [at(2), flagIs('m5_role', 'ally')] }, speaker: 'concordium',
      title: 'Brothers in Arms', text: 'The Concordium remembers who stood with it in the Reach.', pause: false,
      effects: [{ kind: 'opinion', holder: 'concordium', of: 'player', delta: 15 }, { kind: 'opinion', holder: 'varkon', of: 'player', delta: -15 }],
    },
    {
      id: 'carry_mediator', trigger: { kind: 'all', of: [at(2), flagIs('m5_role', 'mediator')] }, speaker: 'narrator',
      speakerName: 'New Haven Command', title: 'The Peacemaker', text: 'Both sides of the Kessan war remember who ended it.', pause: false,
      effects: [{ kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 }, { kind: 'opinion', holder: 'varkon', of: 'player', delta: 10 }],
    },
    {
      id: 'carry_partner', trigger: { kind: 'all', of: [at(2), flagIs('m5_role', 'partner')] }, speaker: 'varkon',
      title: 'Old Partners', text: 'The Dominion remembers who paid it in the Reach.', pause: false,
      effects: [{ kind: 'opinion', holder: 'varkon', of: 'player', delta: 15 }, { kind: 'opinion', holder: 'concordium', of: 'player', delta: -10 }],
    },
    {
      id: 'carry_exchange', trigger: { kind: 'all', of: [at(2), flagIs('m4_path', 'exchange')] }, speaker: 'meridian',
      title: 'Trusted Traders', text: 'The League remembers who kept the Exchange free.', pause: false,
      effects: [{ kind: 'opinion', holder: 'meridian', of: 'player', delta: 15 }],
    },
    {
      id: 'carry_dominance', trigger: { kind: 'all', of: [at(2), flagIs('m4_path', 'dominance')] }, speaker: 'meridian',
      title: 'A Cold Market', text: 'The League has not forgotten the Exchange.', pause: false,
      effects: [{ kind: 'opinion', holder: 'meridian', of: 'player', delta: -25 }],
    },
    ...archiveEvents,
    // The network pulses: every 12 minutes, five times.
    {
      id: 'pulse_1',
      trigger: at(720),
      speaker: 'narrator',
      speakerName: 'The Observers',
      speakerColor: '#c8d6ff',
      title: 'The First Pulse',
      text:
        'The gates surge and the Heart flares; the eight foundations light up on every screen. A voice: ' +
        '"We are the Observers. Every anchor you raise opens the gates wider. We will not let them open again."',
      pause: true,
      effects: [
        { kind: 'contact', factionId: 'observers' },
        { kind: 'reveal_area', x: CENTER.x, y: CENTER.y, radius: 14 },
        constructor('varkon', 'DOMINION SWARM BUILDERS', VARKON_YARD.x, VARKON_YARD.y, ['frigate']),
        constructor('observers', 'OBSERVER WARDENS', VIGIL_YARD.x, VIGIL_YARD.y, ['destroyer']),
      ],
    },
    {
      id: 'pulse_2', trigger: at(1440), speaker: 'narrator', speakerName: 'New Haven Command', title: 'The Second Pulse',
      text: 'Remnant sentinels pour out of the Alpha Gate, north of the Heart.', pause: false,
      effects: [
        sentinels('REMNANT SENTINELS', MOUTHS.alphaNorth.x, MOUTHS.alphaNorth.y - 2, 'pulse_2'),
        constructor('varkon', 'DOMINION SWARM BUILDERS', VARKON_YARD.x, VARKON_YARD.y, ['frigate']),
      ],
    },
    {
      id: 'pulse_3', trigger: at(2160), speaker: 'narrator', speakerName: 'New Haven Command', title: 'The Third Pulse',
      text: 'Remnant sentinels guard the Omega Gate west of the Heart.', pause: false,
      effects: [
        sentinels('REMNANT SENTINELS', MOUTHS.omegaWest.x - 2, MOUTHS.omegaWest.y - 3, 'pulse_3'),
        constructor('varkon', 'DOMINION SWARM BUILDERS', VARKON_YARD.x, VARKON_YARD.y, ['frigate']),
        constructor('observers', 'OBSERVER WARDENS', VIGIL_YARD.x, VIGIL_YARD.y, ['destroyer']),
      ],
    },
    {
      id: 'pulse_4', trigger: at(2880), speaker: 'narrator', speakerName: 'New Haven Command', title: 'The Fourth Pulse',
      text: 'The Alpha Gate answers again, this time in our quadrant.', pause: false,
      effects: [
        sentinels('REMNANT SENTINELS', MOUTHS.alphaSouth.x + 3, MOUTHS.alphaSouth.y - 3, 'pulse_4'),
        constructor('varkon', 'DOMINION SWARM BUILDERS', VARKON_YARD.x, VARKON_YARD.y, ['frigate']),
      ],
    },
    {
      id: 'union_charter',
      trigger: { kind: 'all', of: [CHARTER_READY, { kind: 'not', of: { kind: 'flag', flag: 'm7_union_charter' } }] },
      speaker: 'concordium',
      title: 'The Union Charter',
      text:
        '"The Concordium and the League propose a Charter: the ring shared, no power holding more than three foundations, ' +
        'and no member raising its guns over an anchor. Will humanity sign?"',
      pause: true,
      choices: [
        { id: 'sign', label: 'Sign the Union Charter', consequences: 'The Concordium and the League build anchors with you and never hunt yours. Varkon opinion −15.', effects: SIGN_CHARTER },
        { id: 'later', label: 'Not yet', consequences: 'The offer returns at the summit.', effects: [] },
      ],
    },
    {
      id: 'dominion_pressure',
      trigger: { kind: 'dyson_warmup', state: 'running', holder: 'player' },
      speaker: 'narrator',
      speakerName: 'The Observers',
      speakerColor: '#c8d6ff',
      title: 'The Network Wakes',
      text: '"You will not power it alone." Remnant sentinels rise at the ring, and an Observer fleet leaves Vigil.',
      pause: false,
      effects: [
        sentinels('RING SENTINELS', Math.round(CENTER.x + 6.5), Math.round(CENTER.y + 2.5), 'ring_sentinels_east'),
        sentinels('RING SENTINELS', Math.round(CENTER.x - 6.5), Math.round(CENTER.y - 2.5), 'ring_sentinels_west'),
        { kind: 'spawn_fleet', factionId: 'observers', name: 'OBSERVER VANGUARD', x: 168, y: 32, ships: ['destroyer', 'destroyer', 'cruiser', 'cruiser'], tag: 'observer_reinforcement' },
      ],
    },
    {
      id: 'instability_warning',
      trigger: { kind: 'value_at_least', key: 'instability', value: 70 },
      speaker: 'narrator',
      speakerName: 'New Haven Command',
      title: 'The Heart Trembles',
      text: 'Instability is at 70. If it reaches 100, the network cascades and the Frontier goes silent.',
      pause: false,
    },
    {
      id: 'summit',
      trigger: at(3600),
      speaker: 'narrator',
      speakerName: 'The Fifth Pulse',
      title: 'The Summit',
      text:
        'The fifth pulse brings every power to the Heart. The envoys meet under the ring. Whatever humanity says now, the others will remember.',
      pause: true,
      choices: [
        {
          id: 'charter', label: 'Propose the Union Charter again', consequences: 'Signs the Charter.', effects: SIGN_CHARTER,
          requires: { kind: 'all', of: [CHARTER_READY, { kind: 'not', of: { kind: 'flag', flag: 'm7_union_charter' } }] },
        },
        {
          id: 'accord', label: 'Pledge to quiet the Heart', consequences: 'Observer opinion +15; Varkon opinion −10.',
          effects: [{ kind: 'flag', flag: 'm7_accord_pledge', value: true }, { kind: 'opinion', holder: 'observers', of: 'player', delta: 15 }, { kind: 'opinion', holder: 'varkon', of: 'player', delta: -10 }],
          requires: { kind: 'in_contact', a: 'player', b: 'observers' },
        },
        {
          id: 'dominion', label: 'Declare the ring humanity\'s', consequences: 'Every other power trusts you less (opinion −15).',
          effects: [
            { kind: 'flag', flag: 'm7_dominion_declared', value: true },
            { kind: 'opinion', holder: 'concordium', of: 'player', delta: -15 },
            { kind: 'opinion', holder: 'meridian', of: 'player', delta: -15 },
            { kind: 'opinion', holder: 'observers', of: 'player', delta: -15 },
          ],
        },
        { id: 'silent', label: 'Say nothing', consequences: 'Nothing changes.', effects: [] },
      ],
    },
  ],
  endings: [
    {
      id: 'm7_human_dominion',
      title: 'Human Dominion',
      debrief:
        'The swarm burns around the Lacuna Heart, and every gate of the Frontier answers to humanity. ' +
        'The others will never forgive it. They will not need to: they will need us. The campaign is complete.',
      condition: { kind: 'dyson_warmup', state: 'completed', holder: 'player' },
      records: { m7_ending: 'human_dominion' },
    },
    {
      id: 'm7_galactic_union',
      title: 'The Galactic Union',
      debrief:
        'Three powers raised the swarm together and no one holds it alone. The gates open under a Charter, ' +
        'and the Frontier has a future that belongs to all of it. The campaign is complete.',
      condition: { kind: 'dyson_warmup', state: 'completed', holder: 'coalition:union' },
      records: { m7_ending: 'galactic_union' },
    },
    {
      id: 'm7_observers_accord',
      title: 'The Observers\' Accord',
      debrief:
        'The Heart sleeps under the Dampeners and the gates are sealed. The Observers keep their watch, ' +
        'and for the first time they keep it with us. The Silent Frontier stays silent, by choice. The campaign is complete.',
      condition: { kind: 'sites_claimed', siteIds: SEALS, count: 4, factionIds: ['player', 'observers'] },
      records: { m7_ending: 'observers_accord' },
    },
  ],
  defeat: [
    { condition: { kind: 'value_at_least', key: 'instability', value: 100 }, reason: 'The network cascaded. The Silent Frontier went silent again.' },
    {
      condition: { kind: 'dyson_warmup', state: 'completed', notHolders: ['player', 'coalition:union'] },
      reason: 'The network opens under someone else\'s swarm.',
    },
  ],
};

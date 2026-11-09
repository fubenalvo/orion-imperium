import { StarMapData } from '../components/star-map/star-map.models';
import { CampaignSessionState, Condition } from './campaign.models';
import { CampaignWorld, EvaluationContext, evaluateCondition } from './campaign-objectives';
import { buildMission } from './mission-builder';
import { M0_FIXTURE } from './missions/m0-fixture';

describe('campaign objectives (conditions)', () => {
  let data: StarMapData;
  let session: CampaignSessionState;
  let explored: Set<string>;

  const world = (gameSeconds = 0): CampaignWorld => ({
    gameSeconds,
    factions: data.factions,
    starSystems: data.starSystems,
    fleets: data.fleets,
    exploredGridCells: explored,
  });
  const ctx = (dt = 1, gameSeconds = 0): EvaluationContext => ({ world: world(gameSeconds), session, dt });
  const check = (condition: Condition, dt = 1) => evaluateCondition(condition, ctx(dt));

  beforeEach(() => {
    data = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });
    session = data.campaign!;
    explored = new Set();
  });

  it('reads flags, values, counters and objective states from the session', () => {
    session.flags['a'] = 'x';
    session.values['standing'] = 30;
    session.counters['battle_won'] = 2;
    session.objectives['chart_proxima'].status = 'done';
    expect(check({ kind: 'flag', flag: 'a' })).toBe(true);
    expect(check({ kind: 'flag', flag: 'a', equals: 'y' })).toBe(false);
    expect(check({ kind: 'flag', flag: 'missing' })).toBe(false);
    expect(check({ kind: 'value_at_least', key: 'standing', value: 30 })).toBe(true);
    expect(check({ kind: 'event_count', event: 'battle_won', atLeast: 3 })).toBe(false);
    expect(check({ kind: 'objective_done', id: 'chart_proxima' })).toBe(true);
  });

  it('charts a system by its explored galaxy cell', () => {
    expect(check({ kind: 'system_charted', systemId: 'proxima' })).toBe(false);
    explored.add('70-26');
    expect(check({ kind: 'system_charted', systemId: 'proxima' })).toBe(true);
    expect(check({ kind: 'systems_charted', count: 1 })).toBe(true);
    expect(check({ kind: 'systems_charted', count: 2 })).toBe(false);
  });

  it('counts only completed player buildings, not construction sites', () => {
    expect(check({ kind: 'building_complete', buildingId: 'capital' })).toBe(true);
    expect(check({ kind: 'building_complete', buildingId: 'mining_complex' })).toBe(false);
    const earth = data.starSystems[0].planetsTiles[0];
    earth.buildings.push({ name: 'Mining Complex', size: 2, x: 0, y: 0, constructionRemaining: 10, constructionTotal: 30 });
    expect(check({ kind: 'building_complete', buildingId: 'mining_complex' })).toBe(false);
    earth.buildings[earth.buildings.length - 1].constructionRemaining = 0;
    expect(check({ kind: 'building_complete', buildingId: 'mining_complex', planetName: 'Earth' })).toBe(true);
  });

  it('reads planets, population and technologies of the player', () => {
    expect(check({ kind: 'planets_owned', count: 1 })).toBe(true);
    expect(check({ kind: 'planets_owned', count: 2 })).toBe(false);
    expect(check({ kind: 'planet_owned_by', planetName: 'Mars', factionId: 'unhabited' })).toBe(true);
    expect(check({ kind: 'population_at_least', value: 1200 })).toBe(true);
    expect(check({ kind: 'population_at_least', value: 1201 })).toBe(false);
    expect(check({ kind: 'technology', technologyId: 'basic_engineering' })).toBe(true);
    expect(check({ kind: 'technology', technologyId: 'basic_radar' })).toBe(false);
  });

  it('treats a tagged fleet as destroyed when the fleet or all its ships are gone', () => {
    const condition: Condition = { kind: 'fleet_tag_destroyed', tag: 'sentinel' };
    expect(check(condition)).toBe(false);
    const sentinel = data.fleets.find((f) => f.name === 'SENTINEL')!;
    sentinel.ships.forEach((s) => (s.destroyed = true));
    expect(check(condition)).toBe(true);
    expect(check({ kind: 'fleet_tag_destroyed', tag: 'unknown' }), 'a tag without fleets is never a win').toBe(false);
  });

  it('finds a player fleet at a cell with the required ships', () => {
    const orion = data.fleets.find((f) => f.name === 'ORION')!;
    expect(check({ kind: 'fleet_at', x: 25, y: 32, ships: { scout: 2 } })).toBe(true);
    expect(check({ kind: 'fleet_at', x: 25, y: 32, ships: { colonizer: 1 } })).toBe(false);
    orion.x = 68;
    orion.y = 26;
    expect(check({ kind: 'fleet_at', x: 70, y: 26, radius: 2 })).toBe(true);
  });

  it('advances held_for timers only while the condition holds, and freezes them at dt 0', () => {
    const held: Condition = { kind: 'held_for', id: 't', seconds: 3, condition: { kind: 'flag', flag: 'on' } };
    session.flags['on'] = true;
    expect(check(held, 1)).toBe(false);
    expect(check(held, 0), 'paused: no progress').toBe(false);
    expect(check(held, 1)).toBe(false);
    expect(check(held, 1)).toBe(true);
    session.flags['on'] = false;
    expect(check(held, 1)).toBe(false);
    expect(session.heldTimers['t']).toBe(0);
  });

  it('evaluates every child of a composite, so nested timers advance even after a match', () => {
    session.flags['on'] = true;
    const condition: Condition = {
      kind: 'any',
      of: [{ kind: 'flag', flag: 'on' }, { kind: 'held_for', id: 'inner', seconds: 10, condition: { kind: 'flag', flag: 'on' } }],
    };
    expect(check(condition, 2)).toBe(true);
    expect(session.heldTimers['inner']).toBe(2);
    expect(check({ kind: 'not', of: { kind: 'flag', flag: 'on' } })).toBe(false);
  });
});

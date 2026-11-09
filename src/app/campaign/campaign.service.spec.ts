import { TestBed } from '@angular/core/testing';
import { StarMapData } from '../components/star-map/star-map.models';
import { ResearchService } from '../services/research.service';
import { CampaignService } from './campaign.service';
import { CampaignProgressService } from './campaign-progress.service';
import { CampaignWorld } from './campaign-objectives';
import { buildMission } from './mission-builder';
import { M0_FIXTURE } from './missions/m0-fixture';
import { clearTestMissions, getMissionDefinition, registerTestMission } from './missions';

describe('CampaignService', () => {
  let service: CampaignService;
  let data: StarMapData;
  let explored: Set<string>;
  let seconds: number;

  const world = (): CampaignWorld => ({
    gameSeconds: seconds,
    factions: data.factions,
    starSystems: data.starSystems,
    fleets: data.fleets,
    exploredGridCells: explored,
  });
  const tick = (dt = 1) => {
    seconds += dt;
    return service.tick(dt, world());
  };
  const status = (id: string) => service.state!.objectives[id].status;
  const player = () => data.factions.find((f) => f.id === 'player')!;
  const killSentinel = () => data.fleets.find((f) => f.name === 'SENTINEL')!.ships.forEach((s) => (s.destroyed = true));

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CampaignService);
    data = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });
    explored = new Set();
    seconds = 0;
    service.restore(data.campaign);
  });

  afterEach(() => {
    clearTestMissions();
    service.leave();
    localStorage.clear();
  });

  it('activates objectives without prerequisites and keeps chained ones locked', () => {
    const result = tick();
    expect(result.changed).toBe(true);
    expect(status('chart_proxima')).toBe('active');
    expect(status('research_radar')).toBe('active');
    expect(status('destroy_sentinel')).toBe('locked');
  });

  it('completes an objective once, applies its effects once and unlocks the next one in the same tick', () => {
    tick();
    explored.add('70-26');
    const result = tick();
    expect(status('chart_proxima')).toBe('done');
    expect(status('destroy_sentinel')).toBe('active');
    expect(service.state!.flags['proxima_charted']).toBe(true);
    expect(result.notices).toContain('Proxima charted.');
    expect(tick().notices).not.toContain('Proxima charted.');
  });

  it('pays an objective reward exactly once', () => {
    tick();
    const credits = player().currencies['credits'];
    player().researchedTechnologies!.push('basic_radar');
    tick();
    tick();
    expect(status('research_radar')).toBe('done');
    expect(player().currencies['credits']).toBe(credits + 500);
  });

  it('shows non-modal events as notices once, and queues modal events', () => {
    const first = tick(1);
    expect(first.notices).toContain('Proving Ground: The range is live.');
    expect(tick().notices.some((n) => n.includes('The range is live'))).toBe(false);
    explored.add('70-26');
    tick();
    killSentinel();
    tick();
    expect(service.pendingEvent?.id).toBe('sentinel_down');
  });

  it('ends the mission through an event choice, records the victory and stops evaluating', () => {
    tick();
    explored.add('70-26');
    tick();
    killSentinel();
    tick();
    expect(service.chooseEventOption('sentinel_down', 'nope', world()).changed, 'unknown choice').toBe(false);
    const result = service.chooseEventOption('sentinel_down', 'report', world());
    expect(result.outcome).toEqual({ kind: 'victory', endingId: 'cleared' });
    expect(service.pendingEvent).toBeNull();
    const record = TestBed.inject(CampaignProgressService).getRecord('m0_fixture');
    expect(record?.endingId).toBe('cleared');
    expect(record?.records).toEqual({ m0_cleared: true });
    expect(record?.researchedTechnologies).toContain('basic_engineering');
    expect(tick().outcome, 'a decided mission is not re-evaluated').toBeNull();
  });

  it('decides a defeat from the mission defeat conditions', () => {
    tick();
    (service.state as any).flags['force_defeat'] = true;
    expect(tick().outcome).toEqual({ kind: 'defeat', reason: 'Test defeat.' });
    expect(TestBed.inject(CampaignProgressService).getRecord('m0_fixture')).toBeUndefined();
  });

  it('counts notified events and reports them as a change', () => {
    tick();
    service.notify('battle_won');
    service.notify('battle_won');
    expect(tick().changed).toBe(true);
    expect(service.state!.counters.battle_won).toBe(2);
  });

  it('round-trips through serialize and restore, and drops what the definition does not know', () => {
    tick();
    explored.add('70-26');
    tick();
    const saved = service.serialize()!;
    (saved.objectives as any)['retired_objective'] = { status: 'done' };
    saved.pendingEvents.push('retired_event');
    delete (saved.objectives as any)['research_radar'];
    service.restore(saved);
    expect(status('chart_proxima')).toBe('done');
    expect(service.state!.objectives['retired_objective']).toBeUndefined();
    expect(service.state!.pendingEvents).not.toContain('retired_event');
    expect(status('research_radar'), 'a new objective starts locked').toBe('locked');
  });

  it('ignores a session of an unknown mission and treats the game as a normal one', () => {
    service.restore({ ...data.campaign!, missionId: 'no_such_mission' });
    expect(service.active).toBe(false);
    expect(service.piratesAllowed()).toBe(true);
  });

  it('sets the research horizon on restore and clears it on leave', () => {
    const research = TestBed.inject(ResearchService);
    expect(research.hasCampaignHorizon()).toBe(true);
    expect(research.isAvailable(player(), 'basic_radar')).toBe(true);
    expect(research.isAvailable(player(), 'advanced_engineering'), 'outside the fixture horizon').toBe(false);
    service.leave();
    expect(research.hasCampaignHorizon()).toBe(false);
    expect(research.isAvailable(player(), 'advanced_engineering')).toBe(true);
  });

  it('fails a timed objective when its time runs out, and an objective whose failIf holds', () => {
    registerTestMission({
      ...M0_FIXTURE,
      id: 'm0_timed',
      objectives: [
        { id: 'timed', title: 'Timed', condition: { kind: 'flag', flag: 'never' }, timeLimitSeconds: 3, onFail: [{ kind: 'flag', flag: 'timed_failed', value: true }] },
        { id: 'guarded', title: 'Guarded', condition: { kind: 'flag', flag: 'never' }, failIf: { kind: 'flag', flag: 'break' } },
      ],
      events: [],
    });
    const timed = buildMission(getMissionDefinition('m0_timed')!, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });
    service.restore(timed.campaign);
    tick();
    tick(0);
    tick();
    expect(status('timed'), 'paused seconds do not count').toBe('active');
    tick();
    expect(status('timed')).toBe('failed');
    expect(service.state!.flags['timed_failed']).toBe(true);
    (service.state as any).flags['break'] = true;
    tick();
    expect(status('guarded')).toBe('failed');
  });

  it('switches pirates by the mission rules', () => {
    expect(service.piratesAllowed()).toBe(false);
  });

  it('lists revealed objectives with progress for the tracker', () => {
    tick();
    const views = service.objectiveViews(world());
    expect(views.map((v) => v.id)).toEqual(['chart_proxima', 'research_radar']);
    expect(views[1].optional).toBe(true);
  });
});

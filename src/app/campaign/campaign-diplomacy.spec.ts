import { TestBed } from '@angular/core/testing';
import { StarMapData } from '../components/star-map/star-map.models';
import { getRelation, makeContact, startWar } from '../components/star-map/diplomacy';
import { CampaignService } from './campaign.service';
import { CampaignWorld } from './campaign-objectives';
import { buildMission } from './mission-builder';
import { M3_FIRST_CONTACT } from './missions/m3-first-contact';

/*
 * The campaign's diplomacy hooks (Phase 4b): per-empire event counters,
 * planet-loss bookkeeping, story-event effects, forced contacts, tribute
 * pacts and scripted AI restraint. Pure service level on the Mission 3 map.
 */
describe('CampaignService diplomacy hooks', () => {
  let service: CampaignService;
  let data: StarMapData;
  let seconds: number;

  const world = (): CampaignWorld => ({
    gameSeconds: seconds,
    factions: data.factions,
    starSystems: data.starSystems,
    fleets: data.fleets,
    exploredGridCells: new Set(),
  });
  const tick = (dt = 1) => {
    seconds += dt;
    return service.tick(dt, world());
  };
  const faction = (id: string) => data.factions.find((f) => f.id === id)!;
  const planet = (name: string) => data.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === name)!;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CampaignService);
    data = buildMission(M3_FIRST_CONTACT, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });
    seconds = 0;
    service.restore(data.campaign);
  });

  afterEach(() => {
    service.leave();
    localStorage.clear();
  });

  it('counts events per empire as well as in total', () => {
    service.notify('battle_won', 1, 'varkon');
    service.notify('battle_won');
    expect(service.state!.counters['battle_won']).toBe(2);
    expect(service.state!.counters['battle_won:varkon']).toBe(1);
  });

  it('counts a lost planet by its new owner, but not the planets owned at the start', () => {
    tick();
    expect(service.state!.counters['planet_lost']).toBeUndefined();
    expect(service.state!.playerPlanets).toEqual(['Haven']);
    planet('Haven').factionId = 'varkon';
    tick();
    expect(service.state!.counters['planet_lost']).toBe(1);
    expect(service.state!.counters['planet_lost:varkon']).toBe(1);
    tick();
    expect(service.state!.counters['planet_lost']).toBe(1);
  });

  it('applies a fired story event\'s effects once: the Concordium envoy forces a contact', () => {
    tick();
    seconds = 359;
    tick();
    expect(service.state!.firedEvents).toContain('concordium_envoy');
    expect(service.forcedContacts).toEqual(['concordium']);
    // Once the pair has met, the forced contact is done.
    makeContact(faction('player'), faction('concordium'));
    tick();
    expect(service.forcedContacts).toEqual([]);
  });

  it('advances held_for timers inside event triggers', () => {
    makeContact(faction('player'), faction('varkon'));
    for (let i = 0; i < 59; i++) tick();
    expect(service.state!.firedEvents).not.toContain('varkon_tribute');
    tick();
    tick();
    expect(service.state!.firedEvents).toContain('varkon_tribute');
    const result = service.state!.flags['m3_varkon_demanded'];
    expect(result).toBe(true);
  });

  it('returns a forced demand as a diplomacy action for StarMap', () => {
    const result = service.applyExternalEffects(
      [{ kind: 'force_demand', demander: 'varkon', target: 'player', demandKind: 'tribute', amount: 400 }],
      world(),
    );
    expect(result.diplomacy).toEqual([{ kind: 'force_demand', demander: 'varkon', target: 'player', demandKind: 'tribute', amount: 400 }]);
  });

  it('applies opinion effects directly', () => {
    const before = getRelation(faction('concordium'), faction('player'))!.opinion ?? 0;
    service.applyExternalEffects([{ kind: 'opinion', holder: 'concordium', of: 'player', delta: 10 }], world());
    expect(getRelation(faction('concordium'), faction('player'))!.opinion).toBe(before + 10);
  });

  describe('tribute pact', () => {
    const acceptPact = () => service.applyExternalEffects([{ kind: 'tribute_pact', receiver: 'varkon', amount: 250, intervalSeconds: 120 }], world());

    it('pays every interval and survives a save round trip', () => {
      makeContact(faction('player'), faction('varkon'));
      acceptPact();
      const credits = faction('player').currencies['credits'];
      const theirs = faction('varkon').currencies['credits'];
      for (let i = 0; i < 119; i++) tick();
      expect(faction('player').currencies['credits']).toBe(credits);
      const result = tick();
      expect(faction('player').currencies['credits']).toBe(credits - 250);
      expect(faction('varkon').currencies['credits']).toBe(theirs + 250);
      expect(result.notices).toContain('Tribute paid to Varkon Dominion: 250 credits.');
      expect(service.state!.values['tribute_paid:varkon']).toBe(250);

      service.restore(service.serialize());
      expect(service.state!.tributePacts).toEqual([{ receiver: 'varkon', amount: 250, intervalSeconds: 120, untilNext: 120 }]);
    });

    it('breaks with a war declaration by the receiver when a payment cannot be made', () => {
      makeContact(faction('player'), faction('varkon'));
      acceptPact();
      faction('player').currencies['credits'] = 100;
      service.state!.tributePacts![0].untilNext = 1;
      const result = tick();
      expect(service.hasTributePact('varkon', 'player')).toBe(false);
      expect(service.state!.flags['tribute_pact_broken']).toBe(true);
      expect(result.diplomacy).toEqual([{ kind: 'start_war', a: 'varkon', b: 'player', declarer: 'varkon' }]);
      expect(faction('player').currencies['credits']).toBe(100);
    });

    it('ends without a new war when the two are already at war', () => {
      makeContact(faction('player'), faction('varkon'));
      acceptPact();
      startWar(faction('varkon'), faction('player'), 0, 'player');
      const result = tick();
      expect(service.hasTributePact('varkon', 'player')).toBe(false);
      expect(result.diplomacy).toEqual([]);
    });
  });

  describe('AI restraint', () => {
    it('holds Varkon back from the player until its ultimatum, and from the Concordium for the whole mission', () => {
      expect(service.restrains('varkon', 'player')).toBe(true);
      expect(service.restrains('varkon', 'concordium')).toBe(true);
      expect(service.restrains('concordium', 'player')).toBe(false);
      service.applyExternalEffects([{ kind: 'flag', flag: 'm3_varkon_ultimatum', value: true }], world());
      expect(service.restrains('varkon', 'player')).toBe(false);
      expect(service.restrains('varkon', 'concordium')).toBe(true);
    });

    it('also holds back an empire the player pays a tribute pact', () => {
      service.applyExternalEffects([
        { kind: 'flag', flag: 'm3_varkon_ultimatum', value: true },
        { kind: 'tribute_pact', receiver: 'concordium', amount: 100, intervalSeconds: 60 },
      ], world());
      expect(service.restrains('concordium', 'player')).toBe(true);
    });

    it('restrains nobody outside a campaign', () => {
      service.leave();
      expect(service.restrains('varkon', 'player')).toBe(false);
    });
  });
});

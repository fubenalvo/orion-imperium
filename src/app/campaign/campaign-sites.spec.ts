import { Faction, Fleet, SpaceBase } from '../components/star-map/star-map.models';
import { CampaignSiteDef } from './campaign.models';
import { SiteWorld, advanceSite, emptySiteState, sitePresence } from './campaign-sites';

/* Campaign site rules (campaign-sites.ts): presence, contest by hostiles, decay, claim. */
describe('campaign sites', () => {
  const TEAMS: Record<string, number> = { player: 1, varkon: 2, concordium: 3, remnant: 0 };
  const def: CampaignSiteDef = { id: 's', name: 'Site', x: 10, y: 10, radius: 1, holdSeconds: 10, minWarships: 2 };
  const faction = (id: string, extra: Partial<Faction> = {}): Faction =>
    ({ id, name: id, color: '#fff', team: TEAMS[id] ?? 9, currencies: {}, ...extra }) as Faction;
  const fleet = (id: number, factionId: string, x: number, y: number, warships = 2): Fleet =>
    ({ id, name: `F${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, ships: Array.from({ length: warships }, (_, i) => ({ id: id * 10 + i, name: 's', type: 'frigate' })) }) as unknown as Fleet;
  const peace = (a: Faction, b: Faction) => {
    a.relations = { ...(a.relations ?? {}), [b.id]: { state: 'peace', lockRemaining: 0 } };
    b.relations = { ...(b.relations ?? {}), [a.id]: { state: 'peace', lockRemaining: 0 } };
  };
  const world = (factions: Faction[], fleets: Fleet[], spaceBases: SpaceBase[] = []): SiteWorld => ({
    factions, fleets, spaceBases, warships: (f) => f.ships.filter((s) => !s.destroyed).length,
  });

  it('needs enough warships within the radius', () => {
    const player = faction('player');
    expect(sitePresence(def, world([player], [fleet(1, 'player', 11, 10, 1)]))).toEqual([]);
    expect(sitePresence(def, world([player], [fleet(1, 'player', 13, 10)]))).toEqual([]);
    expect(sitePresence(def, world([player], [fleet(1, 'player', 11, 10)]))).toEqual([{ factionId: 'player', contested: false }]);
  });

  it('is contested by a hostile guardian base or a hostile fleet, not by a peace partner', () => {
    const player = faction('player');
    const remnant = faction('remnant', { outlaw: true });
    const varkon = faction('varkon');
    const base = { id: 1, name: 'Warden', factionId: 'remnant', x: 10, y: 10 } as SpaceBase;
    expect(sitePresence(def, world([player, remnant], [fleet(1, 'player', 10, 10)], [base]))[0].contested).toBe(true);
    // No relation stored = war.
    expect(sitePresence(def, world([player, varkon], [fleet(1, 'player', 10, 10), fleet(2, 'varkon', 10, 11)]))[0].contested).toBe(true);
    peace(player, varkon);
    expect(sitePresence(def, world([player, varkon], [fleet(1, 'player', 10, 10), fleet(2, 'varkon', 10, 11)])).map((p) => p.contested)).toEqual([false, false]);
  });

  it('claims after holdSeconds, decays twice as fast while absent, and never claims twice', () => {
    const player = faction('player');
    const state = emptySiteState();
    const here = world([player], [fleet(1, 'player', 10, 10)]);
    const away = world([player], [fleet(1, 'player', 30, 30)]);
    expect(advanceSite(def, state, here, 6)).toBeNull();
    expect(advanceSite(def, state, away, 2)).toBeNull();
    expect(state.progress['player']).toBe(2);
    expect(advanceSite(def, state, here, 7)).toBeNull();
    expect(advanceSite(def, state, here, 1)).toBe('player');
    expect(state.claimedBy).toBe('player');
    expect(advanceSite(def, state, here, 100)).toBeNull();
  });
});

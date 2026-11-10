import { SpaceBase, StarSystem } from './star-map.models';
import { DysonBonusId, dysonBonusEffects, dysonBonusOptions, dysonOpenerCount, isOpenerAnchor } from './dyson-anchor';
import { coalitionHolderId, dysonCoalitionHolder, dysonRingHolder } from './dyson-victory';

/*
 * Campaign Dyson rules (docs/campaign-design.md, Mission 7): the Dampener
 * bonus and the coalition warm-up holder. Normal games never offer the
 * Dampener, so these rules leave them unchanged.
 */
describe('campaign Dyson rules', () => {
  const systems = (owners: string[]): StarSystem[] =>
    owners.map((owner, i) => ({ id: `s${i}`, name: `S${i}`, x: i * 20, y: 0, planets: 1, color: '#fff', planetsTiles: [{ factionId: owner }] }) as unknown as StarSystem);
  const ring = (owners: [string, DysonBonusId][]): SpaceBase[] =>
    owners.map(([factionId, bonus], i) => ({ id: i + 1, name: `A${i}`, factionId, x: i, y: 0, kind: 'dyson', dysonSlot: i, dysonBonus: bonus }));
  const all = (owner: string, bonus: DysonBonusId = 'stellar_power') => Array.from({ length: 8 }, () => [owner, bonus] as [string, DysonBonusId]);
  const union = { id: 'union', name: 'Union', members: ['player', 'concordium', 'meridian'], maxPerMember: 3 };

  it('offers the Dampener only where a mission enables it, and gives it no economy bonus', () => {
    expect(dysonBonusOptions(false).map((b) => b.id)).not.toContain('dampener');
    expect(dysonBonusOptions(true).map((b) => b.id)).toContain('dampener');
    const bases = ring([['player', 'dampener'], ['player', 'dampener']]);
    expect(dysonBonusEffects(bases, 'player')).toEqual({ energyOutput: 0, shipRawCostMultiplier: 1, researchPerSecond: 0 });
    expect(bases.every((b) => !isOpenerAnchor(b))).toBe(true);
    expect(dysonOpenerCount(ring([['player', 'dampener'], ['player', 'stellar_power']]), 'player')).toBe(1);
  });

  it('never counts a Dampener toward a ring holder', () => {
    const owners = all('player');
    expect(dysonRingHolder(ring(owners), 8, systems(['player']))).toBe('player');
    owners[3] = ['player', 'dampener'];
    expect(dysonRingHolder(ring(owners), 8, systems(['player']))).toBeNull();
  });

  it('lets coalition members hold the ring together: each at least one, none above the cap', () => {
    const world = systems(['player', 'concordium', 'meridian']);
    const shared = ring([
      ['player', 'stellar_power'], ['player', 'stellar_power'],
      ['concordium', 'stellar_power'], ['concordium', 'stellar_power'], ['concordium', 'stellar_power'],
      ['meridian', 'stellar_power'], ['meridian', 'stellar_power'], ['meridian', 'stellar_power'],
    ]);
    expect(dysonRingHolder(shared, 8, world)).toBeNull();
    expect(dysonCoalitionHolder(shared, 8, world, union)).toBe(coalitionHolderId(union));
    expect(dysonCoalitionHolder(shared, 8, world, null)).toBeNull();
    // A member above the cap, an outsider's anchor, or a member without anchors breaks it.
    const greedy = ring([...all('player').slice(0, 4), ['concordium', 'stellar_power'], ['concordium', 'stellar_power'], ['meridian', 'stellar_power'], ['meridian', 'stellar_power']]);
    expect(dysonCoalitionHolder(greedy, 8, world, union)).toBeNull();
    const intruder = [...shared];
    intruder[7] = { ...intruder[7], factionId: 'varkon' };
    expect(dysonCoalitionHolder(intruder, 8, world, union)).toBeNull();
    const absent = ring([...all('player').slice(0, 3), ['concordium', 'stellar_power'], ['concordium', 'stellar_power'], ['concordium', 'stellar_power'], ['player', 'stellar_power'], ['concordium', 'stellar_power']]);
    expect(dysonCoalitionHolder(absent, 8, world, union)).toBeNull();
  });
});

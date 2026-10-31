import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SECONDS_PER_MINUTE,
  EXHAUSTION_PER_MINUTE,
  OPINION_PEACE_DRIFT_PER_MINUTE,
  formatGameDuration,
  EXHAUSTION_MAX_PENALTY,
  INITIAL_WAR_LOCK_SECONDS,
  OPINION_TREATY_BROKEN,
  OPINION_WAR_DECLARED,
  REPUTATION_SURPRISE_ATTACK,
  REPUTATION_TREATY_BROKEN,
  REPUTATION_TREATY_HONORED,
  REPUTATION_WAR_DECLARED,
  TRUCE_SECONDS,
  WAR_MIN_DURATION_SECONDS,
  areFactionsAllied,
  areFactionsHostile,
  canAttackPlanetOf,
  getOpinion,
  getRelation,
  getRelationKind,
  getReputation,
  getWarExhaustion,
  getWarExhaustionPenalty,
  hostileFactionIds,
  isTruceActive,
  normalizeRelations,
  recordHostileAct,
  recordPlanetLoss,
  recordShipLosses,
  setTreatyState,
  startPeace,
  startWar,
  tickDiplomacyTime,
} from './diplomacy';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { DiplomacyService, PEACE_OFFER_SECONDS } from '../../services/diplomacy.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { BattleService } from '../../services/battle.service';
import { EconomyService } from '../../services/economy.service';
import { PeaceTreaty, validateTreaty } from './peace-treaty';
import { buildDiplomacyRows } from './star-map-diplomacy-vm';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';

const faction = (id: string, team: number, ai = true, extra: Partial<Faction> = {}): Faction => ({
  id,
  name: id,
  color: '#fff',
  team,
  ai,
  currencies: { credits: 0, rawmaterials: 0, research: 0 },
  ...extra,
});

const fleet = (id: number, factionId: string, x: number, y: number, ships: string[]): Fleet => ({
  id,
  name: `F${id}`,
  factionId,
  x,
  y,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  ships: ships.map((type, i) => ({ id: id * 100 + i, name: type, type, destroyed: false })),
  destroyed: false,
} as Fleet);

let planetIds = 1;
const system = (id: string, x: number, y: number, owners: string[], population = 100): StarSystem => ({
  id,
  name: id,
  x,
  y,
  planets: owners.length,
  color: '#fff',
  planetsTiles: owners.map((factionId, i) => ({
    id: planetIds++,
    index: i,
    name: `${id}-${i}`,
    factionId,
    x: 1,
    y: 1,
    type: 'earthlike',
    size: 'medium',
    population,
    buildings: [],
    explored: true,
  })),
} as unknown as StarSystem);

describe('diplomacy rules', () => {
  it('classifies relations: self, allied (same team), neutral (team 0), treaty state', () => {
    const player = faction('player', 1, false);
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    const legacyAlly = faction('enemy3', 2);
    const rebels = faction('independent', 0, false);
    expect(getRelationKind(a, a)).toBe('self');
    expect(getRelationKind(a, legacyAlly)).toBe('allied');
    expect(getRelationKind(a, rebels)).toBe('neutral');
    expect(getRelationKind(player, a)).toBe('war');
    setTreatyState(a, b, 'peace', 10);
    expect(getRelationKind(b, a)).toBe('peace');
    expect(areFactionsHostile(a, b)).toBe(false);
    expect(areFactionsHostile(player, a)).toBe(true);
    expect(areFactionsAllied(a, legacyAlly)).toBe(true);
    expect(areFactionsHostile(a, rebels)).toBe(false);
  });

  it('allows planet attacks at war and on neutral rebels, never at peace, on allies or on unhabited planets', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    expect(canAttackPlanetOf(a, b)).toBe(true);
    expect(canAttackPlanetOf(a, faction('independent', 0, false))).toBe(true);
    expect(canAttackPlanetOf(a, faction('unhabited', 0, false))).toBe(false);
    setTreatyState(a, b, 'peace', 0);
    expect(canAttackPlanetOf(a, b)).toBe(false);
    expect(canAttackPlanetOf(a, faction('enemy3', 2))).toBe(false);
  });

  it('migrates v0 entries: fills defaults, keeps per-side opinion, repairs disagreement as war, drops non-treaty entries', () => {
    const player = faction('player', 1, false);
    const a = faction('enemy1', 2, true, {
      relations: { enemy2: { state: 'peace', lockRemaining: 5, opinion: 30 }, independent: { state: 'war', lockRemaining: 0 } },
    });
    const b = faction('enemy2', 3, true, { relations: { enemy1: { state: 'war', lockRemaining: 7, opinion: -10 } } });
    const rebels = faction('independent', 0, false);
    const factions = [player, a, b, rebels];
    normalizeRelations(factions, 30);
    expect(getRelationKind(a, b)).toBe('war');
    expect(a.relations?.['enemy2']).toMatchObject({ state: 'war', lockRemaining: 7, opinion: 30, warExhaustion: 0 });
    expect(b.relations?.['enemy1']).toMatchObject({ state: 'war', lockRemaining: 7, opinion: -10 });
    expect(player.relations?.['enemy1']).toMatchObject({ state: 'war', lockRemaining: 30, opinion: 0, warExhaustion: 0 });
    expect(a.relations?.['independent']).toBeUndefined();
    expect(rebels.relations).toBeUndefined();
    const snapshot = JSON.stringify(factions);
    normalizeRelations(factions, 30);
    expect(JSON.stringify(factions)).toBe(snapshot);
  });

  it('keeps legacy saves (all AIs on team 2) allied and at war with the player', () => {
    const factions = [faction('player', 1, false), faction('enemy1', 2), faction('enemy2', 2)];
    normalizeRelations(factions);
    expect(areFactionsAllied(factions[1], factions[2])).toBe(true);
    expect(Object.keys(factions[1].relations ?? {})).toEqual(['player']);
    expect([...hostileFactionIds(factions[1], factions)]).toEqual(['player']);
  });

  it('clamps out-of-range and corrupt values on load', () => {
    const a = faction('enemy1', 2, true, { reputation: 500, relations: { enemy2: { state: 'war', lockRemaining: -3, opinion: 999, warExhaustion: Number.NaN } } });
    const b = faction('enemy2', 3, true, { relations: { enemy1: { state: 'war', lockRemaining: 0, warExhaustion: 250 } } });
    normalizeRelations([a, b]);
    expect(a.reputation).toBe(100);
    expect(a.relations?.['enemy2']).toMatchObject({ lockRemaining: 0, opinion: 100, warExhaustion: 0 });
    expect(b.relations?.['enemy1'].warExhaustion).toBe(100);
  });
});

describe('time-based diplomacy (continuous game time, rates per minute)', () => {
  it('raises exhaustion every minute of war and erodes opinion; peace builds opinion', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    const c = faction('enemy3', 4);
    normalizeRelations([a, b, c]);
    setTreatyState(a, c, 'peace', 0);
    tickDiplomacyTime([a, b, c], 10 * SECONDS_PER_MINUTE);
    expect(getWarExhaustion(a, b)).toBeCloseTo(10);
    expect(getRelation(a, b)?.warSeconds).toBe(600);
    expect(getOpinion(a, b)).toBeCloseTo(-5);
    expect(getOpinion(a, c)).toBeCloseTo(10);
  });

  it('freezes while paused and for eliminated factions', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    tickDiplomacyTime([a, b], 0);
    tickDiplomacyTime([a, b], 600, (id) => id !== 'enemy2');
    expect(getWarExhaustion(a, b)).toBe(0);
  });

  it('honors a truce that runs out unbroken: reputation for both, peace stays', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    startPeace(a, b, TRUCE_SECONDS);
    expect(isTruceActive(a, b)).toBe(true);
    const honored = tickDiplomacyTime([a, b], TRUCE_SECONDS);
    expect(honored).toEqual([{ aId: 'enemy1', bId: 'enemy2' }]);
    expect(isTruceActive(a, b)).toBe(false);
    expect(getRelationKind(a, b)).toBe('peace');
    // Honored truce, plus 10 minutes of reputation drift while at war with nobody.
    expect(getReputation(a)).toBeCloseTo(REPUTATION_TREATY_HONORED + 0.5 * 10);
  });

  it('slowly improves the reputation of an empire at war with nobody', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    setTreatyState(a, b, 'peace', 0);
    tickDiplomacyTime([a, b], 10 * SECONDS_PER_MINUTE);
    expect(getReputation(a)).toBeCloseTo(5);
  });
});

describe('war bookkeeping', () => {
  it('scales ship-loss exhaustion with the share of the navy lost, plus a severe-defeat bonus', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    recordShipLosses(a, b, 1000, 4000, false);
    expect(getWarExhaustion(a, b)).toBeCloseTo(10);
    recordShipLosses(a, b, 3000, 3000, true);
    expect(getWarExhaustion(a, b)).toBeCloseTo(55);
    expect(getRelation(a, b)?.shipsLostValue).toBe(4000);
    // At peace nothing is recorded.
    setTreatyState(a, b, 'peace', 0);
    recordShipLosses(a, b, 1000, 1000, true);
    expect(getRelation(a, b)?.shipsLostValue).toBe(0);
  });

  it('a lost planet raises exhaustion and lowers opinion of the taker', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    recordPlanetLoss(a, b, 1400);
    expect(getWarExhaustion(a, b)).toBe(15);
    expect(getRelation(a, b)?.planetsLost).toBe(1);
    expect(getOpinion(a, b)).toBe(-10);
  });

  it('a surprise attack is an attack by the declarer within one minute of game time, penalized once per war', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    startWar(a, b, WAR_MIN_DURATION_SECONDS, 'enemy1');
    expect(recordHostileAct(b, a)).toBe(false);
    expect(recordHostileAct(a, b)).toBe(true);
    expect(recordHostileAct(a, b)).toBe(false);
    expect(getReputation(a)).toBe(REPUTATION_SURPRISE_ATTACK);

    startWar(a, b, WAR_MIN_DURATION_SECONDS, 'enemy1');
    tickDiplomacyTime([a, b], SECONDS_PER_MINUTE);
    expect(recordHostileAct(a, b)).toBe(false);
  });

  it('cuts output only above the exhaustion threshold, up to 30%', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    a.relations!['enemy2'].warExhaustion = 25;
    expect(getWarExhaustionPenalty(a)).toBe(0);
    a.relations!['enemy2'].warExhaustion = 100;
    expect(getWarExhaustionPenalty(a)).toBe(EXHAUSTION_MAX_PENALTY);
  });
});

describe('DiplomacyService', () => {
  let service: DiplomacyService;
  let player: Faction;
  let ai: Faction;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DiplomacyService);
    service.reset();
    player = faction('player', 1, false, { currencies: { credits: 1000, rawmaterials: 500, research: 0 } });
    ai = faction('enemy1', 2, true, { currencies: { credits: 2000, rawmaterials: 100, research: 0 } });
    normalizeRelations([player, ai]);
  });

  const world = (systems: StarSystem[]) => ({ factions: [player, ai], starSystems: systems, fleets: [] as Fleet[], production: [] });

  it('declaring war costs reputation and the victim\'s opinion; impossible during a truce', () => {
    startPeace(player, ai, TRUCE_SECONDS);
    expect(service.declareWar(player, ai)).toEqual({ ok: false, reason: 'truce', waitSeconds: TRUCE_SECONDS });
    service.tick(TRUCE_SECONDS, [player, ai]);
    expect(service.declareWar(player, ai).ok).toBe(true);
    // Truce honored (+5) and 10 minutes of game time at war with nobody (+5), then the declaration.
    expect(getReputation(player)).toBeCloseTo(REPUTATION_TREATY_HONORED + 5 + REPUTATION_WAR_DECLARED);
    // +10 from ten minutes of peace, then the declaration.
    expect(getOpinion(ai, player)).toBeCloseTo(10 + OPINION_WAR_DECLARED);
    expect(getRelation(player, ai)).toMatchObject({ state: 'war', declaredBy: 'player', lockRemaining: WAR_MIN_DURATION_SECONDS });
  });

  it('breaking a treaty is only possible during a truce and is punished hard', () => {
    expect(service.breakTreaty(player, ai).reason).toBe('not_in_truce');
    startPeace(player, ai, TRUCE_SECONDS);
    expect(service.breakTreaty(player, ai).ok).toBe(true);
    expect(getRelationKind(player, ai)).toBe('war');
    expect(getReputation(player)).toBe(REPUTATION_TREATY_BROKEN);
    expect(getOpinion(ai, player)).toBe(OPINION_TREATY_BROKEN);
    expect(service.drainEvents()).toEqual([{ kind: 'breach', initiatorId: 'player', targetId: 'enemy1' }]);
  });

  it('executes a treaty atomically: resources move, planets stay, peace and truce start, exhaustion resets', () => {
    const home = system('home', 10, 10, ['enemy1', 'enemy1']);
    const colony = system('col', 20, 10, ['enemy1', 'player']);
    const capital = system('cap', 40, 10, ['player']);
    const ownersBefore = [home, colony, capital].map((s) => s.planetsTiles.map((p) => p.factionId));
    player.relations!['enemy1'].warExhaustion = 40;
    const treaty: PeaceTreaty = {
      proposerId: 'player',
      recipientId: 'enemy1',
      items: [
        { kind: 'credits', giverId: 'enemy1', amount: 500 },
        { kind: 'rawmaterials', giverId: 'player', amount: 200 },
      ],
    };
    const result = service.executeTreaty(world([home, colony, capital]), treaty);
    expect(result.ok).toBe(true);
    expect(ai.currencies['credits']).toBe(1500);
    expect(player.currencies['credits']).toBe(1500);
    expect(player.currencies['rawmaterials']).toBe(300);
    expect(ai.currencies['rawmaterials']).toBe(300);
    // A treaty never moves a planet.
    expect([home, colony, capital].map((s) => s.planetsTiles.map((p) => p.factionId))).toEqual(ownersBefore);
    expect(getRelation(player, ai)).toMatchObject({ state: 'peace', truce: true, lockRemaining: TRUCE_SECONDS, warExhaustion: 0 });
    expect(isTruceActive(ai, player)).toBe(true);
  });

  it('rejects infeasible terms without changing anything', () => {
    const home = system('home', 10, 10, ['enemy1']);
    const capital = system('cap', 40, 10, ['player']);
    const before = JSON.stringify([player, ai, home, capital]);
    const tooMuch: PeaceTreaty = { proposerId: 'player', recipientId: 'enemy1', items: [
      { kind: 'rawmaterials', giverId: 'player', amount: 100 },
      { kind: 'credits', giverId: 'enemy1', amount: 9999 },
    ] };
    expect(service.executeTreaty(world([home, capital]), tooMuch).validation.reason).toBe('insufficient_resources');
    expect(JSON.stringify([player, ai, home, capital])).toBe(before);
  });

  it('rejects planet or system items (stale code or data): only resources are negotiable', () => {
    const home = system('home', 10, 10, ['enemy1', 'enemy1']);
    const capital = system('cap', 40, 10, ['player']);
    const before = JSON.stringify([player, ai, home, capital]);
    for (const legacy of [
      { kind: 'planet', giverId: 'enemy1', planetId: home.planetsTiles[1].id },
      { kind: 'system', giverId: 'enemy1', systemId: 'home' },
    ]) {
      const treaty = { proposerId: 'player', recipientId: 'enemy1', items: [{ kind: 'credits', giverId: 'enemy1', amount: 100 }, legacy] } as unknown as PeaceTreaty;
      const result = service.executeTreaty(world([home, capital]), treaty);
      expect(result.ok).toBe(false);
      expect(result.validation).toEqual({ ok: false, reason: 'unsupported_item', itemIndex: 1 });
    }
    expect(JSON.stringify([player, ai, home, capital])).toBe(before);
    expect(getRelationKind(player, ai)).toBe('war');
  });

  it('a treaty whose payer spent the resources meanwhile is refused as a whole', () => {
    const home = system('home', 10, 10, ['enemy1']);
    const capital = system('cap', 40, 10, ['player']);
    const treaty: PeaceTreaty = { proposerId: 'enemy1', recipientId: 'player', items: [
      { kind: 'credits', giverId: 'enemy1', amount: 1500 },
      { kind: 'rawmaterials', giverId: 'player', amount: 100 },
    ] };
    ai.currencies['credits'] = 1000;
    const result = service.executeTreaty(world([home, capital]), treaty);
    expect(result.validation.reason).toBe('insufficient_resources');
    expect(player.currencies['rawmaterials']).toBe(500);
    expect(getRelationKind(player, ai)).toBe('war');
  });

  it('survives a save round-trip unchanged (JSON + load normalization)', () => {
    startPeace(player, ai, TRUCE_SECONDS);
    player.relations!['enemy1'].opinion = 42;
    player.reputation = -12;
    tickDiplomacyTime([player, ai], 90);
    const loaded = JSON.parse(JSON.stringify([player, ai])) as Faction[];
    normalizeRelations(loaded);
    expect(loaded[0].relations).toEqual(player.relations);
    expect(loaded[1].relations).toEqual(ai.relations);
    expect(loaded[0].reputation).toBe(player.reputation);
  });

  it('refuses negotiation during the minimum war duration and for eliminated factions', () => {
    startWar(player, ai, WAR_MIN_DURATION_SECONDS, 'player');
    const capital = system('cap', 40, 10, ['player']);
    const home = system('home', 10, 10, ['enemy1']);
    const white: PeaceTreaty = { proposerId: 'player', recipientId: 'enemy1', items: [] };
    expect(validateTreaty(white, world([capital, home])).reason).toBe('locked');
    service.tick(WAR_MIN_DURATION_SECONDS, [player, ai]);
    expect(validateTreaty(white, world([capital])).reason).toBe('eliminated');
    expect(validateTreaty(white, world([capital, home])).ok).toBe(true);
  });

  it('expires AI proposals and drops them when the treaty changes', () => {
    const white: PeaceTreaty = { proposerId: 'enemy1', recipientId: 'player', items: [] };
    service.addOffer(white);
    service.tick(PEACE_OFFER_SECONDS - 1, [player, ai]);
    expect(service.hasOffer('enemy1')).toBe(true);
    service.tick(2, [player, ai]);
    expect(service.hasOffer('enemy1')).toBe(false);
    service.addOffer(white);
    service.executeTreaty(world([system('h', 10, 10, ['enemy1']), system('c', 40, 10, ['player'])]), white);
    expect(service.hasOffer('enemy1')).toBe(false);
  });
});

describe('EnemyDiplomacyService', () => {
  let ai: EnemyDiplomacyService;
  let diplomacy: DiplomacyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ai = TestBed.inject(EnemyDiplomacyService);
    diplomacy = TestBed.inject(DiplomacyService);
    ai.reset();
    diplomacy.reset();
  });

  /* enemy1 at (10,10), enemy2 at (40,10), two planets each, at war, negotiations open. */
  const world = (ownShips: string[], enemyShips: string[], personalities: ['balanced' | 'militarist' | 'technologist' | 'expansionist', string] = ['balanced', 'balanced']) => {
    const a = faction('enemy1', 2, true, { aiPersonality: personalities[0], currencies: { credits: 5000, rawmaterials: 2000, research: 0 } });
    const b = faction('enemy2', 3, true, { aiPersonality: personalities[1] as never, currencies: { credits: 5000, rawmaterials: 2000, research: 0 } });
    const factions = [faction('player', 1, false), a, b];
    normalizeRelations(factions);
    const fleets = [fleet(1, 'enemy1', 10, 10, ownShips), fleet(2, 'enemy2', 40, 10, enemyShips)];
    const starSystems = [system('s1', 10, 10, ['enemy1', 'enemy1'], 700), system('s2', 40, 10, ['enemy2', 'enemy2'], 700)];
    return { a, b, factions, fleets, starSystems };
  };

  it('explains its peace pressure with named factors', () => {
    const ctx = world(['fighter'], Array(10).fill('battleship'));
    ctx.a.relations!['enemy2'].warExhaustion = 60;
    const assessment = ai.assessWar(ctx.a, ctx.b, ctx);
    const keys = assessment.factors.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['baseline', 'military', 'exhaustion']));
    expect(assessment.factors.find((f) => f.key === 'military')!.value).toBeGreaterThan(0);
    expect(assessment.pressure).toBeGreaterThan(0.5);
    // The stronger, fresh side resists peace.
    expect(ai.assessWar(ctx.b, ctx.a, ctx).pressure).toBeLessThan(0);
  });

  it('accepts generous terms, refuses greedy ones, and the meter crosses 0.5 exactly at acceptance', () => {
    const ctx = world(Array(5).fill('battleship'), Array(5).fill('battleship'));
    const white: PeaceTreaty = { proposerId: 'enemy2', recipientId: 'enemy1', items: [] };
    const whiteEval = ai.evaluateTreaty(ctx.a, white, ctx);
    expect(whiteEval.accept).toBe(false); // even war: wants something for peace (war aims)
    const paid: PeaceTreaty = { ...white, items: [{ kind: 'credits', giverId: 'enemy2', amount: Math.ceil(-whiteEval.margin) }] };
    const paidEval = ai.evaluateTreaty(ctx.a, paid, ctx);
    expect(paidEval.accept).toBe(true);
    expect(paidEval.acceptance).toBeGreaterThanOrEqual(0.5);
    const greedy: PeaceTreaty = { ...white, items: [{ kind: 'credits', giverId: 'enemy1', amount: 3000 }] };
    expect(ai.evaluateTreaty(ctx.a, greedy, ctx).acceptance).toBeLessThan(whiteEval.acceptance);
    // Terms are valued in credits only: raw materials ×1.2, nothing else.
    expect(ai.termsValue(ctx.a, { ...white, items: [{ kind: 'rawmaterials', giverId: 'enemy2', amount: 100 }] })).toBeCloseTo(120);
  });

  it('counter-offers by paying less and asking only for resources the other side holds', () => {
    const ctx = world(Array(5).fill('battleship'), Array(5).fill('battleship'));
    const greedy: PeaceTreaty = { proposerId: 'enemy2', recipientId: 'enemy1', items: [
      { kind: 'credits', giverId: 'enemy1', amount: 3000 },
    ] };
    const response = ai.respondToProposal(ctx.a, greedy, ctx);
    expect(response.decision).toBe('counter');
    const counter = response.counter!;
    expect(counter.proposerId).toBe('enemy1');
    expect(counter.items.every((i) => i.kind === 'credits' || i.kind === 'rawmaterials')).toBe(true);
    expect(counter.items.some((i) => i.giverId === 'enemy1')).toBe(false);
    expect(validateTreaty(counter, ctx).ok).toBe(true);
    expect(ai.evaluateTreaty(ctx.a, counter, ctx).accept).toBe(true);
    for (const item of counter.items) {
      if (item.kind === 'credits') expect(item.amount).toBeLessThanOrEqual(5000);
    }
  });

  it('refuses outright when no feasible counter exists', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter']);
    ctx.b.currencies = { credits: 0, rawmaterials: 0, research: 0 }; // nothing it could pay
    const white: PeaceTreaty = { proposerId: 'enemy2', recipientId: 'enemy1', items: [] };
    expect(ai.respondToProposal(ctx.a, white, ctx).decision).toBe('refuse');
  });

  it('two AIs settle when their peace values allow it, the eager side paying the other\'s price', () => {
    const ctx = world(['fighter'], Array(5).fill('battleship'));
    ctx.a.currencies['credits'] = 20000;
    ctx.a.relations!['enemy2'].warExhaustion = 80;
    ctx.b.relations!['enemy1'].warExhaustion = 50;
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');
    expect(isTruceActive(ctx.a, ctx.b)).toBe(true);
    // The losing side paid; credits only moved between the two.
    expect(ctx.a.currencies['credits']).toBeLessThan(20000);
    expect(ctx.a.currencies['credits'] + ctx.b.currencies['credits']).toBe(25000);
  });

  it('two equally exhausted AIs both want out and sign a white peace', () => {
    const ctx = world(Array(5).fill('battleship'), Array(5).fill('battleship'));
    ctx.a.relations!['enemy2'].warExhaustion = 70;
    ctx.b.relations!['enemy1'].warExhaustion = 70;
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');
    expect(ctx.a.currencies['credits']).toBe(5000);
  });

  it('proposes peace to the player when it wants out, and its proposal is feasible', () => {
    const ctx = world(['fighter'], ['fighter']);
    ctx.fleets.push(fleet(3, 'player', 12, 10, Array(10).fill('battleship')));
    ctx.starSystems.push(system('p1', 14, 10, ['player']));
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    const offer = diplomacy.getOffer('enemy1');
    expect(offer).toBeDefined();
    expect(offer!.treaty.recipientId).toBe('player');
    expect(validateTreaty(offer!.treaty, ctx).ok).toBe(true);
    expect(getRelationKind(ctx.factions[0], ctx.a)).toBe('war');
  });

  it('declares war on a weak neighbour it does not like, but not on a friend, and never during a truce unless treacherous', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter']);
    setTreatyState(ctx.a, ctx.factions[0], 'peace', 0);
    setTreatyState(ctx.a, ctx.b, 'peace', 0);
    ctx.a.relations!['enemy2'].opinion = 50;
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');

    ctx.a.relations!['enemy2'].opinion = 0;
    startPeace(ctx.a, ctx.b, TRUCE_SECONDS);
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');

    diplomacy.tick(TRUCE_SECONDS, ctx.factions);
    // Ten minutes of peace built some goodwill; reset it to "indifferent".
    ctx.a.relations!['enemy2'].opinion = 0;
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('war');
    expect(getRelation(ctx.a, ctx.b)?.declaredBy).toBe('enemy1');
  });

  it('a militarist breaks a truce only when overwhelmingly stronger and hostile', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter'], ['militarist', 'balanced']);
    setTreatyState(ctx.a, ctx.factions[0], 'peace', 0);
    startPeace(ctx.a, ctx.b, TRUCE_SECONDS);
    ctx.a.relations!['enemy2'].opinion = -60;
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('war');
    expect(getReputation(ctx.a)).toBe(REPUTATION_TREATY_BROKEN);
  });

  it('starts no new war while exhausted', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter']);
    const third = faction('enemy3', 4);
    ctx.factions.push(third);
    normalizeRelations(ctx.factions);
    setTreatyState(ctx.a, ctx.b, 'peace', 0);
    setTreatyState(ctx.a, ctx.factions[0], 'peace', 0);
    ctx.a.relations!['enemy3'].warExhaustion = 60; // at war with an eliminated faction: exhausted
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');
  });

  it('never offers or demands planets or systems, in any proposal, counter-offer or AI–AI treaty', () => {
    const scenarios = [
      world(['fighter'], Array(10).fill('battleship')),
      world(Array(10).fill('battleship'), ['fighter']),
      world(Array(5).fill('battleship'), Array(5).fill('battleship')),
    ];
    for (const ctx of scenarios) {
      ctx.b.currencies = { credits: 0, rawmaterials: 0, research: 0 };
      // A hard counter request: the AI used to ask for planets when resources ran out.
      const response = ai.respondToProposal(ctx.a, { proposerId: 'enemy2', recipientId: 'enemy1', items: [] }, ctx);
      for (const item of response.counter?.items ?? []) expect(['credits', 'rawmaterials']).toContain(item.kind);
    }
    const ctx = world(['fighter'], ['fighter']);
    ctx.fleets.push(fleet(3, 'player', 12, 10, Array(10).fill('battleship')));
    ctx.starSystems.push(system('p1', 14, 10, ['player']));
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    for (const item of diplomacy.getOffer('enemy1')?.treaty.items ?? []) expect(['credits', 'rawmaterials']).toContain(item.kind);
    const executed = diplomacy.drainEvents().filter((e) => e.kind === 'peace');
    for (const event of executed) {
      for (const item of event.treaty?.items ?? []) expect(['credits', 'rawmaterials']).toContain(item.kind);
    }
  });

  it('does nothing while paused or between decisions', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter']);
    setTreatyState(ctx.a, ctx.b, 'peace', 0);
    setTreatyState(ctx.a, ctx.factions[0], 'peace', 0);
    expect(ai.tick(0, ctx)).toBe(false);
    expect(ai.tick(EnemyDiplomacyService.DECISION_INTERVAL / 2, ctx)).toBe(false);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');
  });
});

describe('planet transfers and war bookkeeping (PlanetOwnershipService)', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('a capture is a war loss (and a surprise attack right after the declaration)', () => {
    const ownership = TestBed.inject(PlanetOwnershipService);
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    startWar(a, b, WAR_MIN_DURATION_SECONDS, 'enemy1');
    const sys = system('s', 10, 10, ['enemy2', 'enemy2', 'enemy2'], 400);
    ownership.transferPlanet({ factions: [a, b] }, sys.planetsTiles[0], 'enemy1', 'captured');
    expect(getRelation(b, a)?.planetsLost).toBe(1);
    expect(getReputation(a)).toBe(REPUTATION_SURPRISE_ATTACK);
    // Rebellion is not a war loss.
    ownership.transferPlanet({ factions: [a, b] }, sys.planetsTiles[1], 'independent', 'rebellion');
    expect(getRelation(b, a)?.planetsLost).toBe(1);
  });
});

describe('real-time diplomacy timers', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('formats game durations without turns', () => {
    expect(formatGameDuration(0)).toBe('0 s');
    expect(formatGameDuration(44.2)).toBe('45 s');
    expect(formatGameDuration(60)).toBe('1 min');
    expect(formatGameDuration(270)).toBe('4 min 30 s');
    expect(formatGameDuration(TRUCE_SECONDS)).toBe('10 min');
    expect(formatGameDuration(3900)).toBe('1 h 5 min');
  });

  it('every timer and rate is continuous game time: half a minute does half a minute of work', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    normalizeRelations([a, b]);
    startPeace(a, b, TRUCE_SECONDS);
    tickDiplomacyTime([a, b], 30);
    expect(getRelation(a, b)?.lockRemaining).toBe(TRUCE_SECONDS - 30);
    expect(getOpinion(a, b)).toBeCloseTo(OPINION_PEACE_DRIFT_PER_MINUTE / 2);
    startWar(a, b, 0);
    tickDiplomacyTime([a, b], 90);
    expect(getWarExhaustion(a, b)).toBeCloseTo(EXHAUSTION_PER_MINUTE * 1.5);
    expect(getRelation(a, b)?.warSeconds).toBe(90);
  });

  it('freezes while paused (zero scaled delta): truce, war clock, offers and AI decisions', () => {
    const service = TestBed.inject(DiplomacyService);
    const enemy = TestBed.inject(EnemyDiplomacyService);
    service.reset();
    enemy.reset();
    const player = faction('player', 1, false);
    const a = faction('enemy1', 2, true);
    const b = faction('enemy2', 3, true);
    const factions = [player, a, b];
    normalizeRelations(factions);
    startPeace(player, a, TRUCE_SECONDS);
    startWar(a, b, 0);
    service.addOffer({ proposerId: 'enemy1', recipientId: 'player', items: [] });
    const before = JSON.stringify(factions);
    for (let i = 0; i < 1000; i++) {
      service.tick(0, factions);
      enemy.tick(0, { factions, fleets: [], starSystems: [] });
    }
    expect(JSON.stringify(factions)).toBe(before);
    expect(service.getOffer('enemy1')?.secondsLeft).toBe(PEACE_OFFER_SECONDS);
    // Resuming continues from where it stopped.
    service.tick(10, factions);
    expect(getRelation(player, a)?.lockRemaining).toBe(TRUCE_SECONDS - 10);
    expect(service.getOffer('enemy1')?.secondsLeft).toBe(PEACE_OFFER_SECONDS - 10);
  });

  it('the diplomacy screen shows real durations and never mentions turns', () => {
    const service = TestBed.inject(DiplomacyService);
    const enemy = TestBed.inject(EnemyDiplomacyService);
    service.reset();
    const player = faction('player', 1, false);
    const a = faction('enemy1', 2, true);
    const b = faction('enemy2', 3, true);
    const factions = [player, a, b];
    normalizeRelations(factions);
    startPeace(player, a, TRUCE_SECONDS);
    tickDiplomacyTime(factions, 150);
    service.addOffer({ proposerId: 'enemy2', recipientId: 'player', items: [] });
    const world = { factions, fleets: [] as Fleet[], starSystems: [system('p', 1, 1, ['player']), system('a', 30, 1, ['enemy1']), system('b', 60, 1, ['enemy2'])] };
    const rows = buildDiplomacyRows(player, world, service, enemy);
    const peaceRow = rows.find((r) => r.id === 'enemy1')!;
    const warRow = rows.find((r) => r.id === 'enemy2')!;
    expect(peaceRow.truceSecondsLeft).toBe(TRUCE_SECONDS - 150);
    expect(peaceRow.truceLeftLabel).toBe('7 min 30 s');
    expect(warRow.warSeconds).toBe(150);
    expect(warRow.warDurationLabel).toBe('2 min 30 s');
    expect(warRow.offer?.timeLeftLabel).toBe('1 min 30 s');
    expect(JSON.stringify(rows).toLowerCase()).not.toContain('turn');
  });
});

describe('war exhaustion and the economy', () => {
  it('reduces credit income through the same numbers the HUD shows', () => {
    TestBed.configureTestingModule({});
    const economy = TestBed.inject(EconomyService);
    const player = faction('player', 1, false);
    const enemy = faction('enemy1', 2);
    normalizeRelations([player, enemy]);
    const systems = [system('s', 10, 10, ['player'], 1000)];
    const fresh = economy.calculateEconomy('player', [player, enemy], systems, []).incomePerSecond;
    player.relations!['enemy1'].warExhaustion = 100;
    const exhausted = economy.calculateEconomy('player', [player, enemy], systems, []).incomePerSecond;
    expect(exhausted).toBeCloseTo(fresh * (1 - EXHAUSTION_MAX_PENALTY));
  });
});

describe('diplomatic victory (GameOutcomeService)', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const run = (playerPlanets: number, partnerPlanets: number, state: 'war' | 'peace') => {
    const outcome = TestBed.inject(GameOutcomeService);
    outcome.reset();
    const player = faction('player', 1, false);
    const aiFaction = faction('enemy1', 2);
    const factions = [player, aiFaction, faction('independent', 0, false), faction('unhabited', 0, false)];
    normalizeRelations(factions);
    setTreatyState(player, aiFaction, state, 0);
    const owners = [...Array(playerPlanets).fill('player'), ...Array(partnerPlanets).fill('enemy1')];
    return outcome.evaluateOutcome(factions, [system('s1', 10, 10, owners)], [fleet(1, 'enemy1', 10, 10, ['fighter'])]);
  };

  it('wins when every survivor is at peace and the player holds more than half of the inhabited planets', () => {
    expect(run(3, 2, 'peace')).toBe('victory');
  });

  it('does not win by peace with an even or smaller share, or while an enemy at war survives', () => {
    expect(run(2, 2, 'peace')).toBe('inProgress');
    expect(run(3, 2, 'war')).toBe('inProgress');
  });
});

describe('AI-vs-AI fleet battles (StarMapBattleDetectionService)', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const detect = (factions: Faction[], fleets: Fleet[], onAuto?: () => void) => {
    let entered = 0;
    const triggered = new Set<string>();
    const result = TestBed.inject(StarMapBattleDetectionService).checkForBattles(
      fleets,
      factions,
      (x, y) => ({ col: Math.floor(x), row: Math.floor(y) }),
      () => false,
      [],
      () => entered++,
      triggered,
      onAuto,
    );
    return { result, entered, triggered };
  };

  it('auto-resolves a battle between two AIs at war and records the loser\'s war losses', () => {
    const factions = [faction('enemy1', 2), faction('enemy2', 3)];
    normalizeRelations(factions, INITIAL_WAR_LOCK_SECONDS);
    const strong = fleet(1, 'enemy1', 5, 5, Array(5).fill('battleship'));
    const weak = fleet(2, 'enemy2', 5, 5, ['destroyer', 'destroyer']);
    let auto = 0;
    const { result, entered } = detect(factions, [strong, weak], () => auto++);
    expect(result).toBe(false);
    expect(entered).toBe(0);
    expect(auto).toBe(1);
    expect(weak.destroyed).toBe(true);
    expect(TestBed.inject(BattleService).getBattle()).toBeNull();
    expect(getRelation(factions[1], factions[0])?.shipsLostValue).toBe(520);
    expect(getWarExhaustion(factions[1], factions[0])).toBeGreaterThan(0);
  });

  it('fleets at peace or allied never fight', () => {
    const peaceful = [faction('enemy1', 2), faction('enemy2', 3)];
    normalizeRelations(peaceful);
    setTreatyState(peaceful[0], peaceful[1], 'peace', 0);
    const fleets = [fleet(1, 'enemy1', 5, 5, ['fighter']), fleet(2, 'enemy2', 5, 5, ['fighter'])];
    expect(detect(peaceful, fleets).triggered.size).toBe(0);
    expect(detect([faction('enemy1', 2), faction('enemy2', 2)], fleets).triggered.size).toBe(0);
  });

  it('a battle with the human player still opens the battle screen', () => {
    const factions = [faction('player', 1, false), faction('enemy1', 2)];
    normalizeRelations(factions);
    const { result, entered } = detect(factions, [fleet(1, 'player', 5, 5, ['fighter']), fleet(2, 'enemy1', 5, 5, ['fighter'])]);
    expect(result).toBe(true);
    expect(entered).toBe(1);
  });
});

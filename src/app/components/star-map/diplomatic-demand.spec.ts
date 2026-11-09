import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TRUCE_SECONDS,
  getOpinion,
  getRelation,
  getRelationKind,
  getReputation,
  normalizeRelations,
  setTreatyState,
  startPeace,
} from './diplomacy';
import {
  DEMAND_PAIR_COOLDOWN_SECONDS,
  DEMAND_RESPONSE_SECONDS,
  DEMAND_RULES,
  FOLLOW_THROUGH_SECONDS,
  MAX_DEMAND_TARGET_SHARE,
  MAX_PENDING_PLAYER_DEMANDS,
  MIN_DEMAND_CREDITS,
  PLAYER_DEMAND_COOLDOWN_SECONDS,
  REPUTATION_EMPTY_THREAT,
  DiplomaticDemand,
  validateDemand,
} from './diplomatic-demand';
import { transferResources } from './resource-transfer';
import { AiPersonality, Faction, Fleet, StarMapData, StarSystem } from './star-map.models';
import { DiplomacyService } from '../../services/diplomacy.service';
import { DiplomacyContext, EnemyDiplomacyService } from './enemy-diplomacy.service';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';

/*
 * Financial demands and ultimatums (docs/diplomacy.md). Every scenario uses
 * the real services: DiplomacyService applies the rules, EnemyDiplomacyService
 * makes the AI's choices, exactly as in the game loop.
 */

const faction = (id: string, team: number, ai: boolean, credits: number, personality?: AiPersonality): Faction => ({
  id,
  name: id,
  color: '#fff',
  team,
  ai,
  aiPersonality: personality,
  currencies: { credits, rawmaterials: 1000, research: 0 },
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
const system = (id: string, x: number, y: number, owners: string[], population = 700): StarSystem => ({
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

const strong = Array(10).fill('battleship');
const weak = ['fighter'];

interface Setup {
  playerShips?: string[];
  aShips?: string[];
  bShips?: string[];
  aPersonality?: AiPersonality;
  bPersonality?: AiPersonality;
  credits?: { player?: number; a?: number; b?: number };
  /* Treaty state between the two AIs (the player is at peace with both). */
  aiPair?: 'war' | 'peace';
}

/*
 * player at (14,10), enemy1 at (10,10), enemy2 at (40,10); every pair at
 * peace without a truce unless stated otherwise.
 */
function world(setup: Setup = {}): DiplomacyContext & { player: Faction; a: Faction; b: Faction } {
  const player = faction('player', 1, false, setup.credits?.player ?? 6000);
  const a = faction('enemy1', 2, true, setup.credits?.a ?? 20000, setup.aPersonality ?? 'militarist');
  const b = faction('enemy2', 3, true, setup.credits?.b ?? 20000, setup.bPersonality ?? 'balanced');
  const factions = [player, a, b];
  normalizeRelations(factions);
  setTreatyState(player, a, 'peace', 0);
  setTreatyState(player, b, 'peace', 0);
  setTreatyState(a, b, setup.aiPair ?? 'peace', 0);
  const fleets = [
    fleet(1, 'player', 14, 10, setup.playerShips ?? weak),
    fleet(2, 'enemy1', 10, 10, setup.aShips ?? strong),
    fleet(3, 'enemy2', 40, 10, setup.bShips ?? strong),
  ];
  const starSystems = [system('p', 14, 10, ['player']), system('s1', 10, 10, ['enemy1', 'enemy1']), system('s2', 40, 10, ['enemy2', 'enemy2'])];
  return { player, a, b, factions, fleets, starSystems, production: [], shipStock: [] };
}

describe('financial demands and ultimatums', () => {
  let ai: EnemyDiplomacyService;
  let diplomacy: DiplomacyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ai = TestBed.inject(EnemyDiplomacyService);
    diplomacy = TestBed.inject(DiplomacyService);
    ai.reset();
    diplomacy.reset();
  });

  /* A demand from `demander` to the human, stored as pending (as the AI tick would). */
  const demandToPlayer = (ctx: ReturnType<typeof world>, demander: Faction, kind: DiplomaticDemand['kind'], amount: number): DiplomaticDemand => {
    const result = ai.makeDemand(demander, ctx.player, kind, amount, ctx);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('pending');
    return diplomacy.getDemand(result.demand!.id)!;
  };

  it('1. an AI demands credits from the player on its own (deterministic, within the player\'s means)', () => {
    const ctx = world();
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    const demand = diplomacy.getPendingDemandsFor('player').find((d) => d.demanderId === 'enemy1');
    expect(demand).toBeDefined();
    // A strong militarist next door threatens rather than asks.
    expect(demand!.kind).toBe('threat');
    expect(demand!.amount).toBeGreaterThanOrEqual(MIN_DEMAND_CREDITS);
    expect(demand!.amount).toBeLessThanOrEqual(6000 * MAX_DEMAND_TARGET_SHARE);
    expect(demand!.secondsLeft).toBe(DEMAND_RESPONSE_SECONDS);
    // It waits for the answer instead of declaring war in parallel.
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
    expect(diplomacy.drainEvents().some((e) => e.kind === 'demand' && e.targetId === 'player')).toBe(true);
    // The same state gives the same decision (no randomness).
    const again = world();
    diplomacy.reset();
    ai.reset();
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, again);
    expect(diplomacy.getPendingDemandsFor('player').find((d) => d.demanderId === 'enemy1')).toMatchObject({ kind: demand!.kind, amount: demand!.amount });
  });

  it('2. the player accepts: exactly the demanded credits move, once', () => {
    const ctx = world();
    const demand = demandToPlayer(ctx, ctx.a, 'tribute', 1500);
    const result = diplomacy.acceptDemand(demand, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.player.currencies['credits']).toBe(4500);
    expect(ctx.a.currencies['credits']).toBe(21500);
    expect(diplomacy.getDemand(demand.id)).toBeUndefined();
    // A second accept of the same demand cannot pay twice.
    expect(diplomacy.getPendingDemandsFor('player')).toHaveLength(0);
    // Paying does not buy significant goodwill.
    expect(getOpinion(ctx.a, ctx.player)).toBe(DEMAND_RULES.tribute.paidOpinionDemander);
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
  });

  it('3. refusing a simple request sours relations, never starts a war', () => {
    const ctx = world({ aPersonality: 'balanced' });
    const demand = demandToPlayer(ctx, ctx.a, 'request', 500);
    const outcome = ai.handleRefusal(demand, ctx);
    expect(outcome).toBe('refused');
    expect(getOpinion(ctx.a, ctx.player)).toBe(DEMAND_RULES.request.refusalOpinion);
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
    expect(ctx.player.currencies['credits']).toBe(6000);
  });

  it('4. an AI threat refused by the player is carried out with a normal war declaration', () => {
    const ctx = world({ aPersonality: 'militarist' });
    const demand = demandToPlayer(ctx, ctx.a, 'threat', 2000);
    const reputationBefore = getReputation(ctx.a);
    const outcome = ai.handleRefusal(demand, ctx);
    expect(outcome).toBe('war');
    expect(getRelationKind(ctx.a, ctx.player)).toBe('war');
    expect(getRelation(ctx.a, ctx.player)?.declaredBy).toBe('enemy1');
    // DiplomacyService.declareWar's usual reputation penalty applies.
    expect(getReputation(ctx.a)).toBeLessThan(reputationBefore);
    expect(diplomacy.drainEvents().some((e) => e.kind === 'war' && e.initiatorId === 'enemy1')).toBe(true);
  });

  it('5. an AI bluffs: no war, but lost reputation and credibility that lasts', () => {
    const ctx = world({ aPersonality: 'technologist' });
    const demand = demandToPlayer(ctx, ctx.a, 'threat', 2000);
    const credibilityBefore = ai.evaluateDemand(ctx.b, { ...demand, targetId: 'enemy2' }, ctx).score;
    const decision = ai.assessFollowThrough(ctx.a, ctx.player, ctx);
    expect(decision.carryOut).toBe(false);
    const outcome = ai.handleRefusal(demand, ctx);
    expect(outcome).toBe('bluff');
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
    expect(getReputation(ctx.a)).toBe(REPUTATION_EMPTY_THREAT);
    expect(ctx.a.emptyThreats).toBe(1);
    // Every empire now takes its threats less seriously ...
    const credibilityAfter = ai.evaluateDemand(ctx.b, { ...demand, targetId: 'enemy2' }, ctx).score;
    expect(credibilityAfter).toBeLessThan(credibilityBefore);
    // ... and the bluffer is pushed toward carrying out the next one.
    const nextDecision = ai.assessFollowThrough(ctx.a, ctx.player, ctx);
    expect(nextDecision.score).toBeGreaterThan(decision.score);
    expect(nextDecision.factors.find((f) => f.key === 'credibility')?.value).toBeGreaterThan(0);
  });

  it('6. the player demands credits from an AI through the same path', () => {
    const ctx = world({ playerShips: strong, aShips: weak, aPersonality: 'balanced' });
    const result = ai.makeDemand(ctx.player, ctx.a, 'tribute', 1000, ctx);
    expect(result.ok).toBe(true);
    expect(['paid', 'refused']).toContain(result.outcome);
    // Cooldowns started and the AI resents the pressure.
    expect(ctx.player.demandCooldown).toBe(PLAYER_DEMAND_COOLDOWN_SECONDS);
    expect(getRelation(ctx.player, ctx.a)?.demandCooldown).toBe(DEMAND_PAIR_COOLDOWN_SECONDS);
    expect(getOpinion(ctx.a, ctx.player)).toBeLessThan(0);
  });

  it('7. an AI that fears the player pays a threat (credits move atomically)', () => {
    const ctx = world({ playerShips: strong, aShips: weak, aPersonality: 'technologist' });
    const evaluation = ai.evaluateDemand(ctx.a, { id: 0, kind: 'threat', demanderId: 'player', targetId: 'enemy1', amount: 1000, stage: 'pending', secondsLeft: 0 }, ctx);
    expect(evaluation.affordable).toBe(true);
    const result = ai.makeDemand(ctx.player, ctx.a, 'threat', 1000, ctx);
    expect(result.outcome).toBe('paid');
    expect(ctx.player.currencies['credits']).toBe(7000);
    expect(ctx.a.currencies['credits']).toBe(19000);
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
  });

  it('8. an AI refuses the player\'s demand; a refused ultimatum leaves the player war or backing down', () => {
    const ctx = world({ playerShips: weak, aShips: strong, aPersonality: 'militarist' });
    const request = ai.makeDemand(ctx.player, ctx.a, 'request', 1000, ctx);
    expect(request.outcome).toBe('refused');
    expect(ctx.a.currencies['credits']).toBe(20000);
    expect(getOpinion(ctx.a, ctx.player)).toBeLessThan(0);

    // A threat to a strong militarist is not guaranteed to work either.
    const other = world({ playerShips: weak, bShips: strong, bPersonality: 'militarist' });
    diplomacy.reset();
    const threat = ai.makeDemand(other.player, other.b, 'threat', 1000, other);
    expect(threat.outcome).toBe('follow_through');
    const open = diplomacy.getDemands().find((d) => d.stage === 'follow_through')!;
    expect(open.secondsLeft).toBe(FOLLOW_THROUGH_SECONDS);
    expect(diplomacy.carryOutThreat(open, other.factions).ok).toBe(true);
    expect(getRelationKind(other.player, other.b)).toBe('war');
    expect(getRelation(other.player, other.b)?.declaredBy).toBe('player');
  });

  it('8b. a player who lets the follow-through expire has backed down', () => {
    const ctx = world({ playerShips: weak, bShips: strong, bPersonality: 'militarist' });
    ai.makeDemand(ctx.player, ctx.b, 'threat', 1000, ctx);
    diplomacy.tick(FOLLOW_THROUGH_SECONDS + 1, ctx.factions, ctx);
    expect(diplomacy.getDemands()).toHaveLength(0);
    expect(ctx.player.emptyThreats).toBeGreaterThan(0);
    expect(getReputation(ctx.player)).toBeLessThan(0);
    expect(getRelationKind(ctx.player, ctx.b)).toBe('peace');
  });

  it('9. two AIs settle a demand between themselves without any player UI', () => {
    const ctx = world({ aShips: strong, bShips: weak, aPersonality: 'militarist', bPersonality: 'technologist' });
    // Only the AI pair is at peace: the player is out of the picture.
    setTreatyState(ctx.player, ctx.a, 'war', 0);
    setTreatyState(ctx.player, ctx.b, 'war', 0);
    const plan = ai.planDemand(ctx.a, ctx);
    expect(plan?.target.id).toBe('enemy2');
    expect(plan?.kind).toBe('threat');
    const creditsBefore = ctx.b.currencies['credits'];
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    const events = diplomacy.drainEvents();
    expect(events.some((e) => e.kind === 'demand' && e.initiatorId === 'enemy1' && e.targetId === 'enemy2')).toBe(true);
    const paid = events.find((e) => e.kind === 'demand_paid' && e.targetId === 'enemy2');
    expect(paid).toBeDefined();
    expect(ctx.b.currencies['credits']).toBe(creditsBefore - paid!.demand!.amount);
    // AI–AI demands are answered at once: nothing waits for anyone.
    expect(diplomacy.getDemands()).toHaveLength(0);
  });

  it('10. an AI never pays more than it holds or than it can spare', () => {
    const ctx = world({ playerShips: strong, aShips: weak, aPersonality: 'technologist', credits: { a: 1000 } });
    const demand: DiplomaticDemand = { id: 0, kind: 'threat', demanderId: 'player', targetId: 'enemy1', amount: 900, stage: 'pending', secondsLeft: 0 };
    const evaluation = ai.evaluateDemand(ctx.a, demand, ctx);
    expect(evaluation.spendable).toBeLessThanOrEqual(600);
    expect(evaluation.accept).toBe(false);
    // More than it holds is not even a valid demand, and a transfer cannot overdraw.
    expect(validateDemand({ ...demand, amount: 1500 }, ctx).reason).toBe('insufficient_credits');
    expect(transferResources(ctx.a, ctx.player, { credits: 1500 })).toBe(false);
    expect(ctx.a.currencies['credits']).toBe(1000);
    const result = ai.makeDemand(ctx.player, ctx.a, 'threat', 900, ctx);
    expect(result.outcome).not.toBe('paid');
    expect(ctx.a.currencies['credits']).toBe(1000);
    // An AI's own demand never exceeds half of what the target holds.
    const poor = world({ credits: { player: 400 } });
    diplomacy.reset();
    const plan = ai.planDemand(poor.a, poor);
    if (plan?.target.id === 'player') expect(plan.amount).toBeLessThanOrEqual(200);
  });

  it('11. cooldowns cannot be bypassed, also across a save round trip', () => {
    const ctx = world({ playerShips: strong, aShips: weak });
    expect(ai.makeDemand(ctx.player, ctx.a, 'request', 500, ctx).ok).toBe(true);
    const again = ai.makeDemand(ctx.player, ctx.b, 'request', 500, ctx);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('cooldown');
    // The global cooldown runs out, the per-empire one is longer.
    diplomacy.tick(PLAYER_DEMAND_COOLDOWN_SECONDS + 1, ctx.factions, ctx);
    expect(ai.makeDemand(ctx.player, ctx.a, 'request', 500, ctx).reason).toBe('cooldown');
    // Factions are saved as JSON: the cooldown survives a reload.
    const reloaded = JSON.parse(JSON.stringify(ctx.factions)) as Faction[];
    normalizeRelations(reloaded);
    expect(getRelation(reloaded[0], reloaded[1])?.demandCooldown).toBeGreaterThan(0);
    // Paused (zero delta): nothing counts down.
    const left = ctx.player.relations!['enemy1'].demandCooldown;
    diplomacy.tick(0, ctx.factions, ctx);
    expect(ctx.player.relations!['enemy1'].demandCooldown).toBe(left);
  });

  it('12. at most MAX_PENDING_PLAYER_DEMANDS demands wait for the player at once', () => {
    const ctx = world({ aPersonality: 'militarist', bPersonality: 'militarist' });
    const c = faction('enemy3', 4, true, 20000, 'militarist');
    ctx.factions.push(c);
    normalizeRelations(ctx.factions);
    setTreatyState(ctx.player, c, 'peace', 0);
    setTreatyState(c, ctx.a, 'peace', 0);
    setTreatyState(c, ctx.b, 'peace', 0);
    ctx.fleets.push(fleet(4, 'enemy3', 12, 12, strong));
    expect(ai.makeDemand(ctx.a, ctx.player, 'tribute', 500, ctx).ok).toBe(true);
    expect(ai.makeDemand(ctx.b, ctx.player, 'tribute', 500, ctx).ok).toBe(true);
    const third = ai.makeDemand(c, ctx.player, 'tribute', 500, ctx);
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('player_queue_full');
    expect(diplomacy.getPendingDemandsFor('player')).toHaveLength(MAX_PENDING_PLAYER_DEMANDS);
    // The AI tick respects the cap as well.
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(diplomacy.getPendingDemandsFor('player').length).toBeLessThanOrEqual(MAX_PENDING_PLAYER_DEMANDS);
    // A demander never has two demands open with the same target.
    expect(ai.makeDemand(ctx.player, ctx.a, 'request', 500, ctx).reason).toBe('open_demand');
  });

  it('13. pending demands survive save and load with their deadline, and expiry still counts as refusal', () => {
    const ctx = world({ aPersonality: 'militarist' });
    const demand = demandToPlayer(ctx, ctx.a, 'threat', 1000);
    diplomacy.tick(30, ctx.factions, ctx);
    const saved = JSON.parse(JSON.stringify({ factions: ctx.factions, demands: diplomacy.serializeDemands() }));
    diplomacy.reset();
    expect(diplomacy.getDemands()).toHaveLength(0);
    const factions = saved.factions as Faction[];
    normalizeRelations(factions);
    diplomacy.restoreDemands(saved.demands, factions);
    const restored = diplomacy.getDemand(demand.id);
    expect(restored).toMatchObject({ kind: 'threat', amount: 1000, stage: 'pending', secondsLeft: DEMAND_RESPONSE_SECONDS - 30 });
    // New demands never reuse a restored id.
    const loaded = { ...ctx, factions, player: factions[0], a: factions[1], b: factions[2] };
    expect(ai.makeDemand(loaded.b, loaded.player, 'request', 500, loaded).demand!.id).toBeGreaterThan(demand.id);
    // Letting it run out after the reload is a refusal: the militarist strikes.
    diplomacy.tick(DEMAND_RESPONSE_SECONDS, factions, loaded);
    ai.tick(0.01, loaded);
    expect(getRelationKind(loaded.a, loaded.player)).toBe('war');
    // A new game (no list yet) loads with none; malformed entries are dropped.
    const migrated = TestBed.inject(SaveGameService).normalizeSave({ saveVersion: SAVE_VERSION, factions: [], starSystems: [], fleets: [], map: { width: 10, height: 10, cellSizeVw: 2, cellSizeVh: 2 } } as unknown as StarMapData);
    expect(migrated.diplomaticDemands).toEqual([]);
    diplomacy.restoreDemands([{ id: 'x' }, null, { ...demand, kind: 'planet' }], factions);
    expect(diplomacy.getDemands()).toHaveLength(0);
  });

  it('14. no ultimatum during a truce, and a truce is never broken through a demand', () => {
    const ctx = world({ aPersonality: 'militarist' });
    startPeace(ctx.a, ctx.player, TRUCE_SECONDS);
    const threat = ai.makeDemand(ctx.a, ctx.player, 'threat', 1000, ctx);
    expect(threat.ok).toBe(false);
    expect(threat.reason).toBe('truce');
    // The AI does not even plan one (it may still ask for tribute later).
    expect(ai.planDemand(ctx.a, ctx)?.kind === 'threat' && ai.planDemand(ctx.a, ctx)?.target.id === 'player').toBe(false);
    // Even a stale follow-through cannot declare war through the truce.
    const stale: DiplomaticDemand = { id: 99, kind: 'threat', demanderId: 'enemy1', targetId: 'player', amount: 1000, stage: 'pending', secondsLeft: 10 };
    expect(ai.assessFollowThrough(ctx.a, ctx.player, ctx).carryOut).toBe(false);
    expect(diplomacy.carryOutThreat(stale, ctx.factions).ok).toBe(false);
    expect(ai.handleRefusal(stale, ctx)).toBe('bluff');
    expect(getRelationKind(ctx.a, ctx.player)).toBe('peace');
    expect(getRelation(ctx.a, ctx.player)?.truce).toBe(true);
  });

  it('15. a demand never interrupts or voids another open transaction', () => {
    const ctx = world({ aPersonality: 'militarist', bPersonality: 'balanced' });
    // enemy2 is at war with the player and has an open peace proposal.
    setTreatyState(ctx.player, ctx.b, 'war', 0);
    const offer = { proposerId: 'enemy2', recipientId: 'player', items: [] };
    diplomacy.addOffer(offer);
    const first = demandToPlayer(ctx, ctx.a, 'tribute', 500);
    expect(diplomacy.hasOffer('enemy2')).toBe(true);
    // Paying the demand leaves the peace proposal open.
    expect(diplomacy.acceptDemand(first, ctx).ok).toBe(true);
    expect(diplomacy.getOffer('enemy2')?.treaty).toEqual(offer);
    // An AI–AI demand leaves the player's open demand alone.
    const c = faction('enemy3', 4, true, 20000, 'technologist');
    ctx.factions.push(c);
    normalizeRelations(ctx.factions);
    setTreatyState(c, ctx.player, 'peace', 0);
    setTreatyState(c, ctx.a, 'peace', 0);
    ctx.fleets.push(fleet(5, 'enemy3', 60, 10, weak));
    ctx.starSystems.push(system('s3', 60, 10, ['enemy3']));
    const pending = demandToPlayer(ctx, c, 'request', 300);
    ctx.a.demandCooldown = 0;
    ai.makeDemand(ctx.a, c, 'tribute', 500, ctx);
    expect(diplomacy.getDemand(pending.id)).toBeDefined();
    expect(diplomacy.hasOffer('enemy2')).toBe(true);
    // A failed payment changes nothing and keeps the demand open.
    ctx.player.currencies['credits'] = 100;
    expect(diplomacy.acceptDemand(pending, ctx).ok).toBe(false);
    expect(diplomacy.getDemand(pending.id)).toBeDefined();
    expect(ctx.player.currencies['credits']).toBe(100);
  });

  it('16. a scripted campaign demand skips the cooldowns but no other rule', () => {
    const ctx = world({ playerShips: strong, aShips: weak });
    expect(ai.makeDemand(ctx.player, ctx.a, 'request', 500, ctx).ok).toBe(true);
    expect(ai.makeDemand(ctx.player, ctx.b, 'request', 500, ctx).reason).toBe('cooldown');
    expect(ai.makeDemand(ctx.player, ctx.b, 'request', 500, ctx, { ignoreCooldowns: true }).ok).toBe(true);
    // Feasibility still applies: no more than the target holds.
    const tooMuch = (ctx.b.currencies['credits'] ?? 0) + 1000;
    expect(ai.makeDemand(ctx.player, ctx.b, 'request', tooMuch, ctx, { ignoreCooldowns: true }).reason).toBe('insufficient_credits');
  });
});

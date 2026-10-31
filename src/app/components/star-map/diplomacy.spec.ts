import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  INITIAL_WAR_LOCK_SECONDS,
  PEACE_MIN_DURATION_SECONDS,
  WAR_MIN_DURATION_SECONDS,
  areFactionsAllied,
  areFactionsHostile,
  canAttackPlanetOf,
  getRelationKind,
  hostileFactionIds,
  normalizeRelations,
  setTreatyState,
  tickRelationLocks,
} from './diplomacy';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { DiplomacyService, PEACE_OFFER_SECONDS } from '../../services/diplomacy.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { BattleService } from '../../services/battle.service';

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

const system = (id: string, x: number, y: number, owners: string[]): StarSystem => ({
  id,
  name: id,
  x,
  y,
  planets: owners.length,
  color: '#fff',
  planetsTiles: owners.map((factionId, i) => ({
    id: x * 100 + y * 10 + i,
    index: i,
    name: `${id}-${i}`,
    factionId,
    x: 1,
    y: 1,
    type: 'earthlike',
    size: 'medium',
    population: 100,
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
    // A missing treaty entry between participants means war.
    expect(getRelationKind(player, a)).toBe('war');
    setTreatyState(a, b, 'peace', 10);
    expect(getRelationKind(a, b)).toBe('peace');
    expect(getRelationKind(b, a)).toBe('peace');
    expect(areFactionsHostile(a, b)).toBe(false);
    expect(areFactionsHostile(player, a)).toBe(true);
    expect(areFactionsAllied(a, legacyAlly)).toBe(true);
    expect(areFactionsHostile(a, rebels)).toBe(false);
  });

  it('allows planet attacks at war and on neutral rebels, never at peace, on allies or on unhabited planets', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    const rebels = faction('independent', 0, false);
    const unhabited = faction('unhabited', 0, false);
    expect(canAttackPlanetOf(a, b)).toBe(true);
    expect(canAttackPlanetOf(a, rebels)).toBe(true);
    expect(canAttackPlanetOf(a, unhabited)).toBe(false);
    expect(canAttackPlanetOf(rebels, a)).toBe(false);
    setTreatyState(a, b, 'peace', 0);
    expect(canAttackPlanetOf(a, b)).toBe(false);
    expect(canAttackPlanetOf(a, faction('enemy3', 2))).toBe(false);
  });

  it('normalizes relations: fills missing pairs, repairs disagreement as war, drops non-treaty entries', () => {
    const player = faction('player', 1, false);
    const a = faction('enemy1', 2, true, {
      relations: { enemy2: { state: 'peace', lockRemaining: 5 }, independent: { state: 'war', lockRemaining: 0 } },
    });
    const b = faction('enemy2', 3, true, { relations: { enemy1: { state: 'war', lockRemaining: 7 } } });
    const rebels = faction('independent', 0, false);
    const factions = [player, a, b, rebels];
    normalizeRelations(factions, 30);
    expect(a.relations).toEqual({ enemy2: { state: 'war', lockRemaining: 7 }, player: { state: 'war', lockRemaining: 30 } });
    expect(b.relations?.['enemy1']).toEqual({ state: 'war', lockRemaining: 7 });
    expect(player.relations).toEqual({
      enemy1: { state: 'war', lockRemaining: 30 },
      enemy2: { state: 'war', lockRemaining: 30 },
    });
    expect(rebels.relations).toBeUndefined();
    // Idempotent.
    const snapshot = JSON.stringify(factions);
    normalizeRelations(factions, 30);
    expect(JSON.stringify(factions)).toBe(snapshot);
  });

  it('keeps legacy saves (all AIs on team 2) allied and at war with the player', () => {
    const factions = [faction('player', 1, false), faction('enemy1', 2), faction('enemy2', 2)];
    normalizeRelations(factions);
    expect(areFactionsAllied(factions[1], factions[2])).toBe(true);
    expect(factions[1].relations).toEqual({ player: { state: 'war', lockRemaining: 0 } });
    expect([...hostileFactionIds(factions[1], factions)]).toEqual(['player']);
  });

  it('counts locks down with game time and never below zero', () => {
    const a = faction('enemy1', 2);
    const b = faction('enemy2', 3);
    setTreatyState(a, b, 'peace', 10);
    tickRelationLocks([a, b], 4);
    expect(a.relations?.['enemy2'].lockRemaining).toBe(6);
    expect(b.relations?.['enemy1'].lockRemaining).toBe(6);
    tickRelationLocks([a, b], 0);
    expect(a.relations?.['enemy2'].lockRemaining).toBe(6);
    tickRelationLocks([a, b], 100);
    expect(a.relations?.['enemy2'].lockRemaining).toBe(0);
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
    player = faction('player', 1, false);
    ai = faction('enemy1', 2);
    normalizeRelations([player, ai], INITIAL_WAR_LOCK_SECONDS);
  });

  it('refuses treaty changes while the relation is locked', () => {
    expect(service.signPeace(player, ai)).toEqual({ ok: false, reason: 'locked', waitSeconds: INITIAL_WAR_LOCK_SECONDS });
    service.tick(INITIAL_WAR_LOCK_SECONDS, [player, ai]);
    expect(service.signPeace(player, ai).ok).toBe(true);
    expect(player.relations?.['enemy1']).toEqual({ state: 'peace', lockRemaining: PEACE_MIN_DURATION_SECONDS });
    expect(service.declareWar(player, ai).reason).toBe('locked');
    service.tick(PEACE_MIN_DURATION_SECONDS, [player, ai]);
    expect(service.declareWar(player, ai).ok).toBe(true);
    expect(ai.relations?.['player']).toEqual({ state: 'war', lockRemaining: WAR_MIN_DURATION_SECONDS });
    expect(service.declareWar(player, ai).reason).toBe('already');
    expect(service.drainEvents()).toEqual([
      { kind: 'peace', initiatorId: 'player', targetId: 'enemy1' },
      { kind: 'war', initiatorId: 'player', targetId: 'enemy1' },
    ]);
    expect(service.drainEvents()).toEqual([]);
  });

  it('expires peace offers and clears them when the treaty changes', () => {
    service.addOffer('enemy1');
    service.tick(PEACE_OFFER_SECONDS - 1, [player, ai]);
    expect(service.hasOffer('enemy1')).toBe(true);
    service.tick(2, [player, ai]);
    expect(service.hasOffer('enemy1')).toBe(false);

    service.addOffer('enemy1');
    service.tick(INITIAL_WAR_LOCK_SECONDS, [player, ai]);
    service.signPeace(ai, player);
    expect(service.hasOffer('enemy1')).toBe(false);
  });

  it('never changes allied or neutral relations', () => {
    const ally = faction('enemy2', 2);
    expect(service.declareWar(ai, ally).reason).toBe('invalid');
    expect(service.signPeace(ai, faction('independent', 0, false)).reason).toBe('invalid');
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

  const world = (ownShips: string[], enemyShips: string[]) => {
    const a = faction('enemy1', 2, true, { aiPersonality: 'balanced' });
    const b = faction('enemy2', 3, true, { aiPersonality: 'balanced' });
    const factions = [faction('player', 1, false), a, b];
    normalizeRelations(factions);
    const fleets = [fleet(1, 'enemy1', 10, 10, ownShips), fleet(2, 'enemy2', 40, 10, enemyShips)];
    const starSystems = [system('s1', 10, 10, ['enemy1']), system('s2', 40, 10, ['enemy2'])];
    return { a, b, factions, fleets, starSystems };
  };

  it('seeks peace with a much stronger enemy and refuses while it feels strong', () => {
    const ctx = world(['fighter'], Array(10).fill('battleship'));
    expect(ai.wantsPeace(ctx.a, ctx.b, ctx)).toEqual({ accept: true, reason: 'outmatched' });
    expect(ai.wantsPeace(ctx.b, ctx.a, ctx).accept).toBe(false);
  });

  it('signs AI–AI peace only when both sides want it', () => {
    // Two evenly matched AIs fighting only each other: no reason for peace.
    const ctx = world(Array(5).fill('battleship'), Array(5).fill('battleship'));
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('war');

    // The player appears next to both: each AI's nearer, primary enemy. Their
    // mutual war becomes a second front for both, so both want peace.
    ctx.starSystems.push(system('p1', 12, 10, ['player']), system('p2', 42, 10, ['player']));
    ctx.fleets.push(fleet(3, 'player', 12, 10, Array(5).fill('battleship')));
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('peace');
  });

  it('a dominant AI does not let a much weaker enemy off on a second front', () => {
    const ctx = world(['fighter'], Array(10).fill('battleship'));
    ctx.starSystems.push(system('p2', 42, 10, ['player']));
    ctx.fleets.push(fleet(3, 'player', 42, 10, Array(10).fill('battleship')));
    // enemy1 is outmatched and wants peace; enemy2 refuses (ratio far below SECOND_FRONT_MIN_RATIO).
    expect(ai.wantsPeace(ctx.a, ctx.b, ctx).accept).toBe(true);
    expect(ai.wantsPeace(ctx.b, ctx.a, ctx).accept).toBe(false);
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('war');
  });

  it('offers peace to the human player instead of signing it', () => {
    const ctx = world(['fighter'], ['fighter']);
    ctx.fleets.push(fleet(3, 'player', 12, 10, Array(10).fill('battleship')));
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(diplomacy.hasOffer('enemy1')).toBe(true);
    expect(getRelationKind(ctx.factions[0], ctx.a)).toBe('war');
  });

  it('declares war on a clearly weaker neighbour at peace, within its war limit', () => {
    const ctx = world(Array(10).fill('battleship'), ['fighter']);
    setTreatyState(ctx.a, ctx.b, 'peace', 0);
    // The player is far away and equally strong: enemy1 has no war it is fighting nearby.
    setTreatyState(ctx.a, ctx.factions[0], 'peace', 0);
    ai.tick(EnemyDiplomacyService.DECISION_INTERVAL, ctx);
    expect(getRelationKind(ctx.a, ctx.b)).toBe('war');
    expect(diplomacy.drainEvents()).toContainEqual({ kind: 'war', initiatorId: 'enemy1', targetId: 'enemy2' });
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

describe('diplomatic victory (GameOutcomeService)', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const run = (playerPlanets: number, partnerPlanets: number, state: 'war' | 'peace') => {
    const outcome = TestBed.inject(GameOutcomeService);
    outcome.reset();
    const player = faction('player', 1, false);
    const ai = faction('enemy1', 2);
    const factions = [player, ai, faction('independent', 0, false), faction('unhabited', 0, false)];
    normalizeRelations(factions);
    setTreatyState(player, ai, state, 0);
    const owners = [...Array(playerPlanets).fill('player'), ...Array(partnerPlanets).fill('enemy1')];
    return outcome.evaluateOutcome(factions, [system('s1', 10, 10, owners)], [fleet(1, 'enemy1', 10, 10, ['fighter'])]);
  };

  it('wins when every survivor is at peace and the player holds more than half of the inhabited planets', () => {
    expect(run(3, 2, 'peace')).toBe('victory');
  });

  it('does not win by peace with an even or smaller share', () => {
    expect(run(2, 2, 'peace')).toBe('inProgress');
    expect(run(1, 3, 'peace')).toBe('inProgress');
  });

  it('a surviving enemy at war still blocks victory', () => {
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

  it('auto-resolves a battle between two AIs at war without opening the battle screen', () => {
    const factions = [faction('enemy1', 2), faction('enemy2', 3)];
    normalizeRelations(factions);
    const strong = fleet(1, 'enemy1', 5, 5, Array(5).fill('battleship'));
    const weak = fleet(2, 'enemy2', 5, 5, ['scout']);
    let auto = 0;
    const { result, entered } = detect(factions, [strong, weak], () => auto++);
    expect(result).toBe(false);
    expect(entered).toBe(0);
    expect(auto).toBe(1);
    expect(weak.destroyed).toBe(true);
    expect(strong.destroyed).toBe(false);
    expect(TestBed.inject(BattleService).getBattle()).toBeNull();
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

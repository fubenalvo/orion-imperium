import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, SpaceBase, StarMapData, StarSystem } from './star-map.models';
import {
  DYSON_WARMUP_SECONDS,
  advanceDysonWarmup,
  dysonRingHolder,
  formatWarmup,
  sanitizeDysonWarmup,
} from './dyson-victory';
import { diffDysonAnchors, snapshotDysonAnchors } from './dyson-news';
import { DysonVictoryService } from './dyson-victory.service';
import { DysonRingService } from './dyson-ring.service';
import { SpaceBaseService } from './space-base.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { blackHoleObject } from '../../services/galaxy-generator.service';

/*
 * Dyson victory (docs/dyson-swarm.md, phase 4): ring holder, warm-up
 * countdown / cancel / restart / completion, the game outcome rule and the
 * global news diff.
 */

const anchor = (id: number, slot: number, factionId: string, extra: Partial<SpaceBase> = {}): SpaceBase => ({
  id, name: `Dyson Anchor ${slot + 1}`, factionId, x: 0, y: 0, kind: 'dyson', dysonSlot: slot, ...extra,
});

const fullRing = (factionId: string): SpaceBase[] => Array.from({ length: 8 }, (_, slot) => anchor(slot + 1, slot, factionId));

const systemOwnedBy = (factionId: string): StarSystem =>
  ({
    id: 's', name: 's', x: 1, y: 1, planets: 1, color: '#fff', explored: true,
    planetsTiles: [{ id: 1, index: 0, name: 'P', factionId, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 10, buildings: [], explored: true }],
  }) as unknown as StarSystem;

describe('Dyson ring holder', () => {
  it('needs a completed anchor of one faction on every slot and an owned planet', () => {
    const systems = [systemOwnedBy('player')];
    expect(dysonRingHolder(fullRing('player'), 8, systems)).toBe('player');
    expect(dysonRingHolder(fullRing('player').slice(1), 8, systems)).toBeNull();
    const mixed = fullRing('player');
    mixed[3] = anchor(4, 3, 'enemy1');
    expect(dysonRingHolder(mixed, 8, systems)).toBeNull();
    const site = fullRing('player');
    site[5] = anchor(6, 5, 'player', { constructionRemaining: 10 });
    expect(dysonRingHolder(site, 8, systems)).toBeNull();
    // No planet left: no holder.
    expect(dysonRingHolder(fullRing('player'), 8, [systemOwnedBy('enemy1')])).toBeNull();
    // Ordinary bases never count.
    expect(dysonRingHolder([{ id: 9, name: 'B', factionId: 'player', x: 1, y: 1 }], 8, systems)).toBeNull();
  });
});

describe('Dyson warm-up', () => {
  it('starts, counts down, and completes once', () => {
    let step = advanceDysonWarmup(null, 'player', 10);
    expect(step.events.map((e) => e.kind)).toEqual(['started']);
    expect(step.state).toEqual({ factionId: 'player', remaining: DYSON_WARMUP_SECONDS - 10 });
    step = advanceDysonWarmup(step.state, 'player', DYSON_WARMUP_SECONDS);
    expect(step.events).toEqual([{ kind: 'completed', factionId: 'player' }]);
    expect(step.state!.remaining).toBe(0);
    // Terminal: nothing changes any more, even if the ring is lost.
    expect(advanceDysonWarmup(step.state, null, 5)).toEqual({ state: step.state, events: [] });
  });

  it('is cancelled when the holder loses the ring and restarts from the full time', () => {
    const running = advanceDysonWarmup(null, 'enemy1', 200).state!;
    expect(running.remaining).toBe(DYSON_WARMUP_SECONDS - 200);
    const lost = advanceDysonWarmup(running, null, 1);
    expect(lost).toEqual({ state: null, events: [{ kind: 'cancelled', factionId: 'enemy1' }] });
    const again = advanceDysonWarmup(lost.state, 'enemy1', 0);
    expect(again.state).toEqual({ factionId: 'enemy1', remaining: DYSON_WARMUP_SECONDS });
    // A different holder cancels the old warm-up and starts its own.
    const swapped = advanceDysonWarmup(again.state, 'player', 0);
    expect(swapped.events.map((e) => e.kind)).toEqual(['cancelled', 'started']);
  });

  it('freezes while paused and sanitizes a saved state', () => {
    const running = advanceDysonWarmup(null, 'player', 0).state!;
    expect(advanceDysonWarmup(running, 'player', 0).state).toEqual(running);
    expect(sanitizeDysonWarmup({ factionId: 'x', remaining: 9999 })).toEqual({ factionId: 'x', remaining: DYSON_WARMUP_SECONDS });
    expect(sanitizeDysonWarmup({ factionId: 3, remaining: 1 })).toBeNull();
    expect(sanitizeDysonWarmup(undefined)).toBeNull();
    expect(formatWarmup(245.2)).toBe('4:06');
  });

  it('the service follows the live anchors', () => {
    TestBed.inject(DysonRingService).configure([blackHoleObject(120, 80)]);
    const bases = TestBed.inject(SpaceBaseService);
    const victory = TestBed.inject(DysonVictoryService);
    victory.restore(undefined);
    bases.restore(fullRing('enemy1'));
    const systems = [systemOwnedBy('enemy1')];
    expect(victory.tick(1, systems).map((e) => e.kind)).toEqual(['started']);
    bases.destroy(4);
    expect(victory.tick(1, systems)).toEqual([{ kind: 'cancelled', factionId: 'enemy1' }]);
    expect(victory.serialize()).toBeUndefined();
  });
});

describe('Dyson game outcome', () => {
  const factions = [
    { id: 'player', name: 'P', color: '#fff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'E', color: '#f00', team: 2, ai: true, currencies: {} },
  ] as unknown as Faction[];
  const data = (dysonWarmup?: StarMapData['dysonWarmup']): StarMapData => ({
    factions,
    map: { width: 10, height: 10, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [systemOwnedBy('player'), { ...systemOwnedBy('enemy1'), id: 't' }],
    fleets: [],
    dysonWarmup,
  });

  let outcomes: GameOutcomeService;
  beforeEach(() => {
    outcomes = TestBed.inject(GameOutcomeService);
    outcomes.reset();
  });

  it('a completed warm-up decides the game for its holder', () => {
    expect(outcomes.evaluate(data({ factionId: 'player', remaining: 0 }))).toBe('victory');
    outcomes.reset();
    expect(outcomes.evaluate(data({ factionId: 'enemy1', remaining: 0 }))).toBe('defeat');
  });

  it('a running warm-up does not', () => {
    expect(outcomes.evaluate(data({ factionId: 'player', remaining: 1 }))).toBe('inProgress');
    expect(outcomes.evaluate(data())).toBe('inProgress');
  });
});

describe('Dyson news', () => {
  it('reports started, completed, destroyed and demolished anchors', () => {
    const before = snapshotDysonAnchors([
      anchor(1, 0, 'enemy1', { constructionRemaining: 5 }),
      anchor(2, 1, 'enemy1'),
      anchor(3, 2, 'player'),
    ]);
    const after = snapshotDysonAnchors([
      anchor(1, 0, 'enemy1'),
      anchor(4, 3, 'enemy1', { constructionRemaining: 300 }),
      anchor(5, 4, 'enemy1'),
    ]);
    const events = diffDysonAnchors(before, after, (id) => id === 3);
    expect(events.map((e) => [e.kind, e.anchor.id])).toEqual([
      ['completed', 1],
      ['destroyed', 2],
      ['demolished', 3],
      ['started', 4],
      // Appeared already complete: reported once.
      ['completed', 5],
    ]);
    // Ordinary bases are never news.
    expect(snapshotDysonAnchors([{ id: 9, name: 'B', factionId: 'player', x: 1, y: 1 }])).toEqual([]);
  });

  it('demolish marks the anchor once for the news', () => {
    TestBed.inject(DysonRingService).configure([blackHoleObject(120, 80)]);
    const bases = TestBed.inject(SpaceBaseService);
    bases.restore([anchor(1, 0, 'player')]);
    expect(bases.demolish(1, 'player')).toBe(true);
    expect(bases.takeDemolished(1)).toBe(true);
    expect(bases.takeDemolished(1)).toBe(false);
  });
});

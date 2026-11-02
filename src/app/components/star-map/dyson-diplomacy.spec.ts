import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, Fleet, SpaceBase, StarSystem } from './star-map.models';
import {
  OPINION_TREATY_BROKEN,
  OPINION_WAR_DECLARED,
  REPUTATION_WAR_DECLARED,
  TRUCE_SECONDS,
  getOpinion,
  getRelationKind,
  getReputation,
  normalizeRelations,
  recordHostileAct,
  startPeace,
} from './diplomacy';
import { DiplomacyService } from '../../services/diplomacy.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { SpaceBaseService } from './space-base.service';
import { DysonRingService } from './dyson-ring.service';
import { DysonVictoryService } from './dyson-victory.service';
import { StarMapMovementService } from './star-map-movement.service';
import { DYSON_ANCHOR_OPINION_PENALTY, DYSON_ANCHOR_SHIP_TYPE, DYSON_CASUS_BELLI_ANCHORS, DYSON_TECHNOLOGY_ID } from './dyson-anchor';
import { PeaceTreaty } from './peace-treaty';
import { blackHoleObject } from '../../services/galaxy-generator.service';

/*
 * Dyson Swarm diplomacy (docs/dyson-swarm.md, phase 5): the opinion cost of
 * each anchor, the casus belli against an empire with 3+ anchors (no
 * reputation for war or a truce breach, no surprise-attack penalty), and no
 * AI peace with a faction whose warm-up runs.
 */

const W = 120;
const H = 80;

const faction = (id: string, team: number, ai = true, extra: Partial<Faction> = {}): Faction => ({
  id, name: id, color: '#fff', team, ai, currencies: { credits: 5000, rawmaterials: 2000, research: 0 }, ...extra,
});

const anchors = (factionId: string, count: number): SpaceBase[] =>
  Array.from({ length: count }, (_, slot) => ({
    id: slot + 1, name: `Dyson Anchor ${slot + 1}`, factionId, x: 0, y: 0, kind: 'dyson' as const, dysonSlot: slot,
  }));

describe('Dyson Swarm diplomacy', () => {
  let diplomacy: DiplomacyService;
  let bases: SpaceBaseService;
  let factions: Faction[];
  let player: Faction;
  let builder: Faction;
  let other: Faction;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(DysonRingService).configure([blackHoleObject(W, H)]);
    diplomacy = TestBed.inject(DiplomacyService);
    diplomacy.reset();
    bases = TestBed.inject(SpaceBaseService);
    bases.restore([]);
    TestBed.inject(DysonVictoryService).restore(undefined);
    player = faction('player', 1, false);
    builder = faction('enemy1', 2, true, { researchedTechnologies: [DYSON_TECHNOLOGY_ID] });
    other = faction('enemy2', 3);
    factions = [player, builder, other, faction('unhabited', 0, false)];
    normalizeRelations(factions);
  });

  it('every anchor deployment lowers every other empire’s opinion of the builder', () => {
    for (const f of [player, other]) startPeace(f, builder, 0);
    const before = { player: getOpinion(player, builder), other: getOpinion(other, builder) };
    const ring = TestBed.inject(DysonRingService).ring!;
    const fleet: Fleet = {
      id: 1, name: 'F', factionId: 'enemy1', x: ring.slots[0].col, y: ring.slots[0].row, targetX: null, targetY: null, speed: 1, system: null,
      ships: [{ id: 1, name: 'SC', type: DYSON_ANCHOR_SHIP_TYPE }],
    };
    expect(bases.deployAnchor(fleet, factions).base).not.toBeNull();
    expect(getOpinion(player, builder)).toBe(before.player + DYSON_ANCHOR_OPINION_PENALTY);
    expect(getOpinion(other, builder)).toBe(before.other + DYSON_ANCHOR_OPINION_PENALTY);
  });

  it('war on an empire with 3+ anchors costs no reputation and carries no surprise-attack penalty', () => {
    startPeace(player, builder, 0);
    bases.restore(anchors('enemy1', DYSON_CASUS_BELLI_ANCHORS));
    expect(diplomacy.isDysonCasusBelli(builder)).toBe(true);
    const reputation = getReputation(player);
    const opinion = getOpinion(builder, player);
    expect(diplomacy.declareWar(player, builder).ok).toBe(true);
    expect(getReputation(player)).toBe(reputation);
    expect(getOpinion(builder, player)).toBe(opinion + OPINION_WAR_DECLARED);
    // Attacking at once is not a surprise attack.
    expect(recordHostileAct(player, builder)).toBe(false);
    expect(getReputation(player)).toBe(reputation);
    expect(diplomacy.drainEvents().find((e) => e.kind === 'war')?.dysonCasusBelli).toBe(true);
  });

  it('below the threshold war costs the usual reputation', () => {
    startPeace(player, builder, 0);
    bases.restore(anchors('enemy1', DYSON_CASUS_BELLI_ANCHORS - 1));
    const reputation = getReputation(player);
    expect(diplomacy.declareWar(player, builder).ok).toBe(true);
    expect(getReputation(player)).toBe(reputation + REPUTATION_WAR_DECLARED);
  });

  it('breaking a truce with a casus belli target costs no reputation', () => {
    startPeace(player, builder, TRUCE_SECONDS);
    bases.restore(anchors('enemy1', 5));
    const reputation = getReputation(player);
    const opinion = getOpinion(builder, player);
    expect(diplomacy.canDeclareWar(player, builder).ok).toBe(false);
    expect(diplomacy.breakTreaty(player, builder).ok).toBe(true);
    expect(getRelationKind(player, builder)).toBe('war');
    expect(getReputation(player)).toBe(reputation);
    expect(getOpinion(builder, player)).toBe(opinion + OPINION_TREATY_BROKEN);
  });

  it('no AI makes or accepts peace with a faction whose warm-up runs', () => {
    const ai = TestBed.inject(EnemyDiplomacyService);
    const victory = TestBed.inject(DysonVictoryService);
    const ctx = {
      factions,
      fleets: [] as Fleet[],
      starSystems: [
        { id: 's1', name: 's1', x: 10, y: 10, planets: 1, color: '#fff', explored: true, planetsTiles: [{ id: 1, index: 0, name: 'a', factionId: 'enemy1', x: 1, y: 1, type: 'earthlike', size: 'medium', population: 100, buildings: [], explored: true }] },
        { id: 's2', name: 's2', x: 40, y: 10, planets: 1, color: '#fff', explored: true, planetsTiles: [{ id: 2, index: 0, name: 'b', factionId: 'enemy2', x: 1, y: 1, type: 'earthlike', size: 'medium', population: 100, buildings: [], explored: true }] },
      ] as unknown as StarSystem[],
    };
    // A generous offer from enemy1 to enemy2 (at war): everything enemy1 has.
    const generous: PeaceTreaty = { proposerId: 'enemy1', recipientId: 'enemy2', items: [{ kind: 'credits', giverId: 'enemy1', amount: 5000 }] };
    expect(ai.evaluateTreaty(other, generous, ctx).accept).toBe(true);

    victory.restore({ factionId: 'enemy1', remaining: 200 });
    const blocked = ai.evaluateTreaty(other, generous, ctx);
    expect(blocked.accept).toBe(false);
    expect(blocked.acceptance).toBe(0);
    expect(blocked.assessment.factors.map((f) => f.key)).toContain('dyson');
    expect(ai.respondToProposal(other, generous, ctx).decision).toBe('refuse');

    // The holder itself is not blocked from judging terms.
    const reverse: PeaceTreaty = { proposerId: 'enemy2', recipientId: 'enemy1', items: [{ kind: 'credits', giverId: 'enemy2', amount: 5000 }] };
    expect(ai.evaluateTreaty(builder, reverse, ctx).assessment.factors.map((f) => f.key)).not.toContain('dyson');
  });
});

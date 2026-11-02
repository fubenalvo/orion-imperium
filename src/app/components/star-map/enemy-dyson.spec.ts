import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction, FactionProduction, FactionShipStock, Fleet, PlanetTile, SpaceBase, StarSystem } from './star-map.models';
import { EnemyDysonService } from './enemy-dyson.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { EnemyResearchService } from './enemy-research.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { SpaceBaseService } from './space-base.service';
import { DysonRingService } from './dyson-ring.service';
import { DysonVictoryService } from './dyson-victory.service';
import { StarMapMovementService } from './star-map-movement.service';
import { ResearchService } from '../../services/research.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { DYSON_ANCHOR_SHIP_TYPE, DYSON_TECHNOLOGY_ID } from './dyson-anchor';
import { AiPersonality } from './ai-personality';
import { TRUCE_SECONDS, getRelationKind, getReputation, normalizeRelations, startPeace } from './diplomacy';
import { blackHoleObject } from '../../services/galaxy-generator.service';

/*
 * AI Dyson Swarm behavior (docs/dyson-swarm.md, "AI"; EnemyDysonService):
 * building by personality, driving and deploying the constructor, hunting
 * a rival's anchors (war, truce breach during a warm-up, fleet orders),
 * releasing orders and guarding own anchors.
 */

const W = 120;
const H = 80;
const TICK = EnemyDysonService.DECISION_INTERVAL;

const faction = (id: string, team: number, personality: AiPersonality | null, extra: Partial<Faction> = {}): Faction => ({
  id, name: id, color: '#fff', team, ai: personality !== null, aiPersonality: personality ?? undefined,
  currencies: { credits: 500000, rawmaterials: 100000, research: 0 },
  researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power', DYSON_TECHNOLOGY_ID],
  ...extra,
} as Faction);

const homeSystem = (id: string, owner: string, x: number): StarSystem => ({
  id, name: id, x, y: 10, planets: 1, color: '#fff', explored: true,
  planetsTiles: [{
    id: x, index: 0, name: `${id} I`, factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 100,
    explored: true, resourceTiles: [],
    buildings: [{ name: 'Spaceship Factory', size: 2, x: 0, y: 0 }, { name: 'Spaceport', size: 2, x: 3, y: 0 }],
  } as PlanetTile],
});

const fleet = (id: number, factionId: string, x: number, y: number, types: string[]): Fleet => ({
  id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, system: null,
  ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
});

describe('EnemyDysonService', () => {
  let service: EnemyDysonService;
  let bases: SpaceBaseService;
  let ring: NonNullable<DysonRingService['ring']>;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(DysonRingService).configure([blackHoleObject(W, H)]);
    ring = TestBed.inject(DysonRingService).ring!;
    bases = TestBed.inject(SpaceBaseService);
    bases.restore([]);
    TestBed.inject(DysonVictoryService).restore(undefined);
    TestBed.inject(DiplomacyService).reset();
    service = TestBed.inject(EnemyDysonService);
    service.reset();
    // Upkeep headroom is the economy manager's projection; plenty here.
    vi.spyOn(TestBed.inject(EnemyEconomyService), 'getProjectedNet').mockReturnValue({ income: 2000, net: 1000, rawNet: 10, researchNet: 0, upkeepScale: 1 });
  });

  const world = (factions: Faction[], fleets: Fleet[] = []) => ({
    factions,
    starSystems: factions.filter((f) => f.team !== 0).map((f, i) => homeSystem(`home-${f.id}`, f.id, 10 + i * 40)),
    fleets,
    shipStock: [] as FactionShipStock[],
    production: [] as FactionProduction[],
  });

  const anchorsOf = (factionId: string, slots: number[], extra: Partial<SpaceBase> = {}): SpaceBase[] =>
    slots.map((slot) => ({
      id: 100 + slot, name: `Dyson Anchor ${slot + 1}`, factionId, x: ring.slots[slot].col, y: ring.slots[slot].row,
      kind: 'dyson' as const, dysonSlot: slot, ...extra,
    }));

  describe('building', () => {
    it('a technologist queues one Swarm Constructor; a militarist never does', () => {
      const tech = faction('enemy1', 2, 'technologist');
      const mil = faction('enemy2', 3, 'militarist');
      const data = world([tech, mil]);
      normalizeRelations(data.factions);
      service.tick(TICK, tech, data, new Set());
      service.tick(TICK, mil, data, new Set());
      const orders = (id: string) => Object.values(data.production.find((p) => p.factionId === id)?.ordersByPlanet ?? {}).flat();
      expect(orders('enemy1').map((o) => o.shipTypeId)).toEqual([DYSON_ANCHOR_SHIP_TYPE]);
      expect(orders('enemy2')).toEqual([]);
      // A technologist runs at most two constructors at once (phase 7).
      service.tick(TICK, tech, data, new Set());
      service.tick(TICK, tech, data, new Set());
      expect(orders('enemy1')).toHaveLength(EnemyDysonService.MAX_CONSTRUCTORS.always);
    });

    it('a balanced empire builds only with a large credit surplus', () => {
      const poor = faction('enemy1', 2, 'balanced', { currencies: { credits: 20000, rawmaterials: 50000, research: 0 } });
      const data = world([poor]);
      service.tick(TICK, poor, data, new Set());
      expect(data.production).toEqual([]);
    });

    it('assembles the constructor with an escort, flies to the nearest free slot, deploys and picks a bonus', () => {
      const tech = faction('enemy1', 2, 'technologist');
      const data = world([tech]);
      data.shipStock.push({ factionId: 'enemy1', ships: [
        { id: 1, name: 'SC', type: DYSON_ANCHOR_SHIP_TYPE }, { id: 2, name: 'F1', type: 'frigate' }, { id: 3, name: 'F2', type: 'frigate' },
      ] });
      expect(service.tick(TICK, tech, data, new Set())).toBe(true);
      const builders = data.fleets.find((f) => EnemyDysonService.isConstructorFleet(f))!;
      expect(builders.ships.map((s) => s.type).sort()).toEqual(['frigate', 'frigate', DYSON_ANCHOR_SHIP_TYPE]);

      bases.restore(anchorsOf('enemy2', [0]));
      service.tick(TICK, tech, data, new Set());
      const target = { x: builders.targetX!, y: builders.targetY! };
      const nearestFree = ring.slots.filter((s) => s.index !== 0)
        .sort((a, b) => Math.hypot(a.col - builders.x, a.row - builders.y) - Math.hypot(b.col - builders.x, b.row - builders.y))[0];
      expect(target).toEqual({ x: nearestFree.col, y: nearestFree.row });

      // Arrived.
      builders.x = target.x;
      builders.y = target.y;
      builders.targetX = null;
      builders.targetY = null;
      service.tick(TICK, tech, data, new Set());
      const anchor = bases.anchorOnSlot(nearestFree.index)!;
      expect(anchor).toMatchObject({ factionId: 'enemy1', dysonBonus: 'swarm_observatory' });
      expect(builders.ships.some((s) => s.type === DYSON_ANCHOR_SHIP_TYPE)).toBe(false);
    });
  });

  describe('hunting', () => {
    it('a militarist declares a free war on an empire with 3 anchors and sends a fleet to its sites first', () => {
      const mil = faction('enemy1', 2, 'militarist');
      const builder = faction('enemy2', 3, 'technologist');
      const hunter = fleet(1, 'enemy1', 20, 20, ['frigate', 'frigate', 'frigate']);
      const data = world([mil, builder], [hunter]);
      normalizeRelations(data.factions);
      startPeace(mil, builder, 0);
      bases.restore([...anchorsOf('enemy2', [0, 1]), ...anchorsOf('enemy2', [5], { constructionRemaining: 100 })]);
      const reputation = getReputation(mil);

      service.tick(TICK, mil, data, new Set());
      expect(getRelationKind(mil, builder)).toBe('war');
      expect(getReputation(mil)).toBe(reputation);

      service.tick(TICK, mil, data, new Set());
      expect(service.getOrderedFleetIds().has(1)).toBe(true);
      expect({ x: hunter.targetX, y: hunter.targetY }).toEqual({ x: ring.slots[5].col, y: ring.slots[5].row });
    });

    it('below its threshold a technologist leaves the builder alone, and a weak fleet is not sent', () => {
      const tech = faction('enemy1', 2, 'technologist');
      const mil = faction('enemy3', 4, 'militarist');
      const builder = faction('enemy2', 3, 'balanced');
      const weak = fleet(2, 'enemy3', 20, 20, ['fighter']);
      const data = world([tech, mil, builder], [weak]);
      normalizeRelations(data.factions);
      startPeace(tech, builder, 0);
      bases.restore(anchorsOf('enemy2', [0, 1, 2]));
      service.tick(TICK, tech, data, new Set());
      expect(getRelationKind(tech, builder)).toBe('peace');
      // The militarist is at war already (default), but one fighter is too weak against completed anchors.
      service.tick(TICK, mil, data, new Set());
      expect(service.getOrderedFleetIds().size).toBe(0);
    });

    it('during a warm-up every personality hunts, breaks a truce and commits all fleets but one', () => {
      const exp = faction('enemy1', 2, 'expansionist');
      const holder = faction('enemy2', 3, 'technologist');
      const fleets = [1, 2, 3].map((id) => fleet(id, 'enemy1', 20 + id, 20, ['fighter']));
      const data = world([exp, holder], fleets);
      normalizeRelations(data.factions);
      startPeace(exp, holder, TRUCE_SECONDS);
      bases.restore(anchorsOf('enemy2', [0, 1, 2, 3, 4, 5, 6, 7]));
      TestBed.inject(DysonVictoryService).restore({ factionId: 'enemy2', remaining: 200 });

      service.tick(TICK, exp, data, new Set());
      expect(getRelationKind(exp, holder)).toBe('war');
      service.tick(TICK, exp, data, new Set());
      expect(service.getOrderedFleetIds().size).toBe(2);
      // Fleets reserved elsewhere are never taken.
      service.reset();
      service.tick(TICK, exp, data, new Set([1, 2, 3]));
      service.tick(TICK, exp, data, new Set([1, 2, 3]));
      expect(service.getOrderedFleetIds().size).toBe(0);
    });

    it('releases the hunters once the target has no anchors left', () => {
      const mil = faction('enemy1', 2, 'militarist');
      const builder = faction('enemy2', 3, 'technologist');
      const hunter = fleet(1, 'enemy1', 20, 20, ['frigate', 'frigate', 'frigate']);
      const data = world([mil, builder], [hunter]);
      normalizeRelations(data.factions);
      bases.restore(anchorsOf('enemy2', [0, 1, 2]));
      service.tick(TICK, mil, data, new Set());
      expect(service.getOrderedFleetIds().has(1)).toBe(true);
      bases.restore([]);
      service.tick(TICK, mil, data, new Set());
      expect(service.getOrderedFleetIds().size).toBe(0);
      expect(hunter.targetX).toBeNull();
    });
  });

  describe('contesting a full ring', () => {
    it('a builder facing a full ring it does not own hunts the rival with the most anchors, and refuses peace with it', () => {
      const tech = faction('enemy1', 2, 'technologist');
      const rival = faction('enemy2', 3, 'balanced');
      const data = world([tech, rival]);
      normalizeRelations(data.factions);
      startPeace(tech, rival, 0);
      bases.restore([...anchorsOf('enemy1', [0, 1, 2, 3, 4, 5]), ...anchorsOf('enemy2', [6, 7])]);
      expect(service.isHuntTarget(tech, rival, data.factions)).toBe(true);
      service.tick(TICK, tech, data, new Set());
      expect(getRelationKind(tech, rival)).toBe('war');

      // No AI–AI settlement ends the hunt: the hunter refuses even generous terms.
      const generous = { proposerId: 'enemy2', recipientId: 'enemy1', items: [{ kind: 'credits' as const, giverId: 'enemy2', amount: 50000 }] };
      const ctx = { factions: data.factions, fleets: data.fleets, starSystems: data.starSystems };
      expect(TestBed.inject(EnemyDiplomacyService).evaluateTreaty(tech, generous, ctx).accept).toBe(false);

      // With a free slot left there is nothing to contest (below its normal threshold of 6).
      bases.restore([...anchorsOf('enemy1', [0, 1, 2, 3, 4]), ...anchorsOf('enemy2', [6, 7])]);
      expect(service.isHuntTarget(tech, rival, data.factions)).toBe(false);
    });
  });

  describe('guarding', () => {
    it('a builder with 3 completed anchors parks its second-strongest free fleet on one of them', () => {
      const tech = faction('enemy1', 2, 'technologist', { researchedTechnologies: ['basic_engineering'] });
      const strong = fleet(1, 'enemy1', 20, 20, ['cruiser', 'cruiser']);
      const second = fleet(2, 'enemy1', 22, 20, ['frigate']);
      const data = world([tech], [strong, second]);
      bases.restore(anchorsOf('enemy1', [0, 1, 2]));
      service.tick(TICK, tech, data, new Set());
      expect(service.getOrderedFleetIds()).toEqual(new Set([2]));
      expect(ring.slots.slice(0, 3).some((s) => s.col === second.targetX && s.row === second.targetY)).toBe(true);
      expect(strong.targetX).toBeNull();
    });
  });

  describe('research', () => {
    it('Stellar Engineering is worth something to a technologist and nothing to a militarist', () => {
      const research = TestBed.inject(EnemyResearchService) as unknown as {
        directValue(f: Faction, t: unknown, ctx: unknown): number;
      };
      const tech = TestBed.inject(ResearchService).getTechnology(DYSON_TECHNOLOGY_ID)!;
      const ctx = { militaryNeed: 1, weights: { economy: 1, research: 1, expansion: 1, military: 1 } };
      const without = (p: AiPersonality) => faction('x', 2, p, { researchedTechnologies: ['basic_engineering'] });
      expect(research.directValue(without('technologist'), tech, ctx)).toBeGreaterThan(0);
      expect(research.directValue(without('militarist'), tech, ctx)).toBe(0);
    });
  });
});

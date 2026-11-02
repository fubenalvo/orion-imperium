import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction, Fleet, SpaceBase } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { TerritoryService } from './territory.service';
import { DysonRingService } from './dyson-ring.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { normalizeRelations } from './diplomacy';
import { DysonRing, dysonWedgeAt } from './dyson-ring';
import {
  DYSON_ANCHOR_SHIP_TYPE,
  DYSON_ANCHOR_UPKEEP_POINTS,
  DYSON_TECHNOLOGY_ID,
  dysonWedgeOwners,
  validateAnchorDeployment,
} from './dyson-anchor';
import { OUTPOST_SHIP_TYPE } from './space-base';
import { STATION_CONSTRUCTION_SECONDS } from './station-construction';
import { isCombatShipType } from './ai-queries';
import { blackHoleObject } from '../../services/galaxy-generator.service';

/*
 * Dyson anchors (docs/dyson-swarm.md, phase 2): deployment rules and
 * mutation, wedge territory, one-time bonus, demolition, upkeep, save
 * sanitizing and the shared base battle path.
 */

const W = 120;
const H = 80;

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: {}, researchedTechnologies: [DYSON_TECHNOLOGY_ID] },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: {}, researchedTechnologies: [DYSON_TECHNOLOGY_ID] },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

function fleet(id: number, factionId: string, x: number, y: number, types: string[]): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 1, system: null,
    ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
  };
}

describe('Dyson anchors', () => {
  let bases: SpaceBaseService;
  let territory: TerritoryService;
  let ring: DysonRing;

  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(DysonRingService).configure([blackHoleObject(W, H)]);
    ring = TestBed.inject(DysonRingService).ring!;
    bases = TestBed.inject(SpaceBaseService);
    territory = TestBed.inject(TerritoryService);
    bases.restore([]);
  });

  const onSlot = (id: number, factionId: string, slot: number, types = [DYSON_ANCHOR_SHIP_TYPE]) =>
    fleet(id, factionId, ring.slots[slot].col + 0.4, ring.slots[slot].row + 0.6, types);

  const complete = () => bases.advanceConstruction(STATION_CONSTRUCTION_SECONDS.dysonAnchor);

  describe('ship and technology', () => {
    it('Stellar Engineering unlocks the Swarm Constructor, a civilian ship', () => {
      const tech = TestBed.inject(ResearchService).getTechnology(DYSON_TECHNOLOGY_ID)!;
      expect(tech.unlocksShips).toEqual([DYSON_ANCHOR_SHIP_TYPE]);
      const ship = TestBed.inject(ShipService).getShipType(DYSON_ANCHOR_SHIP_TYPE)!;
      expect(isCombatShipType(ship)).toBe(false);
      const outpost = TestBed.inject(ShipService).getShipType(OUTPOST_SHIP_TYPE)!;
      expect(ship.speed).toBeLessThan(outpost.speed);
    });
  });

  describe('deployment rules', () => {
    it('refuses each rule violation with its reason', () => {
      const factions = makeFactions();
      const reason = (f: Fleet, list: SpaceBase[] = [], r: DysonRing | null = ring, fs = factions) => {
        const check = validateAnchorDeployment({ fleet: f, factions: fs, ring: r, bases: list });
        return check.ok ? 'ok' : check.reason;
      };
      expect(reason(onSlot(1, 'player', 0, ['frigate']))).toBe('no_constructor');
      const moving = onSlot(2, 'player', 0);
      moving.targetX = 1;
      moving.targetY = 1;
      expect(reason(moving)).toBe('fleet_moving');
      const inSystem = onSlot(3, 'player', 0);
      inSystem.system = { id: 's', x: 1, y: 1, targetX: null, targetY: null };
      expect(reason(inSystem)).toBe('inside_system');
      const noTech = makeFactions();
      noTech[0].researchedTechnologies = [];
      expect(reason(onSlot(4, 'player', 0), [], ring, noTech)).toBe('no_technology');
      expect(reason(onSlot(5, 'player', 0), [], null)).toBe('no_ring');
      expect(reason(fleet(6, 'player', ring.slots[0].col + 1, ring.slots[0].row, [DYSON_ANCHOR_SHIP_TYPE]))).toBe('not_on_slot');
      const taken = { id: 1, name: 'A', factionId: 'enemy1', x: ring.slots[0].col, y: ring.slots[0].row, kind: 'dyson' as const, dysonSlot: 0 };
      expect(reason(onSlot(7, 'player', 0), [taken])).toBe('slot_taken');
      expect(reason(onSlot(8, 'player', 1), [taken])).toBe('ok');
    });

    it('deploys a construction site on the slot, consumes one constructor and keeps the rest of the fleet', () => {
      const factions = makeFactions();
      const f = onSlot(1, 'player', 2, [DYSON_ANCHOR_SHIP_TYPE, DYSON_ANCHOR_SHIP_TYPE, 'frigate']);
      const result = bases.deployAnchor(f, factions);
      expect(result.base).toMatchObject({
        name: 'Dyson Anchor 3',
        factionId: 'player',
        x: ring.slots[2].col,
        y: ring.slots[2].row,
        kind: 'dyson',
        dysonSlot: 2,
        constructionRemaining: STATION_CONSTRUCTION_SECONDS.dysonAnchor,
      });
      expect(f.ships.map((s) => s.type)).toEqual([DYSON_ANCHOR_SHIP_TYPE, 'frigate']);
      expect(f.destroyed).toBeFalsy();
      // The same slot cannot take a second anchor; the fleet keeps its ship.
      const again = bases.deployAnchor(f, factions);
      expect(again.base).toBeNull();
      expect(f.ships).toHaveLength(2);
    });

    it('ignores anchors for ordinary base spacing', () => {
      const factions = makeFactions();
      bases.deployAnchor(onSlot(1, 'player', 0), factions);
      // Just outside the ring zone, a few cells from the anchor on slot 0.
      const outpost = fleet(2, 'player', Math.ceil(ring.cx + ring.outerRadius + 1), ring.slots[0].row, [OUTPOST_SHIP_TYPE]);
      const check = bases.check(outpost, { factions, starSystems: [], territory: territory.get([], factions), width: W, height: H });
      expect(check.ok).toBe(true);
    });
  });

  describe('territory', () => {
    it('a completed anchor claims exactly its wedge; a site claims nothing; demolition frees it', () => {
      const factions = makeFactions();
      const deployed = bases.deployAnchor(onSlot(1, 'player', 4), factions);
      const slot = ring.slots[4];
      expect(territory.get([], factions).cellCount).toBe(0);

      complete();
      const map = territory.get([], factions);
      expect(map.ownerAt(slot.col, slot.row)).toBe('player');
      expect(map.cellCount).toBeGreaterThan(15);
      map.forEachCell((col, row) => expect(dysonWedgeAt(ring, col, row)).toBe(4));
      expect(dysonWedgeOwners(bases.bases, 8)).toEqual([null, null, null, null, 'player', null, null, null]);

      expect(bases.demolish(deployed.base!.id, 'enemy1')).toBe(false);
      expect(bases.demolish(deployed.base!.id, 'player')).toBe(true);
      expect(territory.get([], factions).cellCount).toBe(0);
      expect(bases.anchorOnSlot(4)).toBeUndefined();
    });
  });

  describe('bonus', () => {
    it('only the owner picks, only once, only a known bonus', () => {
      const factions = makeFactions();
      const anchor = bases.deployAnchor(onSlot(1, 'player', 0), factions).base!;
      expect(bases.chooseBonus(anchor.id, 'enemy1', 'stellar_power')).toBe(false);
      expect(bases.chooseBonus(anchor.id, 'player', 'nonsense' as never)).toBe(false);
      expect(bases.chooseBonus(anchor.id, 'player', 'swarm_observatory')).toBe(true);
      expect(bases.chooseBonus(anchor.id, 'player', 'stellar_power')).toBe(false);
      expect(anchor.dysonBonus).toBe('swarm_observatory');
    });

    it('ordinary bases have no bonus and cannot be demolished', () => {
      const factions = makeFactions();
      const radar = bases.deploy(fleet(1, 'player', 20, 20, [OUTPOST_SHIP_TYPE]), {
        factions, starSystems: [], territory: territory.get([], factions), width: W, height: H,
      }).base!;
      expect(bases.chooseBonus(radar.id, 'player', 'stellar_power')).toBe(false);
      expect(bases.demolish(radar.id, 'player')).toBe(false);
    });
  });

  describe('upkeep', () => {
    it('a completed anchor costs its own rate; a site costs nothing', () => {
      const factions = makeFactions();
      const economy = TestBed.inject(EconomyService);
      bases.deployAnchor(onSlot(1, 'player', 0), factions);
      expect(economy.calculateEconomy('player', factions, [], []).stationUpkeepPerSecond).toBe(0);
      complete();
      const rates = economy.getStationUpkeepRates(factions[0], 1);
      expect(rates.dysonAnchor).toBeGreaterThan(rates.spaceBase);
      expect(rates.dysonAnchor / rates.spaceBase).toBeCloseTo(DYSON_ANCHOR_UPKEEP_POINTS / 25);
      expect(economy.calculateEconomy('player', factions, [], []).stationUpkeepPerSecond).toBeGreaterThan(0);
    });
  });

  describe('save', () => {
    it('restore drops anchors without a valid or with a duplicate slot and clears an unknown bonus', () => {
      bases.restore([
        { id: 1, name: 'A', factionId: 'player', x: 1, y: 1, kind: 'dyson', dysonSlot: 2, dysonBonus: 'bogus' as never },
        { id: 2, name: 'B', factionId: 'enemy1', x: 1, y: 1, kind: 'dyson', dysonSlot: 2 },
        { id: 3, name: 'C', factionId: 'enemy1', x: 1, y: 1, kind: 'dyson', dysonSlot: 9 },
        { id: 4, name: 'D', factionId: 'enemy1', x: 1, y: 1, kind: 'dyson' },
        { id: 5, name: 'E', factionId: 'enemy1', x: 5, y: 5 },
      ]);
      expect(bases.bases.map((b) => b.id)).toEqual([1, 5]);
      expect(bases.getBase(1)!.dysonBonus).toBeUndefined();
      expect(bases.serialize()[0]).toMatchObject({ kind: 'dyson', dysonSlot: 2 });
    });
  });

  describe('combat', () => {
    it('a hostile warship fleet destroys an anchor site through the base battle path and frees the slot', () => {
      // Two AI factions (at war by default): the battle is auto-resolved at once.
      const factions = makeFactions();
      factions.push({ id: 'enemy2', name: 'Orn', color: '#fc4', team: 3, ai: true, currencies: {} } as unknown as Faction);
      normalizeRelations(factions);
      const anchor = bases.deployAnchor(onSlot(1, 'enemy1', 3), factions).base!;
      const attacker = fleet(2, 'enemy2', anchor.x + 0.3, anchor.y + 0.3, ['cruiser']);
      const detection = TestBed.inject(StarMapBattleDetectionService);
      expect(detection.checkBaseBattles([attacker], factions, vi.fn(), new Set(), vi.fn())).toBe(false);
      expect(bases.anchorOnSlot(3)).toBeUndefined();
      expect(attacker.destroyed).not.toBe(true);
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Anomaly, AnomalyState, Faction, Fleet, PlanetTile, StarMapData, StarSystem, SystemAsteroid } from './star-map.models';
import {
  ANOMALY_CONFIG,
  activateAnomalies,
  discoverAnomalies,
  generateAnomalies,
  isFleetAtAnomaly,
  nextActiveAnomaly,
  releaseOrphanedAnomalies,
  sanitizeAnomalyState,
} from './anomalies';
import { AnomalyContext, AnomalyService, PIRATE_FACTION_ID, pirateFleetId } from './anomaly.service';
import { getOpinion, normalizeRelations } from './diplomacy';
import { OUTPOST_SHIP_TYPE } from './space-base';
import { systemCellCenterVw } from './system-grid';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { createBattleState } from '../battle-screen/battle/battle-state';
import { autoResolveBattle } from '../battle-screen/battle/battle-auto-resolve';
import { BattleOutcome } from '../battle-screen/battle/battle.types';

/*
 * Exploration anomalies (docs/exploration-anomalies.md): generation,
 * discovery, activation on arrival, exactly-once resolution, every event
 * type's effects, the pirate ambush through the existing battle system,
 * and save/load.
 */

const W = 120;
const H = 80;
const ROCK = { col: 10, row: 5 };

function makeFactions(): Faction[] {
  const factions = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: { credits: 1000, rawmaterials: 0, research: 0 } },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: { credits: 0 } },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(factions);
  return factions;
}

function makeSystem(id: string, x: number, y: number, owner: string | null): StarSystem {
  const planets = owner
    ? [{ id: x * 1000 + y, index: 0, name: 'P', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 50, buildings: [], explored: true } as PlanetTile]
    : [];
  const asteroids: SystemAsteroid[] = [{ ...ROCK, rawMaterials: 0, surveyed: false }];
  return {
    id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true,
    asteroidBelt: { version: 2, radiusVw: 40, asteroids },
  };
}

function makeFleet(id: number, factionId: string, x: number, y: number, extra: Partial<Fleet> = {}): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 4, system: null,
    ships: [{ id: id * 10, name: 'Frigate', type: 'frigate' }],
    ...extra,
  };
}

function anomaly(id: number, type: Anomaly['type'], site: Anomaly['site'], extra: Partial<Anomaly> = {}): Anomaly {
  return { id, type, site, status: 'discovered', ...extra };
}

function state(...anomalies: Anomaly[]): AnomalyState {
  return { version: 1, nextSeq: 1, anomalies };
}

describe('exploration anomalies', () => {
  let service: AnomalyService;
  let factions: Faction[];
  let systems: StarSystem[];
  let fleets: Fleet[];
  const player = () => factions.find((f) => f.id === 'player')!;
  const ai = () => factions.find((f) => f.id === 'enemy1')!;
  const ctx = (): AnomalyContext => ({ factions, fleets, starSystems: systems, shipStock: [] });

  /* Loads the given anomalies into the service and activates them with fleet 1. */
  function activeEvent(type: Anomaly['type'], extra: Partial<Anomaly> = {}): Anomaly {
    const a = anomaly(1, type, { kind: 'space', x: 50, y: 50 }, extra);
    service.restore(state(a));
    expect(service.update(new Set(), fleets)).toBe(true);
    const live = service.getAnomaly(1)!;
    expect(live.status).toBe('active');
    return live;
  }

  beforeEach(() => {
    service = TestBed.inject(AnomalyService);
    factions = makeFactions();
    systems = [makeSystem('home', 20, 20, 'player'), makeSystem('vex', 90, 60, 'enemy1'), makeSystem('free', 60, 30, null)];
    fleets = [makeFleet(1, 'player', 50.4, 50.6), makeFleet(2, 'enemy1', 90, 60)];
  });

  describe('generation', () => {
    const input = () => ({ seed: 1234, width: W, height: H, starSystems: systems, factions, fleets: [] as Fleet[] });

    it('is deterministic per seed and starts every anomaly hidden', () => {
      const a = generateAnomalies(input());
      const b = generateAnomalies(input());
      expect(a).toEqual(b);
      expect(a.anomalies.length).toBeGreaterThan(0);
      expect(a.anomalies.every((x) => x.status === 'hidden')).toBe(true);
      expect(new Set(a.anomalies.map((x) => x.id)).size).toBe(a.anomalies.length);
      expect(generateAnomalies({ ...input(), seed: 99 })).not.toEqual(a);
    });

    it('never places anomalies in claimed systems and keeps open-space ones off systems', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const result = generateAnomalies({ ...input(), seed });
        for (const x of result.anomalies) {
          expect(x.site.systemId === 'home' || x.site.systemId === 'vex').toBe(false);
          if (x.site.kind === 'space') {
            for (const s of systems) {
              expect(Math.hypot(s.x - x.site.x, s.y - x.site.y)).toBeGreaterThanOrEqual(ANOMALY_CONFIG.spaceSystemClearance);
            }
          }
          if (x.site.kind === 'asteroid') expect({ col: x.site.col, row: x.site.row }).toEqual(ROCK);
        }
      }
    });

    it('is random but not everywhere: some free systems get one, some do not', () => {
      const many = Array.from({ length: 60 }, (_, i) => makeSystem(`s${i}`, 5 + (i % 10) * 11, 5 + Math.floor(i / 10) * 12, null));
      const result = generateAnomalies({ ...input(), starSystems: many });
      const withSystemSite = new Set(result.anomalies.filter((x) => x.site.kind === 'system').map((x) => x.site.systemId));
      expect(withSystemSite.size).toBeGreaterThan(0);
      expect(withSystemSite.size).toBeLessThan(many.length);
    });

    it('distress signals name an existing AI empire, and none appear without AI empires', () => {
      for (let seed = 1; seed <= 40; seed++) {
        for (const x of generateAnomalies({ ...input(), seed }).anomalies) {
          if (x.type === 'distress_signal') expect(x.factionId).toBe('enemy1');
        }
        const noAi = generateAnomalies({ ...input(), seed, factions: factions.filter((f) => !f.ai) });
        expect(noAi.anomalies.some((x) => x.type === 'distress_signal')).toBe(false);
      }
    });
  });

  describe('discovery', () => {
    it('reveals a hidden anomaly once its cell is explored, and only then', () => {
      const s = state(anomaly(1, 'ancient_wreck', { kind: 'space', x: 50, y: 50 }, { status: 'hidden' }));
      expect(discoverAnomalies(s, new Set(['49-50']))).toEqual([]);
      expect(s.anomalies[0].status).toBe('hidden');
      expect(discoverAnomalies(s, new Set(['50-50'])).length).toBe(1);
      expect(s.anomalies[0].status).toBe('discovered');
      expect(discoverAnomalies(s, new Set(['50-50']))).toEqual([]);
    });

    it('lists only discovered, unvisited anomalies as map markers', () => {
      service.restore(state(
        anomaly(1, 'ancient_wreck', { kind: 'space', x: 5, y: 5 }, { status: 'hidden' }),
        anomaly(2, 'ancient_wreck', { kind: 'space', x: 6, y: 6 }),
        anomaly(3, 'ancient_wreck', { kind: 'space', x: 7, y: 7 }, { status: 'resolved' }),
      ));
      expect(service.discoveredAnomalies().map((a) => a.id)).toEqual([2]);
    });
  });

  describe('activation on fleet arrival', () => {
    it('triggers when a player fleet reaches an open-space anomaly, even a hidden one', () => {
      const s = state(anomaly(1, 'ancient_wreck', { kind: 'space', x: 50, y: 50 }, { status: 'hidden' }));
      const activated = activateAnomalies(s, fleets);
      expect(activated.map((a) => a.id)).toEqual([1]);
      expect(s.anomalies[0]).toMatchObject({ status: 'active', fleetId: 1 });
    });

    it('a system anomaly needs the fleet to stop in the system; passing through does not count', () => {
      const site = { kind: 'system' as const, x: 60, y: 30, systemId: 'free' };
      const passing = makeFleet(1, 'player', 60.5, 30.2, { targetX: 80, targetY: 30 });
      expect(isFleetAtAnomaly(passing, anomaly(1, 'ancient_wreck', site))).toBe(false);
      expect(isFleetAtAnomaly({ ...passing, targetX: null, targetY: null }, anomaly(1, 'ancient_wreck', site))).toBe(true);
    });

    it('an asteroid anomaly needs the fleet on that asteroid cell inside the system', () => {
      const site = { kind: 'asteroid' as const, x: 60, y: 30, systemId: 'free', ...ROCK };
      const onRock = systemCellCenterVw(ROCK.col, ROCK.row);
      const inSystem = (x: number, y: number) =>
        makeFleet(1, 'player', 60, 30, { system: { id: 'free', x, y, targetX: null, targetY: null } });
      expect(isFleetAtAnomaly(inSystem(onRock.x, onRock.y), anomaly(1, 'ancient_wreck', site))).toBe(true);
      expect(isFleetAtAnomaly(inSystem(onRock.x + 5, onRock.y), anomaly(1, 'ancient_wreck', site))).toBe(false);
      expect(isFleetAtAnomaly(makeFleet(1, 'player', 60, 30), anomaly(1, 'ancient_wreck', site))).toBe(false);
    });

    it('AI fleets never trigger player events', () => {
      const s = state(anomaly(1, 'ancient_wreck', { kind: 'space', x: 90, y: 60 }));
      expect(activateAnomalies(s, fleets)).toEqual([]);
      expect(s.anomalies[0].status).toBe('discovered');
    });

    it('activates only once, even while the fleet stays on the site', () => {
      const s = state(anomaly(1, 'ancient_wreck', { kind: 'space', x: 50, y: 50 }));
      expect(activateAnomalies(s, fleets).length).toBe(1);
      expect(activateAnomalies(s, fleets)).toEqual([]);
      expect(activateAnomalies(s, [...fleets, makeFleet(3, 'player', 50, 50)])).toEqual([]);
      expect(s.anomalies[0].fleetId).toBe(1);
    });

    it('shows pending events oldest first', () => {
      const s = state(
        anomaly(1, 'ancient_wreck', { kind: 'space', x: 70, y: 70 }),
        anomaly(2, 'ancient_wreck', { kind: 'space', x: 50, y: 50 }),
      );
      activateAnomalies(s, fleets);
      fleets[0].x = 70.2;
      fleets[0].y = 70.2;
      activateAnomalies(s, fleets);
      expect(nextActiveAnomaly(s)?.id).toBe(2);
    });

    it('an event whose fleet is gone goes back to discovered', () => {
      const s = state(anomaly(1, 'ancient_wreck', { kind: 'space', x: 50, y: 50 }));
      activateAnomalies(s, fleets);
      fleets[0].destroyed = true;
      expect(releaseOrphanedAnomalies(s, fleets).length).toBe(1);
      expect(s.anomalies[0].status).toBe('discovered');
      expect(s.anomalies[0].fleetId).toBeUndefined();
    });
  });

  describe('resolution', () => {
    it('ancient wreck: salvage gives +800 raw materials', () => {
      activeEvent('ancient_wreck');
      const result = service.resolve(1, 'salvage', ctx());
      expect(result.ok).toBe(true);
      expect(player().currencies['rawmaterials']).toBe(800);
      expect(player().currencies['research']).toBe(0);
      expect(service.getAnomaly(1)).toMatchObject({ status: 'resolved', choiceId: 'salvage' });
    });

    it('ancient wreck: study gives +400 RP', () => {
      activeEvent('ancient_wreck');
      expect(service.resolve(1, 'study', ctx()).ok).toBe(true);
      expect(player().currencies['research']).toBe(400);
      expect(player().currencies['rawmaterials']).toBe(0);
    });

    it('a resolved event pays once: a second choice is refused and it never re-triggers', () => {
      activeEvent('ancient_wreck');
      expect(service.resolve(1, 'salvage', ctx()).ok).toBe(true);
      const again = service.resolve(1, 'study', ctx());
      expect(again.ok).toBe(false);
      expect(player().currencies['rawmaterials']).toBe(800);
      expect(player().currencies['research']).toBe(0);
      expect(service.update(new Set(['50-50']), fleets)).toBe(false);
      expect(service.currentEvent()).toBeNull();
      expect(service.getAnomaly(1)!.status).toBe('resolved');
    });

    it('distress signal: assisting costs 200 credits and raises the AI empire’s opinion by 15', () => {
      activeEvent('distress_signal', { factionId: 'enemy1' });
      const before = getOpinion(ai(), player());
      const playerViewBefore = getOpinion(player(), ai());
      expect(service.resolve(1, 'assist', ctx()).ok).toBe(true);
      expect(player().currencies['credits']).toBe(800);
      expect(getOpinion(ai(), player())).toBe(before + 15);
      expect(getOpinion(player(), ai())).toBe(playerViewBefore);
    });

    it('distress signal: no diplomatic change when the sender empire does not exist', () => {
      activeEvent('distress_signal', { factionId: 'ghosts' });
      const before = getOpinion(ai(), player());
      const vm = service.buildEventVm(service.getAnomaly(1)!, ctx());
      expect(vm.choices[0].consequences.some((c) => c.text.startsWith('No diplomatic effect'))).toBe(true);
      expect(service.resolve(1, 'assist', ctx()).ok).toBe(true);
      expect(player().currencies['credits']).toBe(800);
      expect(getOpinion(ai(), player())).toBe(before);
    });

    it('distress signal: ignoring costs and gives nothing', () => {
      activeEvent('distress_signal', { factionId: 'enemy1' });
      const before = getOpinion(ai(), player());
      expect(service.resolve(1, 'ignore', ctx()).ok).toBe(true);
      expect(player().currencies['credits']).toBe(1000);
      expect(getOpinion(ai(), player())).toBe(before);
    });

    it('without enough credits the costly choice is disabled with a reason and cannot be executed', () => {
      player().currencies['credits'] = 150;
      activeEvent('distress_signal', { factionId: 'enemy1' });
      const before = getOpinion(ai(), player());
      const vm = service.buildEventVm(service.getAnomaly(1)!, ctx());
      const assist = vm.choices.find((c) => c.id === 'assist')!;
      expect(assist.disabled).toBe(true);
      expect(assist.reason).toContain('Not enough credits');
      expect(vm.choices.find((c) => c.id === 'ignore')!.disabled).toBe(false);

      const result = service.resolve(1, 'assist', ctx());
      expect(result.ok).toBe(false);
      expect(player().currencies['credits']).toBe(150);
      expect(getOpinion(ai(), player())).toBe(before);
      expect(service.getAnomaly(1)!.status).toBe('active');
    });

    it('abandoned outpost ship: claiming adds an outpost ship fleet for the player at the finder', () => {
      fleets[0].system = { id: 'x', x: 10, y: 12, targetX: 3, targetY: 4 };
      activeEvent('derelict_outpost');
      const result = service.resolve(1, 'claim', ctx());
      expect(result.ok).toBe(true);
      const granted = result.ok ? result.newFleet! : null;
      expect(fleets).toContain(granted);
      expect(granted).toMatchObject({ factionId: 'player', x: fleets[0].x, y: fleets[0].y, destroyed: false });
      expect(granted!.system).toEqual({ id: 'x', x: 10, y: 12, targetX: null, targetY: null });
      expect(granted!.ships.map((s) => s.type)).toEqual([OUTPOST_SHIP_TYPE]);
      expect(granted!.id).toBeGreaterThan(Math.max(...fleets.filter((f) => f !== granted).map((f) => f.id)));
      const allShipIds = fleets.flatMap((f) => f.ships.map((s) => s.id));
      expect(new Set(allShipIds).size).toBe(allShipIds.length);
    });

    it('abandoned outpost ship: leaving it adds nothing', () => {
      activeEvent('derelict_outpost');
      expect(service.resolve(1, 'leave', ctx()).ok).toBe(true);
      expect(fleets.length).toBe(2);
    });
  });

  describe('pirate ambush', () => {
    it('builds a fleet battle for the existing battle system: pirates attack the finder', () => {
      activeEvent('pirate_trap');
      const result = service.resolve(1, 'fight', ctx());
      if (!result.ok) throw new Error(result.reason);
      const battle = result.battle!;
      expect(battle.type).toBe('fleet');
      expect(battle.attackerId).toBe(pirateFleetId(1));
      expect(battle.defenderId).toBe(1);
      expect(battle.fleet1.factionId).toBe(PIRATE_FACTION_ID);
      expect(battle.fleet1.ships.map((s) => s.type)).toEqual([...ANOMALY_CONFIG.pirateFleet]);
      // The pirates are virtual: never part of the overworld fleets.
      expect(fleets.some((f) => f.id === battle.attackerId)).toBe(false);

      const battleState = createBattleState(battle, TestBed.inject(ShipService), TestBed.inject(PlanetBattleService));
      expect(battleState.stacks.some((s) => s.side === 'attacker')).toBe(true);
      expect(battleState.stacks.some((s) => s.side === 'defender')).toBe(true);
    });

    it('victory pays the loot exactly once; the battle result is applied to the real fleet only', () => {
      fleets[0].ships = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Cruiser', type: 'cruiser' }));
      activeEvent('pirate_trap');
      const result = service.resolve(1, 'fight', ctx());
      if (!result.ok) throw new Error(result.reason);
      const { outcome } = autoResolveBattle(result.battle!, TestBed.inject(ShipService), TestBed.inject(PlanetBattleService));
      expect(outcome.winnerFleetId).toBe(1);

      TestBed.inject(BattleOutcomeService).applyFleetBattleOutcome({ fleets, factions }, outcome);
      expect(fleets.length).toBe(2);
      expect(fleets[0].destroyed).toBeFalsy();

      const credits = player().currencies['credits'];
      const raw = player().currencies['rawmaterials'];
      expect(service.applyBattleOutcome(outcome, factions)).toContain('Pirates defeated');
      expect(player().currencies['credits']).toBe(credits + ANOMALY_CONFIG.pirateLoot.credits);
      expect(player().currencies['rawmaterials']).toBe(raw + ANOMALY_CONFIG.pirateLoot.rawmaterials);
      expect(service.applyBattleOutcome(outcome, factions)).toBeNull();
      expect(player().currencies['credits']).toBe(credits + ANOMALY_CONFIG.pirateLoot.credits);
    });

    it('fleeing starts no battle, pays no loot and damages every ship without destroying any', () => {
      fleets[0].ships = [
        { id: 100, name: 'Frigate', type: 'frigate' },
        { id: 101, name: 'Scout', type: 'scout', currentHp: 1 },
        { id: 102, name: 'Frigate', type: 'frigate', destroyed: true, currentHp: 0 },
      ];
      activeEvent('pirate_trap');
      const vm = service.buildEventVm(service.getAnomaly(1)!, ctx());
      expect(vm.choices.find((c) => c.id === 'flee')!.disabled).toBe(false);

      const result = service.resolve(1, 'flee', ctx());
      if (!result.ok) throw new Error(result.reason);
      expect(result.battle).toBeNull();
      expect(service.getAnomaly(1)!.status).toBe('resolved');
      expect(player().currencies['credits']).toBe(1000);

      const frigateHp = TestBed.inject(ShipService).getShipType('frigate')!.hitPoints;
      const [hit, weak, dead] = fleets[0].ships;
      expect(hit.currentHp).toBe(Math.round(frigateHp * (1 - ANOMALY_CONFIG.pirateFleeDamage)));
      expect(weak.currentHp).toBe(1);
      expect(dead.currentHp).toBe(0);
      expect(fleets[0].destroyed).toBeFalsy();
    });

    it('defeat pays nothing; unrelated battles are ignored', () => {
      activeEvent('pirate_trap');
      service.resolve(1, 'fight', ctx());
      const side = (fleetId: number, factionId: string, side: 'attacker' | 'defender') =>
        ({ fleetId, side, factionId, ships: [], survivors: [], wipedOut: false });
      const lost: BattleOutcome = {
        winnerSide: 'attacker', winnerFleetId: pirateFleetId(1), loserFleetId: 1,
        attacker: side(pirateFleetId(1), PIRATE_FACTION_ID, 'attacker'),
        defender: { ...side(1, 'player', 'defender'), wipedOut: true },
        rounds: 3, battleType: 'fleet',
      };
      expect(service.applyBattleOutcome(lost, factions)).toContain('pirates');
      expect(player().currencies['credits']).toBe(1000);
      const unrelated: BattleOutcome = { ...lost, attacker: side(2, 'enemy1', 'attacker'), winnerFleetId: 1 };
      expect(service.applyBattleOutcome(unrelated, factions)).toBeNull();
    });
  });

  describe('save and load', () => {
    const save = (anomalies?: AnomalyState): StarMapData => ({
      saveVersion: SAVE_VERSION,
      galaxy: { size: 'small', seed: 77, generatorVersion: 2 },
      factions,
      map: { width: W, height: H, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: systems,
      fleets,
      ...(anomalies ? { anomalies } : {}),
    });

    it('a new game (no anomaly state yet) gets its galaxy’s deterministic anomalies once', () => {
      const saves = TestBed.inject(SaveGameService);
      const migrated = saves.normalizeSave(save());
      expect(migrated.anomalies!.anomalies.length).toBeGreaterThan(0);
      expect(migrated.anomalies).toEqual(saves.normalizeSave(save()).anomalies);
    });

    it('anomaly states survive a save slot round trip and are not regenerated', () => {
      const saves = TestBed.inject(SaveGameService);
      const states = state(
        anomaly(1, 'ancient_wreck', { kind: 'space', x: 5, y: 5 }, { status: 'hidden' }),
        anomaly(2, 'distress_signal', { kind: 'system', x: 60, y: 30, systemId: 'free' }, { factionId: 'enemy1' }),
        anomaly(3, 'pirate_trap', { kind: 'space', x: 50, y: 50 }, { status: 'active', fleetId: 1, activatedSeq: 4 }),
        anomaly(4, 'derelict_outpost', { kind: 'asteroid', x: 60, y: 30, systemId: 'free', ...ROCK }, { status: 'resolved', choiceId: 'claim' }),
      );
      states.nextSeq = 5;
      saves.saveToSlot(1, { ...save(states), saveVersion: SAVE_VERSION });
      const loaded = saves.loadFromSlot(1)!;
      expect(loaded.anomalies).toEqual(states);
      saves.clearSlot(1);

      service.restore(loaded.anomalies);
      expect(service.serialize()).toEqual(states);
      expect(service.currentEvent()?.id).toBe(3);
      // The resolved one never comes back; the active one is not re-triggered.
      service.update(new Set(['60-30', '50-50']), fleets);
      expect(service.getAnomaly(4)!.status).toBe('resolved');
      expect(service.getAnomaly(3)!.activatedSeq).toBe(4);
    });

    it('drops malformed anomalies and repairs an active one without a fleet', () => {
      const clean = sanitizeAnomalyState({
        version: 1,
        nextSeq: 1,
        anomalies: [
          anomaly(1, 'ancient_wreck', { kind: 'space', x: 5, y: 5 }, { status: 'active' }),
          { id: 2, type: 'dragon', site: { kind: 'space', x: 1, y: 1 }, status: 'hidden' },
          { id: 3, type: 'ancient_wreck', site: { kind: 'asteroid', x: 1, y: 1 }, status: 'hidden' },
        ],
      });
      expect(clean!.anomalies.map((a) => a.id)).toEqual([1]);
      expect(clean!.anomalies[0].status).toBe('discovered');
      expect(sanitizeAnomalyState('nope')).toBeNull();
    });
  });
});

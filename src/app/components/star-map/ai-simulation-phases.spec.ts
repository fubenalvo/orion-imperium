import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { StarMapData } from './star-map.models';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { EnemyResearchService } from './enemy-research.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { ResearchService } from '../../services/research.service';
import { Fleet } from './star-map.models';
import { OPENING_GRACE_SECONDS } from './opening-grace';
import {
  ScenarioOptions,
  developedPlanetCount,
  expectHealthyAiFactions,
  homeSystemOf,
  homeworldOf,
  isCivilianShip,
  near,
  nearestFreeSystem,
  occupy,
  ownedPlanets,
  playerFleet,
  runScenario,
  stripToResidential,
  turrets,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation — Phase 2 economy and expansion', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('two AIs develop simultaneously over 15 minutes: infrastructure, several colonies, several developed planets, military', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 900, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.factoryAt, `${factionId} factory`).not.toBeNull();
      expect(trace.spaceportAt, `${factionId} spaceport`).not.toBeNull();
      // Factory (3000) + Spaceport (4000) from a 1000-credit start. Since the
      // colony cores (2026-11) the homeworld holds 1200 people and housing
      // costs 1.5×, so the net is ~55–65 credits/s: measured 240–250 s
      // (~200 s before).
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(280);
      // Building construction time (docs/planet-construction.md, 2026-11):
      // the factory and its colonizer come later, by design a slower opening
      // than the old instant buildings. Measured ~355 s (under 300 before).
      expect(trace.firstColonizationAt!, `${factionId} first colony time`).toBeLessThan(420);
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(2);
      // Every owned planet (except possibly a colony founded in the last
      // decision intervals) has been developed, and none runs an energy deficit.
      const planets = ownedPlanets(result.data, factionId);
      expect(developedPlanetCount(result.data, factionId, trace), `${factionId} developed planets`).toBeGreaterThanOrEqual(planets.length - 1);
      const economy = TestBed.inject(EconomyService);
      for (const planet of planets) {
        // The owner's technologies (e.g. improved_power) count, as in the game.
        const e = economy.calculatePlanetEconomy(planet, result.data.factions.find((f) => f.id === factionId));
        expect(e.energyProduction, `${factionId} ${planet.name} energy`).toBeGreaterThanOrEqual(e.energyConsumption);
      }
      expect(trace.combatShipsProduced, `${factionId} combat ships`).toBeGreaterThanOrEqual(2);
      // Produced combat ships leave the stock into fleets at a Spaceport.
      const stock = result.data.shipStock?.find((s) => s.factionId === factionId)?.ships ?? [];
      expect(stock.filter((s) => !isCivilianShip(s.type)).length, `${factionId} undeployed combat ships`).toBeLessThanOrEqual(1);
    }
  });

  it('an AI starting with minimal infrastructure builds power, factory and Spaceport, then colonizes', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: stripToResidential,
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      // Solar Array first, then Factory (3000), the first Mining Complex
      // (1500, plus the power and housing it needs: raw materials only come
      // from deposits) and Spaceport (4000) from a half-capacity homeworld's
      // net income.
      expect(trace.factoryAt!, `${factionId} factory time`).toBeLessThan(120);
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(420);
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      const home = result.data.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.id === trace.homeworldId)!;
      const economy = TestBed.inject(EconomyService).calculatePlanetEconomy(home, result.data.factions.find((f) => f.id === factionId));
      expect(economy.energyProduction, `${factionId} homeworld energy`).toBeGreaterThanOrEqual(economy.energyConsumption);
    }
  });

  it('an energy-deficit homeworld is repaired before it rebels', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 120,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        for (const faction of data.factions.filter((f) => f.ai)) {
          // Without its Fusion Power Plant the homeworld runs 0/54 energy.
          const home = homeworldOf(data)(faction.id);
          home.buildings = home.buildings.filter((b) => b.name !== 'Fusion Power Plant');
        }
      },
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    const economy = TestBed.inject(EconomyService);
    for (const [factionId, trace] of result.traces) {
      const home = result.data.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.id === trace.homeworldId)!;
      const e = economy.calculatePlanetEconomy(home, result.data.factions.find((f) => f.id === factionId));
      expect(e.energyProduction, `${factionId} energy`).toBeGreaterThanOrEqual(e.energyConsumption);
      expect(home.satisfaction ?? 100, `${factionId} satisfaction`).toBeGreaterThan(80);
    }
  });

  it('a homeworld without construction space develops the other planets instead', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      // Premise: other planets exist from the start. Only Hard still starts
      // with extra home-system colonies (ai-difficulty.ts extraColonies).
      difficulty: 'hard',
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        for (const faction of data.factions.filter((f) => f.ai)) {
          const home = homeworldOf(data)(faction.id);
          const grid = 9; // medium planet surface
          const occupied = (x: number, y: number) =>
            home.buildings.some((b) => x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size);
          // Fill every free cell with an inert placeholder the economy ignores.
          for (let y = 0; y < grid; y++) {
            for (let x = 0; x < grid; x++) {
              if (!occupied(x, y)) home.buildings.push({ name: 'Rubble', size: 1, x, y });
            }
          }
        }
      },
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const others = ownedPlanets(result.data, factionId).filter((p) => p.id !== trace.homeworldId);
      expect(
        others.some((p) => p.buildings.length > (trace.initialBuildings.get(p.id) ?? 0)),
        `${factionId} built elsewhere`,
      ).toBe(true);
      expect(trace.factoryAt, `${factionId} factory on another planet`).not.toBeNull();
    }
  });

  it('a faction that cannot afford a Spaceport saves for it before optional buildings', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 300,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        for (const faction of data.factions.filter((f) => f.ai)) {
          faction.currencies['credits'] = 0;
          const home = homeworldOf(data)(faction.id);
          home.buildings.push({ name: 'Spaceship Factory', size: 3, x: 2, y: 3 });
          home.buildings.push({ name: 'Solar Array', size: 2, x: 5, y: 3 });
        }
      },
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.spaceportAt, `${factionId} spaceport`).not.toBeNull();
      // The first Mining Complex (1500 credits) comes first, then 4000
      // credits + 1000 raw at ~55–65 credits/s net (homeworld income minus
      // upkeep; 1200 people since the colony cores) plus other committed
      // needs: about four minutes.
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(280);
      if (trace.firstResearchBuildingAt !== null) {
        expect(trace.firstResearchBuildingAt, `${factionId} research before spaceport`).toBeGreaterThan(trace.spaceportAt!);
      }
    }
  });

  it('recovers from a sudden credit shortage and keeps progressing', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 900,
      dt: 1 / 60,
      removePlayerFleets: true,
      events: [
        {
          at: 300,
          apply: (data) => {
            for (const faction of data.factions.filter((f) => f.ai)) faction.currencies['credits'] = 0;
          },
        },
      ],
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.buildTimes.some((t) => t > 320), `${factionId} builds after shortage`).toBe(true);
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(2);
    }
  });

  it('with no valid expansion target the AI keeps developing and arming without colonizer spam', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        for (const planet of data.starSystems.flatMap((s) => s.planetsTiles)) {
          if (planet.factionId === 'unhabited') planet.factionId = 'independent';
        }
      },
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizersProduced, `${factionId} colonizers`).toBe(0);
      expect(trace.colonizations).toBe(0);
      expect(trace.buildTimes.length, `${factionId} buildings`).toBeGreaterThanOrEqual(5);
      expect(trace.spaceportAt, `${factionId} spaceport`).not.toBeNull();
      expect(trace.combatShipsProduced, `${factionId} combat ships`).toBeGreaterThanOrEqual(2);
    }
  });

  it('after losing every fleet the AI rebuilds a fleet at its Spaceport and resumes colonization', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 900,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        const ai = new Set(data.factions.filter((f) => f.ai).map((f) => f.id));
        data.fleets = data.fleets.filter((f) => !ai.has(f.factionId));
      },
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const fleets = result.data.fleets.filter((f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => !s.destroyed));
      expect(fleets.length, `${factionId} rebuilt fleets`).toBeGreaterThanOrEqual(1);
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('AI simulation — Phase 3 research and military operations', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('two AIs research many technologies over 20 minutes, respecting prerequisites and costs, and field heavier hulls', () => {
    // 20 minutes: research costs more credits and income is lower since
    // 2026-11, so the first heavier hull is unlocked later.
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 1200, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);
    const research = TestBed.inject(EnemyResearchService);
    const researchService = TestBed.inject(ResearchService);
    const ships = TestBed.inject(ShipService);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const faction = result.data.factions.find((f) => f.id === factionId)!;
      const history = research.getResearchHistory(factionId);
      // Research costs 4 credits per point (since 2026-11) on top of the
      // research points, so a run buys fewer technologies than before.
      expect(history.length, `${factionId} technologies researched`).toBeGreaterThanOrEqual(5);
      expect(new Set(history).size, `${factionId} no duplicate research`).toBe(history.length);

      // Each technology's prerequisites were owned before it was bought.
      const known = new Set(researchService.getStartingTechnologyIds());
      for (const techId of history) {
        const tech = researchService.getTechnology(techId)!;
        for (const prerequisite of tech.prerequisites) {
          expect(known.has(prerequisite), `${factionId} ${techId} needs ${prerequisite}`).toBe(true);
        }
        known.add(techId);
      }
      expect([...known].every((id) => faction.researchedTechnologies!.includes(id))).toBe(true);

      // Combat ships only after a Spaceport exists, only unlocked types,
      // and research shows up in the fleet: at least one hull stronger
      // than the starting fighter.
      expect(trace.firstCombatProducedAt, `${factionId} combat production`).not.toBeNull();
      expect(trace.firstCombatProducedAt!).toBeGreaterThanOrEqual(trace.spaceportAt!);
      for (const typeId of Object.keys(trace.combatProducedByType)) {
        expect(researchService.isShipUnlocked(faction, typeId), `${factionId} ${typeId} unlocked`).toBe(true);
      }
      const fighter = ships.calculateFleetStrength([{ type: 'fighter' }]);
      expect(
        Object.keys(trace.combatProducedByType).some((t) => ships.calculateFleetStrength([{ type: t }]) > fighter),
        `${factionId} heavier hull produced`,
      ).toBe(true);
    }
  });

  it('produced ships are assembled into new fleets and reinforce existing fleets at the Spaceport', () => {
    // 20 minutes: with the empire upkeep scale (economy.md) the navy grows
    // more slowly, and since building construction time (2026-11) the
    // Spaceport and factories come later still; the first reinforcement can
    // come after minute 15.
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 1200, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.fleetsCreated, `${factionId} fleets created`).toBeGreaterThanOrEqual(1);
      expect(trace.reinforcements, `${factionId} reinforcements`).toBeGreaterThanOrEqual(1);
      const stock = result.data.shipStock?.find((st) => st.factionId === factionId)?.ships ?? [];
      expect(stock.filter((sh) => !isCivilianShip(sh.type)).length, `${factionId} undeployed combat ships`).toBeLessThanOrEqual(2);
    }
  });

  it('colonization orders survive an enemy fleet patrolling through AI territory', () => {
    let patrol: Fleet;
    let home: { x: number; y: number };
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        // Captured once: the homeworld's population grows during the run.
        home = homeSystemOf(data, 'enemy1');
        const start = near(data, home, 12, 0);
        patrol = playerFleet(start.x, start.y, 'scout', 1);
        data.fleets.push(patrol);
      },
      // The patrol zig-zags around enemy1's home every 20 s.
      events: Array.from({ length: 30 }, (_, i) => ({
        at: 5 + i * 20,
        apply: (data: StarMapData) => {
          const corner = near(data, home, i % 2 === 0 ? -12 : 12, i % 3 === 0 ? 10 : -10);
          if (!patrol.destroyed) {
            patrol.targetX = corner.x;
            patrol.targetY = corner.y;
          }
        },
      })),
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    expect(result.colonizerFleetHijacks).toBe(0);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('engages a weak intruder, does not attack a much stronger fleet, and pulls an exposed fleet back', () => {
    let strong: Fleet;
    let weak: Fleet;
    let exposedId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      // The premise is AI aggression toward the player: start after the opening grace.
      startGameSeconds: OPENING_GRACE_SECONDS,
      size: 'medium',
      aiCount: 2,
      seconds: 300,
      dt: 1 / 60,
      removePlayerFleets: true,
      prepare: (data) => {
        const home1 = homeSystemOf(data, 'enemy1');
        const strongPos = near(data, home1, 18, 0);
        strong = playerFleet(strongPos.x, strongPos.y, 'battleship', 8);
        data.fleets.push(strong);
        // One enemy1 fleet starts close to the strong fleet, away from its Spaceport.
        const exposed = data.fleets.find((f) => f.factionId === 'enemy1')!;
        exposedId = exposed.id;
        exposed.x = strongPos.x - 6;
        exposed.y = strongPos.y;

        const home2 = homeSystemOf(data, 'enemy2');
        // Inside the home system's sensor range (5 cells): fog of war means
        // the AI only reacts to intruders it can see.
        const weakPos = near(data, home2, 0, 4);
        weak = playerFleet(weakPos.x, weakPos.y, 'scout', 1);
        data.fleets.push(weak);
      },
    };
    const result = runScenario(options);
    const ships = TestBed.inject(ShipService);

    expectHealthyAiFactions(result, options);

    // Never walks into the stronger fleet with weaker forces.
    const strongStrength = ships.calculateFleetStrength(strong!.ships);
    const trace1 = result.traces.get('enemy1')!;
    for (const contact of trace1.contacts.filter((c) => c.hostileFleetId === strong!.id)) {
      expect(contact.aiStrength, 'enemy1 strength at contact with the strong fleet').toBeGreaterThanOrEqual(strongStrength);
    }
    // The exposed fleet retreated: it ends farther away than it started.
    const exposed = result.data.fleets.find((f) => f.id === exposedId)!;
    expect(Math.hypot(exposed.x - strong!.x, exposed.y - strong!.y), 'exposed fleet distance').toBeGreaterThan(10);

    // The weak intruder near enemy2's home is engaged with superior strength.
    const trace2 = result.traces.get('enemy2')!;
    const weakContact = trace2.contacts.find((c) => c.hostileFleetId === weak!.id);
    expect(weakContact, 'enemy2 intercepts the weak intruder').toBeDefined();
    expect(weakContact!.time).toBeLessThan(120);
    expect(weakContact!.aiStrength).toBeGreaterThanOrEqual(ships.calculateFleetStrength(weak!.ships) * 1.2);
  });

  it('heavy fleet losses send damaged fleets home to regroup, production continues and the factions recover', () => {
    const preLoss = new Map<string, number>();
    const damaged = new Map<string, number[]>();
    const rolesAfterLoss: { factionId: string; fleetId: number; role: string | undefined; atSpaceport: boolean; lostShare: number }[] = [];
    const lostShareOf = new Map<number, number>();
    const managedAtLoss = new Set<number>();
    const ships = () => TestBed.inject(ShipService);
    const militaryStrength = (data: StarMapData, factionId: string) =>
      data.fleets
        .filter((f) => f.factionId === factionId && !f.destroyed)
        .reduce((sum, f) => sum + ships().calculateFleetStrength(f.ships.filter((sh) => !isCivilianShip(sh.type))), 0);
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium',
      aiCount: 2,
      seconds: 900,
      dt: 1 / 60,
      removePlayerFleets: true,
      events: [
        {
          at: 300,
          // Same state change as StarMap.applyBattleResult after lost battles:
          // ships flagged destroyed, wiped-out fleets destroyed, targets cleared.
          apply: (data) => {
            const fleetOps = TestBed.inject(EnemyFleetService);
            for (const fleet of data.fleets) {
              if (fleetOps.getAssignment(fleet.id)) managedAtLoss.add(fleet.id);
            }
            for (const faction of data.factions.filter((f) => f.ai)) {
              preLoss.set(faction.id, militaryStrength(data, faction.id));
              for (const fleet of data.fleets.filter((f) => f.factionId === faction.id && !f.destroyed)) {
                const combat = fleet.ships.filter((sh) => !sh.destroyed && !isCivilianShip(sh.type));
                if (combat.length < 2) continue;
                // ~75% losses, leaving at least one survivor so the fleet is damaged, not wiped out.
                const losses = Math.max(1, Math.min(combat.length - 1, Math.round(combat.length * 0.75)));
                combat.slice(0, losses).forEach((sh) => (sh.destroyed = true));
                lostShareOf.set(fleet.id, losses / combat.length);
                if (!fleet.ships.some((sh) => !sh.destroyed)) {
                  fleet.destroyed = true;
                } else {
                  damaged.set(faction.id, [...(damaged.get(faction.id) ?? []), fleet.id]);
                }
                fleet.targetX = null;
                fleet.targetY = null;
              }
            }
          },
        },
        {
          // Two fleet-operations decisions later.
          at: 305,
          apply: (data) => {
            const fleetOps = TestBed.inject(EnemyFleetService);
            for (const [factionId, ids] of damaged) {
              const spaceports = data.starSystems.filter((sy) =>
                sy.planetsTiles.some((p) => p.factionId === factionId && p.buildings.some((b) => b.name === 'Spaceport')));
              for (const id of ids) {
                const fleet = data.fleets.find((f) => f.id === id)!;
                if (fleet.destroyed || fleet.ships.some((sh) => sh.type === 'colonizer' && !sh.destroyed)) continue;
                const atSpaceport = spaceports.some((sy) => Math.floor(sy.x) === Math.floor(fleet.x) && Math.floor(sy.y) === Math.floor(fleet.y));
                // Only fleets fleet operations managed when the losses hit:
                // a fleet the colonization pipeline owned until then has no
                // recorded pre-loss peak (EnemyFleetService tracks peaks for
                // managed fleets only), so it cannot detect the drop.
                if (!managedAtLoss.has(id)) continue;
                rolesAfterLoss.push({ factionId, fleetId: id, role: fleetOps.getAssignment(id)?.role, atSpaceport, lostShare: lostShareOf.get(id) ?? 0 });
              }
            }
          },
        },
      ],
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    expect(rolesAfterLoss.length, 'damaged fleets observed').toBeGreaterThan(0);
    // Fleets below the regroup threshold (lost more than half) must head home.
    for (const entry of rolesAfterLoss.filter((e) => e.lostShare > 0.5)) {
      // A damaged fleet either already sits at a Spaceport (where it is
      // reinforced) or has been ordered home to regroup.
      expect(
        entry.atSpaceport || entry.role === 'regroup' || entry.role === 'retreat',
        `${entry.factionId} fleet ${entry.fleetId} role ${entry.role}`,
      ).toBe(true);
    }
    for (const [factionId, trace] of result.traces) {
      expect(trace.combatProducedTimes.filter((t) => t >= 300).length, `${factionId} production after losses`).toBeGreaterThan(0);
      expect(militaryStrength(result.data, factionId), `${factionId} recovered strength`).toBeGreaterThanOrEqual(0.8 * preLoss.get(factionId)!);
      expect(trace.colonizations, `${factionId} keeps expanding`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('AI simulation — Phase 4 planet capture and game outcomes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures an undefended hostile planet in a system the player has never seen, without a battle', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 400, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        const system = nearestFreeSystem(data, 'enemy1');
        system.explored = false;
        const planet = system.planetsTiles[0];
        occupy(planet, 'independent', [{ name: 'Small Residential Block', size: 1, x: 0, y: 0 }]);
        targetId = planet.id;
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);

    const changes = result.ownershipChanges.filter((c) => c.planetId === targetId);
    expect(changes).toEqual([{ time: expect.any(Number), planetId: targetId, from: 'independent', to: 'enemy1' }]);
    const reports = TestBed.inject(EnemyFleetService).getAssaultReports().filter((r) => r.planetId === targetId);
    expect(reports.map((r) => r.result)).toEqual(['captured']);
  });

  it('takes a defended planet by battle: both sides lose strength and ownership transfers once', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        const planet = nearestFreeSystem(data, 'enemy1').planetsTiles[0];
        occupy(planet, 'independent', [...turrets(2), { name: 'Small Residential Block', size: 1, x: 8, y: 8 }]);
        targetId = planet.id;
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);

    const changes = result.ownershipChanges.filter((c) => c.planetId === targetId);
    expect(changes.map((c) => `${c.from}->${c.to}`)).toEqual(['independent->enemy1']);
    const planet = result.data.starSystems.flatMap((sy) => sy.planetsTiles).find((p) => p.id === targetId)!;
    expect(planet.factionId).toBe('enemy1');
    // It was taken by battle (the turrets are still there), not as an
    // undefended capture. Per-side losses are asserted in the resolver specs.
    expect(planet.buildings.some((b) => b.name === 'Laser Turret')).toBe(true);
    const reports = TestBed.inject(EnemyFleetService).getAssaultReports().filter((r) => r.planetId === targetId);
    expect(reports.map((r) => r.result)).toEqual(['captured']);
  });

  it('does not throw its fleets at a planet it cannot take', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      size: 'medium', aiCount: 2, seconds: 300, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        const planet = nearestFreeSystem(data, 'enemy1').planetsTiles[0];
        occupy(planet, 'independent', [...turrets(40), { name: 'Planetary Shield', size: 2, x: 7, y: 7 }]);
        targetId = planet.id;
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    expect(TestBed.inject(EnemyFleetService).getAssaultReports().filter((r) => r.planetId === targetId)).toEqual([]);
    expect(result.ownershipChanges.filter((c) => c.planetId === targetId)).toEqual([]);
  });

  it('two AI factions capture different targets at the same time', () => {
    const targets = new Map<string, number>();
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 500, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        const first = nearestFreeSystem(data, 'enemy1');
        const second = nearestFreeSystem(data, 'enemy2', [first.id]);
        occupy(first.planetsTiles[0], 'independent', turrets(1));
        occupy(second.planetsTiles[0], 'independent', turrets(1));
        targets.set('enemy1', first.planetsTiles[0].id);
        targets.set('enemy2', second.planetsTiles[0].id);
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    for (const [factionId, planetId] of targets) {
      const change = result.ownershipChanges.find((c) => c.planetId === planetId && c.to === factionId);
      expect(change, `${factionId} captured its target`).toBeDefined();
    }
  });

  it('attacks a defended player colony through a player battle; the player keeps playing from the homeworld', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        const planet = nearestFreeSystem(data, 'enemy1').planetsTiles[0];
        occupy(planet, 'player', [...turrets(1), { name: 'Spaceship Factory', size: 3, x: 0, y: 0 }]);
        targetId = planet.id;
        // A player production order on that colony must not survive its capture.
        data.production = [{ factionId: 'player', ordersByPlanet: { [planet.id]: [{ id: 77, shipTypeId: 'fighter', quantity: 1, progress: 0, startedAtTick: 0 }] } }];
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);

    const battles = result.playerBattles.filter((b) => b.planetId === targetId);
    expect(battles.length, 'player battle fought').toBeGreaterThanOrEqual(1);
    expect(battles.at(-1)!.winner).toBe('attacker');
    expect(result.ownershipChanges.filter((c) => c.planetId === targetId).map((c) => `${c.from}->${c.to}`)).toEqual(['player->enemy1']);
    const playerOrders = result.data.production?.find((p) => p.factionId === 'player')?.ordersByPlanet[targetId] ?? [];
    expect(playerOrders, 'captured planet production cancelled').toEqual([]);
    // Losing a colony with the homeworld intact is not a defeat.
    expect(result.outcome).toBe('inProgress');
  });

  it('genuine defeat: the AI captures the player\'s last planet while the player has no fleet', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        for (const planet of data.starSystems.flatMap((sy) => sy.planetsTiles)) {
          if (planet.factionId === 'player') {
            planet.factionId = 'unhabited';
            planet.population = 0;
            planet.buildings = [];
          }
        }
        const planet = nearestFreeSystem(data, 'enemy1').planetsTiles[0];
        occupy(planet, 'player', turrets(1));
        targetId = planet.id;
      },
    };
    const result = runScenario(options);

    expect(result.ownershipChanges.some((c) => c.planetId === targetId && c.to === 'enemy1')).toBe(true);
    expect(result.outcome).toBe('defeat');
    // The simulation stopped at the terminal outcome, which stays terminal.
    expect(result.outcomeAt).not.toBeNull();
    const outcomes = TestBed.inject(GameOutcomeService);
    expect(outcomes.evaluate({ ...result.data, gameOutcome: 'defeat' })).toBe('defeat');
  });

  it('a faction that lost its last planet keeps a recovery route and retakes territory', () => {
    let freeId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      // 12 minutes: enemy1 retakes its old worlds and colonizes first; the
      // free world falls ~10 minutes in since the slower start of the colony
      // cores (2026-11; ~9 minutes before).
      size: 'medium', aiCount: 2, seconds: 720, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        // enemy1 loses every planet but keeps its fleets.
        for (const planet of data.starSystems.flatMap((sy) => sy.planetsTiles)) {
          if (planet.factionId === 'enemy1') {
            planet.factionId = 'independent';
          }
        }
        // An undefended independent world near enemy1's fleets is its way back.
        const fleet = data.fleets.find((f) => f.factionId === 'enemy1')!;
        const target = data.starSystems
          .filter((sy) => sy.planetsTiles.every((p) => p.factionId === 'unhabited'))
          .sort((a, b) => Math.hypot(a.x - fleet.x, a.y - fleet.y) - Math.hypot(b.x - fleet.x, b.y - fleet.y))[0];
        occupy(target.planetsTiles[0], 'independent', [{ name: 'Small Residential Block', size: 1, x: 0, y: 0 }]);
        freeId = target.planetsTiles[0].id;
      },
    };
    const result = runScenario(options);

    expect(result.outcome).toBe('inProgress');
    const recovered = result.ownershipChanges.filter((c) => c.to === 'enemy1');
    expect(recovered.length, 'enemy1 regained a planet').toBeGreaterThanOrEqual(1);
    expect(recovered.some((c) => c.planetId === freeId), 'recovered the undefended world').toBe(true);
  });

  it('save/load during an invasion and after a capture neither loses nor repeats the capture', () => {
    let targetId = -1;
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      saveLoadAtSecond: 40,
      prepare: (data) => {
        const planet = nearestFreeSystem(data, 'enemy1').planetsTiles[0];
        occupy(planet, 'independent', turrets(1));
        targetId = planet.id;
      },
      events: [
        {
          // A second reload after the capture (JSON round trip + AI reset).
          at: 450,
          apply: (data) => {
            const copy = JSON.parse(JSON.stringify(data));
            Object.assign(data, copy);
            TestBed.inject(StarMapAiTickService).resetAiPipeline();
          },
        },
      ],
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);

    const changes = result.ownershipChanges.filter((c) => c.planetId === targetId);
    expect(changes.map((c) => `${c.from}->${c.to}`)).toEqual(['independent->enemy1']);
    const planet = result.data.starSystems.flatMap((sy) => sy.planetsTiles).find((p) => p.id === targetId)!;
    expect(planet.factionId).toBe('enemy1');
  });
});

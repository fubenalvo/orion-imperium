import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { ProductionService } from '../../services/production.service';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { AiDifficulty, Faction, GalaxySize, StarMapData } from './star-map.models';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { StarMapMovementService } from './star-map-movement.service';
import { EnemyActionService } from './enemy-action.service';
import { EnemyResearchService } from './enemy-research.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { GameOutcomeService, GameOutcome } from '../../services/game-outcome.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { autoResolveBattle } from '../battle-screen/battle/battle-auto-resolve';
import { EnemyPlanService, StrategicPriority } from './enemy-plan.service';
import { EnemyProgressService } from './enemy-progress.service';
import { EnemyStrategyService } from './enemy-strategy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyReachService } from './enemy-reach.service';
import { EnemyIntelService } from './enemy-intel.service';
import { ResearchService } from '../../services/research.service';
import { Fleet } from './star-map.models';
import { generateResourceTilesForPlanet, selectPlanetsForResources } from './star-map-resources.util';
import { getPlanetGridSize } from './star-map-display.util';
import { areFactionsHostile, normalizeRelations } from './diplomacy';
import { DiplomacyService } from '../../services/diplomacy.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { BattleService } from '../../services/battle.service';

/*
 * =========================================================
 * AI SIMULATION REGRESSION SUITE
 * =========================================================
 *
 * Headless multi-minute simulations of procedurally generated games.
 * Each frame mirrors StarMap.gameLoopCallback: fleet movement, the AI
 * pipeline tick, production, then the 1 s economy tick. Battles and
 * planet-arrival handling (which need the battle screen / system view)
 * are not simulated; hostile collisions are therefore avoided by the
 * scenarios rather than resolved.
 *
 * These tests guard cross-layer behavior that the per-service unit
 * tests cannot see: per-faction scheduling, end-to-end colonization,
 * construction pacing and homeworld stability, fleet-order ownership,
 * and false "state changed" reports.
 */

// Each scenario simulates 2–15 minutes of game time (up to 54,000 frames);
// a single run takes ~0.2–1.5 s, but the default 5 s limit is too tight
// when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

interface ScenarioOptions {
  size: GalaxySize;
  aiCount: number;
  seconds: number;
  /* Fixed frame delta, or 'jitter' for a deterministic 30–120 fps mix. */
  dt: number | 'jitter';
  removePlayerFleets?: boolean;
  difficulty?: AiDifficulty;
  seed?: number;
  /* JSON round-trip the game state and reset the AI pipeline at this time. */
  saveLoadAtSecond?: number;
  /* Deterministic fixture changes applied to the generated galaxy. */
  prepare?: (data: StarMapData) => void;
  /* One-shot state changes applied once simulated time reaches `at`. */
  events?: { at: number; apply: (data: StarMapData) => void }[];
  /*
   * Pre-diplomacy world: every AI on team 2 (permanent allies, as on saves
   * from before diplomacy). For scenarios whose premise is "AIs against the
   * player"; without it AIs are at war with each other as in a new game.
   */
  aiAlliance?: boolean;
  /*
   * Fleet battles with the player are auto-resolved as if the player chose
   * AUTO on the battle screen (planet battles always are). For whole-game
   * health runs; scenario tests that study contacts keep them unresolved.
   */
  resolvePlayerFleetBattles?: boolean;
  /*
   * Keep simulating after a terminal outcome (StarMap would stop). For
   * AI stability runs, where the passive stand-in player may be defeated
   * long before the end and the AIs should keep playing each other.
   */
  continueAfterOutcome?: boolean;
}

interface FactionTrace {
  evaluations: number;
  buildTimes: number[];
  colonizations: number;
  colonizersProduced: number;
  lostPlanets: number;
  startPlanets: number;
  homeworldId: number;
  combatShipsProduced: number;
  spaceportAt: number | null;
  factoryAt: number | null;
  firstResearchBuildingAt: number | null;
  firstColonizationAt: number | null;
  /* Planet id → building count when the planet was first seen owned. */
  initialBuildings: Map<number, number>;
  minCredits: number;
  minResearch: number;
  combatProducedByType: Record<string, number>;
  firstCombatProducedAt: number | null;
  combatProducedTimes: number[];
  fleetsCreated: number;
  reinforcements: number;
  initialCombatShips: number;
  creditsSpent: number;
  startCredits: number;
  researchTimes: number[];
  /* Every 10 s: the EnemyPlanService primary priority. */
  priorities: StrategicPriority[];
  /* Every 10 s: the pipeline strategy (EnemyStrategyService). */
  strategies: string[];
  personality: string;
  /* First contact (shared galaxy cell) with each hostile fleet. */
  contacts: { time: number; hostileFleetId: number; aiStrength: number; hostileStrength: number }[];
  /* Economy metrics (EconomyService breakdown summed over every economy tick). */
  grossIncome: number;
  upkeepCharged: number;
  startRaw: number;
  rawSpent: number;
  /* ProductionService.queueOrder calls by this faction that were rejected. */
  failedOrders: number;
  /* Economy ticks on which part of the upkeep could not be paid. */
  arrearsTicks: number;
  /* Researched technology ids in order, with researchOrderTimes[i] = when. */
  researchOrder: string[];
  researchOrderTimes: number[];
}

interface OwnershipChange {
  time: number;
  planetId: number;
  from: string;
  to: string;
}

interface ScenarioResult {
  data: StarMapData;
  ownershipChanges: OwnershipChange[];
  playerBattles: { time: number; planetId: number; winner: string }[];
  outcome: GameOutcome;
  outcomeAt: number | null;
  /* Decisions that used knowledge the faction did not have (fog of war). */
  fogViolations: string[];
  aiTickMs: { total: number; max: number; perFrame: number };
  frames: number;
  changedFrames: number;
  traces: Map<string, FactionTrace>;
  colonizerFleetHijacks: number;
  /* Fleet battles between two AI factions, auto-resolved by battle detection. */
  aiBattles: number;
}

const AI_COLORS = ['#d65757', '#39b8a8', '#b07cff', '#7bd66b', '#ff9a3c', '#ff6fcf'];

function generate(options: ScenarioOptions): StarMapData {
  const config = createDefaultNewGameConfig(options.size);
  const human = config.players.find((p) => p.controller === 'human')!;
  const aiTemplate = config.players.find((p) => p.controller === 'ai')!;
  config.players = [
    human,
    ...Array.from({ length: options.aiCount }, (_, i) => ({
      ...aiTemplate,
      name: `AI ${i + 1}`,
      color: AI_COLORS[i],
      difficulty: options.difficulty ?? aiTemplate.difficulty,
    })),
  ];
  const data = TestBed.inject(GalaxyGeneratorService).generate(config, options.seed ?? 31337);
  // Mirrors StarMap.ensureResourceTiles on load: ore deposits on ~20% of planets.
  const allPlanets = data.starSystems.flatMap((s) => s.planetsTiles);
  const withOre = selectPlanetsForResources(allPlanets);
  for (const planet of allPlanets) {
    planet.resourceTiles = withOre.has(planet.id) ? generateResourceTilesForPlanet(planet, getPlanetGridSize) : [];
  }
  if (options.removePlayerFleets) {
    data.fleets = data.fleets.filter((f) => f.factionId !== 'player');
  }
  if (options.aiAlliance) {
    for (const faction of data.factions) {
      if (faction.ai === true) faction.team = 2;
    }
    normalizeRelations(data.factions);
  }
  options.prepare?.(data);
  return data;
}

function ownedPlanets(data: StarMapData, factionId: string) {
  return data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === factionId);
}

const RESEARCH_BUILDINGS = ['Small Research Laboratory', 'Research Laboratory'];

function hasBuilding(data: StarMapData, factionId: string, names: string[]): boolean {
  return ownedPlanets(data, factionId).some((p) => p.buildings.some((b) => names.includes(b.name)));
}

/* AI-owned planets that gained at least one building during the run. */
function developedPlanetCount(data: StarMapData, factionId: string, trace: FactionTrace): number {
  return ownedPlanets(data, factionId).filter((p) => p.buildings.length > (trace.initialBuildings.get(p.id) ?? 0)).length;
}

function homeworldOf(data: StarMapData): (factionId: string) => StarMapData['starSystems'][0]['planetsTiles'][0] {
  return (factionId) => ownedPlanets(data, factionId).find((p) => p.population === 1400)!;
}

function runScenario(options: ScenarioOptions): ScenarioResult {
  let data = generate(options);
  const movement = TestBed.inject(StarMapMovementService);
  const aiTick = TestBed.inject(StarMapAiTickService);
  const production = TestBed.inject(ProductionService);
  const economy = TestBed.inject(EconomyService);
  const actions = TestBed.inject(EnemyActionService);

  movement.initialize(data.map.cellSizeVw, data.map.cellSizeVh, data.map.width, data.map.height);
  movement.initializeCoordinates(data.fleets, data.starSystems);
  aiTick.resetAiPipeline();

  const traces = new Map<string, FactionTrace>();
  for (const faction of data.factions.filter((f) => f.ai)) {
    const planets = ownedPlanets(data, faction.id);
    // A faction may start a scenario with no planet at all (recovery tests).
    const homeworld = planets.find((p) => p.population === 1400) ?? planets[0] ?? { id: -1 };
    traces.set(faction.id, {
      evaluations: 0,
      buildTimes: [],
      colonizations: 0,
      colonizersProduced: 0,
      lostPlanets: 0,
      startPlanets: planets.length,
      homeworldId: homeworld.id,
      combatShipsProduced: 0,
      spaceportAt: hasBuilding(data, faction.id, ['Spaceport']) ? 0 : null,
      factoryAt: hasBuilding(data, faction.id, ['Spaceship Factory']) ? 0 : null,
      firstResearchBuildingAt: null,
      firstColonizationAt: null,
      initialBuildings: new Map(planets.map((p) => [p.id, p.buildings.length] as const)),
      minCredits: faction.currencies['credits'] ?? 0,
      minResearch: faction.currencies['research'] ?? 0,
      combatProducedByType: {},
      firstCombatProducedAt: null,
      combatProducedTimes: [],
      fleetsCreated: 0,
      reinforcements: 0,
      creditsSpent: 0,
      startCredits: faction.currencies['credits'] ?? 0,
      researchTimes: [],
      priorities: [],
      strategies: [],
      personality: faction.aiPersonality ?? 'balanced',
      initialCombatShips: data.fleets
        .filter((f) => f.factionId === faction.id)
        .flatMap((f) => f.ships)
        .filter((sh) => sh.type !== 'colonizer').length,
      contacts: [],
      grossIncome: 0,
      upkeepCharged: 0,
      startRaw: faction.currencies['rawmaterials'] ?? 0,
      rawSpent: 0,
      failedOrders: 0,
      arrearsTicks: 0,
      researchOrder: [],
      researchOrderTimes: [],
    });
  }

  // Counts primary action evaluations only; the parallel colonization slot
  // (planColonizationAction) reuses evaluateAction and is excluded.
  const evaluateAction = (actions as any).evaluateAction.bind(actions);
  let inColonizationSlot = false;
  const planColonization = actions.planColonizationAction.bind(actions);
  const colonizationSpy = vi.spyOn(actions, 'planColonizationAction').mockImplementation((...args: Parameters<typeof planColonization>) => {
    inColonizationSlot = true;
    try {
      return planColonization(...args);
    } finally {
      inColonizationSlot = false;
    }
  });
  const queueOrder = production.queueOrder.bind(production);
  const queueSpy = vi.spyOn(production, 'queueOrder').mockImplementation((...args: Parameters<typeof queueOrder>) => {
    const result = queueOrder(...args);
    const trace = traces.get(args[1]);
    if (trace && !result.ok) trace.failedOrders++;
    return result;
  });
  const evaluateSpy = vi.spyOn(actions as any, 'evaluateAction').mockImplementation((...args: any[]) => evaluateAction(...args));
  // Scheduling: count the goal layer's per-faction decisions (every 2 s),
  // which happen whether or not the faction currently has a goal.
  const goalService = TestBed.inject(EnemyGoalService);
  const updatePrimary = (goalService as any).updatePrimaryGoal.bind(goalService);
  const goalSpy = vi.spyOn(goalService as any, 'updatePrimaryGoal').mockImplementation((...args: any[]) => {
    const trace = traces.get(args[1]);
    if (trace && !inColonizationSlot) trace.evaluations++;
    return updatePrimary(...args);
  });

  let rngState = 12345;
  const nextDt = (): number => {
    if (options.dt !== 'jitter') return options.dt;
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return 1 / 120 + (rngState / 2147483648) * (1 / 30 - 1 / 120);
  };

  let time = 0;
  let frames = 0;
  let changedFrames = 0;
  let economyAccumulator = 0;
  let colonizerFleetHijacks = 0;
  let savedAndLoaded = false;
  const appliedEvents = new Set<object>();
  const ownership = TestBed.inject(PlanetOwnershipService);
  const outcomes = TestBed.inject(GameOutcomeService);
  outcomes.reset();
  const ownershipChanges: OwnershipChange[] = [];
  const playerBattles: { time: number; planetId: number; winner: string }[] = [];
  let outcome: GameOutcome = 'inProgress';
  let outcomeAt: number | null = null;
  let lastRevision = ownership.revision;
  const fogViolations: string[] = [];
  let aiTickTotal = 0;
  let aiTickMax = 0;
  const intel = TestBed.inject(EnemyIntelService);
  const fleetOps = TestBed.inject(EnemyFleetService);
  const goalsForFog = TestBed.inject(EnemyGoalService);
  const shipService = TestBed.inject(ShipService);
  const strengthOf = (fleet: Fleet) => shipService.calculateFleetStrength(fleet.ships);
  const livingCombat = (fleet: Fleet) => fleet.ships.filter((sh) => !sh.destroyed && sh.type !== 'colonizer').length;
  const knownFleetCombat = new Map(data.fleets.map((f) => [f.id, livingCombat(f)] as const));
  const contactKeys = new Set<string>();
  const diplomacy = TestBed.inject(DiplomacyService);
  const battleDetection = TestBed.inject(StarMapBattleDetectionService);
  const triggeredBattles = new Set<string>();
  let aiBattles = 0;
  const researchBuildingsBefore = new Map(
    [...traces.keys()].map((id) => [
      id,
      ownedPlanets(data, id).flatMap((p) => p.buildings).filter((b) => RESEARCH_BUILDINGS.includes(b.name)).length,
    ] as const),
  );

  while (time < options.seconds && (outcome === 'inProgress' || options.continueAfterOutcome)) {
    const dt = nextDt();
    time += dt;
    frames++;

    for (const event of options.events ?? []) {
      if (time >= event.at && !appliedEvents.has(event)) {
        appliedEvents.add(event);
        event.apply(data);
      }
    }

    if (options.saveLoadAtSecond !== undefined && !savedAndLoaded && time >= options.saveLoadAtSecond) {
      // Mirrors StarMap.loadGame: fresh object graph, pipeline reset.
      data = JSON.parse(JSON.stringify(data));
      production.rebaseFromSave(data.production);
      movement.initializeCoordinates(data.fleets, data.starSystems);
      aiTick.resetAiPipeline();
      savedAndLoaded = true;
    }

    const ownersBefore = new Map(
      data.starSystems.flatMap((s) => s.planetsTiles).map((p) => [p.id, p.factionId] as const),
    );
    // Per-planet building counts: construction is counted only on planets
    // the faction owned both before and after the frame, so capturing an
    // already developed planet is not mistaken for a new building.
    const buildingsBefore = new Map(
      data.starSystems.flatMap((s) => s.planetsTiles).map((p) => [p.id, p.buildings.length] as const),
    );

    movement.updateFleets(data.fleets, data.starSystems, null, 'map', dt, () => {}, (fleetId) => {
      const fleet = data.fleets.find((f) => f.id === fleetId);
      if (fleet) fleet.system = null;
    });
    // Mirrors StarMap.gameLoopCallback: treaty locks count down, and battles
    // between two AI factions at war are auto-resolved on contact (battles
    // with the player would open the battle screen; the harness has none).
    diplomacy.tick(dt, data.factions, data);
    battleDetection.checkForBattles(
      data.fleets,
      data.factions,
      (x, y) => movement.calculateGridCell(x, y),
      (fleet, system) => movement.isFleetInSystem(fleet, system),
      data.starSystems,
      () => {
        if (!options.resolvePlayerFleetBattles) return;
        const battle = TestBed.inject(BattleService).getBattle();
        if (!battle) return;
        const resolved = autoResolveBattle(battle, TestBed.inject(ShipService), TestBed.inject(PlanetBattleService));
        TestBed.inject(BattleOutcomeService).applyFleetBattleOutcome(data, resolved.outcome);
        TestBed.inject(BattleService).clearBattle();
      },
      triggeredBattles,
      () => {
        aiBattles++;
      },
    );
    const creditsBeforeTick = new Map(data.factions.map((f) => [f.id, f.currencies['credits'] ?? 0] as const));
    const rawBeforeTick = new Map(data.factions.map((f) => [f.id, f.currencies['rawmaterials'] ?? 0] as const));
    const techsBeforeTick = new Map(data.factions.map((f) => [f.id, (f.researchedTechnologies ?? []).length] as const));
    const tickStart = performance.now();
    const changed = aiTick.tick(dt, {
      fleets: data.fleets,
      factions: data.factions,
      starSystems: data.starSystems,
      shipStock: data.shipStock!,
      production: data.production!,
    });
    const tickMs = performance.now() - tickStart;
    aiTickTotal += tickMs;
    aiTickMax = Math.max(aiTickMax, tickMs);
    if (changed) changedFrames++;

    // Fog-of-war compliance: every target a decision layer picked must be
    // something the faction's sensors have seen.
    if (intel.enabled && frames % 60 === 0) {
      for (const factionId of traces.keys()) {
        for (const goal of [goalsForFog.getGoal(factionId), goalsForFog.getColonizationGoal(factionId)]) {
          if (goal?.type === 'colonize' && !intel.knowsSystem(factionId, goal.targetSystemId)) {
            fogViolations.push(`${time.toFixed(0)}s ${factionId} colonize target ${goal.targetSystemId} never sensed`);
          }
        }
        for (const fleet of data.fleets.filter((f) => f.factionId === factionId && !f.destroyed)) {
          const assignment = fleetOps.getAssignment(fleet.id);
          if (assignment?.role === 'assault' && assignment.systemId && !intel.knowsSystem(factionId, assignment.systemId)) {
            fogViolations.push(`${time.toFixed(0)}s ${factionId} assault on uncharted ${assignment.systemId}`);
          }
          if (assignment?.role === 'intercept' && assignment.targetFleetId !== undefined) {
            const target = data.fleets.find((f) => f.id === assignment.targetFleetId);
            if (target && !intel.getKnownPosition(factionId, target)) {
              fogViolations.push(`${time.toFixed(0)}s ${factionId} intercepts unknown fleet ${target.id}`);
            }
          }
        }
      }
    }
    for (const [factionId, trace] of traces) {
      const faction = data.factions.find((f) => f.id === factionId)!;
      // AI spending happens inside the AI tick (buildings, production orders).
      trace.creditsSpent += Math.max(0, creditsBeforeTick.get(factionId)! - (faction.currencies['credits'] ?? 0));
      trace.rawSpent += Math.max(0, rawBeforeTick.get(factionId)! - (faction.currencies['rawmaterials'] ?? 0));
      const researchedNow = faction.researchedTechnologies ?? [];
      if (researchedNow.length > techsBeforeTick.get(factionId)!) {
        trace.researchTimes.push(time);
        for (const id of researchedNow.slice(techsBeforeTick.get(factionId)!)) {
          trace.researchOrder.push(id);
          trace.researchOrderTimes.push(time);
        }
      }
      if (frames % 600 === 0) {
        trace.priorities.push(TestBed.inject(EnemyPlanService).getPosture(faction).primary);
        trace.strategies.push(TestBed.inject(EnemyStrategyService).getStrategy(factionId) ?? 'none');
      }
    }

    // A queued AI assault on a player planet: in game StarMap opens the
    // battle screen, the battle screen applies the outcome to the save via
    // BattleOutcomeService and StarMap reloads (resetting the AI). The
    // harness stands in for the player choosing AUTO: the same battle is
    // auto-resolved and applied through the same service, then the AI is
    // reset as on reload.
    const pendingBattle = aiTick.takePendingPlayerBattle();
    if (pendingBattle) {
      const resolved = autoResolveBattle(pendingBattle, TestBed.inject(ShipService), TestBed.inject(PlanetBattleService));
      TestBed.inject(BattleOutcomeService).applyPlanetBattleOutcome(data, pendingBattle, resolved.outcome);
      playerBattles.push({ time, planetId: pendingBattle.planetId!, winner: resolved.outcome.winnerSide });
      aiTick.resetAiPipeline();
    }
    const produced = production.tick(dt, data as never, data.starSystems, data.fleets, data.factions);
    for (const ships of produced.producedShips) {
      const trace = traces.get(ships.factionId);
      if (!trace) continue;
      if (ships.typeId === 'colonizer') {
        trace.colonizersProduced += ships.count;
      } else {
        trace.combatShipsProduced += ships.count;
        trace.combatProducedByType[ships.typeId] = (trace.combatProducedByType[ships.typeId] ?? 0) + ships.count;
        trace.firstCombatProducedAt ??= time;
        trace.combatProducedTimes.push(time);
      }
    }
    economyAccumulator += dt;
    if (economyAccumulator >= 1) {
      for (const faction of data.factions) {
        const breakdown = economy.applyEconomyDelta(
          faction.id, data.factions, data.starSystems, data.fleets, economyAccumulator, data.production, data.shipStock,
        );
        const trace = traces.get(faction.id);
        if (trace) {
          trace.grossIncome += (breakdown.incomePerSecond ?? 0) * economyAccumulator;
          trace.upkeepCharged += (breakdown.expensePerSecond ?? 0) * economyAccumulator;
          if ((breakdown.unpaidUpkeepPerSecond ?? 0) > 0) trace.arrearsTicks++;
        }
      }
      economyAccumulator = 0;
    }

    for (const planet of data.starSystems.flatMap((s) => s.planetsTiles)) {
      const before = ownersBefore.get(planet.id);
      if (before === planet.factionId) continue;
      ownershipChanges.push({ time, planetId: planet.id, from: before ?? '?', to: planet.factionId });
      const gainer = traces.get(planet.factionId);
      if (gainer && before === 'unhabited') {
        gainer.colonizations++;
        gainer.firstColonizationAt ??= time;
      }
      if (gainer && !gainer.initialBuildings.has(planet.id)) gainer.initialBuildings.set(planet.id, planet.buildings.length);
      const loser = before !== undefined ? traces.get(before) : undefined;
      if (loser) loser.lostPlanets++;
    }
    for (const [factionId, trace] of traces) {
      const built = ownedPlanets(data, factionId).some(
        (p) => ownersBefore.get(p.id) === factionId && p.buildings.length > (buildingsBefore.get(p.id) ?? 0),
      );
      if (built) trace.buildTimes.push(time);
      if (trace.spaceportAt === null && hasBuilding(data, factionId, ['Spaceport'])) trace.spaceportAt = time;
      if (trace.factoryAt === null && hasBuilding(data, factionId, ['Spaceship Factory'])) trace.factoryAt = time;
      if (trace.firstResearchBuildingAt === null) {
        const research = ownedPlanets(data, factionId).flatMap((p) => p.buildings).filter((b) => RESEARCH_BUILDINGS.includes(b.name)).length;
        if (research > researchBuildingsBefore.get(factionId)!) trace.firstResearchBuildingAt = time;
        researchBuildingsBefore.set(factionId, research);
      }
      const faction = data.factions.find((f) => f.id === factionId)!;
      trace.minCredits = Math.min(trace.minCredits, faction.currencies['credits'] ?? 0);
      trace.minResearch = Math.min(trace.minResearch, faction.currencies['research'] ?? 0);
    }

    // Fleet assembly events: a new AI fleet id, or more living combat
    // ships in an existing fleet (reinforcement).
    for (const fleet of data.fleets) {
      const trace = traces.get(fleet.factionId);
      const combat = livingCombat(fleet);
      const before = knownFleetCombat.get(fleet.id);
      if (trace && before === undefined) trace.fleetsCreated++;
      if (trace && before !== undefined && combat > before) trace.reinforcements++;
      knownFleetCombat.set(fleet.id, combat);
    }

    // Hostile contacts (in game these start a battle).
    const factionById = new Map(data.factions.map((f) => [f.id, f] as const));
    const alive = data.fleets.filter((f) => !f.destroyed && f.ships.some((sh) => !sh.destroyed));
    for (const ai of alive) {
      const trace = traces.get(ai.factionId);
      if (!trace) continue;
      for (const other of alive) {
        if (!areFactionsHostile(factionById.get(ai.factionId), factionById.get(other.factionId))) continue;
        if (Math.floor(other.x) !== Math.floor(ai.x) || Math.floor(other.y) !== Math.floor(ai.y)) continue;
        const key = `${ai.factionId}:${other.id}`;
        if (contactKeys.has(key)) continue;
        contactKeys.add(key);
        const aiStrength = alive
          .filter((f) => f.factionId === ai.factionId && Math.floor(f.x) === Math.floor(ai.x) && Math.floor(f.y) === Math.floor(ai.y))
          .reduce((sum, f) => sum + strengthOf(f), 0);
        trace.contacts.push({ time, hostileFleetId: other.id, aiStrength, hostileStrength: strengthOf(other) });
      }
    }

    // Outcome check on ownership changes, as StarMap.gameLoopCallback does.
    if (ownership.revision !== lastRevision) {
      lastRevision = ownership.revision;
      outcome = outcomes.evaluate({ ...data, gameOutcome: outcome });
      if (outcome !== 'inProgress' && outcomeAt === null) outcomeAt = time;
    }

    // A fleet carrying a colonizer must only ever head for a star system
    // (its colonization destination), never chase a fleet.
    const systemCells = new Set(data.starSystems.map((s) => `${s.x},${s.y}`));
    for (const fleet of data.fleets) {
      if (!traces.has(fleet.factionId) || fleet.destroyed || fleet.targetX === null) continue;
      if (!fleet.ships.some((s) => s.type === 'colonizer' && !s.destroyed)) continue;
      if (!systemCells.has(`${fleet.targetX},${fleet.targetY}`)) colonizerFleetHijacks++;
    }
  }

  // Restore so a test may run several scenarios (e.g. a control run).
  evaluateSpy.mockRestore();
  queueSpy.mockRestore();
  colonizationSpy.mockRestore();
  goalSpy.mockRestore();
  return {
    data, frames, changedFrames, traces, colonizerFleetHijacks, ownershipChanges, playerBattles, outcome, outcomeAt, fogViolations, aiBattles,
    aiTickMs: { total: aiTickTotal, max: aiTickMax, perFrame: aiTickTotal / Math.max(1, frames) },
  };
}

function expectHealthyAiFactions(result: ScenarioResult, options: ScenarioOptions): void {
  const expectedEvaluations = options.seconds / 2;
  for (const [factionId, trace] of result.traces) {
    const faction = result.data.factions.find((f) => f.id === factionId) as Faction;

    // Every faction is planned for on its own ~2 s cadence.
    expect(trace.evaluations, `${factionId} evaluations`).toBeGreaterThanOrEqual(Math.floor(expectedEvaluations * 0.9));
    expect(trace.evaluations, `${factionId} evaluations`).toBeLessThanOrEqual(Math.ceil(expectedEvaluations * 1.1) + 1);

    // Construction is paced: never two buildings within one decision interval.
    for (let i = 1; i < trace.buildTimes.length; i++) {
      expect(trace.buildTimes[i] - trace.buildTimes[i - 1], `${factionId} build spacing`).toBeGreaterThan(1.5);
    }

    // No AI planet is lost to its own development (rebellion). Planets may
    // only change hands through battles/captures in Phase 4 scenarios.
    const rebellions = result.ownershipChanges.filter((c) => c.from === factionId && c.to === 'independent').length;
    expect(rebellions, `${factionId} rebellions`).toBe(0);
    if (trace.homeworldId >= 0) {
      const homeworld = ownedPlanets(result.data, factionId).find((p) => p.id === trace.homeworldId);
      expect(homeworld, `${factionId} homeworld still owned`).toBeDefined();
      expect(homeworld!.satisfaction ?? 100, `${factionId} homeworld satisfaction`).toBeGreaterThan(50);
    }

    expect(faction.currencies['credits']).toBeGreaterThanOrEqual(0);
    expect(trace.minCredits, `${factionId} credits never negative`).toBeGreaterThanOrEqual(0);
    expect(trace.minResearch, `${factionId} research never negative`).toBeGreaterThanOrEqual(0);

    // Ship accounting: every combat ship the faction ever had is still in
    // exactly one fleet (alive or destroyed) or in the stock.
    const fleetShips = result.data.fleets.filter((f) => f.factionId === factionId).flatMap((f) => f.ships);
    const stockShips = result.data.shipStock?.find((st) => st.factionId === factionId)?.ships ?? [];
    const ids = [...fleetShips, ...stockShips].map((sh) => sh.id);
    expect(new Set(ids).size, `${factionId} unique ship ids`).toBe(ids.length);
    const combatNow = [...fleetShips, ...stockShips].filter((sh) => sh.type !== 'colonizer').length;
    expect(combatNow, `${factionId} combat ship accounting`).toBe(trace.initialCombatShips + trace.combatShipsProduced);
  }

  // Colonizer fleets keep their strategic destination.
  expect(result.colonizerFleetHijacks).toBe(0);
  // Decisions only use knowledge the faction legitimately has.
  expect(result.fogViolations.slice(0, 5), 'fog-of-war violations ' + JSON.stringify(result.fogViolations.slice(0, 5))).toEqual([]);

  // "State changed" must not be reported on (almost) every frame.
  expect(result.changedFrames / result.frames).toBeLessThan(0.05);
}

describe('AI simulation (headless multi-minute games)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('two AIs on a medium map without player fleets develop infrastructure and colonize', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const planets = ownedPlanets(result.data, factionId);
      const buildings = planets.flatMap((p) => p.buildings.map((b) => b.name));
      expect(buildings, `${factionId} factory`).toContain('Spaceship Factory');
      expect(buildings, `${factionId} spaceport`).toContain('Spaceport');
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      expect(planets.length).toBe(trace.startPlanets + trace.colonizations);
    }
  });

  it('two AIs on a medium map with player fleets present keep progressing', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60 };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('hard AIs on a small map with variable frame times colonize and stay stable', () => {
    const options: ScenarioOptions = { size: 'small', aiCount: 2, seconds: 600, dt: 'jitter', difficulty: 'hard' };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('five AIs on a large map are each processed and colonize', () => {
    const options: ScenarioOptions = { size: 'large', aiCount: 5, seconds: 600, dt: 1 / 60 };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('AIs keep progressing after a mid-game save/load', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      saveLoadAtSecond: 40,
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('each colonization consumes exactly one colonizer and claims the planet once', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      const livingColonizers =
        result.data.fleets
          .filter((f) => f.factionId === factionId && !f.destroyed)
          .flatMap((f) => f.ships)
          .filter((s) => s.type === 'colonizer' && !s.destroyed).length +
        (result.data.shipStock?.find((s) => s.factionId === factionId)?.ships ?? []).filter((s) => s.type === 'colonizer')
          .length;
      // Every produced colonizer is either still alive or was spent on exactly one colony.
      expect(trace.colonizersProduced, `${factionId} colonizer accounting`).toBe(trace.colonizations + livingColonizers);
      // Colonized planets are only ever claimed once (no ownership flip-flop).
      expect(trace.lostPlanets).toBe(0);
    }
  });

  it('fleet strength ignores destroyed ships', () => {
    const shipService = TestBed.inject(ShipService);
    const living = shipService.calculateFleetStrength([{ type: 'cruiser' }]);
    const withWreck = shipService.calculateFleetStrength([
      { type: 'cruiser' },
      { type: 'cruiser', destroyed: true },
    ]);
    expect(living).toBeGreaterThan(0);
    expect(withWreck).toBe(living);
  });
});

/*
 * Phase 2 scenarios: autonomous economy, spending policy, end-to-end
 * colonization and recovery. Time limits follow the game rules:
 *  - ship build time = cost × 0.1 / 0.5 factory power → colonizer 20 s,
 *    fighter 15 s;
 *  - AI-assembled fleets move 0.2 cells/s (speed 4 / 10 / cellSizeVw 2),
 *    and colonization targets are limited to 60 cells (≤ 300 s travel);
 *  - one construction decision per faction every 2 s;
 *  - homeworld income ≈ 140 credits/s (1400 pop × 0.1), ≈ 86/s net of
 *    upkeep with the starting fleet; Spaceship Factory 3000 and Spaceport
 *    4000 credits (docs/economy.md).
 */
const stripToResidential = (data: StarMapData): void => {
  for (const faction of data.factions.filter((f) => f.ai)) {
    const home = homeworldOf(data)(faction.id);
    home.buildings = [{ name: 'Large Residential Block', size: 3, x: 0, y: 0 }];
    // Enough for one power building (Solar Array: 600 credits). With an
    // energy deficit the homeworld earns nothing, so less than that would
    // be an unwinnable start under the economy rules, not an AI test.
    faction.currencies['credits'] = 1000;
  }
};

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
      // Factory (3000) + Spaceport (4000) from a 1000-credit start at ~85 credits/s net.
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(180);
      expect(trace.firstColonizationAt!, `${factionId} first colony time`).toBeLessThan(300);
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
      expect(stock.filter((s) => s.type !== 'colonizer').length, `${factionId} undeployed combat ships`).toBeLessThanOrEqual(1);
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
      // Solar Array first, then Factory (3000) and Spaceport (4000) from a
      // half-capacity homeworld's net income.
      expect(trace.factoryAt!, `${factionId} factory time`).toBeLessThan(120);
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(300);
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
      // 4000 credits + 600 raw at ~80 credits/s net (homeworld income minus
      // upkeep) plus other committed needs: about a minute.
      expect(trace.spaceportAt!, `${factionId} spaceport time`).toBeLessThan(120);
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

/*
 * Phase 3 scenarios: research, military production, fleet assembly,
 * fleet roles and strategic combat decisions. Battles are not resolved
 * by the harness; "contacts" record when an AI fleet shares a cell with
 * a hostile fleet (in game this starts a battle). Combat losses are
 * injected exactly the way StarMap.applyBattleResult writes them.
 */
const homeSystemOf = (data: StarMapData, factionId: string) =>
  data.starSystems.find((sy) => sy.planetsTiles.some((p) => p.id === homeworldOf(data)(factionId).id))!;

let nextTestFleetId = 900;
let nextTestShipId = 90000;
const playerFleet = (x: number, y: number, type: string, count: number): Fleet => ({
  id: nextTestFleetId++,
  name: `TEST-${type}`,
  factionId: 'player',
  x,
  y,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  destroyed: false,
  sensorRange: 3,
  ships: Array.from({ length: count }, (_, k) => ({ id: nextTestShipId++, name: `${type}-${k}`, type })),
});

/* Offset (dx, dy) from a system, clamped inside the map. */
const near = (data: StarMapData, system: { x: number; y: number }, dx: number, dy: number) => ({
  x: Math.max(2, Math.min(data.map.width - 2, system.x + dx)),
  y: Math.max(2, Math.min(data.map.height - 2, system.y + dy)),
});

describe('AI simulation — Phase 3 research and military operations', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('two AIs research many technologies over 15 minutes, respecting prerequisites and costs, and field heavier hulls', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 900, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);
    const research = TestBed.inject(EnemyResearchService);
    const researchService = TestBed.inject(ResearchService);
    const ships = TestBed.inject(ShipService);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const faction = result.data.factions.find((f) => f.id === factionId)!;
      const history = research.getResearchHistory(factionId);
      expect(history.length, `${factionId} technologies researched`).toBeGreaterThanOrEqual(8);
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
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.fleetsCreated, `${factionId} fleets created`).toBeGreaterThanOrEqual(1);
      expect(trace.reinforcements, `${factionId} reinforcements`).toBeGreaterThanOrEqual(1);
      const stock = result.data.shipStock?.find((st) => st.factionId === factionId)?.ships ?? [];
      expect(stock.filter((sh) => sh.type !== 'colonizer').length, `${factionId} undeployed combat ships`).toBeLessThanOrEqual(2);
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
        .reduce((sum, f) => sum + ships().calculateFleetStrength(f.ships.filter((sh) => sh.type !== 'colonizer')), 0);
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
                const combat = fleet.ships.filter((sh) => !sh.destroyed && sh.type !== 'colonizer');
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

/*
 * Phase 4 scenarios: planet capture, war resolution and game outcomes.
 * Targets are prepared deterministically next to an AI home system. AI
 * assaults on non-player planets are auto-resolved in game; assaults on
 * player planets go to the battle screen, which the harness replaces with
 * the same auto-resolver (a stand-in for the player choosing AUTO).
 */
type Planet = StarMapData['starSystems'][0]['planetsTiles'][0];

/* The nearest system to `factionId`'s home that nobody owns yet. */
const nearestFreeSystem = (data: StarMapData, factionId: string, skip: string[] = []) => {
  const home = homeSystemOf(data, factionId);
  return data.starSystems
    .filter((sy) => sy.id !== home.id && !skip.includes(sy.id))
    .filter((sy) => sy.planetsTiles.every((p) => p.factionId === 'unhabited'))
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
};

const turrets = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: 'Laser Turret', size: 1, x: i % 9, y: Math.floor(i / 9) + 4 }));

const occupy = (planet: Planet, owner: string, buildings: Planet['buildings'], hidden = true) => {
  planet.factionId = owner;
  planet.population = 300;
  // A Solar Array keeps an owned fixture planet energy-positive; without it
  // the turrets' consumption makes it rebel (economy rule) before any attack.
  planet.size = 'huge';
  planet.buildings = [...buildings, { name: 'Solar Array', size: 2, x: 9, y: 9 }];
  planet.explored = !hidden ? planet.explored : false;
};

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
      size: 'medium', aiCount: 2, seconds: 400, dt: 1 / 60, removePlayerFleets: true,
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

/*
 * Phase 5: strategic intelligence, multiple objectives, deadlock recovery
 * and a repeatable evaluation across map sizes, difficulties, faction
 * counts and personalities. Fixed seeds; assertions are on measurable
 * properties, not on identical strategic outcomes.
 */
interface LeagueRow {
  factionId: string;
  personality: string;
  difficulty: string;
  planetsStart: number;
  planetsEnd: number;
  colonizations: number;
  captures: number;
  techs: number;
  combatBuilt: number;
  combatLost: number;
  creditsSpent: number;
  creditsEarned: number;
  deadlocks: number;
  inactiveWindows: number;
  livingStrength: number;
  /* Time of the last technology bought (the whole tree when techs = 31). */
  treeCompletedAt: number;
  /* Sum of base research costs of everything researched (research volume). */
  researchVolume: number;
  priorities: Record<string, number>;
}

function leagueRows(result: ScenarioResult, options: ScenarioOptions, windowSeconds = 300): LeagueRow[] {
  const events = TestBed.inject(EnemyProgressService).getEvents();
  const rows: LeagueRow[] = [];
  for (const [factionId, trace] of result.traces) {
    const faction = result.data.factions.find((f) => f.id === factionId)!;
    const ships = result.data.fleets.filter((f) => f.factionId === factionId).flatMap((f) => f.ships);
    const activity = [...trace.buildTimes, ...trace.combatProducedTimes, ...trace.researchTimes,
      ...result.ownershipChanges.filter((c) => c.to === factionId).map((c) => c.time)];
    let inactiveWindows = 0;
    for (let start = 0; start + windowSeconds <= options.seconds; start += windowSeconds) {
      if (!activity.some((t) => t >= start && t < start + windowSeconds)) inactiveWindows++;
    }
    const priorities: Record<string, number> = {};
    for (const p of trace.priorities) priorities[p] = (priorities[p] ?? 0) + 1;
    const creditsEnd = faction.currencies['credits'] ?? 0;
    rows.push({
      factionId,
      personality: trace.personality,
      difficulty: faction.aiDifficulty ?? 'normal',
      planetsStart: trace.startPlanets,
      planetsEnd: ownedPlanets(result.data, factionId).length,
      colonizations: trace.colonizations,
      captures: result.ownershipChanges.filter((c) => c.to === factionId && c.from !== 'unhabited').length,
      techs: (faction.researchedTechnologies ?? []).length,
      combatBuilt: trace.combatShipsProduced,
      combatLost: ships.filter((sh) => sh.destroyed && sh.type !== 'colonizer').length,
      creditsSpent: Math.round(trace.creditsSpent),
      creditsEarned: Math.round(creditsEnd - trace.startCredits + trace.creditsSpent),
      deadlocks: events.filter((e) => e.factionId === factionId && e.type !== 'saturated').length,
      inactiveWindows,
      treeCompletedAt: Math.round(trace.researchTimes.at(-1) ?? options.seconds),
      researchVolume: (faction.researchedTechnologies ?? [])
        .reduce((sum, id) => sum + (TestBed.inject(ResearchService).getTechnology(id)?.researchCost ?? 0), 0),
      livingStrength: Math.round(TestBed.inject(ShipService).calculateFleetStrength(
        result.data.fleets.filter((f) => f.factionId === factionId && !f.destroyed).flatMap((f) => f.ships),
      )),
      priorities,
    });
  }
  return rows;
}

const withPersonalities = (personalities: string[]) => (data: StarMapData) => {
  data.factions.filter((f) => f.ai).forEach((f, i) => (f.aiPersonality = personalities[i % personalities.length] as never));
};

describe('AI simulation — Phase 5 strategy, multiple objectives and evaluation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps colonizing while defending against a significant threat (parallel objectives)', () => {
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        withPersonalities(['balanced'])(data);
        // Two cruisers parked 4 cells from enemy1's home: a 'defend' strategy trigger.
        const home = homeSystemOf(data, 'enemy1');
        const pos = near(data, home, 4, 0);
        data.fleets.push(playerFleet(pos.x, pos.y, 'cruiser', 2));
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const trace = result.traces.get('enemy1')!;
    // The pipeline spent time in 'defend' (the strategy that used to cancel colonization).
    expect(trace.strategies.filter((st) => st === 'defend').length, 'defend strategy active').toBeGreaterThan(0);
    expect(trace.colonizations, 'enemy1 colonized in parallel').toBeGreaterThanOrEqual(2);
    // The defense objective ran too: the intruder was engaged.
    expect(trace.contacts.length, 'enemy1 engaged the intruder').toBeGreaterThan(0);
  });

  it('detects a fleet that cannot complete its order and replans instead of waiting forever', () => {
    const options: ScenarioOptions = {
      size: 'medium', aiCount: 2, seconds: 300, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        // A crippled fleet (speed 0) away from home will be ordered to garrison but can never move.
        const fleet = data.fleets.find((f) => f.factionId === 'enemy1')!;
        fleet.speed = 0;
        fleet.x += 9;
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const stuck = TestBed.inject(EnemyProgressService).getEvents().filter((e) => e.factionId === 'enemy1' && e.type === 'stuck_fleet');
    expect(stuck.length, 'stuck fleet detected').toBeGreaterThan(0);
    // Detection is throttled (one per stuck window), not every frame.
    expect(stuck.length).toBeLessThanOrEqual(300 / 30 + 1);
    // The rest of the faction keeps making progress.
    expect(result.traces.get('enemy1')!.colonizations).toBeGreaterThanOrEqual(1);
  });

  it('evaluation league: every faction stays active, grows, researches and avoids deadlocks across sizes, difficulties and counts', () => {
    const configs: ScenarioOptions[] = [
      { size: 'small', aiCount: 2, seconds: 900, dt: 1 / 30, difficulty: 'easy' },
      { size: 'small', aiCount: 2, seconds: 900, dt: 1 / 30, difficulty: 'hard' },
      { size: 'medium', aiCount: 3, seconds: 1200, dt: 1 / 30 },
      { size: 'large', aiCount: 5, seconds: 900, dt: 1 / 30, seed: 4242 },
    ];
    const totals = new Map<string, number>();
    for (const options of configs) {
      const result = runScenario({ resolvePlayerFleetBattles: true, ...options });
      expectHealthyAiFactions(result, options);
      const rows = leagueRows(result, options);
      const label = `${options.size}/${options.aiCount}/${options.difficulty ?? 'normal'}`;
      for (const row of rows) {
        const who = `${label} ${row.factionId} (${row.personality})`;
        expect(row.inactiveWindows, `${who} inactive 5-minute windows`).toBe(0);
        expect(row.planetsEnd, `${who} planet growth`).toBeGreaterThan(row.planetsStart);
        // Research costs are balanced for a ~30–40 minute tree (research-tree.json).
        expect(row.techs, `${who} technologies`).toBeGreaterThanOrEqual(8);
        expect(row.deadlocks, `${who} deadlock replans`).toBeLessThanOrEqual(3);
        expect(row.creditsSpent, `${who} spends resources`).toBeGreaterThan(0);
      }
      // End state, not effort: Easy starts with fewer ships and therefore builds more.
      totals.set(label, rows.reduce((sum, r) => sum + r.planetsEnd * 10 + r.techs + r.livingStrength / 50, 0));
    }
    // Same map and seed: Hard (better judgment + income) outperforms Easy.
    expect(totals.get('small/2/hard')!).toBeGreaterThan(totals.get('small/2/easy')!);
  });

  it('regression: on a sparse large map every faction keeps expanding (adaptive reach)', () => {
    // Seed 4242 (large, 5 AIs) left two factions with nothing in the fixed
    // 60-cell reach: one colony each in 15 minutes, then 'develop' forever.
    const options: ScenarioOptions = { size: 'large', aiCount: 5, seconds: 1200, dt: 1 / 30, seed: 4242 };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const reach = TestBed.inject(EnemyReachService);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(2);
    }
    expect([...result.traces.keys()].some((id) => reach.getBonus(id) > 1), 'some faction widened its reach').toBe(true);
  });

  it('personalities produce different, valid strategies on the same map', () => {
    const run = (personality: string) => {
      const options: ScenarioOptions = {
        // Compares personalities in isolation: a war between the two AIs
        // (random winner, lost colonies) would dominate the differences.
        aiAlliance: true,
        size: 'medium', aiCount: 2, seconds: 900, dt: 1 / 30, removePlayerFleets: true,
        prepare: withPersonalities([personality]),
      };
      const result = runScenario(options);
      expectHealthyAiFactions(result, options);
      return leagueRows(result, options);
    };
    const militarist = run('militarist');
    const expansionist = run('expansionist');
    const technologist = run('technologist');
    const sum = (rows: LeagueRow[], key: keyof LeagueRow) => rows.reduce((total, r) => total + (r[key] as number), 0);

    expect(sum(militarist, 'combatBuilt'), 'militarists build more warships').toBeGreaterThan(sum(expansionist, 'combatBuilt'));
    expect(sum(expansionist, 'colonizations'), 'expansionists colonize at least as much').toBeGreaterThanOrEqual(sum(militarist, 'colonizations'));
    expect(sum(technologist, 'techs'), 'technologists research at least as much').toBeGreaterThanOrEqual(sum(militarist, 'techs'));
    // The tree takes ~30–40 minutes (research-tree.json costs), so a 15-minute
    // game compares an early milestone: technologists reach it sooner.
    // Research cost grows with every technology, so "first to N technologies"
    // rewards buying cheap ones; research volume (base cost acquired) is the
    // measure of research investment.
    expect(sum(technologist, 'researchVolume'), 'technologists research more').toBeGreaterThan(sum(militarist, 'researchVolume'));
  });
});

/*
 * Phase 6: long-duration stability, bounded AI state and performance with
 * the maximum number of factions (1 human + 5 AIs on a large map). All
 * runs use fog of war (the default), checked for violations every second.
 */
interface AiStateSizes {
  sightings: number;
  knownSystems: number;
  assignments: number;
  peakStrength: number;
  assaultReports: number;
  progressEvents: number;
  fleetMotion: number;
  carrierTargets: number;
  failedTargets: number;
}

function aiStateSizes(): AiStateSizes {
  const intel = TestBed.inject(EnemyIntelService) as any;
  const fleetOps = TestBed.inject(EnemyFleetService) as any;
  const progress = TestBed.inject(EnemyProgressService) as any;
  const actions = TestBed.inject(EnemyActionService) as any;
  const goals = TestBed.inject(EnemyGoalService) as any;
  const intelStates = [...intel.intel.values()] as any[];
  return {
    sightings: intelStates.reduce((n, s) => n + s.sightings.size, 0),
    knownSystems: intelStates.reduce((n, s) => n + s.knownSystems.size, 0),
    assignments: fleetOps.assignments.size,
    peakStrength: fleetOps.peakStrength.size,
    assaultReports: fleetOps.assaultReports.length,
    progressEvents: progress.events.length,
    fleetMotion: progress.fleetMotion.size,
    carrierTargets: actions.carrierTargets.size,
    failedTargets: [...goals.failedColonizeTargets.values()].reduce((n: number, m: Map<number, number>) => n + m.size, 0),
  };
}

describe('AI simulation — Phase 6 long-duration stability and performance', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const longRun = (options: ScenarioOptions) => {
    const result = runScenario({ resolvePlayerFleetBattles: true, continueAfterOutcome: true, ...options });
    expectHealthyAiFactions(result, options);
    const rows = leagueRows(result, options, 600);
    for (const row of rows) {
      const who = `${options.size} ${row.factionId} (${row.personality}/${row.difficulty})`;
      expect(row.inactiveWindows, `${who} inactive 10-minute windows`).toBe(0);
      expect(row.planetsEnd, `${who} planets`).toBeGreaterThan(row.planetsStart);
      // Research costs target a ~30–40 minute tree, and labs compete with
      // warships for upkeep headroom, so research-light personalities on Easy
      // finish about half the tree in 40 minutes.
      expect(row.techs, `${who} technologies`).toBeGreaterThanOrEqual(15);
      expect(row.deadlocks, `${who} deadlock replans`).toBeLessThanOrEqual(6);
    }
    // Bounded AI state: nothing grows with game time beyond the entity counts.
    const sizes = aiStateSizes();
    const living = result.data.fleets.filter((f) => !f.destroyed).length;
    expect(sizes.sightings).toBeLessThanOrEqual(result.data.fleets.length);
    expect(sizes.knownSystems).toBeLessThanOrEqual(result.data.starSystems.length * options.aiCount);
    expect(sizes.assignments).toBeLessThanOrEqual(living);
    expect(sizes.fleetMotion).toBeLessThanOrEqual(living);
    expect(sizes.progressEvents).toBeLessThanOrEqual(200);
    expect(sizes.assaultReports).toBeLessThanOrEqual(200);
    expect(sizes.carrierTargets).toBeLessThanOrEqual(options.aiCount * 2);
    return { result, rows, sizes };
  };

  it('AT-12: 40-minute games on small, medium and large maps stay healthy and keep progressing', () => {
    longRun({ size: 'small', aiCount: 2, seconds: 2400, dt: 1 / 30, difficulty: 'hard' });
    longRun({ size: 'medium', aiCount: 3, seconds: 2400, dt: 1 / 30 });
    longRun({ size: 'large', aiCount: 5, seconds: 2400, dt: 1 / 30, seed: 4242, difficulty: 'easy' });
  }, 120_000);

  it('AT-15: performance with the maximum number of factions and entities', () => {
    const { result } = longRun({ size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30 });
    const ships = result.data.fleets.filter((f) => !f.destroyed).reduce((n, f) => n + f.ships.filter((s) => !s.destroyed).length, 0);
    const planets = result.data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId !== 'unhabited').length;
    expect(ships, 'entity count reached').toBeGreaterThan(150);
    expect(planets).toBeGreaterThan(15);
    // Measured AI cost per frame (all five factions together).
    expect(result.aiTickMs.perFrame, 'average AI ms per frame').toBeLessThan(2);
    expect(result.aiTickMs.max, 'worst AI frame (ms)').toBeLessThan(100);
  }, 60_000);
});

/*
 * Economy validation: runs long multi-faction games and reports per-faction
 * economic metrics (printed via console.info, which the suites do not mock).
 * The assertions encode the economy's design goals: factions keep
 * expanding, actually spend a meaningful share of their income, never sit
 * in upkeep arrears for long, and the research tree is not exhausted early.
 */
interface EconomyRow {
  who: string;
  planets: string;
  credits: number;
  raw: number;
  grossIncome: number;
  upkeep: number;
  spent: number;
  spendShare: number;
  rawSpent: number;
  built: number;
  ships: number;
  techs: number;
  tech10At: number | null;
  tech20At: number | null;
  failedOrders: number;
  arrearsTicks: number;
  rebellions: number;
  /* Time all technologies of a prerequisite depth were researched (null = not within the run). */
  tier1DoneAt: number | null;
  tier2DoneAt: number | null;
  treeDoneAt: number | null;
  firstPicks: string;
  /* Technologies still unresearched at the end of the run. */
  missing: string;
}

/* Prerequisite depth of each technology (starting technologies: 0). */
function technologyDepths(): Map<string, number> {
  const research = TestBed.inject(ResearchService);
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    const tech = research.getTechnology(id)!;
    const d = tech.prerequisites.length === 0 ? 0 : 1 + Math.max(...tech.prerequisites.map(depthOf));
    depths.set(id, d);
    return d;
  };
  research.getAllTechnologies().forEach((t) => depthOf(t.id));
  return depths;
}

function researchMilestones(factionId: string, trace: FactionTrace): Pick<EconomyRow, 'tier1DoneAt' | 'tier2DoneAt' | 'treeDoneAt' | 'firstPicks' | 'missing'> {
  const history = trace.researchOrder;
  const depths = technologyDepths();
  const doneAt = (maxDepth: number): number | null => {
    const needed = [...depths].filter(([, d]) => d >= 1 && d <= maxDepth).map(([id]) => id);
    const indices = needed.map((id) => history.indexOf(id));
    if (indices.some((i) => i < 0)) return null;
    return Math.round(trace.researchOrderTimes[Math.max(...indices)]);
  };
  return {
    tier1DoneAt: doneAt(1),
    tier2DoneAt: doneAt(2),
    treeDoneAt: doneAt(99),
    firstPicks: history.slice(0, 6).join(','),
    missing: [...depths.keys()].filter((id) => depths.get(id)! > 0 && !history.includes(id)).join(','),
  };
}

function economyRows(result: ScenarioResult, label: string): EconomyRow[] {
  return [...result.traces].map(([factionId, trace]) => {
    const faction = result.data.factions.find((f) => f.id === factionId)!;
    return {
      who: `${label} ${factionId} (${trace.personality})`,
      planets: `${trace.startPlanets}->${ownedPlanets(result.data, factionId).length}`,
      credits: Math.round(faction.currencies['credits'] ?? 0),
      raw: Math.round(faction.currencies['rawmaterials'] ?? 0),
      grossIncome: Math.round(trace.grossIncome),
      upkeep: Math.round(trace.upkeepCharged),
      spent: Math.round(trace.creditsSpent),
      spendShare: Math.round((trace.creditsSpent / Math.max(1, trace.grossIncome)) * 100),
      rawSpent: Math.round(trace.rawSpent),
      built: trace.buildTimes.length,
      ships: trace.combatShipsProduced + trace.colonizersProduced,
      techs: (faction.researchedTechnologies ?? []).length,
      tech10At: trace.researchTimes[5] !== undefined ? Math.round(trace.researchTimes[5]) : null,
      tech20At: trace.researchTimes[15] !== undefined ? Math.round(trace.researchTimes[15]) : null,
      failedOrders: trace.failedOrders,
      arrearsTicks: trace.arrearsTicks,
      ...researchMilestones(factionId, trace),
      rebellions: result.ownershipChanges.filter((c) => c.from === factionId && c.to === 'independent').length,
    };
  });
}

describe('AI simulation — economy validation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('long multi-faction games: factions expand, spend a meaningful share of income and research steadily', () => {
    const configs: ScenarioOptions[] = [
      { size: 'medium', aiCount: 3, seconds: 1800, dt: 1 / 30 },
      { size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30, seed: 4242 },
    ];
    const rows: EconomyRow[] = [];
    for (const options of configs) {
      const result = runScenario(options);
      expectHealthyAiFactions(result, options);
      rows.push(...economyRows(result, `${options.size}/${options.aiCount}`));
    }
    for (const row of rows) {
      // Expansion stays viable under upkeep and administration costs.
      expect(Number(row.planets.split('->')[1]), `${row.who} planets`).toBeGreaterThan(Number(row.planets.split('->')[0]));
      // Purchases are a real share of income (the old economy: 3–5%), and
      // purchases + upkeep consume most of it (the old economy: 3–5% total).
      expect(row.spendShare, `${row.who} purchase share of gross income %`).toBeGreaterThanOrEqual(8);
      expect((row.spent + row.upkeep) / row.grossIncome, `${row.who} total outflow share`).toBeGreaterThan(0.6);
      // The AI's own spending never drives it into persistent arrears.
      expect(row.arrearsTicks, `${row.who} ticks in arrears`).toBeLessThanOrEqual(10);
      // Raw materials are consumed, and production orders are only placed when affordable.
      expect(row.rawSpent, `${row.who} raw materials spent`).toBeGreaterThan(0);
      expect(row.failedOrders, `${row.who} rejected production orders`).toBe(0);
      // Research is long-term: the 20th technology takes more than 10 minutes
      // (the old economy: ~3.5 minutes for the whole tree).
      if (row.tech20At !== null) {
        expect(row.tech20At, `${row.who} 20th technology time`).toBeGreaterThan(600);
      }
      // Research progression: early technologies arrive within the first
      // ~15 minutes, the full tree takes a long session (not minutes).
      expect(row.techs, `${row.who} technologies after 30 minutes`).toBeGreaterThanOrEqual(15);
      if (row.treeDoneAt !== null) {
        expect(row.treeDoneAt, `${row.who} full tree time`).toBeGreaterThan(1200);
      }
    }
    // Personalities research differently: not every faction picks the same first technologies.
    expect(new Set(rows.map((r) => r.firstPicks)).size, 'distinct research openings').toBeGreaterThan(1);
    // console.log is mocked in these suites and console.info is swallowed by
    // the Angular test builder, so the report goes straight to stdout.
    (globalThis as any).process?.stdout?.write(`ECONOMY METRICS ${JSON.stringify(rows)}\n`);
  }, 180_000);
});


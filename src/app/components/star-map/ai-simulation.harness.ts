import { TestBed } from '@angular/core/testing';
import { expect, vi } from 'vitest';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { ProductionService } from '../../services/production.service';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { AiDifficulty, Faction, GalaxySize, StarMapData } from './star-map.models';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { TradeNetworkService, TraderRaid } from './trade-network.service';
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
import { ensurePlanetResources } from './star-map-resources.util';
import { getPlanetGridSize } from './star-map-display.util';
import { areFactionsHostile, getFactionWarExhaustion, getRelationKind, normalizeRelations } from './diplomacy';
import { getAiPersonalityProfile } from './ai-personality';
import { DiplomacyService } from '../../services/diplomacy.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { BattleService } from '../../services/battle.service';
import { OUTPOST_SHIP_TYPE } from './space-base';
import { advanceMiningStationConstruction } from './station-construction';
import { advanceBuildingConstruction, planetConstructionSpeed } from './building-construction';
import { SpaceBaseService } from './space-base.service';
import { FleetRepairService } from './fleet-repair.service';
import { OPENING_GRACE_SECONDS } from './opening-grace';
import { PIRATE_CONFIG, PIRATE_FACTION_ID, PirateIncursionService } from './pirate-incursion';
import { DysonRingService } from './dyson-ring.service';
import { DysonVictoryService } from './dyson-victory.service';
import { AiActionLedger, AiActionReport } from './ai-action-ledger';

/*
 * Shared harness of the AI simulation specs (ai-simulation*.spec.ts):
 * scenario generation, the headless game loop (runScenario) and the
 * report/assertion helpers. Test-only code: excluded from the app build
 * (tsconfig.app.json). The specs are split into several files only so
 * Vitest can run them in parallel; *.long.spec.ts files hold the
 * multi-minute games and run only with `npm run test:long`.
 */

/* Non-combat hulls: colonizers and outpost ships (consumed when used). */
// Civilian ships are consumed by their mission (colony, station, Dyson anchor); combat accounting skips them.
export const isCivilianShip = (type: string) => type === 'colonizer' || type === OUTPOST_SHIP_TYPE || type === 'swarm_constructor';

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

export interface ScenarioOptions {
  size: GalaxySize;
  aiCount: number;
  seconds: number;
  /* Fixed frame delta, or 'jitter' for a deterministic 30–120 fps mix. */
  dt: number | 'jitter';
  /*
   * Generate independent civilizations (default off: these scenarios predate
   * them and assert AI behavior on the regular galaxy; how the AI treats
   * civilizations is covered separately).
   */
  civilizations?: boolean;
  removePlayerFleets?: boolean;
  difficulty?: AiDifficulty;
  seed?: number;
  /* JSON round-trip the game state and reset the AI pipeline at this time. */
  saveLoadAtSecond?: number;
  /* Deterministic fixture changes applied to the generated galaxy. */
  prepare?: (data: StarMapData) => void;
  /*
   * Saved game clock at the start (default 0, a new game). Scenarios that
   * study AI aggression toward the player from the first frame start after
   * the opening grace (opening-grace.ts).
   */
  startGameSeconds?: number;
  /* Run the pirate incursion event like StarMap does (pirate-incursion.ts); off by default. */
  pirates?: boolean;
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
  /* Called after every simulated frame (measurement hooks, e.g. the Dyson Swarm run). */
  onFrame?: (data: StarMapData, time: number) => void;
}

export interface FactionTrace {
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
  /* Game seconds at war with at least one living AI empire (warlike temperaments, docs/diplomacy.md). */
  aiWarSeconds: number;
  /* Highest war exhaustion against anyone during the run. */
  peakExhaustion: number;
  /* Researched technology ids in order, with researchOrderTimes[i] = when. */
  researchOrder: string[];
  researchOrderTimes: number[];
}

export interface OwnershipChange {
  time: number;
  planetId: number;
  from: string;
  to: string;
}

export interface ScenarioResult {
  data: StarMapData;
  /* Traders destroyed by raids (the harness runs the trade network like StarMap). */
  traderRaids: (TraderRaid & { time: number })[];
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
  /* Pirate incursion notices with their game time (only with options.pirates). */
  pirateLog: { time: number; text: string }[];
}

export const AI_COLORS = ['#d65757', '#39b8a8', '#b07cff', '#7bd66b', '#ff9a3c', '#ff6fcf'];

export function generate(options: ScenarioOptions): StarMapData {
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
  const data = TestBed.inject(GalaxyGeneratorService).generate(config, options.seed ?? 31337, {
    civilizations: options.civilizations ?? false,
  });
  // Mirrors StarMap.ensureResourceTiles on load: ore deposits on ~20% of
  // planets plus every homeworld, each with its finite reserve.
  ensurePlanetResources(data.starSystems.flatMap((s) => s.planetsTiles), getPlanetGridSize);
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

export function ownedPlanets(data: StarMapData, factionId: string) {
  return data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === factionId);
}

export const RESEARCH_BUILDINGS = ['Small Research Laboratory', 'Research Laboratory'];

export function hasBuilding(data: StarMapData, factionId: string, names: string[]): boolean {
  return ownedPlanets(data, factionId).some((p) => p.buildings.some((b) => names.includes(b.name)));
}

/* AI-owned planets that gained at least one building during the run. */
export function developedPlanetCount(data: StarMapData, factionId: string, trace: FactionTrace): number {
  return ownedPlanets(data, factionId).filter((p) => p.buildings.length > (trace.initialBuildings.get(p.id) ?? 0)).length;
}

export function homeworldOf(data: StarMapData): (factionId: string) => StarMapData['starSystems'][0]['planetsTiles'][0] {
  return (factionId) => ownedPlanets(data, factionId).find((p) => p.buildings.some((b) => b.name === 'Capital'))!;
}

export function runScenario(options: ScenarioOptions): ScenarioResult {
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
    const homeworld = planets.find((p) => p.buildings.some((b) => b.name === 'Capital')) ?? planets[0] ?? { id: -1 };
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
        .filter((sh) => !isCivilianShip(sh.type)).length,
      contacts: [],
      grossIncome: 0,
      upkeepCharged: 0,
      startRaw: faction.currencies['rawmaterials'] ?? 0,
      rawSpent: 0,
      failedOrders: 0,
      arrearsTicks: 0,
      aiWarSeconds: 0,
      peakExhaustion: 0,
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
  const pirates = TestBed.inject(PirateIncursionService);
  pirates.restore(undefined, options.seed ?? 31337);
  const pirateLog: { time: number; text: string }[] = [];
  let lastActivityCount = 0;
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
  // Mirrors StarMap: the civilian trade network runs every frame.
  const tradeNetwork = TestBed.inject(TradeNetworkService);
  // Like StarMap.loadGame: the Dyson ring is derived from the black hole.
  TestBed.inject(DysonRingService).configure(data.specialObjects);
  tradeNetwork.restore(data.tradeNetwork, data.galaxy?.seed ?? 0, data.starSystems);
  const traderRaids: (TraderRaid & { time: number })[] = [];
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
  const livingCombat = (fleet: Fleet) => fleet.ships.filter((sh) => !sh.destroyed && !isCivilianShip(sh.type)).length;
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
      tradeNetwork.restore(tradeNetwork.serialize(), data.galaxy?.seed ?? 0, data.starSystems);
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
    // Station battles (space bases incl. Dyson anchors, mining stations), as
    // StarMap.updateFleets runs them after fleet battles. AI vs AI is
    // auto-resolved inside; the passive stand-in player owns no stations, so
    // a station battle with the player never happens here.
    const stationBattleScreen = () => TestBed.inject(BattleService).clearBattle();
    battleDetection.checkBaseBattles(data.fleets, data.factions, stationBattleScreen, triggeredBattles, () => {
      aiBattles++;
    });
    battleDetection.checkMiningStationBattles(data.fleets, data.factions, data.starSystems, stationBattleScreen, triggeredBattles, () => {
      aiBattles++;
    });
    // Station construction advances like in StarMap.updateStationConstruction.
    TestBed.inject(SpaceBaseService).advanceConstruction(dt);
    advanceMiningStationConstruction(data.starSystems, dt);
    // Planetary building sites, like StarMap.updateStationConstruction (building-construction.ts).
    const researchForSpeed = TestBed.inject(ResearchService);
    advanceBuildingConstruction(data.starSystems, dt, (planet) => planetConstructionSpeed(
      planet,
      researchForSpeed.getModifiers(data.factions.find((f) => f.id === planet.factionId) ?? null).buildingConstructionSpeed,
    ));
    // Like StarMap.updateFleetRepair (which batches into 0.5 s steps; the rule is linear in time).
    TestBed.inject(FleetRepairService).step(
      { fleets: data.fleets, shipStock: data.shipStock, factions: data.factions, starSystems: data.starSystems },
      dt,
    );
    // Like StarMap.updateDysonSwarm: the Dyson warm-up counts down (no outcome check here).
    TestBed.inject(DysonVictoryService).tick(dt, data.starSystems);
    for (const raid of tradeNetwork.tick(dt, { starSystems: data.starSystems, factions: data.factions, fleets: data.fleets }).raids) {
      traderRaids.push({ ...raid, time });
    }
    const creditsBeforeTick = new Map(data.factions.map((f) => [f.id, f.currencies['credits'] ?? 0] as const));
    const rawBeforeTick = new Map(data.factions.map((f) => [f.id, f.currencies['rawmaterials'] ?? 0] as const));
    const techsBeforeTick = new Map(data.factions.map((f) => [f.id, (f.researchedTechnologies ?? []).length] as const));
    const tickStart = performance.now();
    if (options.pirates) {
      // Activity like StarMap: battles and ownership changes involving the player.
      const activity = playerBattles.length + ownershipChanges.filter((c) => c.from === 'player' || c.to === 'player').length;
      if (activity !== lastActivityCount) {
        lastActivityCount = activity;
        pirates.noteActivity(time);
      }
      for (const text of pirates.tick(dt, {
        gameSeconds: time, factions: data.factions, fleets: data.fleets, starSystems: data.starSystems,
        shipStock: data.shipStock, mapWidth: data.map.width, mapHeight: data.map.height,
      })) {
        pirateLog.push({ time, text });
      }
    }
    const changed = aiTick.tick(dt, {
      fleets: data.fleets,
      factions: data.factions,
      starSystems: data.starSystems,
      shipStock: data.shipStock!,
      production: data.production!,
      gameSeconds: time + (options.startGameSeconds ?? 0),
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
      if (ships.typeId === OUTPOST_SHIP_TYPE || ships.typeId === 'swarm_constructor') {
        // Outpost ships (EnemyMiningService) and Swarm Constructors
        // (EnemyDysonService) are consumed by their stations; they are
        // neither colonizers nor combat ships.
      } else if (ships.typeId === 'colonizer') {
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
          const aiWar = data.factions.some(
            (o) => o.ai === true && o.id !== faction.id && getRelationKind(faction, o) === 'war' && ownedPlanets(data, o.id).length > 0,
          );
          if (aiWar) trace.aiWarSeconds += economyAccumulator;
          trace.peakExhaustion = Math.max(trace.peakExhaustion, getFactionWarExhaustion(faction));
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

    // Outcome check on ownership changes, as StarMap.gameLoopCallback does,
    // and when a Dyson warm-up completes (StarMap.updateDysonSwarm).
    const dysonWarmup = TestBed.inject(DysonVictoryService).serialize();
    if (ownership.revision !== lastRevision || (dysonWarmup && dysonWarmup.remaining <= 0)) {
      lastRevision = ownership.revision;
      outcome = outcomes.evaluate({ ...data, gameOutcome: outcome, dysonWarmup });
      if (outcome !== 'inProgress' && outcomeAt === null) outcomeAt = time;
    }
    options.onFrame?.(data, time);

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
    data, traderRaids, frames, changedFrames, traces, colonizerFleetHijacks, ownershipChanges, playerBattles, outcome, outcomeAt, fogViolations, aiBattles, pirateLog,
    aiTickMs: { total: aiTickTotal, max: aiTickMax, perFrame: aiTickTotal / Math.max(1, frames) },
  };
}

export function expectHealthyAiFactions(result: ScenarioResult, options: ScenarioOptions): void {
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
    const combatNow = [...fleetShips, ...stockShips].filter((sh) => !isCivilianShip(sh.type)).length;
    expect(combatNow, `${factionId} combat ship accounting`).toBe(trace.initialCombatShips + trace.combatShipsProduced);
  }

  // Colonizer fleets keep their strategic destination.
  expect(result.colonizerFleetHijacks).toBe(0);
  // Decisions only use knowledge the faction legitimately has.
  expect(result.fogViolations.slice(0, 5), 'fog-of-war violations ' + JSON.stringify(result.fogViolations.slice(0, 5))).toEqual([]);

  // "State changed" must not be reported on (almost) every frame.
  expect(result.changedFrames / result.frames).toBeLessThan(0.05);
}

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
export const stripToResidential = (data: StarMapData): void => {
  for (const faction of data.factions.filter((f) => f.ai)) {
    const home = homeworldOf(data)(faction.id);
    // The Capital stays: core buildings are never removed (colony-core.ts).
    home.buildings = [
      ...home.buildings.filter((b) => b.name === 'Capital'),
      { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
    ];
    // Enough for one power building (Solar Array: 600 credits). With an
    // energy deficit the homeworld earns nothing, so less than that would
    // be an unwinnable start under the economy rules, not an AI test.
    faction.currencies['credits'] = 1000;
  }
};

/*
 * Phase 3 scenarios: research, military production, fleet assembly,
 * fleet roles and strategic combat decisions. Battles are not resolved
 * by the harness; "contacts" record when an AI fleet shares a cell with
 * a hostile fleet (in game this starts a battle). Combat losses are
 * injected exactly the way StarMap.applyBattleResult writes them.
 */
export const homeSystemOf = (data: StarMapData, factionId: string) =>
  data.starSystems.find((sy) => sy.planetsTiles.some((p) => p.id === homeworldOf(data)(factionId).id))!;

export let nextTestFleetId = 900;
export let nextTestShipId = 90000;
export const playerFleet = (x: number, y: number, type: string, count: number): Fleet => ({
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
export const near = (data: StarMapData, system: { x: number; y: number }, dx: number, dy: number) => ({
  x: Math.max(2, Math.min(data.map.width - 2, system.x + dx)),
  y: Math.max(2, Math.min(data.map.height - 2, system.y + dy)),
});

/*
 * Phase 4 scenarios: planet capture, war resolution and game outcomes.
 * Targets are prepared deterministically next to an AI home system. AI
 * assaults on non-player planets are auto-resolved in game; assaults on
 * player planets go to the battle screen, which the harness replaces with
 * the same auto-resolver (a stand-in for the player choosing AUTO).
 */
export type Planet = StarMapData['starSystems'][0]['planetsTiles'][0];

/* The nearest system to `factionId`'s home that nobody owns yet. */
export const nearestFreeSystem = (data: StarMapData, factionId: string, skip: string[] = []) => {
  const home = homeSystemOf(data, factionId);
  return data.starSystems
    .filter((sy) => sy.id !== home.id && !skip.includes(sy.id))
    .filter((sy) => sy.planetsTiles.every((p) => p.factionId === 'unhabited'))
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
};

export const turrets = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: 'Laser Turret', size: 1, x: i % 9, y: Math.floor(i / 9) + 4 }));

export const occupy = (planet: Planet, owner: string, buildings: Planet['buildings'], hidden = true) => {
  planet.factionId = owner;
  planet.population = 300;
  // A Solar Array keeps an owned fixture planet energy-positive; without it
  // the turrets' consumption makes it rebel (economy rule) before any attack.
  planet.size = 'huge';
  planet.buildings = [...buildings, { name: 'Solar Array', size: 2, x: 9, y: 9 }];
  planet.explored = !hidden ? planet.explored : false;
};

/*
 * Phase 5: strategic intelligence, multiple objectives, deadlock recovery
 * and a repeatable evaluation across map sizes, difficulties, faction
 * counts and personalities. Fixed seeds; assertions are on measurable
 * properties, not on identical strategic outcomes.
 */
export interface LeagueRow {
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

export function leagueRows(result: ScenarioResult, options: ScenarioOptions, windowSeconds = 300): LeagueRow[] {
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

export const withPersonalities = (personalities: string[]) => (data: StarMapData) => {
  data.factions.filter((f) => f.ai).forEach((f, i) => (f.aiPersonality = personalities[i % personalities.length] as never));
};

/*
 * Phase 6: long-duration stability, bounded AI state and performance with
 * the maximum number of factions (1 human + 5 AIs on a large map). All
 * runs use fog of war (the default), checked for violations every second.
 */
export interface AiStateSizes {
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

export function aiStateSizes(): AiStateSizes {
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

/*
 * Economy validation: runs long multi-faction games and reports per-faction
 * economic metrics (printed via console.info, which the suites do not mock).
 * The assertions encode the economy's design goals: factions keep
 * expanding, actually spend a meaningful share of their income, never sit
 * in upkeep arrears for long, and the research tree is not exhausted early.
 */
export interface EconomyRow {
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
  /* Minutes at war with another AI empire, and the peak war exhaustion. */
  aiWarMinutes: number;
  peakExhaustion: number;
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
export function technologyDepths(): Map<string, number> {
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

export function researchMilestones(factionId: string, trace: FactionTrace): Pick<EconomyRow, 'tier1DoneAt' | 'tier2DoneAt' | 'treeDoneAt' | 'firstPicks' | 'missing'> {
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

export function economyRows(result: ScenarioResult, label: string): EconomyRow[] {
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
      aiWarMinutes: Math.round(trace.aiWarSeconds / 60),
      peakExhaustion: Math.round(trace.peakExhaustion),
      ...researchMilestones(factionId, trace),
      rebellions: result.ownershipChanges.filter((c) => c.from === factionId && c.to === 'independent').length,
    };
  });
}

/*
 * Dyson Swarm measurement (docs/dyson-swarm.md, phase 7): long games with a
 * technologist builder, a militarist hunter and a balanced empire. Reports
 * when Stellar Engineering arrives, how many anchors are built and lost,
 * what the swarm costs against income, and whether a warm-up starts.
 */
export interface DysonRow {
  who: string;
  stellarAt: number | null;
  constructorsOrdered: number;
  anchorsBuilt: number;
  anchorsLost: number;
  peakAnchors: number;
  finalAnchors: number;
  anchorUpkeepShare: number;
  credits: number;
  raw: number;
  grossIncomePerSecond: number;
  /* Game seconds at which each of the faction's anchors appeared. */
  anchorTimes: number[];
}

export function runDysonScenario(options: ScenarioOptions) {
  const bases = () => TestBed.inject(SpaceBaseService).bases.filter((b) => b.kind === 'dyson');
  const seen = new Map<number, string>();
  const anchorTimes = new Map<string, number[]>();
  const lost = new Map<string, number>();
  const peak = new Map<string, number>();
  const ordered = new Map<string, Set<number>>();
  let warmupsStarted = 0;
  let lastWarmup: string | null = null;
  const result = runScenario({
    ...options,
    onFrame: (data, time) => {
      const now = bases();
      const ids = new Set(now.map((b) => b.id));
      for (const [id, owner] of seen) {
        if (!ids.has(id)) {
          lost.set(owner, (lost.get(owner) ?? 0) + 1);
          seen.delete(id);
        }
      }
      for (const b of now) {
        if (!seen.has(b.id)) anchorTimes.set(b.factionId, [...(anchorTimes.get(b.factionId) ?? []), Math.round(time)]);
        seen.set(b.id, b.factionId);
      }
      const counts = new Map<string, number>();
      for (const b of now) counts.set(b.factionId, (counts.get(b.factionId) ?? 0) + 1);
      for (const [owner, count] of counts) peak.set(owner, Math.max(peak.get(owner) ?? 0, count));
      for (const p of data.production ?? []) {
        for (const order of Object.values(p.ordersByPlanet).flat()) {
          if (order.shipTypeId !== 'swarm_constructor') continue;
          const set = ordered.get(p.factionId) ?? new Set<number>();
          set.add(order.id);
          ordered.set(p.factionId, set);
        }
      }
      const warmup = TestBed.inject(DysonVictoryService).warmup;
      const key = warmup ? warmup.factionId : null;
      if (key && key !== lastWarmup) warmupsStarted++;
      lastWarmup = key;
    },
  });
  const economy = TestBed.inject(EconomyService);
  const built = new Map<string, number>();
  for (const owner of [...seen.values()]) built.set(owner, (built.get(owner) ?? 0) + 1);
  const rows: DysonRow[] = result.data.factions.filter((f) => f.ai).map((f) => {
    const breakdown = economy.calculateEconomy(f.id, result.data.factions, result.data.starSystems, result.data.fleets, result.data.shipStock);
    const anchors = bases().filter((b) => b.factionId === f.id && b.constructionRemaining === undefined).length;
    const rate = economy.getStationUpkeepRates(f, breakdown.upkeepScale).dysonAnchor;
    const trace = result.traces.get(f.id)!;
    const stellarIndex = trace.researchOrder.indexOf('stellar_engineering');
    return {
      who: `${f.id} (${f.aiPersonality})`,
      stellarAt: stellarIndex >= 0 ? Math.round(trace.researchOrderTimes[stellarIndex]) : null,
      constructorsOrdered: ordered.get(f.id)?.size ?? 0,
      anchorsBuilt: (built.get(f.id) ?? 0) + (lost.get(f.id) ?? 0),
      anchorsLost: lost.get(f.id) ?? 0,
      peakAnchors: peak.get(f.id) ?? 0,
      finalAnchors: anchors,
      anchorUpkeepShare: Math.round((100 * anchors * rate) / Math.max(1, breakdown.incomePerSecond)),
      credits: Math.round(f.currencies['credits'] ?? 0),
      raw: Math.round(f.currencies['rawmaterials'] ?? 0),
      anchorTimes: anchorTimes.get(f.id) ?? [],
      grossIncomePerSecond: Math.round(breakdown.incomePerSecond),
    };
  });
  return { result, rows, warmupsStarted };
}

/*
 * Late-game economy measurement (docs/late-economy.md). runEconomyScenario
 * samples every AI faction at minutes 30 / 60 / 90 and tracks the longest
 * negative-net streak, so the report and the acceptance test read the same
 * numbers. The report itself is opt-in (ORION_ECONOMY_REPORT=1) because it
 * runs two 90-minute games; the acceptance test runs by default.
 */
export interface EconomySample {
  minute: number;
  who: string;
  planets: number;
  population: number;
  income: number;
  /* Share of gross income that comes from population, %. */
  populationShare: number;
  net: number;
  /* Credits/s: buildings, administration, ships, stations. */
  expenses: number[];
  credits: number;
  /* Credit stock in minutes of gross income. */
  creditMinutes: number;
  raw: number;
  techs: number;
  avgSatisfaction: number;
  /* Average comfort coverage of planets above the free population, % (100 without such planets). */
  avgCoverage: number;
  /* The three most populous planets: type, population / capacity, comfort provided / need, satisfaction -> target, buildings. */
  top: string[];
}

export interface EconomySummary {
  who: string;
  personality: string;
  spaceportAt: number | null;
  firstColonyAt: number | null;
  colonizations: number;
  warships: number;
  arrearsTicks: number;
  failedOrders: number;
  rebellions: number;
  techs: number;
  /* Longest run of consecutive seconds with a negative net income. */
  longestNegativeNet: number;
  income30: number;
  /* Planets gained / lost: "<minute>m<from" and "<minute>m>to". */
  gains: string[];
  losses: string[];
}

// ORION_ECONOMY_MINUTES (comma-separated) overrides the sample minutes of the opt-in report.
export const ECONOMY_SAMPLE_MINUTES = String((globalThis as any).process?.env?.['ORION_ECONOMY_MINUTES'] ?? '30,60,90').split(',').map(Number);

export function runEconomyScenario(options: ScenarioOptions) {
  const economy = TestBed.inject(EconomyService);
  const samples: EconomySample[] = [];
  const negativeRun = new Map<string, number>();
  const longestNegative = new Map<string, number>();
  const income30 = new Map<string, number>();
  let lastSecond = -1;
  const result = runScenario({
    ...options,
    onFrame: (data, time) => {
      options.onFrame?.(data, time);
      const second = Math.floor(time);
      if (second === lastSecond) return;
      lastSecond = second;
      const minute = second / 60;
      const sampling = Number.isInteger(minute) && ECONOMY_SAMPLE_MINUTES.includes(minute);
      for (const f of data.factions.filter((x) => x.ai)) {
        const b = economy.calculateEconomy(f.id, data.factions, data.starSystems, data.fleets, data.shipStock);
        const run = b.netPerSecond < 0 ? (negativeRun.get(f.id) ?? 0) + 1 : 0;
        negativeRun.set(f.id, run);
        longestNegative.set(f.id, Math.max(longestNegative.get(f.id) ?? 0, run));
        if (!sampling) continue;
        if (minute === 30) income30.set(f.id, b.incomePerSecond);
        const planets = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === f.id);
        const population = planets.reduce((n, p) => n + (p.population ?? 0), 0);
        const coverages = planets
          .map((p) => economy.calculatePlanetEconomy(p, f) as { comfortNeed?: number; comfortCoverage?: number })
          .filter((e) => (e.comfortNeed ?? 0) > 0)
          .map((e) => e.comfortCoverage ?? 1);
        samples.push({
          minute,
          who: `${f.id}/${f.aiPersonality}`,
          planets: planets.length,
          population: Math.round(population),
          income: Math.round(b.incomePerSecond),
          populationShare: Math.round((100 * population * 0.085 * (b.incomePerSecond > 0 ? 1 : 0)) / Math.max(1, b.incomePerSecond)),
          net: Math.round(b.netPerSecond),
          expenses: [b.buildingUpkeepPerSecond, b.administrationPerSecond, b.shipUpkeepPerSecond, b.stationUpkeepPerSecond].map(Math.round),
          credits: Math.round(f.currencies['credits'] ?? 0),
          creditMinutes: Math.round(((f.currencies['credits'] ?? 0) / Math.max(1, b.incomePerSecond * 60)) * 10) / 10,
          raw: Math.round(f.currencies['rawmaterials'] ?? 0),
          techs: (f.researchedTechnologies ?? []).length,
          avgSatisfaction: Math.round(planets.reduce((n, p) => n + (p.satisfaction ?? 100), 0) / Math.max(1, planets.length)),
          avgCoverage: coverages.length === 0 ? 100 : Math.round((100 * coverages.reduce((n, c) => n + c, 0)) / coverages.length),
          top: [...planets].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 3).map((p) => {
            const e = economy.calculatePlanetEconomy(p, f);
            return `${p.type}:${Math.round(p.population ?? 0)}/${Math.round(economy.getPopulationCapacity(p))} cf ${e.comfortProvided.toFixed(1)}/${e.comfortNeed.toFixed(1)} sat ${Math.round(p.satisfaction ?? 100)}->${Math.round(e.satisfactionTarget)} b${p.buildings.length}`;
          }),
        });
      }
    },
  });
  const summaries: EconomySummary[] = result.data.factions.filter((f) => f.ai).map((f) => {
    const trace = result.traces.get(f.id)!;
    return {
      who: f.id,
      personality: String(f.aiPersonality),
      spaceportAt: trace.spaceportAt,
      firstColonyAt: trace.firstColonizationAt,
      colonizations: trace.colonizations,
      warships: trace.combatShipsProduced,
      arrearsTicks: trace.arrearsTicks,
      failedOrders: trace.failedOrders,
      rebellions: result.ownershipChanges.filter((c) => c.from === f.id && c.to === 'independent').length,
      techs: (f.researchedTechnologies ?? []).length,
      longestNegativeNet: longestNegative.get(f.id) ?? 0,
      income30: Math.round(income30.get(f.id) ?? 0),
      gains: result.ownershipChanges.filter((c) => c.to === f.id).map((c) => `${Math.round(c.time / 60)}m<${c.from}`),
      losses: result.ownershipChanges.filter((c) => c.from === f.id).map((c) => `${Math.round(c.time / 60)}m>${c.to}`),
    };
  });
  return { result, samples, summaries };
}

export const ECONOMY_SCENARIOS: Record<string, ScenarioOptions> = {
  'medium/3': {
    size: 'medium', aiCount: 3, seconds: 5400, dt: 1 / 10, continueAfterOutcome: true, resolvePlayerFleetBattles: true,
    prepare: withPersonalities(['technologist', 'militarist', 'balanced']),
  },
  'large/4': {
    size: 'large', aiCount: 4, seconds: 5400, dt: 1 / 10, seed: 4242, continueAfterOutcome: true, resolvePlayerFleetBattles: true,
    prepare: withPersonalities(['balanced', 'expansionist', 'militarist', 'technologist']),
  },
};

/*
 * Acceptance test of the late-economy rules (docs/late-economy.md,
 * "Acceptance criteria"): the large map with all four personalities, 90
 * minutes. Before comfort, every empire kept 18–34% of its gross income as
 * surplus at minute 90; now no personality may get stuck while doing so.
 */

/*
 * AI action ledger (docs/ai-pipeline.md, "Action ledger"): measurement only.
 * The first block guards the two promises the ledger makes — it never
 * changes the game, and it counts each committed action once — on a real
 * multi-AI game. The opt-in report (ORION_APM_REPORT=1) prints the measured
 * action rates per difficulty, personality, game phase and galaxy size.
 */
export class NoopActionLedger extends AiActionLedger {
  override record(): void {}
  override reject(): void {}
}

/* Game state an AI decision can change, serialized for an exact comparison. */
export function gameFingerprint(data: StarMapData): string {
  return JSON.stringify({
    factions: data.factions.map((f) => [f.id, f.currencies, f.researchedTechnologies ?? [], f.relations ?? null]),
    planets: data.starSystems.flatMap((s) => s.planetsTiles).map((p) => [p.id, p.factionId, p.population, p.satisfaction, p.buildings]),
    fleets: data.fleets.map((f) => [f.id, f.factionId, f.destroyed, f.x, f.y, f.targetX, f.targetY, f.ships.map((s) => [s.type, s.destroyed])]),
    stock: data.shipStock,
    production: data.production,
  });
}

export const LEDGER_CHECK_OPTIONS: ScenarioOptions = {
  size: 'medium', aiCount: 3, seconds: 900, dt: 1 / 10, seed: 2468, continueAfterOutcome: true, resolvePlayerFleetBattles: true,
  prepare: withPersonalities(['militarist', 'expansionist', 'technologist']),
};

/*
 * Opt-in report: ORION_APM_REPORT=1. One run per (size, difficulty, seed),
 * all AIs on the same difficulty; personalities rotate with the seed so
 * every personality appears on every size. Each run prints one line,
 * `APM REPORT <size>/<difficulty>/<seed> {json}`, with the scenario and
 * AiActionLedger.report() (totals, per-minute bins, early/middle/late
 * phases, resource samples). Overrides (comma-separated):
 * ORION_APM_SEEDS, ORION_APM_SIZES, ORION_APM_DIFFICULTIES, ORION_APM_MINUTES.
 */
export const apmEnv = (name: string, fallback: string) => String((globalThis as any).process?.env?.[name] ?? fallback).split(',').map((v) => v.trim()).filter(Boolean);
export const APM_SEEDS = apmEnv('ORION_APM_SEEDS', '31337,4242,777').map(Number);
export const APM_SIZES = apmEnv('ORION_APM_SIZES', 'small,medium') as GalaxySize[];
export const APM_DIFFICULTIES = apmEnv('ORION_APM_DIFFICULTIES', 'easy,normal,hard') as AiDifficulty[];
export const APM_MINUTES = Number(apmEnv('ORION_APM_MINUTES', '60')[0]);
// The most AIs each galaxy size allows next to the player (GALAXY_SIZE_PRESETS.maxPlayers − 1), large capped at 4.
export const APM_AI_COUNT: Record<GalaxySize, number> = { small: 2, medium: 3, large: 4 };
export const APM_PERSONALITIES = ['balanced', 'expansionist', 'militarist', 'technologist'];

export const longRun = (options: ScenarioOptions) => {
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
    // 40 minutes; an Easy militarist (income ×0.75, war first) reaches 11.
    expect(row.techs, `${who} technologies`).toBeGreaterThanOrEqual(11);
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

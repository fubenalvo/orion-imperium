import { Injectable } from '@angular/core';
import { Faction, FactionProduction, FactionShipStock, Fleet, StarSystem, SystemAsteroid } from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { canAffordCost, shipCost } from '../../services/resource-cost';
import { TerritoryService } from './territory.service';
import { OUTPOST_SHIP_TYPE, hasLivingOutpostShip } from './space-base';
import { deployMiningStation, validateMiningStationDeployment } from './mining-station';
import { surveySystemAsteroids } from './system-asteroids';
import { isAsteroidSurveyedBy, rawOutlook, rawSupplyPressure } from './raw-deposits';
import { SYSTEM_FLEET_ENTRY_VW, systemCellAtVw, systemCellCenterVw } from './system-grid';
import { hostileFactionIds } from './diplomacy';

/*
 * =========================================================
 * ENEMY MINING SERVICE (AI asteroid mining)
 * =========================================================
 *
 * AI factions renew their raw-material supply with asteroid mining
 * stations, through exactly the player's rules (docs/ai-pipeline.md,
 * "Asteroid mining"):
 *  1. When rawSupplyPressure (raw-deposits.ts) reaches MIN_PRESSURE and a
 *     reachable system still has prospects, the faction queues ONE outpost
 *     ship at a Spaceship Factory (ProductionService: same price and build
 *     time as the player's).
 *  2. A stocked outpost ship is assembled into a fleet at a Spaceport
 *     (FleetAssemblyService.createFleet).
 *  3. The fleet flies to the best system: known free deposits first
 *     (surveyed by this faction), else a belt with asteroids it has not
 *     surveyed yet; own or neutral territory only (the deployment rule).
 *  4. Inside the system it moves asteroid by asteroid. Standing on a cell
 *     surveys it for this faction (surveySystemAsteroids, the player's
 *     survey rule — the AI never knows a deposit it has not visited).
 *  5. On a free surveyed deposit it deploys the station
 *     (validateMiningStationDeployment / deployMiningStation), which
 *     consumes the outpost ship and retires the fleet.
 *
 * Ownership: every AI fleet carrying a living outpost ship is driven only
 * here (StarMapAiTickService reserves it from the other layers, which also
 * skip such fleets), so exactly one subsystem writes its targets.
 *
 * State: almost none. A mission is re-derived every decision from the
 * world (the fleet, its position, the per-faction survey records in the
 * save), so a load simply continues it. The only memory is which system a
 * fleet was sent to and systems it could not reach (retried after
 * FAILED_RETRY_SECONDS); both are dropped by reset().
 */
@Injectable({ providedIn: 'root' })
export class EnemyMiningService {
  static readonly DECISION_INTERVAL = 3;
  /* rawSupplyPressure at which an outpost ship is worth building. */
  static readonly MIN_PRESSURE = 1;
  /* Galaxy cells an outpost fleet is sent at most from its position. */
  private static readonly MAX_DISTANCE = 45;
  /* A hostile fleet this close to a system makes it unsafe for an unarmed outpost ship. */
  private static readonly DANGER_RADIUS = 4;
  private static readonly FAILED_RETRY_SECONDS = 300;
  /* Expected raw materials behind one unsurveyed asteroid (~1 in 10 holds ~5000). */
  private static readonly UNSURVEYED_VALUE = 500;

  private readonly accumulators = new Map<string, number>();
  private readonly clocks = new Map<string, number>();
  /* Fleet id → system id it was last ordered to. */
  private readonly orders = new Map<number, string>();
  /* Faction id → (system id → game time it may be tried again). */
  private readonly failed = new Map<string, Map<string, number>>();

  constructor(
    private readonly productionService: ProductionService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly spaceportService: SpaceportService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly territory: TerritoryService,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.clocks.clear();
    this.orders.clear();
    this.failed.clear();
  }

  /* AI fleets this service drives: every living AI fleet carrying an outpost ship. */
  static isMiningFleet(fleet: Fleet): boolean {
    return !fleet.destroyed && hasLivingOutpostShip(fleet);
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    data: {
      factions: Faction[];
      starSystems: StarSystem[];
      fleets: Fleet[];
      shipStock: FactionShipStock[];
      production: FactionProduction[];
    },
    perceived: { starSystems: StarSystem[]; fleets: Fleet[] },
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) return false;
    const clock = (this.clocks.get(faction.id) ?? 0) + gameDeltaTime;
    this.clocks.set(faction.id, clock);
    const accumulator = (this.accumulators.get(faction.id) ?? 0) + gameDeltaTime;
    if (accumulator < EnemyMiningService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, accumulator - EnemyMiningService.DECISION_INTERVAL);

    const fleet = data.fleets.find((f) => f.factionId === faction.id && EnemyMiningService.isMiningFleet(f));
    if (fleet) {
      return this.drive(faction, fleet, data, perceived, clock);
    }
    if (rawSupplyPressure(rawOutlook(faction.id, data.starSystems)) < EnemyMiningService.MIN_PRESSURE) {
      return false;
    }
    if (this.assembleFromStock(faction, data)) return true;
    return this.queueOutpostShip(faction, data, perceived);
  }

  // ---------------------------------------------------------------
  // Getting an outpost fleet
  // ---------------------------------------------------------------

  private assembleFromStock(faction: Faction, data: { starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] }): boolean {
    const inStock = data.shipStock.find((s) => s.factionId === faction.id)?.ships.some((s) => s.type === OUTPOST_SHIP_TYPE);
    if (!inStock) return false;
    const spaceport = [...this.spaceportService.listSpaceports(faction.id, data.starSystems)]
      .sort((a, b) => a.system.id.localeCompare(b.system.id) || a.planet.id - b.planet.id)[0];
    if (!spaceport) return false;
    const result = this.fleetAssemblyService.createFleet({ fleets: data.fleets, shipStock: data.shipStock }, data.starSystems, {
      factionId: faction.id,
      fleetName: `${faction.name} Prospector`,
      systemId: spaceport.system.id,
      planetId: spaceport.planet.id,
      composition: [{ typeId: OUTPOST_SHIP_TYPE, count: 1 }],
    });
    return result.ok;
  }

  /*
   * One outpost ship at a time: none queued, in stock or in a fleet (the
   * caller checked fleets). Only when there is somewhere to send it, the
   * faction can field it (Spaceport) and can pay the full price now.
   */
  private queueOutpostShip(
    faction: Faction,
    data: { factions: Faction[]; starSystems: StarSystem[]; production: FactionProduction[] },
    perceived: { starSystems: StarSystem[]; fleets: Fleet[] },
  ): boolean {
    const type = this.shipService.getShipType(OUTPOST_SHIP_TYPE);
    if (!type || !this.researchService.isShipUnlocked(faction, OUTPOST_SHIP_TYPE)) return false;
    const orders = Object.values(data.production.find((p) => p.factionId === faction.id)?.ordersByPlanet ?? {}).flat();
    if (orders.some((o) => o.shipTypeId === OUTPOST_SHIP_TYPE)) return false;
    if (!canAffordCost(faction, shipCost(type))) return false;
    const spaceports = this.spaceportService.listSpaceports(faction.id, data.starSystems);
    if (spaceports.length === 0) return false;
    const home = spaceports[0].system;
    if (!this.chooseSystem(faction, { x: home.x, y: home.y }, data, perceived)) return false;
    const factory = data.starSystems
      .flatMap((s) => s.planetsTiles)
      .filter((p) => p.factionId === faction.id && p.buildings.some((b) => b.name === 'Spaceship Factory'))
      .sort((a, b) => a.id - b.id)[0];
    if (!factory) return false;
    return this.productionService.queueOrder(
      { production: data.production }, faction.id, factory.id, OUTPOST_SHIP_TYPE, 1, data.starSystems, [faction],
    ).ok;
  }

  // ---------------------------------------------------------------
  // Driving the outpost fleet
  // ---------------------------------------------------------------

  private drive(
    faction: Faction,
    fleet: Fleet,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[] },
    perceived: { starSystems: StarSystem[]; fleets: Fleet[] },
    clock: number,
  ): boolean {
    if (fleet.targetX !== null || fleet.targetY !== null) return false; // travelling

    // A fleet whose galaxy cell left its system no longer stands in it.
    let system = fleet.system?.id ? data.starSystems.find((s) => s.id === fleet.system!.id) ?? null : null;
    if (fleet.system && (!system || Math.floor(system.x) !== Math.floor(fleet.x) || Math.floor(system.y) !== Math.floor(fleet.y))) {
      fleet.system = null;
      system = null;
    }
    // Arrived at the galaxy cell of a system: enter it.
    if (!system) {
      system = data.starSystems.find(
        (s) => Math.floor(s.x) === Math.floor(fleet.x) && Math.floor(s.y) === Math.floor(fleet.y) && !!s.asteroidBelt,
      ) ?? null;
      if (system) {
        fleet.system = { id: system.id, x: SYSTEM_FLEET_ENTRY_VW.x, y: SYSTEM_FLEET_ENTRY_VW.y, targetX: null, targetY: null };
      }
    }
    const ordered = this.orders.get(fleet.id);
    if (ordered && ordered !== system?.id) {
      // Stopped short of the system it was sent to: the route failed.
      this.markFailed(faction.id, ordered, clock);
    }
    this.orders.delete(fleet.id);

    if (system && fleet.system) {
      if (fleet.system.targetX !== null || fleet.system.targetY !== null) return false; // moving in-system
      surveySystemAsteroids([fleet], [system], 'player', (id) => id === faction.id);
      const territory = this.territory.get(data.starSystems, data.factions);
      const check = validateMiningStationDeployment({ fleet, factions: data.factions, starSystems: data.starSystems, territory });
      if (check.ok) {
        return deployMiningStation({ fleet, factions: data.factions, starSystems: data.starSystems, territory }).ok;
      }
      const next = this.nextAsteroid(faction.id, fleet, system);
      if (next && this.isOpenSystem(faction.id, system, data)) {
        const center = systemCellCenterVw(next.col, next.row);
        fleet.system.targetX = center.x;
        fleet.system.targetY = center.y;
        return true;
      }
      // Nothing left here for this faction: look elsewhere.
    }

    const target = this.chooseSystem(faction, { x: fleet.x, y: fleet.y }, data, perceived, system?.id);
    if (!target) return false;
    fleet.targetX = target.x;
    fleet.targetY = target.y;
    this.orders.set(fleet.id, target.id);
    return true;
  }

  /*
   * The asteroid to visit next: a known free deposit of this faction first
   * (to deploy), otherwise the nearest asteroid it has not surveyed yet.
   */
  private nextAsteroid(factionId: string, fleet: Fleet, system: StarSystem): SystemAsteroid | undefined {
    const here = systemCellAtVw(fleet.system!.x, fleet.system!.y);
    const distance = (a: SystemAsteroid) => Math.hypot(a.col - here.col, a.row - here.row);
    const asteroids = system.asteroidBelt?.asteroids ?? [];
    const known = asteroids
      .filter((a) => this.isFreeKnownDeposit(factionId, a))
      .sort((a, b) => b.rawMaterials - a.rawMaterials || distance(a) - distance(b))[0];
    if (known) return known;
    return asteroids
      .filter((a) => !isAsteroidSurveyedBy(a, factionId))
      .sort((a, b) => distance(a) - distance(b) || a.col - b.col || a.row - b.row)[0];
  }

  private isFreeKnownDeposit(factionId: string, asteroid: SystemAsteroid): boolean {
    return !asteroid.miningStation && asteroid.rawMaterials > 0 && isAsteroidSurveyedBy(asteroid, factionId);
  }

  /* Own or unclaimed space: the deployment rule for mining stations. */
  private isOpenSystem(factionId: string, system: StarSystem, data: { factions: Faction[]; starSystems: StarSystem[] }): boolean {
    const owner = this.territory.get(data.starSystems, data.factions).systemTerritoryOwner(system);
    return owner === null || owner === factionId;
  }

  /*
   * Best system for the outpost fleet, from what the faction knows: value =
   * known free deposits + UNSURVEYED_VALUE per unsurveyed asteroid, divided
   * by (distance + 5). Own territory counts 1.5×. Skips the current system
   * (`excludeId`), foreign territory, systems near perceived hostile fleets,
   * systems that recently failed and anything beyond MAX_DISTANCE.
   */
  private chooseSystem(
    faction: Faction,
    from: { x: number; y: number },
    data: { factions: Faction[]; starSystems: StarSystem[] },
    perceived: { starSystems: StarSystem[]; fleets: Fleet[] },
    excludeId?: string,
  ): StarSystem | undefined {
    const territory = this.territory.get(data.starSystems, data.factions);
    const hostile = hostileFactionIds(faction, data.factions);
    const dangers = perceived.fleets.filter((f) => hostile.has(f.factionId) && !f.destroyed);
    const failed = this.failed.get(faction.id);
    const clock = this.clocks.get(faction.id) ?? 0;
    let best: { system: StarSystem; score: number } | undefined;
    for (const system of perceived.starSystems) {
      if (system.id === excludeId || !system.asteroidBelt) continue;
      if ((failed?.get(system.id) ?? -Infinity) > clock) continue;
      const distance = Math.hypot(system.x - from.x, system.y - from.y);
      if (distance > EnemyMiningService.MAX_DISTANCE) continue;
      const owner = territory.systemTerritoryOwner(system);
      if (owner !== null && owner !== faction.id) continue;
      if (dangers.some((f) => Math.hypot(f.x - system.x, f.y - system.y) <= EnemyMiningService.DANGER_RADIUS)) continue;
      let value = 0;
      for (const asteroid of system.asteroidBelt.asteroids) {
        if (this.isFreeKnownDeposit(faction.id, asteroid)) value += asteroid.rawMaterials;
        else if (!isAsteroidSurveyedBy(asteroid, faction.id)) value += EnemyMiningService.UNSURVEYED_VALUE;
      }
      if (value <= 0) continue;
      const score = (value * (owner === faction.id ? 1.5 : 1)) / (distance + 5);
      if (!best || score > best.score || (score === best.score && system.id < best.system.id)) {
        best = { system, score };
      }
    }
    return best ? data.starSystems.find((s) => s.id === best!.system.id) : undefined;
  }

  private markFailed(factionId: string, systemId: string, clock: number): void {
    const map = this.failed.get(factionId) ?? new Map<string, number>();
    map.set(systemId, clock + EnemyMiningService.FAILED_RETRY_SECONDS);
    this.failed.set(factionId, map);
  }
}

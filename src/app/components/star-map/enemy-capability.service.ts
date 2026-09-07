import { Injectable } from '@angular/core';
import {
  Fleet,
  Faction,
  StarSystem,
  StrategicGoal,
  ColonizeGoal,
  AttackGoal,
  DefendGoal,
  DevelopGoal,
  CapabilityRequirement,
  CapabilityResult,
} from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';

/*
 * =========================================================
 * ENEMY CAPABILITY SERVICE
 * =========================================================
 *
 * Third strategic AI layer below EnemyStrategyService V4.1
 * and EnemyGoalService V4.2.
 *
 * Given a faction's current goal, evaluates whether the faction
 * currently has the capabilities required to pursue that goal.
 *
 * This layer does NOT execute actions. It only inspects the
 * current game state and reports what is available and what
 * is missing.
 *
 * Timing: capabilities are recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, matching
 * the V4.1/V4.2 cadence.
 */

@Injectable({ providedIn: 'root' })
export class EnemyCapabilityService {
  private readonly STRATEGY_TICK_INTERVAL = 2;
  private readonly THREAT_DISTANCE = 5;

  private accumulator = 0;
  private readonly currentCapabilities = new Map<string, CapabilityResult>();

  constructor(
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
    private readonly shipStockService: ShipStockService,
  ) {}

  reset(): void {
    this.accumulator = 0;
    this.currentCapabilities.clear();
  }

  tick(
    gameDeltaTime: number,
    currentGoal: StrategicGoal | undefined,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, { shipTypeId: string; quantity: number; progress: number; startedAtTick: number }[]> }[],
  ): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

    this.accumulator += gameDeltaTime;
    if (this.accumulator < this.STRATEGY_TICK_INTERVAL) {
      return false;
    }

    this.accumulator -= this.STRATEGY_TICK_INTERVAL;
    if (this.accumulator < 0) {
      this.accumulator = 0;
    }

    const previous = this.currentCapabilities.get(factionId);
    const next = currentGoal !== undefined
      ? this.evaluateGoal(currentGoal, factionId, fleets, factions, starSystems, shipStock, production)
      : undefined;

    if (previous !== undefined && next !== undefined) {
      const changed = JSON.stringify(previous) !== JSON.stringify(next);
      if (changed) {
        this.currentCapabilities.set(factionId, next);
      }
      return changed;
    }

    if (previous === undefined && next !== undefined) {
      this.currentCapabilities.set(factionId, next);
      return true;
    }

    if (previous !== undefined && next === undefined) {
      this.currentCapabilities.delete(factionId);
      return true;
    }

    return false;
  }

  getCapability(factionId: string): CapabilityResult | undefined {
    return this.currentCapabilities.get(factionId);
  }

  private evaluateGoal(
    goal: StrategicGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, { shipTypeId: string; quantity: number; progress: number; startedAtTick: number }[]> }[],
  ): CapabilityResult {
    switch (goal.type) {
      case 'colonize':
        return this.evaluateColonize(goal, factionId, fleets, factions, starSystems, shipStock);
      case 'attack':
        return this.evaluateAttack(goal, factionId, fleets, factions);
      case 'defend':
        return this.evaluateDefend(goal, factionId, fleets, factions, starSystems);
      case 'develop':
        return this.evaluateDevelop(factionId);
    }
  }

  private evaluateColonize(
    goal: ColonizeGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[],
  ): CapabilityResult {
    const requirements: CapabilityRequirement[] = [];

    const faction = factions.find((f) => f.id === factionId);

    const hasTechnology = faction !== undefined && this.researchService.isResearched(faction, 'basic_engineering');
    requirements.push({
      type: 'colonizer_technology',
      satisfied: hasTechnology,
      reason: hasTechnology ? 'satisfied' : 'no_colonizer_technology',
    });

    const isUnlocked = faction !== undefined && this.researchService.isShipUnlocked(faction, 'colonizer');
    requirements.push({
      type: 'colonizer_unlocked',
      satisfied: isUnlocked,
      reason: isUnlocked ? 'satisfied' : 'colonizer_not_unlocked',
    });

    const stockData = { shipStock } as { shipStock?: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[] };
    const colonizerInStock = this.shipStockService.getCount(stockData, factionId, 'colonizer');
    const colonizerInFleet = fleets.some(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => ship.type === 'colonizer' && !ship.destroyed),
    );
    const hasColonizer = colonizerInStock > 0 || colonizerInFleet;
    requirements.push({
      type: 'colonizer_available',
      satisfied: hasColonizer,
      reason: hasColonizer ? 'satisfied' : 'no_colonizer_available',
    });

    const usableFleet = fleets.some(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed),
    );
    requirements.push({
      type: 'usable_fleet',
      satisfied: usableFleet,
      reason: usableFleet ? 'satisfied' : 'no_usable_fleet',
    });

    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);
    const targetValid = system !== undefined && planet !== undefined && planet.factionId === 'unhabited';
    requirements.push({
      type: 'target_valid',
      satisfied: targetValid,
      reason: targetValid ? 'satisfied' : 'target_invalid',
    });

    return {
      canExecute: requirements.every((r) => r.satisfied),
      goalType: 'colonize',
      factionId,
      requirements,
    };
  }

  private evaluateAttack(
    goal: AttackGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
  ): CapabilityResult {
    const requirements: CapabilityRequirement[] = [];

    const enemyFleets = fleets.filter(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed),
    );
    const hasFleet = enemyFleets.length > 0;
    requirements.push({
      type: 'available_fleet',
      satisfied: hasFleet,
      reason: hasFleet ? 'satisfied' : 'no_available_fleet',
    });

    const targetFleet = fleets.find((f) => f.id === goal.targetFleetId);
    const playerFactionIds = new Set(
      factions
        .filter((faction) => faction.team === 1)
        .map((faction) => faction.id),
    );
    const targetValid = targetFleet !== undefined
      && !targetFleet.destroyed
      && targetFleet.ships.some((ship) => !ship.destroyed)
      && playerFactionIds.has(targetFleet.factionId);
    requirements.push({
      type: 'target_valid',
      satisfied: targetValid,
      reason: targetValid ? 'satisfied' : 'target_destroyed',
    });

    const hasCombatCapability = hasFleet && enemyFleets.some((fleet) => this.calculateFleetStrength(fleet) > 0);
    requirements.push({
      type: 'fleet_can_engage',
      satisfied: hasCombatCapability,
      reason: hasCombatCapability ? 'satisfied' : 'no_combat_capability',
    });

    return {
      canExecute: requirements.every((r) => r.satisfied),
      goalType: 'attack',
      factionId,
      requirements,
    };
  }

  private evaluateDefend(
    goal: DefendGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): CapabilityResult {
    const requirements: CapabilityRequirement[] = [];

    const enemyFleets = fleets.filter(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed),
    );
    const hasFleet = enemyFleets.length > 0;
    requirements.push({
      type: 'available_fleet',
      satisfied: hasFleet,
      reason: hasFleet ? 'satisfied' : 'no_available_fleet',
    });

    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);
    const targetValid = system !== undefined && planet !== undefined && planet.factionId === factionId;
    requirements.push({
      type: 'target_valid',
      satisfied: targetValid,
      reason: targetValid ? 'satisfied' : 'target_lost',
    });

    const playerFleets = fleets.filter(
      (fleet) => playerFactionIds(fleet, factions) && !fleet.destroyed && fleet.ships.some((ship) => !ship.destroyed),
    );
    const threatPresent = targetValid && playerFleets.some((fleet) => {
      const dx = fleet.x - system!.x;
      const dy = fleet.y - system!.y;
      return Math.sqrt(dx * dx + dy * dy) <= this.THREAT_DISTANCE;
    });
    requirements.push({
      type: 'threat_present',
      satisfied: threatPresent,
      reason: threatPresent ? 'satisfied' : 'no_threat',
    });

    return {
      canExecute: requirements.every((r) => r.satisfied),
      goalType: 'defend',
      factionId,
      requirements,
    };
  }

  private evaluateDevelop(factionId: string): CapabilityResult {
    return {
      canExecute: true,
      goalType: 'develop',
      factionId,
      requirements: [
        {
          type: 'always_executable',
          satisfied: true,
          reason: 'satisfied',
        },
      ],
    };
  }

  private calculateFleetStrength(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => {
      const shipType = this.shipService.getShipType(ship.type);
      if (!shipType) {
        return sum;
      }
      return sum + shipType.attack + shipType.defense + shipType.hitPoints / 10 + shipType.shield / 10;
    }, 0);
  }
}

function playerFactionIds(fleet: Fleet, factions: Faction[]): boolean {
  const playerFactionIds = new Set(
    factions
      .filter((faction) => faction.team === 1)
      .map((faction) => faction.id),
  );
  return playerFactionIds.has(fleet.factionId);
}

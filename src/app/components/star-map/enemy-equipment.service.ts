import { Injectable } from '@angular/core';
import { operationalBuildings } from './building-construction';
import {
  Faction,
  FactionEquipmentInventory,
  FactionProduction,
  FactionShipStock,
  Fleet,
  FleetShip,
  ShipStockEntry,
  StarSystem,
} from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipEquipmentService } from '../../services/ship-equipment.service';
import { ResearchService } from '../../services/research.service';
import { ShipService, ShipType } from '../../services/ship.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { getAiPersonalityProfile } from './ai-personality';
import { AiActionLedger, rejectionReason } from './ai-action-ledger';
import { isCombatShipType } from './ai-queries';
import { hostileFactionIds } from './diplomacy';
import { weaponMultiplier } from '../battle-screen/battle/battle-grid';
import { armorFactor } from './hull-class';
import { EquipmentDefinition, EquipmentSlot, ShipLoadout, getUpgradeModules, moduleInSlot } from './equipment';
import { inventoryCount } from './equipment-inventory';
import { resolveShipStats } from './ship-stats';

const DAMAGE_TYPES = ['kinetic', 'energy', 'missile'] as const;

/* The slots the AI refits. Engines are left out: they only pay off when a whole fleet carries one (map speed). */
const AI_SLOTS: readonly EquipmentSlot[] = ['weapon', 'defense'];

type ShipRecord = FleetShip | ShipStockEntry;

/* Share of perceived hostile strength per damage type it deals and per defense profile it has. */
interface ThreatProfile {
  dealt: Record<string, number>;
  profiles: Record<string, number>;
}

type EquipmentData = {
  factions: Faction[];
  starSystems: StarSystem[];
  fleets: Fleet[];
  shipStock: FactionShipStock[];
  production: FactionProduction[];
  equipmentInventory?: FactionEquipmentInventory[];
};

/*
 * =========================================================
 * ENEMY EQUIPMENT SERVICE (AI ship refits)
 * =========================================================
 *
 * AI factions build and install equipment modules through exactly the
 * player's rules (docs/ship-equipment.md, Phase 8; docs/ai-pipeline.md,
 * "Ship equipment"): ProductionService.queueEquipmentOrder (research unlock,
 * factory, price) and ShipEquipmentService.install (inventory, location).
 *
 * Every DECISION_INTERVAL per faction:
 *  1. Install: ships at a refit location (fleets within 2 cells of an own
 *     Spaceport planet, the reserve while it owns a Spaceport) get the best
 *     module in the inventory for each slot, heaviest hulls first, if it
 *     improves the ship by at least MIN_GAIN.
 *  2. Order: one module at a time, only on a Spaceship Factory the economy
 *     left idle (this runs after its military production, and never queues
 *     behind ships), only when net income is positive, raw materials are
 *     not short, and the credits left after the economy's spending reserve
 *     (which holds the next warship while the navy is short) cover
 *     BUDGET_MARGIN module prices plus the personality's
 *     equipment.minSurplusCredits (raw materials: BUDGET_MARGIN prices).
 *     Tuning notes (2026-11-08): without the surplus an AI with no enemy in
 *     sight bought modules from its first minutes and reinforced its fleets
 *     later (ai-simulation-phases "reinforce existing fleets"); a gate on
 *     navy coverage of the military target never opened, because a wealthy
 *     faction's target grows with its credits. It orders the module most of its combat
 *     ships would gain from, minus what the inventory already holds.
 *
 * Choice: a module's value for a ship is its damage per second (attack ×
 * fire-rate factor) times the average damage-type multiplier against the
 * perceived hostile navy's defense profiles, and its durability (hull +
 * shield, through armour) divided by the average multiplier of the hostile
 * damage types against its profile. Weights are the hostile ships'
 * strength (fog of war: perceived fleets only, their visible equipment
 * included). Without any sighting every type counts equally, so pure stat
 * gains decide.
 *
 * Engines are not built: their map speed only helps when every ship of a
 * fleet carries one, and the AI's fleets are mixed and reorganized.
 *
 * State: only the decision accumulators (reset()). Inventory, orders and
 * loadouts live in the save.
 */
@Injectable({ providedIn: 'root' })
export class EnemyEquipmentService {
  static readonly DECISION_INTERVAL = 5;
  /* Budget after the spending reserve must cover this many module prices. */
  static readonly BUDGET_MARGIN = 2;
  /* Smallest relative improvement worth a refit (stops swaps that change nothing). */
  static readonly MIN_GAIN = 0.03;
  /*
   * On for every personality since the module balance pass (2026-11-08).
   * The long simulations only stay stable together with the economy fixes
   * made then: hull-only military need / threat, the deficit runways in
   * the spending reserve and research, and the colony brake's starter
   * upkeep (docs/ai-pipeline.md, Ship equipment). Switching this off or
   * changing those rules means re-running `npm run test:long`.
   */
  static readonly ENABLED_BY_DEFAULT = true;
  enabled = EnemyEquipmentService.ENABLED_BY_DEFAULT;

  private readonly accumulators = new Map<string, number>();

  constructor(
    private readonly productionService: ProductionService,
    private readonly shipEquipment: ShipEquipmentService,
    private readonly economy: EnemyEconomyService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly actionLedger: AiActionLedger,
  ) {}

  reset(): void {
    this.accumulators.clear();
  }

  tick(gameDeltaTime: number, faction: Faction, data: EquipmentData, perceived: { fleets: Fleet[]; starSystems: StarSystem[] }): boolean {
    if (!this.enabled || gameDeltaTime <= 0 || faction.ai !== true) return false;
    const accumulator = (this.accumulators.get(faction.id) ?? 0) + gameDeltaTime;
    if (accumulator < EnemyEquipmentService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, accumulator - EnemyEquipmentService.DECISION_INTERVAL);

    const threat = this.threatProfile(faction, data.factions, perceived.fleets);
    let changed = this.installFromInventory(faction, data, threat);
    changed = this.queueModule(faction, data, perceived, threat) || changed;
    return changed;
  }

  // ---------------------------------------------------------------
  // What the enemy fields
  // ---------------------------------------------------------------

  threatProfile(faction: Faction, factions: Faction[], perceivedFleets: Fleet[]): ThreatProfile {
    const hostile = new Set(hostileFactionIds(faction, factions));
    const dealt: Record<string, number> = {};
    const profiles: Record<string, number> = {};
    let total = 0;
    for (const fleet of perceivedFleets) {
      if (fleet.destroyed || !hostile.has(fleet.factionId)) continue;
      for (const ship of fleet.ships) {
        if (ship.destroyed) continue;
        const type = this.shipService.getShipType(ship.type);
        if (!type) continue;
        const weight = this.shipService.calculateFleetStrength([ship]);
        const stats = resolveShipStats(type, ship.equipment);
        dealt[stats.attackType] = (dealt[stats.attackType] ?? 0) + weight;
        profiles[stats.weakness] = (profiles[stats.weakness] ?? 0) + weight;
        total += weight;
      }
    }
    if (total <= 0) {
      const even = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 1 / DAMAGE_TYPES.length]));
      return { dealt: { ...even }, profiles: { ...even } };
    }
    for (const key of Object.keys(dealt)) dealt[key] /= total;
    for (const key of Object.keys(profiles)) profiles[key] /= total;
    return { dealt, profiles };
  }

  /* Relative improvement of `loadout` over the ship's current one in one slot's terms (offense for weapons, durability for defense). */
  gain(shipType: ShipType, current: ShipLoadout | undefined, loadout: ShipLoadout, slot: EquipmentSlot, threat: ThreatProfile): number {
    const before = this.slotValue(shipType, current, slot, threat);
    const after = this.slotValue(shipType, loadout, slot, threat);
    return before > 0 ? after / before - 1 : 0;
  }

  private slotValue(shipType: ShipType, loadout: ShipLoadout | undefined, slot: EquipmentSlot, threat: ThreatProfile): number {
    const stats = resolveShipStats(shipType, loadout);
    if (slot === 'weapon') {
      const multiplier = Object.entries(threat.profiles).reduce((sum, [profile, w]) => sum + w * weaponMultiplier(stats.attackType, profile), 0);
      return stats.attack * (stats.fireRate / stats.hullFireRate) * multiplier;
    }
    const taken = Object.entries(threat.dealt).reduce((sum, [type, w]) => sum + w * weaponMultiplier(type, stats.weakness), 0);
    return (shipType.hitPoints + stats.shield) / armorFactor(stats.defense) / Math.max(0.1, taken);
  }

  /* The best module for a slot among `candidates`, with its gain; null when nothing beats MIN_GAIN. */
  private bestModule(
    ship: ShipRecord,
    shipType: ShipType,
    slot: EquipmentSlot,
    candidates: readonly EquipmentDefinition[],
    threat: ThreatProfile,
  ): { module: EquipmentDefinition; gain: number } | null {
    const installed = moduleInSlot(ship.type, ship.equipment, slot);
    let best: { module: EquipmentDefinition; gain: number } | null = null;
    for (const module of candidates) {
      if (module.slot !== slot || module.id === installed.id) continue;
      const gain = this.gain(shipType, ship.equipment, { ...ship.equipment, [slot]: module.id }, slot, threat);
      if (gain > EnemyEquipmentService.MIN_GAIN && (!best || gain > best.gain)) {
        best = { module, gain };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------
  // Installing
  // ---------------------------------------------------------------

  private installFromInventory(faction: Faction, data: EquipmentData, threat: ThreatProfile): boolean {
    const ships: ShipRecord[] = [];
    for (const fleet of data.fleets) {
      if (fleet.factionId !== faction.id || fleet.destroyed) continue;
      if (!this.shipEquipment.canCustomizeFleet(faction.id, fleet, data.starSystems)) continue;
      ships.push(...fleet.ships.filter((s) => !s.destroyed));
    }
    if (this.shipEquipment.canCustomizeReserve(faction.id, data.starSystems)) {
      ships.push(...(data.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []));
    }
    let changed = false;
    for (const ship of this.combatShipsHeaviestFirst(ships)) {
      const type = this.shipService.getShipType(ship.type)!;
      for (const slot of AI_SLOTS) {
        const available = getUpgradeModules(slot).filter((m) => inventoryCount(data, faction.id, m.id) > 0);
        const best = this.bestModule(ship, type, slot, available, threat);
        if (!best) continue;
        const result = this.shipEquipment.install(data, data.starSystems, { factionId: faction.id, shipId: ship.id, moduleId: best.module.id });
        if (result.ok) {
          this.actionLedger.record(faction, 'equipment_installed');
          changed = true;
        } else {
          this.actionLedger.reject(faction, 'equipment_installed', rejectionReason(result));
        }
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------
  // Ordering
  // ---------------------------------------------------------------

  private queueModule(
    faction: Faction,
    data: EquipmentData,
    perceived: { fleets: Fleet[]; starSystems: StarSystem[] },
    threat: ThreatProfile,
  ): boolean {
    const unlocked = AI_SLOTS.flatMap((slot) => getUpgradeModules(slot)).filter((m) => this.researchService.isEquipmentUnlocked(faction, m.id));
    if (unlocked.length === 0) return false;
    const orders = Object.values(data.production.find((p) => p.factionId === faction.id)?.ordersByPlanet ?? {}).flat();
    if (orders.some((o) => o.equipmentId)) return false; // one module order at a time

    const context = {
      fleets: data.fleets,
      shipStock: data.shipStock,
      production: data.production,
      factions: data.factions,
      perceivedFleets: perceived.fleets,
      perceivedSystems: perceived.starSystems,
    };
    const policy = getAiPersonalityProfile(faction).equipment;
    if (this.economy.getProjectedNet(faction, data.starSystems, context).net <= 0) return false;
    if (this.economy.isRawConstrained(faction)) return false;

    const module = this.mostWantedModule(faction, data, unlocked, threat);
    if (!module) return false;

    const reserve = this.economy.getSpendingReserve(faction, data.starSystems, context, true);
    const price = this.productionService.moduleCostFor(module);
    const margin = EnemyEquipmentService.BUDGET_MARGIN;
    if ((faction.currencies['credits'] ?? 0) - reserve.credits < price.credits * margin + policy.minSurplusCredits) return false;
    if ((faction.currencies['rawmaterials'] ?? 0) - reserve.rawmaterials < price.rawmaterials * margin) return false;

    const factionProduction = data.production.find((p) => p.factionId === faction.id);
    const factory = data.starSystems
      .flatMap((s) => s.planetsTiles ?? [])
      .filter((p) => p.factionId === faction.id && operationalBuildings(p).some((b) => b.name === 'Spaceship Factory'))
      .filter((p) => (factionProduction?.ordersByPlanet[p.id]?.length ?? 0) === 0)
      .sort((a, b) => a.id - b.id)[0];
    if (!factory) return false;

    const result = this.productionService.queueEquipmentOrder(
      { production: data.production }, faction.id, factory.id, module.id, 1, data.starSystems, [faction],
    );
    if (result.ok) this.actionLedger.record(faction, 'equipment_queued');
    else this.actionLedger.reject(faction, 'equipment_queued', rejectionReason(result));
    return result.ok;
  }

  /*
   * The unlocked module the most combat ships (fleets and reserve, anywhere)
   * would gain from, beyond what the inventory already holds; ties go to the
   * larger total gain.
   */
  private mostWantedModule(faction: Faction, data: EquipmentData, unlocked: EquipmentDefinition[], threat: ThreatProfile): EquipmentDefinition | null {
    const ships: ShipRecord[] = [
      ...data.fleets.filter((f) => f.factionId === faction.id && !f.destroyed).flatMap((f) => f.ships.filter((s) => !s.destroyed)),
      ...(data.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []),
    ];
    const demand = new Map<string, { count: number; gain: number }>();
    for (const ship of this.combatShipsHeaviestFirst(ships)) {
      const type = this.shipService.getShipType(ship.type)!;
      for (const slot of AI_SLOTS) {
        const best = this.bestModule(ship, type, slot, unlocked, threat);
        if (!best) continue;
        const entry = demand.get(best.module.id) ?? { count: 0, gain: 0 };
        entry.count++;
        entry.gain += best.gain;
        demand.set(best.module.id, entry);
      }
    }
    let chosen: { module: EquipmentDefinition; count: number; gain: number } | null = null;
    for (const module of unlocked) {
      const entry = demand.get(module.id);
      if (!entry) continue;
      const count = entry.count - inventoryCount(data, faction.id, module.id);
      if (count <= 0) continue;
      if (!chosen || count > chosen.count || (count === chosen.count && entry.gain > chosen.gain)) {
        chosen = { module, count, gain: entry.gain };
      }
    }
    return chosen?.module ?? null;
  }

  private combatShipsHeaviestFirst(ships: ShipRecord[]): ShipRecord[] {
    return ships
      .filter((s) => isCombatShipType(this.shipService.getShipType(s.type)))
      .sort((a, b) => (this.shipService.getShipType(b.type)!.cost - this.shipService.getShipType(a.type)!.cost) || a.id - b.id);
  }
}

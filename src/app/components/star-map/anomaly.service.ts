import { Injectable } from '@angular/core';
import { Anomaly, AnomalyState, Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import {
  ANOMALY_CONFIG,
  ANOMALY_DEFINITIONS,
  AnomalyChoiceDef,
  AnomalyGenerationInput,
  AnomalyResource,
  RESOURCE_LABELS,
  activateAnomalies,
  anomalySender,
  choiceBlockReason,
  discoverAnomalies,
  generateAnomalies,
  nextActiveAnomaly,
  releaseOrphanedAnomalies,
  sanitizeAnomalyState,
} from './anomalies';
import { adjustOpinion } from './diplomacy';
import { payCost, refundCost } from '../../services/resource-cost';
import { DEFAULT_FLEET_SPEED, FleetAssemblyService } from '../../services/fleet-assembly.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { DEFAULT_FLEET_SENSOR_RANGE } from './star-map-sensor.service';
import { Battle, BattleOutcome } from '../battle-screen/battle/battle.types';

/*
 * Virtual pirate fleets use ids below -PIRATE_FLEET_ID_OFFSET (planets use
 * -planet.id, space bases -10 000 000 - id, mining stations -20 000 000 - n).
 * Like other virtual fleets they are never persisted; the id encodes the
 * anomaly so the battle result can be matched back to it.
 */
export const PIRATE_FLEET_ID_OFFSET = 30_000_000;
/* Pirate ship ids, far above any id ShipStockService hands out. */
const PIRATE_SHIP_ID_OFFSET = 900_000_000;
export const PIRATE_FACTION_ID = 'pirates';

export function pirateFleetId(anomalyId: number): number {
  return -(PIRATE_FLEET_ID_OFFSET + anomalyId);
}

export interface AnomalyConsequenceVm {
  text: string;
  tone: 'gain' | 'cost' | 'neutral' | 'danger';
}

export interface AnomalyChoiceVm {
  id: string;
  label: string;
  consequences: AnomalyConsequenceVm[];
  disabled: boolean;
  reason: string | null;
}

export interface AnomalyEventVm {
  anomalyId: number;
  name: string;
  category: string;
  description: string;
  location: string;
  fleetName: string;
  choices: AnomalyChoiceVm[];
}

export interface AnomalyContext {
  factions: Faction[];
  fleets: Fleet[];
  starSystems: StarSystem[];
  shipStock?: FactionShipStock[];
}

export type AnomalyResolution =
  | { ok: true; anomaly: Anomaly; message: string; battle: Battle | null; newFleet: Fleet | null }
  | { ok: false; reason: string };

/*
 * =========================================================
 * ANOMALY SERVICE
 * =========================================================
 *
 * Owns the live exploration-anomaly state of the session (pure rules in
 * anomalies.ts, docs/exploration-anomalies.md). StarMap restores it on
 * every load and writes `serialize()` into every save.
 *
 * Per game-loop frame StarMap calls `update` (discovery from explored
 * cells, activation by arriving player fleets, release of events whose
 * fleet is gone) and shows `currentEvent()` in the event dialog. A choice
 * goes through `resolve`, which validates (the anomaly must still be
 * active, the cost affordable) before changing anything, applies the
 * effects through the existing economy / diplomacy / fleet helpers and
 * marks the anomaly resolved in the same step, so it can never pay twice.
 *
 * The pirate ambush returns a ready Battle; StarMap starts it through the
 * normal fleet-battle transport. The loot is paid by `applyBattleOutcome`
 * when StarMap applies the battle result after the battle screen.
 */
@Injectable({ providedIn: 'root' })
export class AnomalyService {
  private state: AnomalyState = { version: ANOMALY_CONFIG.generatorVersion, nextSeq: 1, anomalies: [] };

  constructor(
    private readonly fleetAssembly: FleetAssemblyService,
    private readonly shipStockService: ShipStockService,
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
  ) {}

  /*
   * Restores the saved state. Saves always carry it after normalizeSave; the
   * generation fallback only covers data that bypassed it.
   */
  restore(saved: AnomalyState | undefined, fallback?: AnomalyGenerationInput): void {
    const clean = sanitizeAnomalyState(saved);
    this.state = clean ?? (fallback ? generateAnomalies(fallback) : { version: ANOMALY_CONFIG.generatorVersion, nextSeq: 1, anomalies: [] });
  }

  serialize(): AnomalyState {
    return structuredClone(this.state);
  }

  get anomalies(): readonly Anomaly[] {
    return this.state.anomalies;
  }

  getAnomaly(id: number): Anomaly | undefined {
    return this.state.anomalies.find((a) => a.id === id);
  }

  /* One frame of discovery and activation. Returns true when any anomaly changed state. */
  update(exploredCells: ReadonlySet<string>, fleets: Fleet[]): boolean {
    const released = releaseOrphanedAnomalies(this.state, fleets);
    const discovered = discoverAnomalies(this.state, exploredCells);
    const activated = activateAnomalies(this.state, fleets);
    return released.length + discovered.length + activated.length > 0;
  }

  currentEvent(): Anomaly | null {
    return nextActiveAnomaly(this.state);
  }

  /* Discovered events not visited yet (map markers). The type stays unknown until visited. */
  discoveredAnomalies(): Anomaly[] {
    return this.state.anomalies.filter((a) => a.status === 'discovered');
  }

  locationLabel(anomaly: Anomaly, starSystems: StarSystem[]): string {
    const system = anomaly.site.systemId ? starSystems.find((s) => s.id === anomaly.site.systemId) : undefined;
    switch (anomaly.site.kind) {
      case 'system':
        return `${system?.name ?? 'Unknown'} system`;
      case 'asteroid':
        return `${system?.name ?? 'Unknown'} asteroid belt`;
      case 'space':
        return `Deep space (${anomaly.site.x}, ${anomaly.site.y})`;
    }
  }

  buildEventVm(anomaly: Anomaly, ctx: AnomalyContext): AnomalyEventVm {
    const def = ANOMALY_DEFINITIONS[anomaly.type];
    const player = ctx.factions.find((f) => f.id === 'player');
    const fleet = ctx.fleets.find((f) => f.id === anomaly.fleetId);
    return {
      anomalyId: anomaly.id,
      name: def.name,
      category: def.category,
      description: def.description,
      location: this.locationLabel(anomaly, ctx.starSystems),
      fleetName: fleet?.name ?? 'Your fleet',
      choices: def.choices.map((choice) => {
        const reason = choiceBlockReason(choice, player);
        return {
          id: choice.id,
          label: choice.label,
          consequences: this.describeChoice(anomaly, choice, ctx),
          disabled: reason !== null,
          reason,
        };
      }),
    };
  }

  private describeChoice(anomaly: Anomaly, choice: AnomalyChoiceDef, ctx: AnomalyContext): AnomalyConsequenceVm[] {
    const lines: AnomalyConsequenceVm[] = [];
    for (const effect of choice.effects) {
      switch (effect.kind) {
        case 'resource':
          lines.push({
            text: `${effect.amount > 0 ? '+' : '−'}${Math.abs(effect.amount).toLocaleString('en-US')} ${RESOURCE_LABELS[effect.resource]}`,
            tone: effect.amount > 0 ? 'gain' : 'cost',
          });
          break;
        case 'opinion': {
          const sender = anomalySender(anomaly, ctx.factions, ctx.starSystems, ctx.fleets);
          lines.push(
            sender
              ? { text: `+${effect.amount} opinion of you: ${sender.name}`, tone: 'gain' }
              : { text: 'No diplomatic effect: the stranded crew’s empire is gone', tone: 'neutral' },
          );
          break;
        }
        case 'grant_ship':
          lines.push({
            text: `+1 ${this.shipService.getShipType(effect.shipTypeId)?.name ?? effect.shipTypeId} (joins your fleets for free)`,
            tone: 'gain',
          });
          break;
        case 'pirate_battle': {
          const ships = ANOMALY_CONFIG.pirateFleet.map((t) => this.shipService.getShipType(t)?.name ?? t);
          lines.push({ text: `Battle against ${ships.length} pirate ships (${ships.join(', ')})`, tone: 'danger' });
          const loot = ANOMALY_CONFIG.pirateLoot;
          lines.push({
            text: `Victory: +${loot.credits.toLocaleString('en-US')} credits, +${loot.rawmaterials.toLocaleString('en-US')} raw materials`,
            tone: 'gain',
          });
          lines.push({ text: 'Defeat: losses follow the normal battle rules', tone: 'neutral' });
          break;
        }
        case 'fleet_damage':
          lines.push({
            text: `Every ship loses ${Math.round(effect.fraction * 100)}% hull (never below 1 HP; repaired at a Spaceport)`,
            tone: 'cost',
          });
          lines.push({ text: 'No loot', tone: 'neutral' });
          break;
      }
    }
    if (lines.length === 0) lines.push({ text: 'No cost, no reward', tone: 'neutral' });
    return lines;
  }

  /*
   * Applies a choice of an active anomaly. All checks run before any
   * change, so a failed call leaves the game untouched; a successful one
   * resolves the anomaly (it can never be chosen again).
   */
  resolve(anomalyId: number, choiceId: string, ctx: AnomalyContext): AnomalyResolution {
    const anomaly = this.getAnomaly(anomalyId);
    if (!anomaly || anomaly.status !== 'active') return { ok: false, reason: 'This event is no longer pending.' };
    const def = ANOMALY_DEFINITIONS[anomaly.type];
    const choice = def.choices.find((c) => c.id === choiceId);
    if (!choice) return { ok: false, reason: 'Unknown choice.' };
    const player = ctx.factions.find((f) => f.id === 'player');
    const blocked = choiceBlockReason(choice, player);
    if (blocked || !player) return { ok: false, reason: blocked ?? 'No player empire.' };
    const fleet = ctx.fleets.find((f) => f.id === anomaly.fleetId && !f.destroyed);
    if (!fleet) return { ok: false, reason: 'The fleet that found this event is gone.' };

    let battle: Battle | null = null;
    let newFleet: Fleet | null = null;
    const notes: string[] = [choice.outcome];
    for (const effect of choice.effects) {
      switch (effect.kind) {
        case 'resource':
          this.applyResource(player, effect.resource, effect.amount);
          break;
        case 'opinion': {
          const sender = anomalySender(anomaly, ctx.factions, ctx.starSystems, ctx.fleets);
          if (sender) {
            adjustOpinion(sender, player, effect.amount);
            notes.push(`${sender.name} will remember this.`);
          }
          break;
        }
        case 'grant_ship':
          newFleet = this.grantShip(effect.shipTypeId, fleet, ctx);
          notes.push(`${newFleet.name} joined your fleets.`);
          break;
        case 'pirate_battle':
          battle = this.buildPirateBattle(anomaly, fleet, player);
          break;
        case 'fleet_damage':
          this.damageFleet(fleet, effect.fraction);
          break;
      }
    }
    anomaly.status = 'resolved';
    anomaly.choiceId = choice.id;
    delete anomaly.fleetId;
    delete anomaly.activatedSeq;
    return { ok: true, anomaly, message: `${def.name}: ${notes.join(' ')}`, battle, newFleet };
  }

  /* Existing purchase helpers for credits / raw materials; RP are added like other RP rewards. */
  private applyResource(faction: Faction, resource: AnomalyResource, amount: number): void {
    if (resource === 'research') {
      faction.currencies['research'] = (faction.currencies['research'] ?? 0) + amount;
      return;
    }
    const cost = { credits: 0, rawmaterials: 0 };
    cost[resource] = Math.abs(amount);
    if (amount < 0) payCost(faction, cost);
    else refundCost(faction, cost);
  }

  /* Hull loss without destruction: see the `fleet_damage` effect. */
  private damageFleet(fleet: Fleet, fraction: number): void {
    for (const ship of fleet.ships) {
      if (ship.destroyed) continue;
      const maxHp = this.shipService.getShipType(ship.type)?.hitPoints;
      if (!maxHp || maxHp <= 0) continue;
      const current = Math.min(maxHp, ship.currentHp ?? maxHp);
      ship.currentHp = Math.max(1, Math.round(current - maxHp * fraction));
    }
  }

  /*
   * The ship becomes a new player fleet on the finder's position (galaxy
   * and in-system), using the existing ship type and the shared fleet / ship
   * id spaces. It is a normal fleet: the player can merge it via Fleet Command.
   */
  private grantShip(shipTypeId: string, finder: Fleet, ctx: AnomalyContext): Fleet {
    const type = this.shipService.getShipType(shipTypeId);
    const fleet: Fleet = {
      id: this.fleetAssembly.nextFleetId(ctx.fleets),
      name: `Salvaged ${type?.name ?? 'Ship'}`,
      factionId: finder.factionId,
      x: finder.x,
      y: finder.y,
      targetX: null,
      targetY: null,
      speed: DEFAULT_FLEET_SPEED,
      system: finder.system ? { ...finder.system, targetX: null, targetY: null } : null,
      gridCol: finder.gridCol,
      gridRow: finder.gridRow,
      ships: [
        {
          id: this.shipStockService.nextShipId(ctx.fleets, ctx),
          name: type?.name ?? shipTypeId,
          type: shipTypeId,
          currentHp: type?.hitPoints,
          destroyed: false,
        },
      ],
      destroyed: false,
      sensorRange: DEFAULT_FLEET_SENSOR_RANGE,
    };
    ctx.fleets.push(fleet);
    return fleet;
  }

  /* A fleet battle against a virtual pirate fleet; the pirates are the attackers. */
  buildPirateBattle(anomaly: Anomaly, fleet: Fleet, player: Faction): Battle {
    const pirates: Fleet = {
      id: pirateFleetId(anomaly.id),
      name: 'Pirate Raiders',
      factionId: PIRATE_FACTION_ID,
      x: fleet.x,
      y: fleet.y,
      targetX: null,
      targetY: null,
      speed: DEFAULT_FLEET_SPEED,
      system: null,
      ships: ANOMALY_CONFIG.pirateFleet.map((typeId, index) => ({
        id: PIRATE_SHIP_ID_OFFSET + anomaly.id * 10 + index,
        name: this.shipService.getShipType(typeId)?.name ?? typeId,
        type: typeId,
      })),
    };
    return {
      fleet1: pirates,
      fleet2: fleet,
      faction1Name: ANOMALY_CONFIG.pirateFactionName,
      faction1Color: ANOMALY_CONFIG.pirateFactionColor,
      faction2Name: player.name,
      faction2Color: player.color,
      attackerId: pirates.id,
      defenderId: fleet.id,
      type: 'fleet',
      combatBonuses: this.researchService.buildCombatBonuses([player]),
    };
  }

  /*
   * Called with every battle result StarMap applies. When it was a pirate
   * ambush the player won, the loot is paid once. Returns a notice for the
   * player, or null when the battle was not an ambush.
   */
  applyBattleOutcome(outcome: BattleOutcome, factions: Faction[]): string | null {
    const pirateSide = [outcome.attacker, outcome.defender].find((side) => side.factionId === PIRATE_FACTION_ID);
    if (!pirateSide) return null;
    const anomaly = this.state.anomalies.find((a) => pirateFleetId(a.id) === pirateSide.fleetId);
    if (!anomaly || anomaly.type !== 'pirate_trap' || anomaly.lootClaimed) return null;
    const player = factions.find((f) => f.id === 'player');
    if (outcome.winnerFleetId === pirateSide.fleetId || !player) {
      return 'The pirates escaped with the upper hand.';
    }
    anomaly.lootClaimed = true;
    refundCost(player, { ...ANOMALY_CONFIG.pirateLoot });
    const loot = ANOMALY_CONFIG.pirateLoot;
    return `Pirates defeated! Loot: +${loot.credits.toLocaleString('en-US')} credits, ` +
      `+${loot.rawmaterials.toLocaleString('en-US')} raw materials.`;
  }
}

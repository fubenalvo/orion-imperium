import { Injectable } from '@angular/core';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { getAiDifficultyProfile } from './ai-difficulty';
import { getAiPersonalityProfile } from './ai-personality';

/*
 * =========================================================
 * AI ACTION LEDGER (measurement only)
 * =========================================================
 *
 * Counts the meaningful actions every AI faction commits, so AI activity
 * ("actions per minute") can be measured per difficulty and personality
 * before any action limit is designed (docs/ai-pipeline.md, "Action
 * ledger").
 *
 * Invariants:
 *  - Observational only. AI services call record() / reject() and never
 *    read the ledger; only EnemyDebugService (F9 panel), the simulation
 *    report and tests read it. Removing every call must not change
 *    gameplay (ai-action-ledger.spec.ts runs a game with a no-op ledger
 *    and compares the end state).
 *  - One record per committed action, at the AI call site that commits it,
 *    after the authoritative service accepted it. Shared gameplay services
 *    (ProductionService, FleetAssemblyService, …) are never instrumented:
 *    they also serve the player and would double-count AI call sites.
 *  - Game time only (StarMapAiTickService.tick feeds the saved game clock),
 *    so 1× and 3× speed and any frame length give the same numbers.
 *  - Human factions are never counted.
 *  - Bounded memory: a 60-slot one-second ring per faction for the rolling
 *    APM, at most MAX_MINUTES per-minute bins and resource samples.
 *  - In memory only, like all AI state: resetAiPipeline() clears it, the
 *    battle-screen round trip keeps it, nothing is saved. Averages use the
 *    time observed since the last reset, not the whole game clock.
 *
 * A rejection is an attempt the AI committed to that the authoritative
 * service refused (`!result.ok`, failed payment). Guard checks that stop
 * before the call are not attempts. The executor retries its current action
 * every frame, so the same rejection (faction, kind, reason) is counted at
 * most once per REJECTION_DEDUPE_SECONDS.
 */

export type AiActionCategory = 'economy' | 'military' | 'research' | 'expansion' | 'diplomacy';

export const AI_ACTION_CATEGORIES: readonly AiActionCategory[] = ['economy', 'military', 'research', 'expansion', 'diplomacy'];

/* Every countable action and its category. See docs/ai-pipeline.md for the commit point of each. */
export const AI_ACTION_KINDS = {
  building_placed: 'economy',
  warship_queued: 'economy',
  raw_purchase: 'economy',
  fleet_order: 'military',
  assault_ordered: 'military',
  ships_deployed: 'military',
  fleet_to_reserve: 'military',
  pipeline_fleet_action: 'military',
  dyson_fleet_order: 'military',
  legacy_pursuit: 'military',
  tech_purchased: 'research',
  colonizer_queued: 'expansion',
  colonizer_assembled: 'expansion',
  colonizer_dispatched: 'expansion',
  colonized: 'expansion',
  outpost_queued: 'expansion',
  outpost_fleet_created: 'expansion',
  mining_dispatch: 'expansion',
  station_deployed: 'expansion',
  constructor_queued: 'expansion',
  constructor_fleet_created: 'expansion',
  constructor_dispatched: 'expansion',
  anchor_deployed: 'expansion',
  war_declared: 'diplomacy',
  treaty_broken: 'diplomacy',
  demand_issued: 'diplomacy',
  demand_answered: 'diplomacy',
  threat_carried_out: 'diplomacy',
  threat_backed_down: 'diplomacy',
  peace_offered: 'diplomacy',
  peace_signed: 'diplomacy',
} as const satisfies Record<string, AiActionCategory>;

export type AiActionKind = keyof typeof AI_ACTION_KINDS;

type CategoryCounts = Record<AiActionCategory, number>;

export interface AiActionMinute extends CategoryCounts {
  /* Absolute game minute (floor(gameSeconds / 60)). */
  minute: number;
  rejected: number;
}

export interface AiResourceSample {
  minute: number;
  credits: number;
  rawmaterials: number;
  research: number;
  planets: number;
  /* Living ships in the faction's fleets (stock not included). */
  fleetShips: number;
}

/* Compact numbers for the F9 panel. */
export interface AiActionSnapshot {
  /* Actions in the last 60 game seconds (or fewer, scaled to a minute, early on). */
  apm: number;
  byCategory: CategoryCounts;
  rejectedPerMinute: number;
  /* Average APM since the ledger started observing (last load / new game). */
  averageApm: number;
  total: number;
}

export interface AiActionPhase {
  label: string;
  fromMinute: number;
  /* Exclusive; undefined = open-ended. */
  toMinute?: number;
  observedMinutes: number;
  apm: number;
  byCategory: CategoryCounts;
  rejectedPerMinute: number;
}

export interface AiActionReportFaction {
  factionId: string;
  name: string;
  difficulty: string;
  personality: string;
  observedSeconds: number;
  total: number;
  averageApm: number;
  totalsByCategory: CategoryCounts;
  averageApmByCategory: CategoryCounts;
  totalsByKind: Partial<Record<AiActionKind, number>>;
  /* Summed quantities (ships deployed, fleets in an assault group, …); 1 per action when not given. */
  quantitiesByKind: Partial<Record<AiActionKind, number>>;
  rejectedByKind: Partial<Record<AiActionKind, number>>;
  rejectionReasons: Record<string, number>;
  phases: AiActionPhase[];
  perMinute: AiActionMinute[];
  resources: AiResourceSample[];
}

export interface AiActionReport {
  gameSeconds: number;
  factions: AiActionReportFaction[];
}

interface FactionLedger {
  factionId: string;
  name: string;
  difficulty: string;
  personality: string;
  totals: Partial<Record<AiActionKind, number>>;
  quantities: Partial<Record<AiActionKind, number>>;
  rejected: Partial<Record<AiActionKind, number>>;
  rejectionReasons: Record<string, number>;
  lastRejectionAt: Map<string, number>;
  /*
   * Rolling window: slot = second % 60. ringSecond[slot] says which absolute
   * second the slot holds; a stale slot is cleared before reuse.
   */
  ringSecond: number[];
  ringCounts: number[][];
  ringRejected: number[];
  perMinute: AiActionMinute[];
  resources: AiResourceSample[];
}

const WINDOW_SECONDS = 60;

const emptyCounts = (): CategoryCounts => ({ economy: 0, military: 0, research: 0, expansion: 0, diplomacy: 0 });

/* Default report phases (game minutes): early, middle, late. */
export const DEFAULT_AI_ACTION_PHASES: readonly { label: string; fromMinute: number; toMinute?: number }[] = [
  { label: 'early', fromMinute: 0, toMinute: 10 },
  { label: 'middle', fromMinute: 10, toMinute: 30 },
  { label: 'late', fromMinute: 30 },
];

@Injectable({ providedIn: 'root' })
export class AiActionLedger {
  static readonly REJECTION_DEDUPE_SECONDS = 2;
  static readonly MAX_MINUTES = 240;
  // Distinct `kind:reason` keys kept per faction (reasons come from code, so this is a safety cap).
  private static readonly MAX_REASON_KEYS = 100;

  private readonly ledgers = new Map<string, FactionLedger>();
  private clock = 0;
  // Game time at which observation started (first advance() after a reset).
  private observedFrom: number | undefined;
  private lastSampledMinute: number | undefined;

  reset(): void {
    this.ledgers.clear();
    this.clock = 0;
    this.observedFrom = undefined;
    this.lastSampledMinute = undefined;
  }

  /*
   * Moves the ledger clock. `gameSeconds` is the saved game clock when the
   * caller knows it (StarMap always does); otherwise the delta is summed.
   */
  advance(gameDeltaTime: number, gameSeconds?: number): void {
    const next = gameSeconds ?? this.clock + Math.max(0, gameDeltaTime);
    if (this.observedFrom === undefined) {
      this.observedFrom = Math.max(0, next - Math.max(0, gameDeltaTime));
    }
    this.clock = next;
  }

  get gameSeconds(): number {
    return this.clock;
  }

  get observedSeconds(): number {
    return this.observedFrom === undefined ? 0 : Math.max(0, this.clock - this.observedFrom);
  }

  /* One committed action. `quantity` is informational (e.g. ships deployed); the action counts once. */
  record(faction: Faction | undefined, kind: AiActionKind, quantity = 1): void {
    const ledger = this.ledgerFor(faction);
    if (!ledger) return;
    ledger.totals[kind] = (ledger.totals[kind] ?? 0) + 1;
    ledger.quantities[kind] = (ledger.quantities[kind] ?? 0) + quantity;
    const category = AI_ACTION_KINDS[kind];
    this.ringSlot(ledger)[0][AI_ACTION_CATEGORIES.indexOf(category)]++;
    this.minuteBin(ledger)[category]++;
  }

  /* An attempt the authoritative service refused; deduplicated per (kind, reason). */
  reject(faction: Faction | undefined, kind: AiActionKind, reason = 'rejected'): void {
    const ledger = this.ledgerFor(faction);
    if (!ledger) return;
    const key = `${kind}:${reason}`;
    const last = ledger.lastRejectionAt.get(key);
    if (last !== undefined && this.clock - last < AiActionLedger.REJECTION_DEDUPE_SECONDS) return;
    ledger.lastRejectionAt.set(key, this.clock);
    ledger.rejected[kind] = (ledger.rejected[kind] ?? 0) + 1;
    if (key in ledger.rejectionReasons || Object.keys(ledger.rejectionReasons).length < AiActionLedger.MAX_REASON_KEYS) {
      ledger.rejectionReasons[key] = (ledger.rejectionReasons[key] ?? 0) + 1;
    }
    const [, slot] = this.ringSlot(ledger);
    ledger.ringRejected[slot]++;
    this.minuteBin(ledger).rejected++;
  }

  /*
   * Records one resource sample per AI faction once per game minute.
   * Cheap enough to call every frame: it returns at once until the minute changes.
   */
  sampleIfDue(factions: readonly Faction[], starSystems: readonly StarSystem[], fleets: readonly Fleet[]): void {
    const minute = Math.floor(this.clock / 60);
    if (minute === this.lastSampledMinute) return;
    this.lastSampledMinute = minute;
    const planets = new Map<string, number>();
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId) planets.set(planet.factionId, (planets.get(planet.factionId) ?? 0) + 1);
      }
    }
    const ships = new Map<string, number>();
    for (const fleet of fleets) {
      if (fleet.destroyed) continue;
      ships.set(fleet.factionId, (ships.get(fleet.factionId) ?? 0) + fleet.ships.filter((s) => !s.destroyed).length);
    }
    for (const faction of factions) {
      const ledger = this.ledgerFor(faction);
      if (!ledger) continue;
      ledger.resources.push({
        minute,
        credits: Math.round(faction.currencies['credits'] ?? 0),
        rawmaterials: Math.round(faction.currencies['rawmaterials'] ?? 0),
        research: Math.round(faction.currencies['research'] ?? 0),
        planets: planets.get(faction.id) ?? 0,
        fleetShips: ships.get(faction.id) ?? 0,
      });
      if (ledger.resources.length > AiActionLedger.MAX_MINUTES) ledger.resources.shift();
    }
  }

  snapshot(factionId: string): AiActionSnapshot {
    const ledger = this.ledgers.get(factionId);
    const byCategory = emptyCounts();
    if (!ledger) {
      return { apm: 0, byCategory, rejectedPerMinute: 0, averageApm: 0, total: 0 };
    }
    const now = Math.floor(this.clock);
    let rejected = 0;
    for (let slot = 0; slot < WINDOW_SECONDS; slot++) {
      const second = ledger.ringSecond[slot];
      if (second > now - WINDOW_SECONDS && second <= now) {
        AI_ACTION_CATEGORIES.forEach((c, i) => (byCategory[c] += ledger.ringCounts[slot][i]));
        rejected += ledger.ringRejected[slot];
      }
    }
    // Early on the window is shorter than a minute; scale it up to a rate.
    const scale = 60 / Math.min(WINDOW_SECONDS, Math.max(1, this.observedSeconds));
    for (const c of AI_ACTION_CATEGORIES) byCategory[c] = round1(byCategory[c] * scale);
    const total = sumKinds(ledger.totals);
    return {
      apm: round1(AI_ACTION_CATEGORIES.reduce((n, c) => n + byCategory[c], 0)),
      byCategory,
      rejectedPerMinute: round1(rejected * scale),
      averageApm: round1(total / Math.max(1 / 60, this.observedSeconds / 60)),
      total,
    };
  }

  report(phases: readonly { label: string; fromMinute: number; toMinute?: number }[] = DEFAULT_AI_ACTION_PHASES): AiActionReport {
    const observedMinutes = Math.max(1 / 60, this.observedSeconds / 60);
    const from = (this.observedFrom ?? 0) / 60;
    const to = this.clock / 60;
    return {
      gameSeconds: round1(this.clock),
      factions: [...this.ledgers.values()].map((ledger) => {
        const totalsByCategory = emptyCounts();
        for (const [kind, count] of Object.entries(ledger.totals) as [AiActionKind, number][]) {
          totalsByCategory[AI_ACTION_KINDS[kind]] += count;
        }
        const averageApmByCategory = emptyCounts();
        for (const c of AI_ACTION_CATEGORIES) averageApmByCategory[c] = round2(totalsByCategory[c] / observedMinutes);
        const total = sumKinds(ledger.totals);
        return {
          factionId: ledger.factionId,
          name: ledger.name,
          difficulty: ledger.difficulty,
          personality: ledger.personality,
          observedSeconds: round1(this.observedSeconds),
          total,
          averageApm: round2(total / observedMinutes),
          totalsByCategory,
          averageApmByCategory,
          totalsByKind: { ...ledger.totals },
          quantitiesByKind: { ...ledger.quantities },
          rejectedByKind: { ...ledger.rejected },
          rejectionReasons: { ...ledger.rejectionReasons },
          phases: phases.map((p) => phaseSummary(ledger, p, from, to)),
          perMinute: ledger.perMinute.map((m) => ({ ...m })),
          resources: ledger.resources.map((r) => ({ ...r })),
        };
      }),
    };
  }

  private ledgerFor(faction: Faction | undefined): FactionLedger | undefined {
    if (!faction || faction.ai !== true) return undefined;
    let ledger = this.ledgers.get(faction.id);
    if (!ledger) {
      ledger = {
        factionId: faction.id,
        name: faction.name,
        difficulty: '',
        personality: '',
        totals: {},
        quantities: {},
        rejected: {},
        rejectionReasons: {},
        lastRejectionAt: new Map(),
        ringSecond: new Array(WINDOW_SECONDS).fill(-Infinity),
        ringCounts: Array.from({ length: WINDOW_SECONDS }, () => new Array(AI_ACTION_CATEGORIES.length).fill(0)),
        ringRejected: new Array(WINDOW_SECONDS).fill(0),
        perMinute: [],
        resources: [],
      };
      this.ledgers.set(faction.id, ledger);
    }
    // Read at record time, so per-faction configuration changes are reflected.
    ledger.name = faction.name;
    ledger.difficulty = getAiDifficultyProfile(faction).id;
    ledger.personality = getAiPersonalityProfile(faction).id;
    return ledger;
  }

  /* The ring slot of the current second, cleared if it still holds an older second. */
  private ringSlot(ledger: FactionLedger): [number[], number] {
    const second = Math.floor(this.clock);
    const slot = ((second % WINDOW_SECONDS) + WINDOW_SECONDS) % WINDOW_SECONDS;
    if (ledger.ringSecond[slot] !== second) {
      ledger.ringSecond[slot] = second;
      ledger.ringCounts[slot].fill(0);
      ledger.ringRejected[slot] = 0;
    }
    return [ledger.ringCounts[slot], slot];
  }

  private minuteBin(ledger: FactionLedger): AiActionMinute {
    const minute = Math.floor(this.clock / 60);
    let bin = ledger.perMinute[ledger.perMinute.length - 1];
    if (!bin || bin.minute !== minute) {
      bin = { minute, ...emptyCounts(), rejected: 0 };
      ledger.perMinute.push(bin);
      if (ledger.perMinute.length > AiActionLedger.MAX_MINUTES) ledger.perMinute.shift();
    }
    return bin;
  }
}

/* The `reason` of a refused service result, for AiActionLedger.reject(). */
export function rejectionReason(result: object): string {
  const reason = (result as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : 'rejected';
}

function phaseSummary(
  ledger: FactionLedger,
  phase: { label: string; fromMinute: number; toMinute?: number },
  observedFromMinute: number,
  observedToMinute: number,
): AiActionPhase {
  const end = phase.toMinute ?? Infinity;
  const observedMinutes = Math.max(0, Math.min(end, observedToMinute) - Math.max(phase.fromMinute, observedFromMinute));
  const byCategory = emptyCounts();
  let rejected = 0;
  for (const bin of ledger.perMinute) {
    if (bin.minute < phase.fromMinute || bin.minute >= end) continue;
    for (const c of AI_ACTION_CATEGORIES) byCategory[c] += bin[c];
    rejected += bin.rejected;
  }
  const total = AI_ACTION_CATEGORIES.reduce((n, c) => n + byCategory[c], 0);
  const rate = (n: number) => (observedMinutes > 0 ? round2(n / observedMinutes) : 0);
  const rates = emptyCounts();
  for (const c of AI_ACTION_CATEGORIES) rates[c] = rate(byCategory[c]);
  return {
    label: phase.label,
    fromMinute: phase.fromMinute,
    toMinute: phase.toMinute,
    observedMinutes: round2(observedMinutes),
    apm: rate(total),
    byCategory: rates,
    rejectedPerMinute: rate(rejected),
  };
}

function sumKinds(counts: Partial<Record<AiActionKind, number>>): number {
  return Object.values(counts).reduce((n, v) => n + (v ?? 0), 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

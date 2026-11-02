import { Injectable } from '@angular/core';
import { StarMapData } from '../components/star-map/star-map.models';
import { ensureSystemAsteroidBelts } from '../components/star-map/system-asteroids';
import { ensurePlanetDeposits } from '../components/star-map/raw-deposits';
import { isSupportedSaveVersion, validateSaveData } from './save-validation';
import { normalizeRelations } from '../components/star-map/diplomacy';
import { generateAnomalies, sanitizeAnomalyState } from '../components/star-map/anomalies';
import { createInitialTradeNetworkState } from '../components/star-map/trade-network';
import { ShipStockService } from './ship-stock.service';

/*
 * =========================================================
 * SAVE GAME SERVICE
 * =========================================================
 *
 * Persistence layer using localStorage.
 * Stores 5 save slots (1 autosave + 4 manual), each containing
 * a full StarMapData snapshot.
 *
 * Slot 0 = Autosave (system-only)
 * Slots 1-4 = Manual saves (user-initiated)
 *
 * Storage key: 'orion_save_slots'
 * Format: JSON array of SaveSlot objects
 *
 * Corruption is isolated per slot: a single unreadable slot never hides
 * the others. The raw value is quarantined to a backup key before any
 * rewrite so a future migration can recover it.
 */

export interface SaveSlot {
  data: StarMapData | null;
  date: string | null;
  /*
   * True when the slot holds a save whose format this game no longer loads
   * (isSupportedSaveVersion). The slot still lists so the player sees it and
   * may overwrite it; activation refuses it.
   */
  incompatible?: boolean;
}

/* Slot text shown instead of the date for an incompatible save. */
export function incompatibleSlotLabel(slot: SaveSlot): string {
  const version = slot.data?.gameVersion;
  return version ? `Incompatible (v${version})` : 'Incompatible (older version)';
}

export const SaveSlotId = {
  AUTOSAVE: 0,
  MANUAL_1: 1,
  MANUAL_2: 2,
  MANUAL_3: 3,
  MANUAL_4: 4,
} as const;

export const MANUAL_SLOT_START = SaveSlotId.MANUAL_1;
export const MANUAL_SLOT_COUNT = 4;
export const TOTAL_SLOT_COUNT = MANUAL_SLOT_COUNT + 1;

@Injectable({ providedIn: 'root' })
export class SaveGameService {
  private readonly storageKey = 'orion_save_slots';
  private readonly backupKey = 'orion_save_slots_corrupt_backup';
  private readonly slotCount = TOTAL_SLOT_COUNT;

  currentSlot: number | null = null;

  /*
   * Last persistence error, or null when the last operation succeeded.
   * Used by the UI to avoid reporting "GAME SAVED" after a failed write.
   * Note that activation/validation errors also surface here.
   */
  lastError: string | null = null;

  getSlotsError(): string | null {
    return this.lastError;
  }

  getSlots(): SaveSlot[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.storageKey);
    } catch {
      this.lastError = 'storage_unavailable';
      return this.emptySlots();
    }

    if (!raw) {
      this.lastError = null;
      return this.emptySlots();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.lastError = 'save_corrupt_parse';
      this.backupRaw(raw);
      return this.emptySlots();
    }

    if (!Array.isArray(parsed)) {
      this.lastError = 'save_corrupt_shape';
      this.backupRaw(raw);
      return this.emptySlots();
    }

    const slots: SaveSlot[] = this.emptySlots();
    let sawCorruptSlot = false;

    for (let i = 0; i < this.slotCount; i++) {
      try {
        const slot = parsed[i] as { data?: StarMapData | null; date?: string | null } | undefined;
        if (slot && typeof slot === 'object' && slot.data) {
          const normalized = this.normalizeSave(slot.data as StarMapData);
          if (this.isSlotShapeValid(normalized)) {
            slots[i] = { data: normalized, date: slot.date ?? null };
            if (!isSupportedSaveVersion(normalized)) {
              slots[i].incompatible = true;
            }
          } else {
            sawCorruptSlot = true;
            slots[i] = { data: null, date: null };
          }
        } else {
          slots[i] = { data: null, date: null };
        }
      } catch {
        sawCorruptSlot = true;
        slots[i] = { data: null, date: null };
      }
    }

    if (sawCorruptSlot) {
      this.lastError = 'slot_corrupt';
      this.backupRaw(raw);
    } else {
      this.lastError = null;
    }

    return slots;
  }

  getSlot(slotIndex: number): SaveSlot {
    const slots = this.getSlots();
    return slots[slotIndex] ?? { data: null, date: null };
  }

  saveToSlot(slotIndex: number, data: StarMapData): boolean {
    const slots = this.getSlots();
    slots[slotIndex] = {
      data,
      date: new Date().toISOString(),
    };

    try {
      localStorage.setItem(this.storageKey, this.serializeSlots(slots));
      this.lastError = null;
      return true;
    } catch {
      this.lastError = 'save_quota_error';
      return false;
    }
  }

  loadFromSlot(slotIndex: number): StarMapData | null {
    const slot = this.getSlot(slotIndex);
    if (!slot.data) {
      return null;
    }
    return this.normalizeSave(slot.data);
  }

  /*
   * activateSlot: Prepares a save slot as the active session.
   *
   * The active session is always backed by the AUTOSAVE slot (slot 0).
   * Loading a manual slot copies its full snapshot into autosave and
   * switches `currentSlot` to 0 so every subsequent runtime save writes
   * to the same slot that reloadAfterBattle / loadGame read back.
   *
   * The selected manual snapshot is never mutated by activation, and
   * malformed slots leave the current session untouched.
   */
  activateSlot(slotIndex: number): boolean {
    const previousSlot = this.currentSlot;
    const slot = this.getSlot(slotIndex);
    if (!slot.data || !this.isValidSaveData(slot.data)) {
      return false;
    }
    if (slotIndex !== SaveSlotId.AUTOSAVE) {
      if (!this.saveToSlot(SaveSlotId.AUTOSAVE, this.normalizeSave(slot.data))) {
        this.currentSlot = previousSlot;
        return false;
      }
    }
    this.currentSlot = SaveSlotId.AUTOSAVE;
    return true;
  }

  isValidSaveData(data: StarMapData): boolean {
    const result = validateSaveData(data);
    if (!result.ok) {
      this.lastError = `save_invalid: ${result.errors[0]?.message ?? 'unknown error'}`;
      return false;
    }
    return true;
  }

  /*
   * normalizeSave: Completes and repairs a supported save in place. Runs on
   * every slot read, activation and load, so it must stay idempotent.
   *
   * It is not a migration: saves below MIN_SUPPORTED_SAVE_VERSION are
   * returned untouched (validateSaveData rejects them) and the version is
   * never raised. What it does:
   * - initializes state a freshly generated galaxy does not carry yet
   *   (GalaxyGeneratorService leaves spaceBases, diplomaticDemands,
   *   anomalies and tradeNetwork to the first load);
   * - repairs that every load needs (relations, in-system asteroid belts,
   *   planet deposits, unique ship ids).
   */
  normalizeSave(data: StarMapData): StarMapData {
    if (!isSupportedSaveVersion(data)) {
      return data;
    }

    const systems = Array.isArray(data.starSystems) ? data.starSystems : [];
    const factions = Array.isArray(data.factions) ? data.factions : [];

    for (const system of systems) {
      const planets = Array.isArray(system?.planetsTiles) ? system.planetsTiles : [];
      for (const planet of planets) {
        // Generated planets other than homeworlds start without the array.
        if (!planet.resourceTiles) {
          planet.resourceTiles = [];
        }
      }
    }

    // Fills and repairs treaty relations (missing pairs become war, values
    // are clamped, symmetric fields reconciled). Idempotent.
    normalizeRelations(factions.filter((f) => f && typeof f === 'object'));

    if (data.spaceBases === undefined) {
      data.spaceBases = [];
    }
    if (!Array.isArray(data.diplomaticDemands)) {
      data.diplomaticDemands = [];
    }

    // Systems without an in-system asteroid belt get their deterministic one,
    // and planets with deposit tiles get their finite reserve if missing;
    // saved belts and reserves (including depleted ones) are kept.
    ensureSystemAsteroidBelts(systems, data.galaxy?.seed ?? 0);
    ensurePlanetDeposits(systems.flatMap((s) => (Array.isArray(s?.planetsTiles) ? s.planetsTiles : [])));

    // A game without a valid anomaly state (a new game, or malformed state)
    // gets its galaxy's deterministic set exactly once; needs the asteroid
    // belts above. A saved state is kept as it is.
    if (!sanitizeAnomalyState(data.anomalies) && data.map && data.map.width > 0 && data.map.height > 0) {
      data.anomalies = generateAnomalies({
        seed: data.galaxy?.seed ?? 0,
        width: data.map.width,
        height: data.map.height,
        starSystems: systems,
        factions,
        fleets: Array.isArray(data.fleets) ? data.fleets : [],
        specialObjects: data.specialObjects ?? [],
        asteroidBelts: data.asteroidBelts ?? [],
      });
    }

    // A new game starts with an empty trade network; the traders of its
    // Trading Posts are created by TradeNetworkService.restore.
    if (data.tradeNetwork === undefined) {
      data.tradeNetwork = createInitialTradeNetworkState(data.galaxy?.seed ?? 0);
    }

    // Ship ids must be unique across fleets and stock. Idempotent repair.
    ShipStockService.repairDuplicateShipIds(data);

    return data;
  }

  clearSlot(slotIndex: number): void {
    const slots = this.getSlots();
    slots[slotIndex] = { data: null, date: null };
    try {
      localStorage.setItem(this.storageKey, this.serializeSlots(slots));
      this.lastError = null;
    } catch {
      this.lastError = 'save_quota_error';
    }
  }

  /* True when at least one slot holds a save this game can load. */
  hasAnySave(): boolean {
    return this.getSlots().some((slot) => slot.data !== null && !slot.incompatible);
  }

  /*
   * getMostRecentSlotIndex: Returns the index of the loadable save slot with
   * the latest date. Returns null if no loadable save with a readable date
   * exists; incompatible saves are skipped so the game never tries to resume
   * one.
   */
  getMostRecentSlotIndex(): number | null {
    const slots = this.getSlots();
    let bestIndex: number | null = null;
    let bestDate: number | null = null;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].incompatible) {
        continue;
      }
      const dateValue = this.parseSlotDate(slots[i].date);
      if (dateValue !== null && (bestDate === null || dateValue > bestDate)) {
        bestDate = dateValue;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private parseSlotDate(date: string | null): number | null {
    if (!date) {
      return null;
    }
    const timestamp = Date.parse(date);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  // Only data and date are stored; `incompatible` is derived on every read.
  private serializeSlots(slots: SaveSlot[]): string {
    return JSON.stringify(slots.map((slot) => ({ data: slot.data, date: slot.date })));
  }

  private emptySlots(): SaveSlot[] {
    return Array.from({ length: this.slotCount }, () => ({ data: null, date: null }));
  }

  /*
   * isSlotShapeValid: Top-level structural check applied while listing slots.
   * Deliberately permissive (empty arrays are accepted at list time) so
   * battle-screen autosaves and incompatible saves still list; strict domain
   * validation is intentionally NOT applied here — it belongs to activation
   * and load so partial data can never be destroyed by a list read.
   */
  private isSlotShapeValid(data: StarMapData): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      Array.isArray(data.fleets) &&
      Array.isArray(data.starSystems) &&
      Array.isArray(data.factions)
    );
  }

  private backupRaw(raw: string): void {
    try {
      localStorage.setItem(this.backupKey, raw);
    } catch {
      // Backup is best-effort; the original raw string may still be recoverable manually.
    }
  }
}
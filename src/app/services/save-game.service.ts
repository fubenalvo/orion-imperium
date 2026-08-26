import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { StarMapData } from '../components/star-map/star-map';

/*
 * =========================================================
 * SAVE GAME SERVICE
 * =========================================================
 *
 * Persistence layer using localStorage.
 * Stores 4 save slots, each containing a full StarMapData snapshot.
 *
 * Storage key: 'orion_save_slots'
 * Format: JSON array of SaveSlot objects
 *
 * Auto-save triggers:
 * - Entering/leaving star systems
 * - Pausing the game
 * - Exiting to main menu
 * - Battle trigger
 * - Component destroy
 */

export interface SaveSlot {
  data: StarMapData | null;
  date: string | null;
}

@Injectable({ providedIn: 'root' })
export class SaveGameService {
  private readonly storageKey = 'orion_save_slots';
  private readonly slotCount = 4;

  currentSlot: number | null = null;

  getSlots(): SaveSlot[] {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return Array.from({ length: this.slotCount }, () => ({ data: null, date: null }));
    }

    try {
      const parsed = JSON.parse(raw) as SaveSlot[];
      const slots: SaveSlot[] = [];

      for (let i = 0; i < this.slotCount; i++) {
        const slot = parsed[i];
        if (slot && slot.data) {
          slots.push({
            data: slot.data as StarMapData,
            date: slot.date ?? null,
          });
        } else {
          slots.push({ data: null, date: null });
        }
      }

      return slots;
    } catch {
      return Array.from({ length: this.slotCount }, () => ({ data: null, date: null }));
    }
  }

  getSlot(slotIndex: number): SaveSlot {
    const slots = this.getSlots();
    return slots[slotIndex] ?? { data: null, date: null };
  }

  saveToSlot(slotIndex: number, data: StarMapData): void {
    const slots = this.getSlots();
    slots[slotIndex] = {
      data,
      date: new Date().toISOString(),
    };

    localStorage.setItem(this.storageKey, JSON.stringify(slots));
  }

  loadFromSlot(slotIndex: number): StarMapData | null {
    const slot = this.getSlot(slotIndex);
    return slot.data;
  }

  clearSlot(slotIndex: number): void {
    const slots = this.getSlots();
    slots[slotIndex] = { data: null, date: null };
    localStorage.setItem(this.storageKey, JSON.stringify(slots));
  }

  hasAnySave(): boolean {
    return this.getSlots().some((slot) => slot.data !== null);
  }
}

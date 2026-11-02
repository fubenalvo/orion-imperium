import { Injectable } from '@angular/core';
import { StarSystem } from './star-map.models';
import { SpaceBaseService } from './space-base.service';
import { DysonAnchorSnapshot } from './dyson-news';
import { DysonRingService } from './dyson-ring.service';
import {
  DysonWarmupEvent,
  DysonWarmupState,
  advanceDysonWarmup,
  dysonRingHolder,
  sanitizeDysonWarmup,
} from './dyson-victory';

/*
 * =========================================================
 * DYSON VICTORY SERVICE
 * =========================================================
 *
 * Session holder of the Dyson warm-up (dyson-victory.ts). StarMap ticks it
 * every frame with the scaled game delta (paused = frozen), restores it on
 * every load from StarMapData.dysonWarmup and writes it back with the save.
 * A 'completed' event means the holder has won; StarMap then runs the game
 * outcome check, which reads the completed warm-up from the save
 * (GameOutcomeService).
 *
 * It also keeps `anchorsSeen`, the anchors as of the last Dyson news check
 * (dyson-news.ts). It lives here, not in StarMap, because StarMap is
 * destroyed while the battle screen is open: only a fresh load re-seeds it,
 * so an anchor destroyed on the battle screen is announced after the
 * battle return instead of every anchor being announced as new.
 */
@Injectable({ providedIn: 'root' })
export class DysonVictoryService {
  private current: DysonWarmupState | null = null;
  anchorsSeen: DysonAnchorSnapshot[] = [];

  constructor(
    private readonly bases: SpaceBaseService,
    private readonly ring: DysonRingService,
  ) {}

  get warmup(): DysonWarmupState | null {
    return this.current;
  }

  restore(saved: unknown): void {
    this.current = sanitizeDysonWarmup(saved);
  }

  serialize(): DysonWarmupState | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  tick(deltaSeconds: number, starSystems: readonly StarSystem[]): DysonWarmupEvent[] {
    const slotCount = this.ring.ring?.slots.length ?? 0;
    const holder = dysonRingHolder(this.bases.bases, slotCount, starSystems);
    const result = advanceDysonWarmup(this.current, holder, deltaSeconds);
    this.current = result.state;
    return result.events;
  }
}

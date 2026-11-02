import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig, setGalaxySize } from '../../services/new-game-config';
import { SpaceBaseService } from './space-base.service';
import { DysonRingService } from './dyson-ring.service';
import { DYSON_ANCHOR_SHIP_TYPE, DYSON_TECHNOLOGY_ID, dysonAnchorName, isDysonAnchor } from './dyson-anchor';
import { normalizeRelations, startWar } from './diplomacy';
import { Fleet, SpaceBase } from './star-map.models';

/*
 * AI Dyson behavior in a real StarMap session (docs/dyson-swarm.md, "AI"):
 * the whole AI pipeline, fleet movement and battle detection run through
 * StarMap.gameLoopCallback. A militarist's fleet destroys a rival's
 * anchors; a technologist flies its Swarm Constructor to the ring and
 * deploys an anchor.
 */
describe('AI Dyson Swarm (StarMap session)', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    TestBed.inject(SaveGameService).currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const start = (): StarMap => {
    const config = { ...setGalaxySize(createDefaultNewGameConfig('small'), 'small'), seed: 21 };
    expect(TestBed.inject(NewGameService).startNewGame(config, 1).ok).toBe(true);
    const fixture = TestBed.createComponent(StarMap);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  const run = (map: StarMap, seconds: number, dt = 0.5, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += dt) {
      (map as unknown as { gameLoopCallback(dt: number): void }).gameLoopCallback(dt);
      if (until?.()) return;
    }
  };

  it('a militarist fleet destroys a rival AI’s anchors', () => {
    const map = start();
    const [hunter, builder] = map.factions.filter((f) => f.ai);
    hunter.aiPersonality = 'militarist';
    builder.aiPersonality = 'technologist';
    normalizeRelations(map.factions);
    startWar(hunter, builder, 0, hunter.id);
    const ring = TestBed.inject(DysonRingService).ring!;
    const bases = TestBed.inject(SpaceBaseService);
    const anchors: SpaceBase[] = [0, 1, 2].map((slot) => ({
      id: 500 + slot, name: dysonAnchorName(slot), factionId: builder.id, x: ring.slots[slot].col, y: ring.slots[slot].row,
      kind: 'dyson', dysonSlot: slot,
    }));
    bases.restore(anchors);
    // A strong militarist fleet a few cells off the ring.
    const strike: Fleet = {
      id: 9001, name: 'Strike', factionId: hunter.id, x: Math.round(ring.cx + 14), y: Math.round(ring.cy), targetX: null, targetY: null,
      speed: 2, system: null, ships: Array.from({ length: 6 }, (_, i) => ({ id: 900100 + i, name: 'C', type: 'cruiser' })),
    };
    map.fleets.push(strike);

    run(map, 400, 0.5, () => bases.bases.filter((b) => isDysonAnchor(b) && b.factionId === builder.id).length < 3);
    expect(bases.bases.filter((b) => isDysonAnchor(b) && b.factionId === builder.id).length).toBeLessThan(3);
  }, 60_000);

  it('a technologist flies its Swarm Constructor to the ring and deploys an anchor', () => {
    const map = start();
    const tech = map.factions.find((f) => f.ai)!;
    tech.aiPersonality = 'technologist';
    tech.researchedTechnologies = [...(tech.researchedTechnologies ?? []), DYSON_TECHNOLOGY_ID];
    const ring = TestBed.inject(DysonRingService).ring!;
    // Already on its way: a constructor fleet a short flight from the ring.
    map.fleets.push({
      id: 9002, name: 'Builders', factionId: tech.id, x: Math.round(ring.cx + 13), y: Math.round(ring.cy + 3), targetX: null, targetY: null,
      speed: 1, system: null, ships: [{ id: 900200, name: 'SC', type: DYSON_ANCHOR_SHIP_TYPE }],
    });
    const bases = TestBed.inject(SpaceBaseService);

    run(map, 300, 0.5, () => bases.bases.some((b) => isDysonAnchor(b) && b.factionId === tech.id));
    const anchor = bases.bases.find((b) => isDysonAnchor(b) && b.factionId === tech.id);
    expect(anchor).toBeDefined();
    expect(anchor!.dysonBonus).toBe('swarm_observatory');
  }, 60_000);
});

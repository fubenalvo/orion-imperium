import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, Fleet, PlanetTile } from './star-map.models';
import {
  OPENING_GRACE_SECONDS,
  OpeningGraceService,
  blocksOpeningFleetBattle,
  isSparedByOpeningGrace,
} from './opening-grace';
import { normalizeRelations } from './diplomacy';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { EnemyInvasionService } from './enemy-invasion.service';
import { BattleService } from '../../services/battle.service';

/*
 * Opening grace (opening-grace.ts): for the first OPENING_GRACE_SECONDS an
 * AI does not attack the human player; the player may still attack, and
 * AI-vs-AI wars are untouched.
 */

const faction = (id: string, ai: boolean, team: number): Faction =>
  ({ id, name: id, color: '#fff', team, ai, currencies: { credits: 0, rawmaterials: 0, research: 0 } }) as unknown as Faction;

const fleet = (id: number, factionId: string, x: number, y: number, extra: Partial<Fleet> = {}): Fleet => ({
  id, name: `F${id}`, factionId, x, y, targetX: null, targetY: null, speed: 4, system: null,
  ships: [{ id: id * 10, name: 'Frigate', type: 'frigate' }],
  ...extra,
});

describe('opening grace', () => {
  let factions: Faction[];
  const player = () => factions[0];
  const ai1 = () => factions[1];
  const ai2 = () => factions[2];

  beforeEach(() => {
    factions = [faction('player', false, 1), faction('enemy1', true, 2), faction('enemy2', true, 3)];
    normalizeRelations(factions); // everyone at war, as in a new game
    TestBed.inject(BattleService).clearBattle();
  });

  it('spares only the human from AI attackers, and only before the grace ends', () => {
    expect(isSparedByOpeningGrace(ai1(), player(), 0)).toBe(true);
    expect(isSparedByOpeningGrace(ai1(), 'player', OPENING_GRACE_SECONDS - 1)).toBe(true);
    expect(isSparedByOpeningGrace(ai1(), player(), OPENING_GRACE_SECONDS)).toBe(false);
    expect(isSparedByOpeningGrace(ai1(), ai2(), 0)).toBe(false);
    expect(isSparedByOpeningGrace(player(), ai1(), 0)).toBe(false);
  });

  it('blocks a fleet contact the AI started, but not one the player started', () => {
    const aiMoving = fleet(2, 'enemy1', 10, 10, { targetX: 20, targetY: 20 });
    const playerIdle = fleet(1, 'player', 10, 10);
    expect(blocksOpeningFleetBattle(playerIdle, player(), aiMoving, ai1(), 0)).toBe(true);
    expect(blocksOpeningFleetBattle(playerIdle, player(), aiMoving, ai1(), OPENING_GRACE_SECONDS)).toBe(false);

    const playerMoving = fleet(1, 'player', 10, 10, { targetX: 20, targetY: 20 });
    const aiIdle = fleet(2, 'enemy1', 10, 10);
    expect(blocksOpeningFleetBattle(playerMoving, player(), aiIdle, ai1(), 0)).toBe(false);

    const ordered = fleet(1, 'player', 10, 10, { attackFleetId: 2 });
    expect(blocksOpeningFleetBattle(ordered, player(), aiMoving, ai1(), 0)).toBe(false);
  });

  describe('battle detection', () => {
    const detect = (fleets: Fleet[]) => {
      let entered = false;
      const triggered = new Set<string>();
      TestBed.inject(StarMapBattleDetectionService).checkForBattles(
        fleets, factions, (x, y) => ({ col: Math.floor(x), row: Math.floor(y) }), () => false, [],
        () => { entered = true; }, triggered,
      );
      return { entered, triggered };
    };

    it('no battle when an AI fleet runs into a player fleet during the grace; the same contact fights afterwards', () => {
      const fleets = [fleet(1, 'player', 10, 10), fleet(2, 'enemy1', 10, 10, { targetX: 30, targetY: 30 })];
      const grace = TestBed.inject(OpeningGraceService);
      grace.setGameSeconds(10);
      const during = detect(fleets);
      expect(during.entered).toBe(false);
      expect(during.triggered.size).toBe(0);

      grace.setGameSeconds(OPENING_GRACE_SECONDS);
      expect(detect(fleets).entered).toBe(true);
    });

    it('a player attack is fought during the grace', () => {
      TestBed.inject(OpeningGraceService).setGameSeconds(10);
      const fleets = [fleet(1, 'player', 10, 10, { attackFleetId: 2, targetX: 10.5, targetY: 10.5 }), fleet(2, 'enemy1', 10, 10)];
      expect(detect(fleets).entered).toBe(true);
    });
  });

  it('the player’s planets are no AI assault target during the grace; AI planets still are', () => {
    const invasion = TestBed.inject(EnemyInvasionService);
    const grace = TestBed.inject(OpeningGraceService);
    const planet = (factionId: string) => ({ id: 1, factionId } as unknown as PlanetTile);
    grace.setGameSeconds(10);
    expect(invasion.isHostilePlanet(planet('player'), ai1(), factions)).toBe(false);
    expect(invasion.isHostilePlanet(planet('enemy2'), ai1(), factions)).toBe(true);
    grace.setGameSeconds(OPENING_GRACE_SECONDS);
    expect(invasion.isHostilePlanet(planet('player'), ai1(), factions)).toBe(true);
  });
});

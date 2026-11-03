import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { PIRATE_CONFIG, PIRATE_FACTION_ID, PirateIncursionService, PirateWorld } from './pirate-incursion';
import { SpaceBaseService } from './space-base.service';
import { areFactionsHostile, canAttackPlanetOf, isTreatyPair, normalizeRelations } from './diplomacy';

/*
 * Pirate incursion (docs/pirate-incursion.md): quiet-galaxy trigger, the
 * outlaw faction, the haven, raiders taking turns, credit drain, the end.
 */

const faction = (id: string, ai: boolean, team: number): Faction =>
  ({ id, name: id, color: '#fff', team, ai, currencies: { credits: 5000, rawmaterials: 0, research: 0 } }) as unknown as Faction;

const system = (id: string, x: number, y: number, owner: string): StarSystem => ({
  id, name: id, x, y, planets: 1, color: '#fff', explored: true,
  planetsTiles: [{ id: x * 1000 + y, index: 0, name: 'P', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium', population: 100, buildings: [], explored: true } as unknown as PlanetTile],
});

describe('pirate incursion', () => {
  let service: PirateIncursionService;
  let world: PirateWorld;

  beforeEach(() => {
    service = TestBed.inject(PirateIncursionService);
    TestBed.inject(SpaceBaseService).restore([]);
    service.restore(undefined, 7);
    const factions = [faction('player', false, 1), faction('enemy1', true, 2)];
    normalizeRelations(factions);
    const fleets: Fleet[] = [{
      id: 1, name: 'Home', factionId: 'enemy1', x: 10, y: 10, targetX: null, targetY: null, speed: 4, system: null,
      ships: Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Frigate', type: 'frigate' })),
    }];
    world = {
      gameSeconds: 0, factions, fleets, mapWidth: 120, mapHeight: 80,
      starSystems: [system('home', 10, 10, 'player'), system('vex', 110, 70, 'enemy1')],
    };
  });

  /* Moves every pirate fleet straight onto its target (no movement service in this test). */
  const fly = () => {
    for (const f of world.fleets) {
      if (f.factionId === PIRATE_FACTION_ID && f.targetX !== null && f.targetY !== null) {
        f.x = f.targetX; f.y = f.targetY; f.targetX = null; f.targetY = null;
      }
    }
  };

  it('stays away while the galaxy is busy or before minute 20', () => {
    world.gameSeconds = PIRATE_CONFIG.firstAfter - 1;
    expect(service.tick(1, world)).toEqual([]);
    world.gameSeconds = PIRATE_CONFIG.firstAfter + 10;
    service.noteActivity(PIRATE_CONFIG.firstAfter);
    expect(service.tick(1, world)).toEqual([]);
    expect(service.phase).toBe('idle');
  });

  it('a quiet galaxy gets a pirate warband, a haven, and raiders that take turns and drain credits', () => {
    world.gameSeconds = PIRATE_CONFIG.firstAfter + PIRATE_CONFIG.quietSeconds;
    const start = service.tick(1, world);
    expect(start[0]).toContain('Pirate raiders have entered the galaxy');
    expect(service.phase).toBe('arriving');
    const pirates = world.factions.find((f) => f.id === PIRATE_FACTION_ID)!;
    // Outlaws: always at war, no diplomacy, never capture planets.
    expect(areFactionsHostile(pirates, world.factions[0])).toBe(true);
    expect(areFactionsHostile(pirates, world.factions[1])).toBe(true);
    expect(isTreatyPair(pirates, world.factions[0])).toBe(false);
    expect(canAttackPlanetOf(pirates, world.factions[0])).toBe(false);

    fly();
    service.tick(1, world);
    expect(service.phase).toBe('active');
    const haven = TestBed.inject(SpaceBaseService).basesOf(PIRATE_FACTION_ID)[0];
    expect(haven).toBeDefined();

    // Construction, then the first raider.
    world.gameSeconds += 1;
    service.tick(PIRATE_CONFIG.havenBuildSeconds + PIRATE_CONFIG.spawnInterval.max, world);
    TestBed.inject(SpaceBaseService).advanceConstruction(PIRATE_CONFIG.havenBuildSeconds);
    service.tick(PIRATE_CONFIG.spawnInterval.max, world);
    const state = service.serialize();
    expect(state.raiders.length).toBe(1);
    const firstTarget = state.raiders[0].targetFactionId;

    fly();
    service.tick(1, world); // arrives: raid starts
    const victim = world.factions.find((f) => f.id === firstTarget)!;
    const before = victim.currencies['credits'];
    service.tick(10, world);
    expect(victim.currencies['credits']).toBeLessThan(before);
    expect(before - victim.currencies['credits']).toBeLessThanOrEqual(PIRATE_CONFIG.drainCapPerRaid);

    // After the raid the next empire is targeted.
    service.tick(PIRATE_CONFIG.raidStaySeconds, world);
    expect(service.serialize().raiders[0].targetFactionId).not.toBe(firstTarget);
  });

  it('destroying the haven ends the event, removes the raiders and starts the cooldown', () => {
    world.gameSeconds = PIRATE_CONFIG.firstAfter + PIRATE_CONFIG.quietSeconds;
    service.tick(1, world);
    fly();
    service.tick(1, world);
    const bases = TestBed.inject(SpaceBaseService);
    bases.destroy(bases.basesOf(PIRATE_FACTION_ID)[0].id);
    expect(service.tick(1, world)[0]).toContain('destroyed');
    expect(service.phase).toBe('idle');
    expect(world.fleets.filter((f) => f.factionId === PIRATE_FACTION_ID).every((f) => f.destroyed)).toBe(true);
    world.gameSeconds += 10;
    expect(service.tick(1, world)).toEqual([]);
  });
});

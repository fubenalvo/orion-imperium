import { TestBed } from '@angular/core/testing';
import { EnemyIntelService } from './enemy-intel.service';
import { GameSettingsService } from '../../services/game-settings.service';
import { Faction, Fleet, StarSystem } from './star-map.models';

/* AI fog of war with the real sensor rules (system radius 5, fleet sensor range). */
describe('EnemyIntelService', () => {
  let service: EnemyIntelService;

  const ai: Faction = { id: 'enemy1', name: 'E', color: '#f00', team: 2, ai: true, currencies: {}, researchedTechnologies: [] };
  const player: Faction = { id: 'player', name: 'P', color: '#00f', team: 1, ai: false, currencies: {} };
  const factions = [ai, player];

  const planet = (id: number, owner: string) => ({
    id, index: 0, name: `P${id}`, factionId: owner, x: 1, y: 1, type: 'earthlike' as const, size: 'medium' as const,
    population: 100, buildings: [], explored: false,
  });
  const systems = (): StarSystem[] => [
    { id: 'home', name: 'Home', x: 10, y: 10, planets: 2, color: '#fff', planetsTiles: [planet(1, 'enemy1'), planet(2, 'unhabited')] },
    { id: 'far', name: 'Far', x: 60, y: 10, planets: 1, color: '#fff', planetsTiles: [planet(3, 'unhabited')] },
  ];
  let id = 100;
  const fleet = (factionId: string, x: number, y: number): Fleet => ({
    id: id++, name: 'F', factionId, x, y, targetX: null, targetY: null, speed: 4, system: null, sensorRange: 3,
    ships: [{ id: id++, name: 'f', type: 'frigate' }],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyIntelService);
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(true);
  });

  it('shows only sensed hostile fleets and charted planets; own assets are the real objects', () => {
    const sys = systems();
    const near = fleet('player', 13, 10);
    const hidden = fleet('player', 40, 10);
    const own = fleet('enemy1', 10, 10);
    service.tick(1, ai, factions, sys, [near, hidden, own]);
    const view = service.getView(ai, sys, [near, hidden, own]);

    expect(view.fleets).toContain(near);
    expect(view.fleets).toContain(own);
    expect(view.fleets.some((f) => f.id === hidden.id)).toBe(false);
    expect(view.starSystems.find((s) => s.id === 'home')!.planetsTiles.map((p) => p.id)).toEqual([1, 2]);
    expect(view.starSystems.find((s) => s.id === 'home')!.planetsTiles[0]).toBe(sys[0].planetsTiles[0]);
    // The star is charted, its planets are not.
    expect(view.starSystems.find((s) => s.id === 'far')!.planetsTiles).toEqual([]);
    expect(service.knowsSystem('enemy1', 'far')).toBe(false);
  });

  it('remembers a fleet at its last-seen position, never its hidden real one', () => {
    const sys = systems();
    const picket = fleet('enemy1', 30, 10); // sensor range 3
    const scout = fleet('player', 32, 10);
    service.tick(1, ai, factions, sys, [picket, scout]);
    // Both move apart: the last-seen spot is no longer covered by any sensor.
    picket.x = 20;
    scout.x = 45;
    service.tick(2, ai, factions, sys, [picket, scout]);
    const ghost = service.getView(ai, sys, [picket, scout]).fleets.find((f) => f.id === scout.id)!;

    expect(ghost).not.toBe(scout);
    expect(ghost.x).toBe(32);
    expect(service.isVisible('enemy1', scout.id)).toBe(false);
    expect(service.getKnownPosition('enemy1', scout)).toEqual({ x: 32, y: 10 });
  });

  it('drops a sighting whose spot is seen empty, and forgets old ones after their time-to-live', () => {
    const sys = systems();
    const scout = fleet('player', 13, 10); // seen by the home system (radius 5)
    service.tick(1, ai, factions, sys, [scout]);
    scout.x = 45;
    service.tick(2, ai, factions, sys, [scout]);
    // The home sensors still cover x=13 and see nothing there.
    expect(service.getView(ai, sys, [scout]).fleets.some((f) => f.id === scout.id)).toBe(false);

    const picket = fleet('enemy1', 30, 10);
    const raider = fleet('player', 32, 10);
    service.tick(2, ai, factions, sys, [picket, raider]);
    picket.x = 20;
    raider.x = 50;
    service.tick(2, ai, factions, sys, [picket, raider]);
    for (let t = 0; t < 35; t++) service.tick(2, ai, factions, sys, [picket, raider]);
    expect(service.isUncertain('enemy1', raider.id)).toBe(true);
    for (let t = 0; t < 120; t++) service.tick(2, ai, factions, sys, [picket, raider]);
    expect(service.getView(ai, sys, [picket, raider]).fleets.some((f) => f.id === raider.id)).toBe(false);
  });

  it('charts a system once one of its own fleets has sensed it, keeping the last-seen snapshot', () => {
    const sys = systems();
    const explorer = fleet('enemy1', 59, 10);
    service.tick(1, ai, factions, sys, [explorer]);
    expect(service.knowsSystem('enemy1', 'far')).toBe(true);
    sys[1].planetsTiles[0].factionId = 'player'; // changes after the explorer left
    explorer.x = 30;
    service.tick(2, ai, factions, sys, [explorer]);
    const far = service.getView(ai, sys, [explorer]).starSystems.find((s) => s.id === 'far')!;
    expect(far.planetsTiles[0].factionId).toBe('unhabited');
  });

  it('uses the real world when fog of war is disabled (what the player sees)', () => {
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(false);
    const sys = systems();
    const hidden = fleet('player', 40, 10);
    service.tick(1, ai, factions, sys, [hidden]);
    const view = service.getView(ai, sys, [hidden]);
    expect(view.fleets).toEqual([hidden]);
    expect(view.starSystems).toBe(sys);
  });
});

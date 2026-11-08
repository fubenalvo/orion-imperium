import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnemyEquipmentService } from './enemy-equipment.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { ShipService } from '../../services/ship.service';
import { Faction, FactionEquipmentInventory, FactionProduction, FactionShipStock, Fleet, FleetShip, PlanetTile, StarSystem } from './star-map.models';
import { addToInventory, inventoryCount } from './equipment-inventory';
import { SYSTEM_CELL_SIZE_VW } from './system-grid';

/*
 * Phase 8 of docs/ship-equipment.md: AI refits through the player's rules.
 * The economy's financial answers are stubbed so each rule is tested alone;
 * the long simulations cover the whole pipeline.
 */

const cell = (col: number, row: number) => ({
  x: (col - 1) * SYSTEM_CELL_SIZE_VW + SYSTEM_CELL_SIZE_VW / 2,
  y: (row - 1) * SYSTEM_CELL_SIZE_VW + SYSTEM_CELL_SIZE_VW / 2,
});

const ALL_TECH = ['basic_engineering', 'advanced_engineering', 'military_engineering', 'missile_technology', 'advanced_manufacturing', 'advanced_weapons', 'frigate_technology'];

const aiFaction = (personality: Faction['aiPersonality'] = 'balanced', credits = 20000): Faction =>
  ({
    id: 'enemy1', name: 'Enemy', color: '#f00', team: 2, ai: true, aiPersonality: personality,
    currencies: { credits, rawmaterials: 20000 }, researchedTechnologies: ALL_TECH,
    relations: { player: { state: 'war' } },
  }) as unknown as Faction;
const player = (): Faction =>
  ({ id: 'player', name: 'P', color: '#fff', team: 1, currencies: {}, relations: { enemy1: { state: 'war' } } }) as unknown as Faction;

const home = (): PlanetTile =>
  ({ id: 1, index: 0, name: 'Home', factionId: 'enemy1', x: 10, y: 5, type: 'earthlike', size: 'medium', population: 5000,
     buildings: [{ name: 'Spaceport' }, { name: 'Spaceship Factory' }], explored: true }) as PlanetTile;

const world = (opts: { atPort?: boolean; hostile?: FleetShip[] } = {}) => {
  const system = { id: 'sol', name: 'Sol', x: 10, y: 20, planets: 1, color: '#fff', planetsTiles: [home()] } as unknown as StarSystem;
  const pos = opts.atPort === false ? cell(25, 12) : cell(12, 5);
  const guard: Fleet = {
    id: 1, name: 'Guard', factionId: 'enemy1', x: 10.5, y: 20.5, targetX: null, targetY: null, speed: 4,
    system: { id: 'sol', x: pos.x, y: pos.y, targetX: null, targetY: null },
    ships: [
      { id: 1, name: 'S', type: 'destroyer' },
      { id: 2, name: 'S', type: 'cruiser' },
      { id: 3, name: 'S', type: 'colonizer' },
    ],
  };
  const hostile: Fleet = {
    id: 2, name: 'Raiders', factionId: 'player', x: 30, y: 30, targetX: null, targetY: null, speed: 4, system: null,
    ships: opts.hostile ?? [],
  };
  const data = {
    factions: [aiFaction(), player()],
    starSystems: [system],
    fleets: [guard, hostile],
    shipStock: [{ factionId: 'enemy1', ships: [] }] as FactionShipStock[],
    production: [] as FactionProduction[],
    equipmentInventory: [] as FactionEquipmentInventory[],
  };
  return { data, guard, faction: data.factions[0], perceived: { fleets: data.fleets, starSystems: data.starSystems } };
};

describe('EnemyEquipmentService', () => {
  let service: EnemyEquipmentService;
  let economy: EnemyEconomyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyEquipmentService);
    // Off in the game until the balance pass (see ENABLED_BY_DEFAULT); the rules are tested here.
    service.enabled = true;
    economy = TestBed.inject(EnemyEconomyService);
    vi.spyOn(economy, 'getProjectedNet').mockReturnValue({ net: 10, income: 50, rawNet: 5, upkeepScale: 1 } as never);
    vi.spyOn(economy, 'isRawConstrained').mockReturnValue(false);
    vi.spyOn(economy, 'getSpendingReserve').mockReturnValue({ credits: 0, rawmaterials: 0 });
  });

  const decide = (w: ReturnType<typeof world>) =>
    service.tick(EnemyEquipmentService.DECISION_INTERVAL, w.faction, w.data, w.perceived);
  const queued = (w: ReturnType<typeof world>) =>
    Object.values(w.data.production.find((p) => p.factionId === 'enemy1')?.ordersByPlanet ?? {}).flat();

  it('weights the perceived hostile navy by strength, and counts evenly with no sighting', () => {
    const w = world({ hostile: [{ id: 9, name: 'S', type: 'cruiser' }, { id: 10, name: 'S', type: 'fighter' }] });
    const threat = service.threatProfile(w.faction, w.data.factions, w.perceived.fleets);
    // Cruiser: energy guns, kinetic profile; fighter: kinetic guns, energy profile. The cruiser is stronger.
    expect(threat.dealt['energy']).toBeGreaterThan(threat.dealt['kinetic']);
    expect(threat.dealt['energy'] + threat.dealt['kinetic']).toBeCloseTo(1, 10);
    const none = service.threatProfile(w.faction, w.data.factions, []);
    expect(none.dealt).toEqual({ kinetic: 1 / 3, energy: 1 / 3, missile: 1 / 3 });
  });

  it('counters what it sees: kinetic guns against energy shields, a kinetic-resisting profile against kinetic guns', () => {
    const ships = TestBed.inject(ShipService);
    const destroyer = ships.getShipType('destroyer')!;
    const energyShips = world({ hostile: Array.from({ length: 4 }, (_, i) => ({ id: 20 + i, name: 'S', type: 'fighter', equipment: { defense: 'energy_shield' } })) });
    const threat = service.threatProfile(energyShips.faction, energyShips.data.factions, energyShips.perceived.fleets);
    // Hostiles resist energy and are weak to kinetic: the Railgun beats the Laser Cannon.
    expect(service.gain(destroyer, undefined, { weapon: 'railgun' }, 'weapon', threat))
      .toBeGreaterThan(service.gain(destroyer, undefined, { weapon: 'laser_cannon' }, 'weapon', threat));
    // Hostiles fire kinetic (fighters): the Kinetic Barrier beats the Energy Shield.
    expect(service.gain(destroyer, undefined, { defense: 'kinetic_barrier' }, 'defense', threat))
      .toBeGreaterThan(service.gain(destroyer, undefined, { defense: 'energy_shield' }, 'defense', threat));
  });

  it('installs the best inventory module on combat ships at a Spaceport planet, never on civil hulls', () => {
    const w = world();
    addToInventory(w.data, 'enemy1', 'railgun', 1);
    addToInventory(w.data, 'enemy1', 'advanced_shield_generator', 5);
    decide(w);
    const [destroyer, cruiser, colonizer] = w.guard.ships;
    // Heaviest first: the cruiser gets the only Railgun.
    expect(cruiser.equipment?.weapon).toBe('railgun');
    expect(destroyer.equipment?.weapon).toBeUndefined();
    expect(cruiser.equipment?.defense).toBe('advanced_shield_generator');
    expect(destroyer.equipment?.defense).toBe('advanced_shield_generator');
    expect(colonizer.equipment).toBeUndefined();
    expect(inventoryCount(w.data, 'enemy1', 'railgun')).toBe(0);
    expect(inventoryCount(w.data, 'enemy1', 'advanced_shield_generator')).toBe(3);
  });

  it('does not refit fleets away from a Spaceport planet', () => {
    const w = world({ atPort: false });
    addToInventory(w.data, 'enemy1', 'railgun', 2);
    decide(w);
    expect(w.guard.ships.every((s) => !s.equipment)).toBe(true);
  });

  it('orders the most wanted module on an idle factory, one at a time', () => {
    const w = world();
    expect(decide(w)).toBe(true);
    const orders = queued(w);
    expect(orders.length).toBe(1);
    expect(orders[0].equipmentId).toBeTruthy();
    expect(w.faction.currencies['credits']).toBeLessThan(20000);
    decide(w);
    expect(queued(w).length).toBe(1);
  });

  it('waits for the personality surplus, positive net income and enough credits', () => {
    // 2000 credits: short of a balanced faction's surplus (2500 + two module prices),
    // enough for a militarist (1500 + two prices of the cheapest wanted module).
    const balanced = world();
    balanced.faction.currencies['credits'] = 2000;
    decide(balanced);
    expect(queued(balanced)).toEqual([]);
    const militarist = world();
    militarist.data.factions[0] = aiFaction('militarist', 1500 + 2 * 250);
    militarist.faction = militarist.data.factions[0];
    decide(militarist);
    expect(queued(militarist).length).toBe(1);

    (economy.getProjectedNet as ReturnType<typeof vi.fn>).mockReturnValue({ net: -1, income: 50, rawNet: 0, upkeepScale: 1 });
    const broke = world();
    decide(broke);
    expect(queued(broke)).toEqual([]);

    (economy.getProjectedNet as ReturnType<typeof vi.fn>).mockReturnValue({ net: 10, income: 50, rawNet: 5, upkeepScale: 1 });
    const poor = world();
    poor.faction.currencies['credits'] = 300; // less than two module prices
    decide(poor);
    expect(queued(poor)).toEqual([]);
  });

  it('never queues behind ships', () => {
    const w = world();
    w.data.production.push({ factionId: 'enemy1', ordersByPlanet: { 1: [{ id: 1, shipTypeId: 'destroyer', quantity: 1, progress: 0, startedAtTick: 0 }] } });
    decide(w);
    expect(queued(w).filter((o) => o.equipmentId)).toEqual([]);
  });

  it('is off by default in the game', () => {
    expect(EnemyEquipmentService.ENABLED_BY_DEFAULT).toBe(false);
    const w = world();
    addToInventory(w.data, 'enemy1', 'railgun', 1);
    service.enabled = EnemyEquipmentService.ENABLED_BY_DEFAULT;
    expect(decide(w)).toBe(false);
    expect(queued(w)).toEqual([]);
    expect(w.guard.ships.every((s) => !s.equipment)).toBe(true);
  });

  it('does nothing without a researched module', () => {
    const w = world();
    w.faction.researchedTechnologies = ['basic_engineering'];
    expect(decide(w)).toBe(false);
    expect(queued(w)).toEqual([]);
  });
});

describe('ShipService.calculateFleetStrength with equipment', () => {
  it('is unchanged for standard ships and rises with modules', () => {
    TestBed.configureTestingModule({});
    const ships = TestBed.inject(ShipService);
    const base = ships.calculateFleetStrength([{ type: 'cruiser' }]);
    expect(ships.calculateFleetStrength([{ type: 'cruiser', equipment: {} }])).toBe(base);
    expect(ships.calculateFleetStrength([{ type: 'cruiser', equipment: { weapon: 'railgun' } }])).toBe(base + 16);
    expect(ships.calculateFleetStrength([{ type: 'cruiser', equipment: { defense: 'energy_shield' } }])).toBeCloseTo(base + 4, 10);
  });
});

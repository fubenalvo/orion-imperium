import { TestBed } from '@angular/core/testing';
import { FactionShipStock, Fleet, StarSystem } from '../components/star-map/star-map.models';
import { FleetAssemblyService } from './fleet-assembly.service';

/*
 * Stock ships are handed over at a Spaceport only (docs/fleet-organization.md#reserve):
 * reinforceFleet rejects a fleet that is not in a system with one of the
 * faction's Spaceport planets, for the player and the AI alike.
 */
describe('FleetAssemblyService.reinforceFleet location rule', () => {
  const systems = [
    {
      id: 'home',
      name: 'Home',
      x: 5,
      y: 5,
      planets: 1,
      color: '#fff',
      planetsTiles: [{ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport' }] }],
    },
    {
      id: 'far',
      name: 'Far',
      x: 40,
      y: 40,
      planets: 1,
      color: '#fff',
      planetsTiles: [{ id: 2, factionId: 'enemy1', buildings: [] }],
    },
  ] as unknown as StarSystem[];

  const setup = (x: number, y: number) => {
    const fleet: Fleet = {
      id: 1,
      name: 'F',
      factionId: 'enemy1',
      x,
      y,
      targetX: null,
      targetY: null,
      speed: 4,
      system: null,
      ships: [{ id: 10, name: 'Ship', type: 'fighter', currentHp: 50 }],
    };
    const shipStock: FactionShipStock[] = [
      { factionId: 'enemy1', ships: [{ id: 20, type: 'frigate', name: 'Ship' }] },
    ];
    return { fleet, data: { fleets: [fleet], shipStock } };
  };

  const reinforce = (data: { fleets: Fleet[]; shipStock: FactionShipStock[] }) =>
    TestBed.inject(FleetAssemblyService).reinforceFleet(data, systems, {
      factionId: 'enemy1',
      fleetId: 1,
      composition: [{ typeId: 'frigate', count: 1 }],
    });

  it('reinforces a fleet standing in a Spaceport system', () => {
    const { fleet, data } = setup(5.6, 5.2);
    expect(reinforce(data).ok).toBe(true);
    expect(fleet.ships.map((s) => s.id)).toEqual([10, 20]);
    expect(data.shipStock[0].ships).toEqual([]);
  });

  it('rejects a fleet elsewhere, even in an own system without a Spaceport', () => {
    for (const [x, y] of [
      [40, 40],
      [6, 5],
      [20, 20],
    ]) {
      const { fleet, data } = setup(x, y);
      const result = reinforce(data);
      expect(result.reason).toBe('not_at_spaceport');
      expect(fleet.ships.length).toBe(1);
      expect(data.shipStock[0].ships.length).toBe(1);
    }
  });
});

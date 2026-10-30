import { TestBed } from '@angular/core/testing';
import { autoResolveBattle } from './battle-auto-resolve';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle } from './battle.types';
import { Fleet, PlanetTile } from '../../star-map/star-map.models';

/* Non-interactive resolution with the real ship stats and planet defenses. */
describe('autoResolveBattle', () => {
  let ships: ShipService;
  let planets: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ships = TestBed.inject(ShipService);
    planets = TestBed.inject(PlanetBattleService);
  });

  let shipId = 1;
  const fleet = (id: number, factionId: string, types: string[]): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships: types.map((type) => ({ id: shipId++, name: type, type })),
  });

  const planet = (turretCount: number, shield = false): PlanetTile => ({
    id: 5,
    index: 0,
    name: 'Target',
    factionId: 'independent',
    x: 1,
    y: 1,
    type: 'earthlike',
    size: 'huge',
    population: 100,
    explored: true,
    buildings: [
      ...Array.from({ length: turretCount }, (_, i) => ({ name: 'Laser Turret', size: 1, x: i, y: 0 })),
      ...(shield ? [{ name: 'Planetary Shield', size: 2, x: 0, y: 5 }] : []),
    ],
  });

  const planetBattle = (attacker: Fleet, target: PlanetTile): Battle => {
    const defense = planets.createVirtualDefenseFleet(target, null);
    return {
      fleet1: attacker,
      fleet2: defense,
      faction1Name: 'A',
      faction1Color: '#f00',
      faction2Name: 'D',
      faction2Color: '#0f0',
      attackerId: attacker.id,
      defenderId: defense.id,
      type: 'planet',
      planetId: target.id,
      planetName: target.name,
      planetColor: '#fff',
    } as Battle;
  };

  it('a strong fleet takes a lightly defended planet', () => {
    const { outcome, timedOut } = autoResolveBattle(planetBattle(fleet(1, 'enemy1', ['cruiser', 'cruiser', 'destroyer']), planet(1)), ships, planets);
    expect(timedOut).toBe(false);
    expect(outcome.winnerSide).toBe('attacker');
    expect(outcome.battleType).toBe('planet');
    expect(outcome.defender.wipedOut).toBe(true);
    expect(outcome.attacker.wipedOut).toBe(false);
  });

  it('a weak fleet is destroyed by strong defenses', () => {
    const { outcome } = autoResolveBattle(planetBattle(fleet(1, 'enemy1', ['scout']), planet(6, true)), ships, planets);
    expect(outcome.winnerSide).toBe('defender');
    expect(outcome.attacker.wipedOut).toBe(true);
  });

  it('both sides suffer losses in a close fight', () => {
    const { outcome } = autoResolveBattle(
      // Two corvettes against five laser turrets: each side destroys part of the other.
      planetBattle(fleet(1, 'enemy1', ['corvette', 'corvette']), planet(5)),
      ships,
      planets,
    );
    const attackerLosses = outcome.attacker.ships.filter((s) => s.destroyed).length;
    const defenderLosses = outcome.defender.ships.filter((s) => s.destroyed).length;
    expect(attackerLosses).toBeGreaterThan(0);
    expect(defenderLosses).toBeGreaterThan(0);
  });

  it('an undecided battle at the time limit is a draw that the defender holds', () => {
    const { outcome, timedOut } = autoResolveBattle(planetBattle(fleet(1, 'enemy1', ['cruiser', 'cruiser']), planet(3, true)), ships, planets, 500);
    expect(timedOut).toBe(true);
    expect(outcome.winnerSide).toBe('defender');
    expect(outcome.attacker.wipedOut).toBe(false);
    expect(outcome.defender.wipedOut).toBe(false);
  });

  it('is deterministic and never mutates the input fleets', () => {
    const attacker = fleet(1, 'enemy1', ['destroyer', 'frigate']);
    const before = JSON.stringify(attacker);
    const a = autoResolveBattle(planetBattle(attacker, planet(2)), ships, planets);
    const b = autoResolveBattle(planetBattle(attacker, planet(2)), ships, planets);
    expect(JSON.stringify(a.outcome)).toBe(JSON.stringify(b.outcome));
    expect(a.battleMs).toBe(b.battleMs);
    expect(JSON.stringify(attacker)).toBe(before);
  });

  it('resolves fleet-vs-fleet battles too', () => {
    const attacker = fleet(1, 'enemy1', ['cruiser', 'cruiser', 'cruiser']);
    const defender = fleet(2, 'player', ['scout']);
    const battle = {
      fleet1: attacker, fleet2: defender, faction1Name: 'A', faction1Color: '#f00', faction2Name: 'P', faction2Color: '#00f',
      attackerId: 1, defenderId: 2,
    } as Battle;
    const { outcome } = autoResolveBattle(battle, ships, planets);
    expect(outcome.battleType).toBe('fleet');
    expect(outcome.winnerSide).toBe('attacker');
    expect(outcome.defender.wipedOut).toBe(true);
  });
});

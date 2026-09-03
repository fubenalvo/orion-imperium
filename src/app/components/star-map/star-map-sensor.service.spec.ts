import { TestBed } from '@angular/core/testing';
import { StarMapSensorService, DEFAULT_FLEET_SENSOR_RANGE } from './star-map-sensor.service';
import { Fleet } from './star-map.models';

describe('StarMapSensorService', () => {
  let service: StarMapSensorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StarMapSensorService);
  });

  describe('getFleetSensorRange', () => {
    it('should return the floor when fleet has only ships with range <= floor', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [
          { id: 1, name: 'A', type: 'frigate' },
          { id: 2, name: 'B', type: 'scout' },
        ],
        sensorRange: 3,
      };
      expect(service.getFleetSensorRange(fleet)).toBe(3);
    });

    it('should return the highest ship range when a ship exceeds the floor', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [
          { id: 1, name: 'A', type: 'frigate' },
          { id: 2, name: 'B', type: 'battlecruiser' },
        ],
        sensorRange: 3,
      };
      // frigate range = 3, battlecruiser range = 5
      expect(service.getFleetSensorRange(fleet)).toBe(5);
    });

    it('should return the highest ship range with mixed ships', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [
          { id: 1, name: 'A', type: 'fighter' },
          { id: 2, name: 'B', type: 'corvette' },
          { id: 3, name: 'C', type: 'dreadnought' },
        ],
        sensorRange: 3,
      };
      // fighter range = 2, corvette range = 2, dreadnought range = 5
      expect(service.getFleetSensorRange(fleet)).toBe(5);
    });

    it('should fall back to floor when all ships are destroyed', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [{ id: 1, name: 'A', type: 'battlecruiser', destroyed: true }],
        sensorRange: 3,
      };
      expect(service.getFleetSensorRange(fleet)).toBe(DEFAULT_FLEET_SENSOR_RANGE);
    });

    it('should fall back to floor when fleet has no ships', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [],
        sensorRange: 3,
      };
      expect(service.getFleetSensorRange(fleet)).toBe(DEFAULT_FLEET_SENSOR_RANGE);
    });

    it('should default floor to 3 when sensorRange is undefined', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [{ id: 1, name: 'A', type: 'fighter' }],
      };
      // fighter range = 2, floor defaults to 3
      expect(service.getFleetSensorRange(fleet)).toBe(3);
    });

    it('should return the floor when it exceeds the highest ship range', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [
          { id: 1, name: 'A', type: 'fighter' },
          { id: 2, name: 'B', type: 'colonizer' },
        ],
        sensorRange: 3,
      };
      // fighter range = 2, colonizer range = 1, floor = 3
      expect(service.getFleetSensorRange(fleet)).toBe(3);
    });

    it('should skip destroyed ships but count alive ones', () => {
      const fleet: Fleet = {
        id: 1,
        name: 'Test',
        factionId: 'player',
        x: 1,
        y: 1,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [
          { id: 1, name: 'A', type: 'dreadnought', destroyed: true },
          { id: 2, name: 'B', type: 'frigate' },
        ],
        sensorRange: 3,
      };
      // dreadnought (destroyed, skipped), frigate range = 3 → max(3, 3) = 3
      expect(service.getFleetSensorRange(fleet)).toBe(3);
    });
  });
});

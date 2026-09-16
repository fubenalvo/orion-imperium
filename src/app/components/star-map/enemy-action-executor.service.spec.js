import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EnemyActionExecutor } from './enemy-action-executor.service';
import { PLANET_SIZE_MAP, } from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { EconomyService } from '../../services/economy.service';
import { StarMapMovementService } from './star-map-movement.service';
describe('EnemyActionExecutor', () => {
    let service;
    let productionService;
    let shipService;
    let researchService;
    let planetBattleService;
    let economyService;
    let fleetAssemblyService;
    beforeEach(() => {
        productionService = {
            queueOrder: vi.fn(() => ({
                ok: true,
                order: { id: 1, shipTypeId: 'colonizer', quantity: 1, progress: 0, startedAtTick: 0 },
            })),
            getPlanetCapacity: vi.fn(() => 1),
        };
        shipService = {
            getShipType: vi.fn((id) => {
                const types = {
                    'colonizer': { id: 'colonizer', name: 'Colonizer', role: 'Colonizer', cost: 100, hitPoints: 10, shield: 0, shieldRegen: 0, attack: 0, attackType: 'melee', weakness: 'kinetic', defense: 5, speed: 3, range: 1, maintenanceCost: 5 },
                    'frigate': { id: 'frigate', name: 'Frigate', role: 'Combat', cost: 200, hitPoints: 20, shield: 5, shieldRegen: 0, attack: 10, attackType: 'kinetic', weakness: 'energy', defense: 8, speed: 4, range: 2, maintenanceCost: 10 },
                    'destroyer': { id: 'destroyer', name: 'Destroyer', role: 'Combat', cost: 350, hitPoints: 35, shield: 10, shieldRegen: 1, attack: 15, attackType: 'energy', weakness: 'kinetic', defense: 12, speed: 5, range: 3, maintenanceCost: 18 },
                };
                return types[id];
            }),
            calculateFleetStrength: vi.fn((ships) => ships.reduce((sum, ship) => {
                const t = shipService.getShipType(ship.type);
                if (!t) {
                    return sum;
                }
                return sum + t.attack + t.defense + t.hitPoints / 10 + t.shield / 10;
            }, 0)),
        };
        researchService = {
            isResearched: vi.fn(() => true),
            isShipUnlocked: vi.fn(() => true),
            isBuildingUnlocked: vi.fn(() => true),
        };
        planetBattleService = {
            resolveUninhabitedArrival: vi.fn((fleet) => {
                const index = fleet.ships.findIndex((s) => s.type === 'colonizer' && !s.destroyed);
                return { colonized: index >= 0, colonizerIndex: index };
            }),
        };
        economyService = {
            calculatePlanetEconomy: vi.fn(() => ({
                energyProduction: 10,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            })),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: ProductionService, useValue: productionService },
                { provide: ShipService, useValue: shipService },
                { provide: ResearchService, useValue: researchService },
                { provide: PlanetBattleService, useValue: planetBattleService },
                { provide: EconomyService, useValue: economyService },
                {
                    provide: StarMapMovementService,
                    useValue: {
                        getPlanetGridPosition: vi.fn(() => ({ col: 2, row: 2 })),
                        calculateGridCell: vi.fn((x, y) => ({ col: Math.floor(x), row: Math.floor(y) })),
                    },
                },
            ],
        });
        service = TestBed.inject(EnemyActionExecutor);
        fleetAssemblyService = TestBed.inject(FleetAssemblyService);
        vi.spyOn(fleetAssemblyService, 'reinforceFleet');
        vi.spyOn(fleetAssemblyService, 'createFleet');
        // The real FleetAssemblyService mutates the fleets/stock arrays it is
        // given, so the shared "empty" fixtures must be cleared between tests
        // or state (e.g. an auto-created fleet) leaks into the next test.
        emptyProduction.length = 0;
        emptyShipStock.length = 0;
        emptyFleets.length = 0;
    });
    afterEach(() => {
        service.reset();
        vi.resetAllMocks();
    });
    const createFaction = (overrides = {}) => ({
        id: 'enemy1',
        name: 'Enemy 1',
        color: '#d65757',
        team: 2,
        ai: true,
        currencies: { credits: 200 },
        ...overrides,
    });
    const createPlanet = (overrides = {}) => ({
        id: 1,
        index: 1,
        name: 'Planet',
        factionId: 'unhabited',
        x: 10,
        y: 10,
        type: 'earthlike',
        size: 'medium',
        population: 0,
        buildings: [],
        explored: true,
        ...overrides,
    });
    const createSystem = (overrides = {}) => ({
        id: 'sys1',
        name: 'System',
        x: 10,
        y: 10,
        planets: 1,
        color: '#fff',
        planetsTiles: [createPlanet()],
        ...overrides,
    });
    const createFleet = (overrides = {}) => ({
        id: 1,
        name: 'FLEET',
        factionId: 'player',
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
        speed: 5,
        system: null,
        ships: [{ id: 1, name: 'Ship', type: 'frigate', currentHp: 10, destroyed: false }],
        destroyed: false,
        ...overrides,
    });
    const makeAction = (overrides = {}) => ({
        type: 'produce_colonizer',
        factionId: 'enemy1',
        goalType: 'colonize',
        goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' },
        reason: 'No colonizer available but production is possible',
        ...overrides,
    });
    const baseFactions = [
        { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
        {
            id: 'enemy1',
            name: 'Enemy 1',
            color: '#d65757',
            team: 2,
            ai: true,
            currencies: { credits: 200 },
            researchedTechnologies: ['basic_engineering'],
        },
        {
            id: 'enemy2',
            name: 'Enemy 2',
            color: '#39b8a8',
            team: 2,
            ai: true,
            currencies: { credits: 200 },
            researchedTechnologies: ['basic_engineering'],
        },
    ];
    const emptyProduction = [];
    const emptyShipStock = [];
    const emptyFleets = [];
    describe('produce_colonizer execution', () => {
        it('should start colonizer production when action is produce_colonizer and conditions are met', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
                : f);
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(productionService.queueOrder).toHaveBeenCalledWith({ production: [] }, 'enemy1', 1, 'colonizer', 1, systems, factions);
        });
        it('should select the deterministic lowest system/planet id with factory capacity', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
                : f);
            const systems = [
                createSystem({
                    id: 'sys2',
                    planetsTiles: [
                        createPlanet({
                            id: 3,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 2,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(productionService.queueOrder).toHaveBeenCalledWith({ production: [] }, 'enemy1', 2, 'colonizer', 1, systems, factions);
        });
        it('should not execute for player faction', () => {
            const action = makeAction({ factionId: 'player' });
            const factions = baseFactions;
            const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute for independent faction', () => {
            const action = makeAction({ factionId: 'independent' });
            const factions = baseFactions;
            const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when colonizer is locked', () => {
            researchService.isShipUnlocked.mockReturnValue(false);
            const action = makeAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when faction lacks basic_engineering', () => {
            researchService.isResearched.mockReturnValue(false);
            const action = makeAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when faction has insufficient credits', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1' ? { ...f, currencies: { credits: 10 } } : f);
            const action = makeAction();
            const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when no planet has factory capacity', () => {
            productionService.getPlanetCapacity.mockReturnValue(0);
            const action = makeAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when faction does not exist', () => {
            const action = makeAction({ factionId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when action type is not produce_colonizer', () => {
            const action = makeAction({ type: 'none' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when gameDeltaTime is 0 (paused)', () => {
            const action = makeAction();
            const result = service.tick(0, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when gameDeltaTime is negative', () => {
            const action = makeAction();
            const result = service.tick(-1, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not create duplicate orders when a pending colonizer order exists', () => {
            const existingProduction = [
                {
                    factionId: 'enemy1',
                    ordersByPlanet: {
                        1: [{ id: 1, shipTypeId: 'colonizer', quantity: 1, progress: 0.5, startedAtTick: 0 }],
                    },
                },
            ];
            const action = makeAction();
            const result = service.tick(2, action, baseFactions, [], existingProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when queueOrder returns failure', () => {
            productionService.queueOrder.mockReturnValue({
                ok: false,
                reason: 'insufficient_resources',
            });
            const action = makeAction();
            const systems = [
                createSystem({
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).toHaveBeenCalled();
        });
        it('should not modify player production queue', () => {
            const playerProduction = [
                {
                    factionId: 'player',
                    ordersByPlanet: {
                        1: [{ id: 1, shipTypeId: 'scout', quantity: 1, progress: 0, startedAtTick: 0 }],
                    },
                },
            ];
            const action = makeAction();
            const systems = [
                createSystem({
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const result = service.tick(2, action, baseFactions, systems, playerProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(playerProduction[0].ordersByPlanet[1]).toHaveLength(1);
            expect(playerProduction[0].ordersByPlanet[1][0].shipTypeId).toBe('scout');
        });
        it('should not log execution success', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeAction();
            service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(logSpy).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });
    });
    describe('produce_combat_ship execution', () => {
        const makeCombatShipAction = (overrides = {}) => ({
            type: 'produce_combat_ship',
            factionId: 'enemy1',
            goalType: 'attack',
            goal: { type: 'attack', targetFleetId: 1 },
            reason: 'No combat capability but production is possible',
            shipTypeId: 'frigate',
            ...overrides,
        });
        it('should start combat ship production when action is produce_combat_ship and conditions are met', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, currencies: { credits: 500 }, researchedTechnologies: ['basic_engineering'] }
                : f);
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeCombatShipAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(productionService.queueOrder).toHaveBeenCalledWith({ production: [] }, 'enemy1', 1, 'frigate', 1, systems, factions);
        });
        it('should not execute when shipTypeId is missing', () => {
            const action = makeCombatShipAction({ shipTypeId: undefined });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when ship type does not exist', () => {
            const action = makeCombatShipAction({ shipTypeId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when combat ship is not unlocked', () => {
            researchService.isShipUnlocked.mockReturnValue(false);
            const action = makeCombatShipAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when faction lacks basic_engineering', () => {
            researchService.isResearched.mockReturnValue(false);
            const action = makeCombatShipAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when faction has insufficient credits', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1' ? { ...f, currencies: { credits: 10 } } : f);
            const action = makeCombatShipAction();
            const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when no planet has factory capacity', () => {
            productionService.getPlanetCapacity.mockReturnValue(0);
            const action = makeCombatShipAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not create duplicate orders when a pending order exists', () => {
            const existingProduction = [
                {
                    factionId: 'enemy1',
                    ordersByPlanet: {
                        1: [{ id: 1, shipTypeId: 'frigate', quantity: 1, progress: 0.5, startedAtTick: 0 }],
                    },
                },
            ];
            const action = makeCombatShipAction();
            const result = service.tick(2, action, baseFactions, [], existingProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute for player faction', () => {
            const action = makeCombatShipAction({ factionId: 'player' });
            const factions = baseFactions;
            const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when gameDeltaTime is 0 (paused)', () => {
            const action = makeCombatShipAction();
            const result = service.tick(0, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
        it('should not execute when action type is not produce_combat_ship', () => {
            const action = makeCombatShipAction({ type: 'none' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(productionService.queueOrder).not.toHaveBeenCalled();
        });
    });
    describe('reinforce_fleet execution', () => {
        const makeReinforceAction = (overrides = {}) => ({
            type: 'reinforce_fleet',
            factionId: 'enemy1',
            goalType: 'defend',
            goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' },
            reason: 'Fleet under-strength, reinforcing from stock',
            targetId: 1,
            ...overrides,
        });
        const spaceportSystems = () => [
            createSystem({
                id: 'sys1',
                planetsTiles: [
                    createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                ],
            }),
        ];
        it('should reinforce a damaged fleet from stock', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(true);
            expect(fleetAssemblyService.reinforceFleet).toHaveBeenCalledWith({ fleets, shipStock: stock }, systems, { factionId: 'enemy1', fleetId: 1, composition: [{ typeId: 'frigate', count: 1 }] });
        });
        it('should not reinforce once the fleet has reached the target strength (frame-loop dedup)', () => {
            const fleets = [
                createFleet({
                    factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1,
                    ships: [
                        { id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false },
                        { id: 2, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false },
                    ],
                }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const currentStrength = shipService.getShipType('frigate').attack
                + shipService.getShipType('frigate').defense
                + shipService.getShipType('frigate').hitPoints / 10
                + shipService.getShipType('frigate').shield / 10;
            const action = makeReinforceAction({ targetStrength: currentStrength });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should reinforce after combat losses until the target strength is reached', () => {
            const fleets = [
                createFleet({
                    factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1,
                    // One frigate left after a combat loss; the second was removed
                    // from the roster when it was destroyed.
                    ships: [
                        { id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false },
                    ],
                }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const frigateStrength = shipService.getShipType('frigate').attack
                + shipService.getShipType('frigate').defense
                + shipService.getShipType('frigate').hitPoints / 10
                + shipService.getShipType('frigate').shield / 10;
            const action = makeReinforceAction({ targetStrength: frigateStrength * 2 });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(true);
            expect(fleetAssemblyService.reinforceFleet).toHaveBeenCalled();
            expect(stock[0].ships).toHaveLength(0);
            expect(fleets[0].ships).toHaveLength(2);
        });
        it('should preserve fleet identity and persist reinforced ships in fleet state', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 12, y: 34, id: 7, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const action = makeReinforceAction({ targetId: 7 });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(true);
            expect(fleets).toHaveLength(1);
            expect(fleets[0].id).toBe(7);
            expect(fleets[0].name).toBe('RAIDER');
            expect(fleets[0].x).toBe(12);
            expect(fleets[0].y).toBe(34);
            expect(fleets[0].ships).toHaveLength(2);
            // Fleet and stock are plain serializable objects, so a save/load
            // round-trip preserves the reinforced roster without extra state.
            const roundTripped = JSON.parse(JSON.stringify({ fleets, stock }));
            expect(roundTripped.fleets[0].ships).toHaveLength(2);
            expect(roundTripped.fleets[0].id).toBe(7);
            expect(roundTripped.stock[0].ships).toHaveLength(0);
        });
        it('should not reinforce a destroyed fleet', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, destroyed: true, ships: [] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should not reinforce when no stock available', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const systems = spaceportSystems();
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).toHaveBeenCalled();
        });
        it('should not reinforce a fleet with no combat ships', () => {
            const fleets = [
                createFleet({
                    factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1,
                    ships: [{ id: 1, name: 'Colonizer', type: 'colonizer', currentHp: 10, destroyed: false }],
                }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'colonizer', name: 'Colonizer' }] }];
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should not reinforce for player faction', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const action = makeReinforceAction({ factionId: 'player' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should not reinforce when paused (deltaTime is 0)', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const action = makeReinforceAction();
            const result = service.tick(0, action, baseFactions, [], emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should not reinforce when fleet does not belong to faction', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const action = makeReinforceAction({ factionId: 'enemy2' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
        });
        it('should reinforce multiple AI factions independently', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
                createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 50, y: 50, id: 2, ships: [{ id: 2, name: 'Destroyer', type: 'destroyer', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [
                { factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] },
                { factionId: 'enemy2', ships: [{ id: 11, type: 'destroyer', name: 'Destroyer' }] },
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] })],
                }),
                createSystem({
                    id: 'sys2',
                    planetsTiles: [createPlanet({ id: 2, factionId: 'enemy2', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] })],
                }),
            ];
            const first = service.tick(2, makeReinforceAction({ targetId: 1 }), baseFactions, systems, emptyProduction, stock, fleets);
            const second = service.tick(2, makeReinforceAction({ factionId: 'enemy2', targetId: 2 }), baseFactions, systems, emptyProduction, stock, fleets);
            expect(first).toBe(true);
            expect(second).toBe(true);
            expect(stock[0].ships).toHaveLength(0);
            expect(stock[1].ships).toHaveLength(0);
            expect(fleets[0].ships).toHaveLength(2);
            expect(fleets[1].ships).toHaveLength(2);
        });
        it('should not reinforce a fleet that is engaged with an enemy fleet', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 10, y: 10, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
                createFleet({ factionId: 'player', name: 'ORION', x: 10, y: 10, id: 2, ships: [{ id: 2, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.reinforceFleet).not.toHaveBeenCalled();
            expect(stock[0].ships).toHaveLength(1);
        });
        it('should still reinforce a fleet co-located with an ally', () => {
            const fleets = [
                createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 10, y: 10, id: 1, ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
                createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 10, y: 10, id: 2, ships: [{ id: 2, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }] }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }] }];
            const systems = spaceportSystems();
            const action = makeReinforceAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(true);
            expect(fleetAssemblyService.reinforceFleet).toHaveBeenCalled();
        });
    });
    describe('create_fleet execution', () => {
        const makeCreateFleetAction = (overrides = {}) => ({
            type: 'create_fleet',
            factionId: 'enemy1',
            goalType: 'defend',
            goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' },
            reason: 'No combat capability, creating new fleet',
            shipTypeId: 'frigate',
            targetSystemId: 'sys1',
            targetPlanetId: 1,
            ...overrides,
        });
        it('should create fleet at Spaceport with 2 ships', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const stock = [
                { factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }, { id: 11, type: 'frigate', name: 'Frigate' }] },
            ];
            const action = makeCreateFleetAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, emptyFleets);
            expect(result).toBe(true);
            expect(fleetAssemblyService.createFleet).toHaveBeenCalledWith({ fleets: emptyFleets, shipStock: stock }, systems, {
                factionId: 'enemy1',
                fleetName: 'enemy1 Fleet',
                systemId: 'sys1',
                planetId: 1,
                composition: [{ typeId: 'frigate', count: 2 }],
            });
        });
        it('should not create fleet when planet is not owned by faction', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'unhabited', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const action = makeCreateFleetAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should not create a second fleet once the faction has a combat fleet', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const stock = [
                { factionId: 'enemy1', ships: [{ id: 10, type: 'frigate', name: 'Frigate' }, { id: 11, type: 'frigate', name: 'Frigate' }] },
            ];
            const fleets = [
                createFleet({
                    factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1,
                    ships: [{ id: 1, name: 'Frigate', type: 'frigate', currentHp: 10, destroyed: false }],
                }),
            ];
            const action = makeCreateFleetAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, stock, fleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should not create fleet when no Spaceport', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [] }),
                    ],
                }),
            ];
            const action = makeCreateFleetAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).toHaveBeenCalled();
        });
        it('should not create fleet when ship type does not exist', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const action = makeCreateFleetAction({ shipTypeId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should not create fleet for player faction', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const action = makeCreateFleetAction({ factionId: 'player' });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should not create fleet when paused (deltaTime is 0)', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const action = makeCreateFleetAction();
            const result = service.tick(0, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should not create fleet when system does not exist', () => {
            const action = makeCreateFleetAction({ targetSystemId: 'nonexistent', targetPlanetId: 1 });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(fleetAssemblyService.createFleet).not.toHaveBeenCalled();
        });
        it('should create fleet with composition from shipTypeId', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] }),
                    ],
                }),
            ];
            const stock = [{ factionId: 'enemy1', ships: [{ id: 10, type: 'destroyer', name: 'Destroyer' }] }];
            const action = makeCreateFleetAction({ shipTypeId: 'destroyer' });
            service.tick(2, action, baseFactions, systems, emptyProduction, stock, emptyFleets);
            expect(fleetAssemblyService.createFleet).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
                composition: [{ typeId: 'destroyer', count: 2 }],
            }));
        });
    });
    describe('planet selection', () => {
        it('should pick the first planet with factory capacity across multiple systems', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
                : f);
            const systems = [
                createSystem({
                    id: 'sys10',
                    planetsTiles: [
                        createPlanet({
                            id: 5,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
                createSystem({
                    id: 'sys2',
                    planetsTiles: [
                        createPlanet({ id: 2, factionId: 'enemy1', buildings: [] }),
                        createPlanet({
                            id: 3,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeAction();
            service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(productionService.queueOrder).toHaveBeenCalledWith({ production: [] }, 'enemy1', 1, 'colonizer', 1, systems, factions);
        });
        it('should skip planets owned by other factions', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
                : f);
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createPlanet({
                            id: 1,
                            factionId: 'player',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                        createPlanet({
                            id: 2,
                            factionId: 'enemy1',
                            buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
                        }),
                    ],
                }),
            ];
            const action = makeAction();
            service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(productionService.queueOrder).toHaveBeenCalledWith({ production: [] }, 'enemy1', 2, 'colonizer', 1, systems, factions);
        });
    });
    describe('assemble_fleet execution', () => {
        const makeAssembleAction = (overrides = {}) => ({
            type: 'assemble_fleet',
            factionId: 'enemy1',
            goalType: 'colonize',
            goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' },
            reason: 'Colonizer in stock but no fleet has it',
            ...overrides,
        });
        const createEnemyFleet = (overrides = {}) => ({
            id: 3,
            name: 'RAIDER',
            factionId: 'enemy1',
            x: 30,
            y: 30,
            targetX: null,
            targetY: null,
            speed: 5,
            system: null,
            gridCol: 1,
            gridRow: 1,
            ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
            destroyed: false,
            sensorRange: 3,
            ...overrides,
        });
        const makeStock = (factionId, ids) => [
            { factionId, ships: ids.map((id) => ({ id, type: 'colonizer', name: 'Colonizer' })) },
        ];
        const spaceportSystems = () => [
            createSystem({
                id: 'sys1',
                planetsTiles: [
                    createPlanet({
                        id: 1,
                        factionId: 'enemy1',
                        buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }],
                    }),
                ],
            }),
        ];
        it('should move one colonizer from stock into the existing faction fleet', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(true);
            expect(shipStock[0].ships).toHaveLength(0);
            expect(fleets).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(2);
            expect(fleets[0].ships.some((s) => s.type === 'colonizer' && s.id === 101 && !s.destroyed)).toBe(true);
        });
        it('should keep the reinforced fleet identity and position unchanged', () => {
            const fleets = [
                createEnemyFleet({ id: 3, name: 'RAIDER', x: 12, y: 34, gridCol: 5, gridRow: 6 }),
            ];
            const shipStock = makeStock('enemy1', [101]);
            const fleetBefore = {
                id: fleets[0].id,
                name: fleets[0].name,
                x: fleets[0].x,
                y: fleets[0].y,
                system: fleets[0].system,
            };
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(true);
            expect(fleets).toHaveLength(1);
            expect(fleets[0].id).toBe(fleetBefore.id);
            expect(fleets[0].name).toBe(fleetBefore.name);
            expect(fleets[0].x).toBe(fleetBefore.x);
            expect(fleets[0].y).toBe(fleetBefore.y);
            expect(fleets[0].system).toEqual(fleetBefore.system);
            expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(true);
        });
        it('should not log execution success', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(logSpy).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });
        it('should not execute when the faction stock has no colonizer', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', []);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(0);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not mutate state when the faction owns no Spaceport', () => {
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [] })],
                }),
            ];
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, systems, emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not assemble ships from another faction stock', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy2', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not modify player stock or player fleets', () => {
            const fleets = [createEnemyFleet({ factionId: 'player', id: 1, name: 'ORION' })];
            const shipStock = makeStock('player', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not execute assemble_fleet for the player faction', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction({ factionId: 'player' }), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not assemble the same colonizer twice across repeated frames', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101, 102]);
            const action = makeAssembleAction();
            const first = service.tick(2, action, baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            const second = service.tick(2, action, baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(1);
        });
        it('should not assemble when a faction fleet already carries a colonizer', () => {
            const fleets = [
                createEnemyFleet({
                    ships: [
                        { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
                        { id: 200, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
                    ],
                }),
            ];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(1);
        });
        it('should skip destroyed and unusable fleets when picking the target fleet', () => {
            const fleets = [
                createEnemyFleet({ id: 2, name: 'GHOST', destroyed: true }),
                createEnemyFleet({
                    id: 5,
                    name: 'HUSK',
                    ships: [{ id: 20, name: 'Scout', type: 'scout', destroyed: true }],
                }),
                createEnemyFleet({ id: 7, name: 'GUARD' }),
            ];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(true);
            expect(shipStock[0].ships).toHaveLength(0);
            expect(fleets.find((f) => f.id === 7)?.ships.some((s) => s.type === 'colonizer')).toBe(true);
            expect(fleets.find((f) => f.id === 2)?.ships.some((s) => s.type === 'colonizer')).toBe(false);
            expect(fleets.find((f) => f.id === 5)?.ships.some((s) => s.type === 'colonizer')).toBe(false);
        });
        it('should create a new faction fleet at the deterministic spaceport when no usable fleet exists', () => {
            const systems = spaceportSystems();
            const fleets = [];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction(), baseFactions, systems, emptyProduction, shipStock, fleets);
            expect(result).toBe(true);
            expect(shipStock[0].ships).toHaveLength(0);
            expect(fleets).toHaveLength(1);
            const fleet = fleets[0];
            expect(fleet.factionId).toBe('enemy1');
            expect(fleet.name).toBe('enemy1 Fleet');
            expect(fleet.ships).toHaveLength(1);
            expect(fleet.ships[0].type).toBe('colonizer');
            expect(fleet.ships[0].id).toBe(101);
            expect(fleet.x).toBe(systems[0].x);
            expect(fleet.y).toBe(systems[0].y);
            expect(fleet.system?.id).toBe('sys1');
            expect(fleet.gridCol).toBe(2);
            expect(fleet.gridRow).toBe(2);
        });
        it('should not execute assemble_fleet while paused', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(0, makeAssembleAction(), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
        it('should not execute action types other than produce_colonizer and assemble_fleet', () => {
            const fleets = [createEnemyFleet()];
            const shipStock = makeStock('enemy1', [101]);
            const result = service.tick(2, makeAssembleAction({ type: 'move_to_target', targetId: 3 }), baseFactions, spaceportSystems(), emptyProduction, shipStock, fleets);
            expect(result).toBe(false);
            expect(shipStock[0].ships).toHaveLength(1);
            expect(fleets[0].ships).toHaveLength(1);
        });
    });
    describe('move_to_target execution', () => {
        const makeMoveAction = (overrides = {}) => ({
            type: 'move_to_target',
            factionId: 'enemy1',
            goalType: 'colonize',
            goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' },
            targetId: 3,
            targetSystemId: 'sys1',
            targetPlanetId: 1,
            reason: 'Fleet needs to move to target',
            ...overrides,
        });
        const createEnemyFleet = (overrides = {}) => ({
            id: 3,
            name: 'RAIDER',
            factionId: 'enemy1',
            x: 10,
            y: 10,
            targetX: null,
            targetY: null,
            speed: 5,
            system: null,
            gridCol: 1,
            gridRow: 1,
            ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
            destroyed: false,
            sensorRange: 3,
            ...overrides,
        });
        const baseSystems = () => [
            createSystem({
                id: 'sys1',
                planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
            }),
        ];
        it('should start movement toward the target system for colonize goal', () => {
            const fleets = [createEnemyFleet()];
            const systems = baseSystems();
            const action = makeMoveAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(fleets[0].targetX).toBe(systems[0].x);
            expect(fleets[0].targetY).toBe(systems[0].y);
        });
        it('should not start movement when the target system does not exist', () => {
            const fleets = [createEnemyFleet()];
            const action = makeMoveAction({ targetSystemId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not start movement when the target planet is no longer unhabited', () => {
            const fleets = [createEnemyFleet()];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
                }),
            ];
            const action = makeMoveAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not move a destroyed fleet', () => {
            const fleets = [createEnemyFleet({ destroyed: true })];
            const systems = baseSystems();
            const action = makeMoveAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not move a fleet owned by another faction', () => {
            const fleets = [createEnemyFleet({ factionId: 'enemy2' })];
            const systems = baseSystems();
            const action = makeMoveAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not move a player fleet', () => {
            const fleets = [createEnemyFleet({ id: 1, factionId: 'player', name: 'ORION' })];
            const systems = baseSystems();
            const action = makeMoveAction({ targetId: 1 });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not restart movement when already heading to the same destination', () => {
            const fleets = [createEnemyFleet({ targetX: 10, targetY: 10 })];
            const systems = baseSystems();
            const action = makeMoveAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBe(10);
            expect(fleets[0].targetY).toBe(10);
        });
        it('should start movement toward the target fleet for attack goal', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
            ];
            const action = makeMoveAction({
                goalType: 'attack',
                goal: { type: 'attack', targetFleetId: 5 },
                targetId: 3,
                targetSystemId: undefined,
                targetPlanetId: undefined,
            });
            const result = service.tick(2, action, baseFactions, baseSystems(), emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(fleets[0].targetX).toBe(20);
            expect(fleets[0].targetY).toBe(20);
        });
        it('should not move for attack goal when the target fleet is destroyed', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', destroyed: true }),
            ];
            const action = makeMoveAction({
                goalType: 'attack',
                goal: { type: 'attack', targetFleetId: 5 },
                targetId: 3,
                targetSystemId: undefined,
                targetPlanetId: undefined,
            });
            const result = service.tick(2, action, baseFactions, baseSystems(), emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should start movement toward the threatened system for defend goal', () => {
            const fleets = [createEnemyFleet()];
            const systems = [
                createSystem({ id: 'sys1', planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] }),
            ];
            const action = makeMoveAction({
                goalType: 'defend',
                goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' },
                targetId: 3,
            });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(fleets[0].targetX).toBe(systems[0].x);
            expect(fleets[0].targetY).toBe(systems[0].y);
        });
        it('should not move for defend goal when the target system does not exist', () => {
            const fleets = [createEnemyFleet()];
            const action = makeMoveAction({
                goalType: 'defend',
                goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'nonexistent' },
                targetId: 3,
            });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not log execution success', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const fleets = [createEnemyFleet()];
            const systems = baseSystems();
            const action = makeMoveAction();
            service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(logSpy).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });
        it('should not execute when the action target fleet id is missing', () => {
            const fleets = [createEnemyFleet()];
            const systems = baseSystems();
            const action = makeMoveAction({ targetId: 999 });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
        it('should not execute move_to_target for the player faction', () => {
            const fleets = [createEnemyFleet()];
            const systems = baseSystems();
            const action = makeMoveAction({ factionId: 'player' });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(fleets[0].targetX).toBeNull();
            expect(fleets[0].targetY).toBeNull();
        });
    });
    describe('colonize execution', () => {
        const makeColonizeAction = (overrides = {}) => ({
            type: 'colonize',
            factionId: 'enemy1',
            goalType: 'colonize',
            goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' },
            targetPlanetId: 1,
            targetSystemId: 'sys1',
            reason: 'Fleet with colonizer is at the target planet',
            ...overrides,
        });
        const createEnemyFleet = (overrides = {}) => ({
            id: 3,
            name: 'RAIDER',
            factionId: 'enemy1',
            x: 10,
            y: 10,
            targetX: null,
            targetY: null,
            speed: 5,
            system: null,
            gridCol: 10,
            gridRow: 10,
            ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
            destroyed: false,
            sensorRange: 3,
            ...overrides,
        });
        it('should colonize an unhabited planet when fleet is at the planet with a colonizer', () => {
            const fleets = [
                createEnemyFleet({
                    ships: [
                        { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
                        { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
                    ],
                }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
            expect(fleets[0].ships).toHaveLength(1);
            expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(false);
        });
        it('should not execute when the target planet no longer exists', () => {
            const fleets = [createEnemyFleet()];
            const action = makeColonizeAction({ targetSystemId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when the target planet is already colonized', () => {
            const fleets = [createEnemyFleet()];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
        });
        it('should not execute when the fleet has no colonizer', () => {
            const fleets = [
                createEnemyFleet({
                    ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
                }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
        });
        it('should not execute when no fleet is at the target planet position', () => {
            const fleets = [
                createEnemyFleet({ x: 1, y: 1, gridCol: 1, gridRow: 1 }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
        });
        it('should colonize when fleet is at the system position even if planet grid position differs', () => {
            const fleets = [
                createEnemyFleet({
                    x: 10,
                    y: 10,
                    gridCol: 10,
                    gridRow: 10,
                    ships: [
                        { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
                        { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
                    ],
                }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    x: 10,
                    y: 10,
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited', x: 5, y: 5 })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
            expect(fleets[0].ships).toHaveLength(1);
            expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(false);
        });
        it('should not execute colonization twice (duplicate guard)', () => {
            const fleets = [
                createEnemyFleet({
                    ships: [
                        { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
                        { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
                    ],
                }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
                }),
            ];
            const action = makeColonizeAction();
            const first = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            const second = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
            expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(0);
        });
        it('should not modify game state when planetBattleService reports no colonizer', () => {
            planetBattleService.resolveUninhabitedArrival.mockReturnValue({ colonized: false, colonizerIndex: -1 });
            const fleets = [
                createEnemyFleet({
                    ships: [
                        { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
                        { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
                    ],
                }),
            ];
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
                }),
            ];
            const action = makeColonizeAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
            expect(fleets[0].ships).toHaveLength(2);
        });
    });
    describe('attack execution', () => {
        const makeAttackAction = (overrides = {}) => ({
            type: 'attack',
            factionId: 'enemy1',
            goalType: 'attack',
            goal: { type: 'attack', targetFleetId: 5 },
            targetId: 5,
            reason: 'Enemy fleet is at the target fleet position',
            ...overrides,
        });
        const createEnemyFleet = (overrides = {}) => ({
            id: 3,
            name: 'RAIDER',
            factionId: 'enemy1',
            x: 20,
            y: 20,
            targetX: null,
            targetY: null,
            speed: 5,
            system: null,
            gridCol: 2,
            gridRow: 2,
            ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
            destroyed: false,
            sensorRange: 3,
            ...overrides,
        });
        it('should return true when AI fleet and target fleet are at the same cell', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20, gridCol: 2, gridRow: 2 }),
            ];
            const action = makeAttackAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
        });
        it('should not execute when the target fleet does not exist', () => {
            const fleets = [createEnemyFleet()];
            const action = makeAttackAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when the target fleet is destroyed', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', destroyed: true }),
            ];
            const action = makeAttackAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when the target fleet has no living ships', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({
                    id: 5,
                    factionId: 'player',
                    name: 'ORION',
                    ships: [{ id: 50, name: 'Scout', type: 'scout', destroyed: true }],
                }),
            ];
            const action = makeAttackAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when no AI fleet is at the target cell', () => {
            const fleets = [
                createEnemyFleet({ x: 1, y: 1, gridCol: 1, gridRow: 1 }),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
            ];
            const action = makeAttackAction();
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not modify player fleet state', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20, destroyed: false, ships: [{ id: 50, name: 'Cruiser', type: 'cruiser', destroyed: false }] }),
            ];
            const action = makeAttackAction();
            const playerFleetBefore = { ...fleets[1] };
            service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(fleets[1].destroyed).toBe(playerFleetBefore.destroyed);
            expect(fleets[1].ships).toHaveLength(playerFleetBefore.ships.length);
        });
        it('should not execute attack for the player faction', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
            ];
            const action = makeAttackAction({ factionId: 'player' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
    });
    describe('defend execution', () => {
        const makeDefendAction = (overrides = {}) => ({
            type: 'defend',
            factionId: 'enemy1',
            goalType: 'defend',
            goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' },
            targetSystemId: 'sys1',
            targetPlanetId: 1,
            reason: 'Enemy fleet is at the threatened system',
            ...overrides,
        });
        const createEnemyFleet = (overrides = {}) => ({
            id: 3,
            name: 'RAIDER',
            factionId: 'enemy1',
            x: 10,
            y: 10,
            targetX: null,
            targetY: null,
            speed: 5,
            system: null,
            gridCol: 1,
            gridRow: 1,
            ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
            destroyed: false,
            sensorRange: 3,
            ...overrides,
        });
        it('should return true when AI fleet is at the threatened system', () => {
            const fleets = [createEnemyFleet()];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
        });
        it('should not execute when the target system does not exist', () => {
            const fleets = [createEnemyFleet()];
            const action = makeDefendAction({ targetSystemId: 'nonexistent' });
            const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when no AI fleet is at the system position', () => {
            const fleets = [createEnemyFleet({ x: 1, y: 1 })];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when the AI fleet is destroyed', () => {
            const fleets = [createEnemyFleet({ destroyed: true })];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not execute when the AI fleet has no living ships', () => {
            const fleets = [
                createEnemyFleet({
                    ships: [{ id: 10, name: 'Scout', type: 'scout', destroyed: true }],
                }),
            ];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
        it('should not modify player fleets', () => {
            const fleets = [
                createEnemyFleet(),
                createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 10, y: 10 }),
            ];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction();
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(true);
            expect(fleets[1].factionId).toBe('player');
        });
        it('should not execute defend for the player faction', () => {
            const fleets = [createEnemyFleet()];
            const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
            const action = makeDefendAction({ factionId: 'player' });
            const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
            expect(result).toBe(false);
        });
    });
    describe('develop execution', () => {
        const makeDevelopAction = (overrides = {}) => ({
            type: 'develop',
            factionId: 'enemy1',
            goalType: 'develop',
            goal: { type: 'develop' },
            reason: 'Develop goal is always executable',
            ...overrides,
        });
        const createOwnedPlanet = (overrides = {}) => createPlanet({ factionId: 'enemy1', ...overrides });
        it('should build a power building when energy is short', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'], currencies: { ...f.currencies } }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 5,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
            expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Fusion Power Plant');
            expect(factions.find((f) => f.id === 'enemy1').currencies['credits']).toBe(100);
        });
        it('should build a residential building when workforce is short', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_science'], currencies: { ...f.currencies } }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 10,
                energyConsumption: 10,
                workforceAvailable: 5,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
            expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Small Residential Block');
        });
        it('should build an industry building when raw materials are needed', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_industry'], currencies: { ...f.currencies } }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 10,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 5 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [
                        createOwnedPlanet({
                            id: 1,
                            size: 'medium',
                            buildings: [],
                            resourceTiles: [{ type: 'rawmaterial', x: 0, y: 3 }],
                        }),
                    ],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
            expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Spaceship Factory');
        });
        it('should build a research building as fallback', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_science'], currencies: { ...f.currencies } }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 10,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(true);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
            expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Small Research Laboratory');
        });
        it('should not build when the building is not researched', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering'], currencies: { ...f.currencies } }
                : f);
            researchService.isBuildingUnlocked.mockReturnValue(false);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 5,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(0);
        });
        it('should not build when the faction lacks credits', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'], currencies: { credits: 10 } }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 5,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
            expect(systems[0].planetsTiles[0].buildings).toHaveLength(0);
        });
        it('should not build when no valid placement exists', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'] }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 5,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const buildings = [];
            const gridSize = (PLANET_SIZE_MAP['medium'] ?? 3) * 2 + 3;
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    buildings.push({ name: 'Laser Turret', size: 1, x, y, type: 'turret' });
                }
            }
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
        });
        it('should not build on a planet owned by another faction', () => {
            const factions = baseFactions.map((f) => f.id === 'enemy1'
                ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'] }
                : f);
            economyService.calculatePlanetEconomy.mockReturnValue({
                energyProduction: 5,
                energyConsumption: 10,
                workforceAvailable: 20,
                workforceRequired: 20,
                production: { rawmaterials: 10 },
            });
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createPlanet({ id: 1, factionId: 'player', size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction();
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
        });
        it('should not execute develop for the player faction', () => {
            const factions = baseFactions;
            const systems = [
                createSystem({
                    id: 'sys1',
                    planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
                }),
            ];
            const action = makeDevelopAction({ factionId: 'player' });
            const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);
            expect(result).toBe(false);
        });
    });
});

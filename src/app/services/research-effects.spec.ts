import { TestBed } from '@angular/core/testing';
import { RESEARCH_COST_GROWTH_PER_TECH, ResearchService } from './research.service';
import { EconomyService } from './economy.service';
import { ProductionService } from './production.service';
import { ShipService } from './ship.service';
import { PlanetBattleService } from './planet-battle.service';
import { EnemyResearchService } from '../components/star-map/enemy-research.service';
import { createBattleState } from '../components/battle-screen/battle/battle-state';
import { Battle } from '../components/battle-screen/battle/battle.types';
import {
  Faction,
  FactionProduction,
  Fleet,
  PlanetTile,
  StarSystem,
  TechnologyBonusType,
} from '../components/star-map/star-map.models';
import planetData from '../components/star-map/planet-data.json';

/*
 * Technology effects (docs/research.md): every technology has a real
 * purpose, each bonus changes the system that owns the mechanic, bonuses
 * stack additively, are derived (never stored) so save/load cannot
 * double-apply them, and player and AI use the same rules.
 */

const STARTING = ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'];

const faction = (techs: string[] = [], overrides: Partial<Faction> = {}): Faction => ({
  id: 'player',
  name: 'Player',
  color: '#8cc4ff',
  team: 1,
  ai: false,
  currencies: { credits: 100000, rawmaterials: 100000, research: 0 },
  researchedTechnologies: [...STARTING, ...techs],
  ...overrides,
});

const planet = (buildings: string[], overrides: Partial<PlanetTile> = {}): PlanetTile => ({
  id: 1,
  index: 0,
  name: 'Home',
  factionId: 'player',
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'huge',
  population: 700,
  satisfaction: 100,
  explored: true,
  buildings: buildings.map((name, i) => ({ name, size: 1, x: i, y: 0 })),
  ...overrides,
});

const system = (planets: PlanetTile[]): StarSystem => ({
  id: 'sys1', name: 'Sys', x: 1, y: 1, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true,
});

let shipId = 1;
const fleet = (id: number, factionId: string, types: string[]): Fleet => ({
  id, name: `F${id}`, factionId, x: 0, y: 0, targetX: null, targetY: null, speed: 4, system: null,
  ships: types.map((type) => ({ id: shipId++, name: type, type })),
});

describe('Technology effects — inventory', () => {
  let research: ResearchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    research = TestBed.inject(ResearchService);
  });

  it('the tree is structurally valid', () => {
    expect(research.getValidationErrors()).toEqual([]);
  });

  it('every researchable technology has a real effect: a unique unlock or a bonus', () => {
    const shipUnlockers = new Map<string, number>();
    const buildingUnlockers = new Map<string, number>();
    for (const tech of research.getAllTechnologies()) {
      tech.unlocksShips.forEach((id) => shipUnlockers.set(id, (shipUnlockers.get(id) ?? 0) + 1));
      tech.unlocksBuildings.forEach((id) => buildingUnlockers.set(id, (buildingUnlockers.get(id) ?? 0) + 1));
    }
    // No duplicate unlocks: a second unlocker of the same ship/building would be a no-op technology.
    for (const [id, count] of [...shipUnlockers, ...buildingUnlockers]) expect(count, id).toBe(1);

    for (const tech of research.getAllTechnologies().filter((t) => !STARTING.includes(t.id))) {
      const hasUnlock = tech.unlocksShips.length + tech.unlocksBuildings.length > 0;
      const hasBonus = (tech.bonuses ?? []).length > 0;
      expect(hasUnlock || hasBonus, `${tech.id} has no effect`).toBe(true);
      expect(research.describeEffects(tech).length, `${tech.id} effect text`).toBeGreaterThan(0);
      expect(tech.researchCost, tech.id).toBeGreaterThan(0);
    }
  });

  it('every building is reachable through research, and bonus hull lists name real ships', () => {
    const buildings = (planetData as { buildings: { id: string }[] }).buildings.map((b) => b.id);
    const all = faction(research.getAllTechnologies().map((t) => t.id));
    for (const id of buildings) expect(research.isBuildingUnlocked(all, id), id).toBe(true);
    const ships = TestBed.inject(ShipService);
    for (const tech of research.getAllTechnologies()) {
      for (const bonus of tech.bonuses ?? []) {
        for (const type of bonus.shipTypes ?? []) expect(ships.getShipType(type), `${tech.id} → ${type}`).toBeDefined();
      }
    }
  });

  it('every bonus type in the tree is consumed by a gameplay system covered below', () => {
    const covered: TechnologyBonusType[] = [
      'sensorRange', 'energyOutput', 'researchOutput', 'rawOutput', 'buildingUpkeep',
      'shipUpkeep', 'shipBuildSpeed', 'populationGrowth', 'shipAttack', 'shipShield',
    ];
    const used = new Set(research.getAllTechnologies().flatMap((t) => (t.bonuses ?? []).map((b) => b.type)));
    for (const type of used) expect(covered).toContain(type);
  });

  it('advanced technologies cost more than early ones (average cost rises with prerequisite depth)', () => {
    const depth = (id: string): number => {
      const tech = research.getTechnology(id)!;
      return tech.prerequisites.length === 0 ? 0 : 1 + Math.max(...tech.prerequisites.map(depth));
    };
    const byDepth = new Map<number, number[]>();
    for (const tech of research.getAllTechnologies()) {
      const d = depth(tech.id);
      byDepth.set(d, [...(byDepth.get(d) ?? []), tech.researchCost]);
    }
    const avg = (d: number) => byDepth.get(d)!.reduce((a, b) => a + b, 0) / byDepth.get(d)!.length;
    expect(avg(1)).toBeLessThan(avg(2));
    expect(avg(2)).toBeLessThan(avg(3));
  });
});

describe('Technology effects — gameplay systems', () => {
  let research: ResearchService;
  let economy: EconomyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    research = TestBed.inject(ResearchService);
    economy = TestBed.inject(EconomyService);
  });

  it('energy output: improved_power and advanced_power stack additively (+15% each)', () => {
    const p = planet(['Fusion Power Plant']);
    const base = economy.calculatePlanetEconomy(p, faction()).energyProduction;
    expect(economy.calculatePlanetEconomy(p, faction(['improved_power'])).energyProduction).toBeCloseTo(base * 1.15, 6);
    expect(economy.calculatePlanetEconomy(p, faction(['improved_power', 'advanced_power'])).energyProduction).toBeCloseTo(base * 1.3, 6);
  });

  it('research output: applied_science raises building research, and the economy tick applies it', () => {
    const p = planet(['Large Residential Block', 'Fusion Power Plant', 'Research Laboratory']);
    const without = faction();
    const withTech = faction(['applied_science']);
    const a = economy.calculatePlanetEconomy(p, without).production['research']!;
    expect(economy.calculatePlanetEconomy(p, withTech).production['research']).toBeCloseTo(a * 1.25, 6);
    economy.applyEconomyDelta('player', [withTech], [system([{ ...p }])], [], 1, [], []);
    expect(withTech.currencies['research']).toBeCloseTo(a * 1.25, 4);
  });

  it('raw output: advanced_manufacturing raises building output but not the population trickle', () => {
    const p = planet(['Large Residential Block', 'Spaceship Factory'], { population: 0 });
    const base = economy.calculatePlanetEconomy(p, faction()).production['rawmaterials']!;
    expect(economy.calculatePlanetEconomy(p, faction(['advanced_manufacturing'])).production['rawmaterials']).toBeCloseTo(base * 1.25, 6);
  });

  it('building upkeep: advanced_industry lowers the upkeep the economy charges', () => {
    const p = planet(['Large Residential Block', 'Fusion Power Plant', 'Spaceport']);
    const base = economy.calculateEconomy('player', [faction()], [system([p])], [], []).buildingUpkeepPerSecond;
    const reduced = economy.calculateEconomy('player', [faction(['advanced_industry'])], [system([p])], [], []).buildingUpkeepPerSecond;
    expect(reduced).toBeCloseTo(base * 0.9, 6);
  });

  it('ship upkeep: carrier_technology lowers fleet and reserve upkeep', () => {
    const fleets = [fleet(1, 'player', ['cruiser', 'cruiser'])];
    const stock = [{ factionId: 'player', ships: [{ id: 900, type: 'cruiser', name: 'Cruiser' }] }];
    const base = economy.calculateEconomy('player', [faction()], [system([planet([])])], fleets, stock).shipUpkeepPerSecond;
    const reduced = economy.calculateEconomy('player', [faction(['carrier_technology'])], [system([planet([])])], fleets, stock).shipUpkeepPerSecond;
    expect(reduced).toBeCloseTo(base * 0.85, 6);
  });

  it('population growth: colonization_technology speeds up natural growth', () => {
    const p = planet(['Large Residential Block'], { population: 100 });
    const base = economy.calculatePopulationGrowth(p, 1, faction());
    expect(economy.calculatePopulationGrowth(p, 1, faction(['colonization_technology']))).toBeCloseTo(base * 1.5, 6);
  });

  it('sensor range: radar and scout technologies stack (+1 cell each)', () => {
    expect(research.getSensorRangeBonus(faction(['basic_radar']))).toBe(1);
    expect(research.getSensorRangeBonus(faction(['basic_radar', 'advanced_radar', 'long_range_radar', 'scout_technology']))).toBe(4);
  });

  it('ship build speed: orbital_engineering advances production 25% faster', () => {
    const production = TestBed.inject(ProductionService);
    const run = (f: Faction): number => {
      const data: { production: FactionProduction[]; shipStock: never[] } = { production: [], shipStock: [] };
      const systems = [system([planet(['Spaceship Factory'])])];
      const order = production.queueOrder(data, 'player', 1, 'cruiser', 1, systems, [f]).order!;
      production.tick(1, data as never, systems, [], [f]);
      return order.progress;
    };
    const base = run(faction());
    expect(run(faction(['orbital_engineering']))).toBeCloseTo(base * 1.25, 9);
  });

  it('combat: attack/shield bonuses reach battle ships of the right hulls only, once per battle', () => {
    const ships = TestBed.inject(ShipService);
    const planets = TestBed.inject(PlanetBattleService);
    const attackerFaction = faction(['fighter_technology', 'advanced_weapons', 'frigate_technology']);
    const defenderFaction = faction([], { id: 'enemy1', team: 2 });
    const a = fleet(1, 'player', ['fighter', 'cruiser']);
    const d = fleet(2, 'enemy1', ['fighter']);
    const battle: Battle = {
      fleet1: a, fleet2: d, faction1Name: 'P', faction1Color: '#fff', faction2Name: 'E', faction2Color: '#f00',
      attackerId: 1, defenderId: 2,
      combatBonuses: research.buildCombatBonuses([attackerFaction, defenderFaction]),
    };
    const state = createBattleState(battle, ships, planets);
    const fighter = ships.getShipType('fighter')!;
    const cruiser = ships.getShipType('cruiser')!;
    const ownFighter = state.attackerShips.find((s) => s.typeId === 'fighter')!;
    const ownCruiser = state.attackerShips.find((s) => s.typeId === 'cruiser')!;
    // fighter_technology +25% and advanced_weapons +15% stack additively on fighters.
    expect(ownFighter.attack).toBeCloseTo(fighter.attack * 1.4, 6);
    expect(ownCruiser.attack).toBeCloseTo(cruiser.attack * 1.15, 6);
    expect(ownCruiser.maxShield).toBeCloseTo(cruiser.shield * 1.15, 6);
    // The defender has no technologies; the overworld fleet is not modified.
    expect(state.defenderShips[0].attack).toBe(fighter.attack);
    expect(a.ships.every((s) => s.currentHp === undefined)).toBe(true);
    // A battle without stamped bonuses (older battles, AI forecasts) uses base stats.
    const plain = createBattleState({ ...battle, combatBonuses: undefined }, ships, planets);
    expect(plain.attackerShips.find((s) => s.typeId === 'fighter')!.attack).toBe(fighter.attack);
  });

  it('player and AI factions get identical modifiers from the same technologies', () => {
    const techs = ['advanced_industry', 'improved_power', 'carrier_technology'];
    const player = faction(techs);
    const ai = faction(techs, { id: 'enemy1', ai: true, team: 2, aiDifficulty: 'normal' });
    expect(research.getModifiers(ai)).toEqual(research.getModifiers(player));
    const p = planet(['Large Residential Block', 'Fusion Power Plant']);
    const upkeep = (f: Faction) => economy.calculateEconomy(f.id, [f], [system([{ ...p, factionId: f.id }])], [], []).buildingUpkeepPerSecond;
    expect(upkeep(ai)).toBeCloseTo(upkeep(player), 9);
  });
});

describe('Technology effects — exactly once, save/load', () => {
  let research: ResearchService;
  let economy: EconomyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    research = TestBed.inject(ResearchService);
    economy = TestBed.inject(EconomyService);
  });

  it('duplicated or unknown ids in a save never count twice', () => {
    const clean = research.getModifiers(faction(['improved_power']));
    const messy = research.getModifiers(faction(['improved_power', 'improved_power', 'no_such_tech']));
    expect(messy).toEqual(clean);
  });

  it('repeated save/load cycles give identical modifiers and identical economy output', () => {
    let f = faction(['improved_power', 'advanced_industry', 'applied_science', 'carrier_technology']);
    const p = planet(['Large Residential Block', 'Fusion Power Plant', 'Research Laboratory']);
    const before = economy.calculateEconomy('player', [f], [system([p])], [fleet(1, 'player', ['cruiser'])], []);
    for (let i = 0; i < 3; i++) f = JSON.parse(JSON.stringify(f));
    const after = economy.calculateEconomy('player', [f], [system([p])], [fleet(1, 'player', ['cruiser'])], []);
    expect(research.getModifiers(f)).toEqual(research.getModifiers(faction(['improved_power', 'advanced_industry', 'applied_science', 'carrier_technology'])));
    expect(after.netPerSecond).toBeCloseTo(before.netPerSecond, 9);
    expect(after.net['research']).toBeCloseTo(before.net['research']!, 9);
    // The researched list is the only persisted research state.
    expect(Object.keys(f).filter((k) => k.toLowerCase().includes('modifier') || k.toLowerCase().includes('bonus'))).toEqual([]);
  });

  it('an old save without researchedTechnologies gets no bonuses and no errors', () => {
    const legacy = { ...faction(), researchedTechnologies: undefined };
    expect(research.getModifiers(legacy).energyOutput).toBe(1);
    expect(research.getSensorRangeBonus(legacy)).toBe(0);
  });
});

describe('Research rules and unlock timing', () => {
  let research: ResearchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    research = TestBed.inject(ResearchService);
  });

  it('enforces prerequisites and cost, and reports the reason', () => {
    const f = faction([], { currencies: { research: 10000 } });
    expect(research.getResearchBlocker(f, 'advanced_shipyards')).toBe('prerequisites_missing');
    expect(research.researchTechnology(f, 'advanced_shipyards').ok).toBe(false);
    const poor = faction([], { currencies: { research: 10 } });
    expect(research.getResearchBlocker(poor, 'improved_power')).toBe('insufficient_research');
    expect(research.researchTechnology(poor, 'improved_power')).toMatchObject({ ok: false, reason: 'insufficient_research' });
    expect(poor.currencies['research']).toBe(10);
    expect(research.getResearchBlocker(f, 'improved_power')).toBeUndefined();
  });

  it('research cost grows with technologies already researched (starting ones excluded), and that is what is charged', () => {
    const tech = research.getTechnology('fusion_power')!;
    const fresh = faction([], { currencies: { research: 100000 } });
    expect(research.getResearchCost(fresh, tech)).toBe(tech.researchCost);
    const advanced = faction(['improved_power', 'advanced_engineering', 'basic_radar'], { currencies: { research: 100000 } });
    const expected = Math.round(tech.researchCost * (1 + 3 * RESEARCH_COST_GROWTH_PER_TECH));
    expect(research.getResearchCost(advanced, tech)).toBe(expected);
    research.researchTechnology(advanced, 'fusion_power');
    expect(advanced.currencies['research']).toBe(100000 - expected);
    // Affordability uses the scaled cost too.
    const almost = faction(['improved_power', 'advanced_engineering', 'basic_radar'], { currencies: { research: tech.researchCost } });
    expect(research.canResearch(almost, 'fusion_power')).toBe(false);
    expect(research.getResearchBlocker(almost, 'fusion_power')).toBe('insufficient_research');
  });

  it('an unlock is available exactly when its technology is researched, and bonuses start then', () => {
    const f = faction([], { currencies: { research: 100000 } });
    expect(research.isShipUnlocked(f, 'corvette')).toBe(false);
    expect(research.getModifiers(f).energyOutput).toBe(1);
    research.researchTechnology(f, 'advanced_engineering');
    research.researchTechnology(f, 'improved_power');
    expect(research.isShipUnlocked(f, 'corvette')).toBe(true);
    expect(research.getModifiers(f).energyOutput).toBeCloseTo(1.15, 9);
    // Researching again is rejected and charges nothing.
    const points = f.currencies['research'];
    expect(research.researchTechnology(f, 'improved_power').reason).toBe('already_researched');
    expect(f.currencies['research']).toBe(points);
  });
});

describe('AI research decisions', () => {
  let ai: EnemyResearchService;
  let research: ResearchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ai = TestBed.inject(EnemyResearchService);
    research = TestBed.inject(ResearchService);
  });

  const aiFaction = (points: number, techs: string[] = []): Faction =>
    faction(techs, { id: 'enemy1', ai: true, team: 2, currencies: { credits: 0, research: points } });
  const home = (f: Faction, buildings: string[]) => [system([planet(buildings, { factionId: f.id })])];

  it('only ever picks a technology it can research right now', () => {
    const f = aiFaction(900);
    const choice = ai.selectTechnology(f, [f], home(f, ['Large Residential Block']), []);
    expect(choice).toBeDefined();
    expect(research.canResearch(f, choice!.id)).toBe(true);
  });

  it('with no research income it buys the best affordable technology instead of waiting forever', () => {
    const f = aiFaction(700);
    const choice = ai.selectTechnology(f, [f], home(f, ['Large Residential Block']), []);
    expect(choice).toBeDefined();
    expect(choice!.researchCost).toBeLessThanOrEqual(700);
  });

  it('saves for a clearly better technology that its research income reaches soon', () => {
    // Left to research: applied_science (3000 RP, valuable with strong
    // research income) and fighter_technology (600 RP, little value without
    // fighters). With ~15 RP/s the better one is ~2 min away.
    const remaining = ['applied_science', 'fighter_technology'];
    const all = research.getAllTechnologies().map((t) => t.id).filter((id) => !remaining.includes(id));
    const f = { ...aiFaction(0), researchedTechnologies: all } as Faction;
    const appliedCost = research.getResearchCost(f, research.getTechnology('applied_science')!);
    const fighterCost = research.getResearchCost(f, research.getTechnology('fighter_technology')!);
    f.currencies['research'] = appliedCost - 1500;
    expect(f.currencies['research']).toBeGreaterThanOrEqual(fighterCost);
    const systems = home(f, ['Large Residential Block', 'Large Residential Block', 'Large Residential Block', 'Fusion Power Plant', 'Research Laboratory', 'Research Laboratory', 'Research Laboratory']);
    expect(ai.selectTechnology(f, [f], systems, [])).toBeUndefined();
    // Once affordable it is bought.
    f.currencies['research'] = appliedCost;
    expect(ai.selectTechnology(f, [f], systems, [])?.id).toBe('applied_science');
    // Without research income waiting would never end: it buys the affordable one.
    f.currencies['research'] = appliedCost - 1500;
    expect(ai.selectTechnology(f, [f], home(f, ['Large Residential Block']), [])?.id).toBe('fighter_technology');
  });

  it('never gets stuck: with research income it eventually researches the whole tree', () => {
    const f = aiFaction(0);
    const systems = home(f, ['Large Residential Block', 'Fusion Power Plant', 'Research Laboratory']);
    for (let t = 0; t < 20000 && (f.researchedTechnologies ?? []).length < research.getAllTechnologies().length; t++) {
      f.currencies['research'] = (f.currencies['research'] ?? 0) + 25; // research income per 5 s decision
      ai.tick(5, f, [f], systems, []);
    }
    expect(f.researchedTechnologies!.length).toBe(research.getAllTechnologies().length);
    expect(f.currencies['research']).toBeGreaterThanOrEqual(0);
  });

  it('personality changes priorities: a technologist values research output more than a militarist', () => {
    const tech = research.getTechnology('applied_science')!;
    const score = (personality: 'technologist' | 'militarist') => {
      const f = { ...aiFaction(0), aiPersonality: personality } as Faction;
      return (ai as any).directValue(f, tech, (ai as any).buildContext(f, [f], home(f, ['Research Laboratory']), []));
    };
    expect(score('technologist')).toBeGreaterThan(score('militarist'));
  });
});

describe('Research tree UI feedback', () => {
  it('shows mechanical effects, why a technology is blocked, and the time to afford it', async () => {
    TestBed.configureTestingModule({});
    const research = TestBed.inject(ResearchService);
    const { StarMapResearchTreeComponent } = await import('../components/star-map/star-map-research-tree/star-map-research-tree.component');
    const ui = new StarMapResearchTreeComponent(research);
    ui.faction = faction([], { currencies: { research: 100 } });
    ui.researchPerSecond = 10;

    expect(ui.getEffects(research.getTechnology('improved_power')!)).toEqual(['+15% energy from power buildings']);
    expect(ui.getEffects(research.getTechnology('advanced_engineering')!)[0]).toBe('Unlocks ships: Corvette, Frigate');
    expect(ui.getBlockerText(research.getTechnology('fusion_power')!)).toBe('Requires Improved Power');
    // 600 − 100 = 500 RP at 10 RP/s.
    expect(ui.getBlockerText(research.getTechnology('improved_power')!)).toBe('Need 500 more RP (~50 s at 10.0 RP/s)');
    ui.researchPerSecond = 0;
    expect(ui.getBlockerText(research.getTechnology('improved_power')!)).toContain('no research income');
    expect(ui.getDependentNames(research.getTechnology('improved_power')!)).toEqual(['Fusion Power']);
  });
});

describe('Research save compatibility (SaveGameService round trip)', () => {
  it('an older save keeps its researched list and unlocks; effects are derived on load and survive repeated cycles unchanged', async () => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    TestBed.configureTestingModule({});
    const research = TestBed.inject(ResearchService);
    const { SaveGameService } = await import('./save-game.service');
    const saves = new SaveGameService();
    // Researched before this change: colonization_technology and the class
    // technologies were duplicate unlocks then; now they carry bonuses.
    const techs = [...STARTING, 'advanced_engineering', 'corvette_technology', 'colonization_technology', 'basic_radar'];
    const player = faction([], { researchedTechnologies: techs, currencies: { credits: 5, research: 123 } });
    const data = {
      factions: [player, faction([], { id: 'enemy1', name: 'E', team: 2, ai: true })],
      map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [system([planet(['Large Residential Block'])])],
      fleets: [],
    };
    let loadedPlayer = player;
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(saves.saveToSlot(1, { ...data, factions: [loadedPlayer, data.factions[1]] } as never)).toBe(true);
      loadedPlayer = saves.loadFromSlot(1)!.factions.find((f) => f.id === 'player')!;
    }
    expect(loadedPlayer.researchedTechnologies).toEqual(techs);
    expect(loadedPlayer.currencies['research']).toBe(123);
    expect(research.isShipUnlocked(loadedPlayer, 'colonizer')).toBe(true); // via basic_engineering
    expect(research.isShipUnlocked(loadedPlayer, 'corvette')).toBe(true); // via advanced_engineering
    expect(research.getModifiers(loadedPlayer)).toEqual(research.getModifiers(player));
    expect(research.getModifiers(loadedPlayer).populationGrowth).toBeCloseTo(1.5, 9);
    expect(research.getModifiers(loadedPlayer).shipAttack['corvette']).toBeCloseTo(1.2, 9);
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });
});

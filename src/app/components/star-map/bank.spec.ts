import { describe, it, expect } from 'vitest';
import { EconomyService } from '../../services/economy.service';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { checkBuildingPlacement, isBuildingLimitReached } from './building-placement';
import { Faction, PlanetTile } from './star-map.models';
import planetData from './planet-data.json';

/*
 * Bank building and the per-planet building cap (docs/economy.md, "Bank").
 * Values come from planet-data.json / research-tree.json, so a balance change
 * there is checked against the documented rules, not against copies.
 */
type BuildingJson = { id: string; name: string; role: string; size: number; maxPerPlanet?: number; production?: Partial<Record<string, number>> };
const buildings = (planetData as { buildings: BuildingJson[] }).buildings;
const BANK = buildings.find((b) => b.id === 'bank')!;
const TRADING_POST = buildings.find((b) => b.id === 'trading_post')!;

const planet = (names: string[], overrides: Partial<PlanetTile> = {}): PlanetTile => ({
  id: 7,
  index: 0,
  name: 'Bank World',
  factionId: 'player',
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'medium',
  population: 500,
  satisfaction: 100,
  explored: true,
  // Spread out so the placement checks below only meet the cap, not overlap.
  buildings: names.map((name, i) => ({ name, size: name === 'Large Residential Block' || name === 'Fusion Power Plant' ? 3 : 2, x: i * 4, y: 0 })),
  ...overrides,
} as PlanetTile);

const faction = (researched: string[]): Faction => ({
  id: 'player',
  name: 'Player',
  color: '#fff',
  team: 1,
  ai: false,
  currencies: { credits: 0, rawmaterials: 0, research: 0 },
  researchedTechnologies: researched,
} as Faction);

describe('Bank', () => {
  it('is a credit-producing finance building, capped at one per planet', () => {
    expect(BANK).toBeDefined();
    expect(BANK.role).toBe('finance');
    expect(BANK.production?.['credits']).toBeGreaterThan(0);
    expect(BANK.maxPerPlanet).toBe(1);
    expect(TRADING_POST.maxPerPlanet).toBe(1);
  });

  it('is unlocked by Advanced Industry, not at game start', () => {
    const research = new ResearchService();
    expect(research.isBuildingUnlocked(faction(['basic_industry']), 'bank')).toBe(false);
    expect(research.isBuildingUnlocked(faction(['basic_industry', 'advanced_industry']), 'bank')).toBe(true);
  });

  it('adds its listed credits to the planet when staffed, powered and satisfied', () => {
    const economy = new EconomyService(new ShipService());
    const without = economy.calculatePlanetEconomy(planet(['Large Residential Block', 'Fusion Power Plant']));
    const withBank = economy.calculatePlanetEconomy(planet(['Large Residential Block', 'Fusion Power Plant', 'Bank']));
    expect(withBank.workforceEfficiency).toBe(1);
    expect(withBank.efficiency).toBe(1);
    expect((withBank.production['credits'] ?? 0) - (without.production['credits'] ?? 0)).toBeCloseTo(BANK.production!['credits']!, 6);
  });

  it('earns nothing for an independent (rebel) planet', () => {
    const economy = new EconomyService(new ShipService());
    const rebel = economy.calculatePlanetEconomy(planet(['Large Residential Block', 'Bank'], { factionId: 'independent' }));
    expect(rebel.incomeMultiplier).toBe(0);
  });
});

describe('per-planet building cap', () => {
  it('refuses a second Bank or Trading Post and allows the first', () => {
    const empty = planet([]);
    const banked = planet(['Bank', 'Trading Post']);
    expect(isBuildingLimitReached(empty, BANK)).toBe(false);
    expect(isBuildingLimitReached(banked, BANK)).toBe(true);
    expect(isBuildingLimitReached(banked, TRADING_POST)).toBe(true);
    expect(checkBuildingPlacement(empty, 18, BANK, 10, 10)).toBeNull();
    expect(checkBuildingPlacement(banked, 18, BANK, 10, 10)).toBe('limit_reached');
  });

  it('does not cap buildings without maxPerPlanet', () => {
    const housed = planet(['Small Residential Block', 'Small Residential Block']);
    expect(isBuildingLimitReached(housed, { name: 'Small Residential Block' })).toBe(false);
  });
});

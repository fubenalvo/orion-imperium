import { describe, it, expect } from 'vitest';
import planetData from './planet-data.json';
import { describeBuilding, unlockingTechnologyName } from './building-info';
import type { BuildingType } from './star-map-planet-screen/star-map-planet-screen.component';

/*
 * Building info box content (building-info.ts). The guard that matters: a
 * building added to planet-data.json must get a written summary, otherwise
 * the player sees only its category.
 */
const buildings = (planetData as unknown as { buildings: BuildingType[] }).buildings;
const buildable = buildings.filter((b) => !b.autoPlaced);
const byId = (id: string) => buildings.find((b) => b.id === id)!;

describe('building info', () => {
  it('every buildable building has a written summary and an unlocking technology', () => {
    for (const building of buildable) {
      const info = describeBuilding(building);
      expect(info.summary, building.id).not.toBe(info.category);
      expect(info.summary.length, building.id).toBeGreaterThan(20);
      expect(unlockingTechnologyName(building.id), building.id).not.toBeNull();
    }
  });

  it('derives effect lines from the building data', () => {
    const mine = describeBuilding(byId('mining_complex'));
    expect(mine.effects).toContainEqual({ label: 'Raw materials', value: '+15/s', tone: 'gain' });
    expect(mine.notes).toContain('Must touch an ore deposit.');

    const housing = describeBuilding(byId('small_residential'));
    expect(housing.effects).toContainEqual({ label: 'Housing', value: '+100 people', tone: 'gain' });
    expect(housing.effects).toContainEqual({ label: 'Workers', value: '+20', tone: 'gain' });

    const bank = describeBuilding(byId('bank'));
    expect(bank.notes).toContain('One per planet.');
    expect(bank.effects).toContainEqual({ label: 'Base upkeep', value: '3.0 CR/s', tone: 'cost' });
  });
});

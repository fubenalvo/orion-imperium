import planetData from '../planet-data.json';
import {
  buildCategoryOf,
  groupBuildingsByCategory,
  loadCollapsedBuildCategories,
  saveCollapsedBuildCategories,
} from './build-categories';

describe('build-categories', () => {
  const buildable = (planetData.buildings as { id: string; role?: string; price: number; autoPlaced?: boolean }[])
    .filter((b) => !b.autoPlaced);

  beforeEach(() => localStorage.clear());

  it('puts every buildable building in a named category (none in OTHER)', () => {
    for (const b of buildable) {
      expect(buildCategoryOf(b), b.id).not.toBe('other');
    }
  });

  it('keeps every building exactly once, in category order and by price inside', () => {
    const groups = groupBuildingsByCategory(buildable);
    const ids = groups.flatMap((g) => g.buildings.map((b) => b.id));
    expect(ids.length).toBe(buildable.length);
    expect(new Set(ids).size).toBe(buildable.length);
    expect(groups[0].category.id).toBe('housing');
    expect(groups.find((g) => g.category.id === 'energy')!.buildings.map((b) => b.id))
      .toEqual(['solar_array', 'fusion_plant']);
    expect(groups.find((g) => g.category.id === 'shipyard')!.buildings.map((b) => b.id))
      .toEqual(['spaceship_factory', 'spaceport']);
  });

  it('sends an unknown role to OTHER instead of hiding it', () => {
    expect(buildCategoryOf({ id: 'x', role: 'new_role' })).toBe('other');
  });

  it('remembers collapsed categories and ignores unknown or corrupt values', () => {
    expect(loadCollapsedBuildCategories().size).toBe(0);
    saveCollapsedBuildCategories(new Set(['defense', 'comfort']));
    expect([...loadCollapsedBuildCategories()].sort()).toEqual(['comfort', 'defense']);

    localStorage.setItem('orion_build_categories_collapsed', '["defense","bogus",3]');
    expect([...loadCollapsedBuildCategories()]).toEqual(['defense']);

    localStorage.setItem('orion_build_categories_collapsed', '{not json');
    expect(loadCollapsedBuildCategories().size).toBe(0);
  });
});

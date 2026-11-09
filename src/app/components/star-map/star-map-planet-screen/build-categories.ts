/*
 * Build-list categories for the planet screen's BUILD tab.
 *
 * The list used to follow the order of planet-data.json, which mixed defence,
 * housing and industry. It is now grouped by the building's `role` into a
 * fixed category order that follows a new colony's usual needs: people first,
 * then the energy and comfort they need, then resources, trade, ships and
 * defence. Inside a category buildings are sorted by credit price, so the
 * cheap starter building comes first (Solar Array before Fusion Power Plant)
 * and the comfort buildings line up by comfort points (Park → Entertainment).
 *
 * A role missing from ROLE_CATEGORY lands in OTHER at the end, so a new
 * building type is never hidden from the list; give it a category here.
 *
 * Which categories the player has collapsed is a per-browser preference in
 * localStorage (not part of saves); every category is open by default.
 */

export type BuildCategoryId =
  | 'housing'
  | 'energy'
  | 'comfort'
  | 'production'
  | 'trade'
  | 'shipyard'
  | 'defense'
  | 'other';

export interface BuildCategory {
  id: BuildCategoryId;
  label: string;
}

export const BUILD_CATEGORIES: readonly BuildCategory[] = [
  { id: 'housing', label: 'Housing' },
  { id: 'energy', label: 'Energy' },
  { id: 'comfort', label: 'Comfort' },
  { id: 'production', label: 'Resources & Research' },
  { id: 'trade', label: 'Trade & Finance' },
  { id: 'shipyard', label: 'Shipyards' },
  { id: 'defense', label: 'Planetary Defense' },
  { id: 'other', label: 'Other' },
];

/* Building `role` (planet-data.json) → build-list category. */
const ROLE_CATEGORY: Readonly<Record<string, BuildCategoryId>> = {
  housing: 'housing',
  power: 'energy',
  social: 'comfort',
  research: 'production',
  trade: 'trade',
  finance: 'trade',
  military: 'shipyard',
  defense: 'defense',
};

/* Building ids whose role is shared with another category. The Spaceship
   Factory has role `industry` (like the Mining Complex) but belongs next to
   the Spaceport, which needs it. */
const ID_CATEGORY: Readonly<Record<string, BuildCategoryId>> = {
  spaceship_factory: 'shipyard',
  mining_complex: 'production',
};

export function buildCategoryOf(building: { id: string; role?: string }): BuildCategoryId {
  return ID_CATEGORY[building.id] ?? ROLE_CATEGORY[building.role ?? ''] ?? 'other';
}

export interface BuildCategoryGroup<T> {
  category: BuildCategory;
  buildings: T[];
}

/* Groups buildings in category order; empty categories are left out. */
export function groupBuildingsByCategory<T extends { id: string; role?: string; price: number }>(
  buildings: readonly T[],
): BuildCategoryGroup<T>[] {
  return BUILD_CATEGORIES.map((category) => ({
    category,
    buildings: buildings
      .filter((b) => buildCategoryOf(b) === category.id)
      .sort((a, b) => a.price - b.price),
  })).filter((group) => group.buildings.length > 0);
}

const COLLAPSED_STORAGE_KEY = 'orion_build_categories_collapsed';

/* Collapsed category ids from localStorage; anything unreadable means "all open". */
export function loadCollapsedBuildCategories(): Set<BuildCategoryId> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]');
    if (Array.isArray(stored)) {
      const known = new Set<string>(BUILD_CATEGORIES.map((c) => c.id));
      return new Set(stored.filter((id): id is BuildCategoryId => typeof id === 'string' && known.has(id)));
    }
  } catch {
    // Storage blocked or corrupt: every category open.
  }
  return new Set();
}

export function saveCollapsedBuildCategories(collapsed: ReadonlySet<BuildCategoryId>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Not remembered this time; the list still works.
  }
}

/*
 * =========================================================
 * HULL CLASSES — the size rock-paper-scissors of combat
 * =========================================================
 *
 * Every ship type belongs to one hull class (`hullClass` in
 * ship-data.json). The classes form a counter cycle that is applied on top
 * of the weapon-type table (battle-grid.ts):
 *
 *   light  beats heavy   — big guns cannot track small, agile hulls
 *   medium beats light   — fast, accurate escort fire
 *   heavy  beats medium  — armour and heavy guns overpower line ships
 *
 * Heavy hulls also besiege static defenses (planet turrets, base and mining
 * station cores: the 'structure' class) with a bonus. Structures attack
 * every class neutrally.
 *
 * This file is the single source of truth for the class table, used by
 * battle damage (applyVolleyDamage / expectedVolleyDamage), the AI's fleet
 * composition (enemy-economy.service.ts) and every UI text that explains a
 * hull's role (production panel, research tree). Changing a number here
 * changes combat, the AI and the descriptions together.
 * See docs/battle-rules.md#hull-classes.
 */

export type HullClass = 'light' | 'medium' | 'heavy';
/* Hull classes plus static defenses, which only appear in battle. */
export type CombatClass = HullClass | 'structure';

export const HULL_CLASSES: readonly HullClass[] = ['light', 'medium', 'heavy'];

/* Damage multiplier by attacker class (row) and target class (column). */
export const HULL_CLASS_EFFECTIVENESS: Record<CombatClass, Record<CombatClass, number>> = {
  light: { light: 1.0, medium: 0.75, heavy: 1.35, structure: 1.0 },
  medium: { light: 1.35, medium: 1.0, heavy: 0.75, structure: 1.0 },
  heavy: { light: 0.75, medium: 1.35, heavy: 1.0, structure: 1.5 },
  structure: { light: 1.0, medium: 1.0, heavy: 1.0, structure: 1.0 },
};

export function hullClassMultiplier(attacker: CombatClass, target: CombatClass): number {
  return HULL_CLASS_EFFECTIVENESS[attacker]?.[target] ?? 1.0;
}

/* The class a ship type fights as; unknown or missing data counts as medium (neutral middle). */
export function getHullClass(shipType: { hullClass?: string } | undefined): HullClass {
  const value = shipType?.hullClass;
  return value === 'light' || value === 'medium' || value === 'heavy' ? value : 'medium';
}

export interface HullClassInfo {
  label: string;
  /* The class this one deals bonus damage to. */
  strongAgainst: HullClass;
  /* The class that deals bonus damage to this one. */
  weakAgainst: HullClass;
  /* One-line role summary shown to the player. */
  summary: string;
}

export const HULL_CLASS_INFO: Record<HullClass, HullClassInfo> = {
  light: {
    label: 'Light',
    strongAgainst: 'heavy',
    weakAgainst: 'medium',
    summary: 'Cheap and agile. Swarms heavy hulls whose big guns cannot track them; shredded by medium escorts.',
  },
  medium: {
    label: 'Medium',
    strongAgainst: 'light',
    weakAgainst: 'heavy',
    summary: 'Line and escort ships. Their fast, accurate fire screens the fleet against light swarms; outgunned by heavy hulls.',
  },
  heavy: {
    label: 'Heavy',
    strongAgainst: 'medium',
    weakAgainst: 'light',
    summary: 'Armoured capital ships that crush medium line ships and besiege planets and stations; vulnerable to light swarms.',
  },
};

/* Percent bonus of a multiplier, e.g. 1.35 → 35. */
export function bonusPercent(multiplier: number): number {
  return Math.round((multiplier - 1) * 100);
}

export interface HullRoleText {
  hullClass: HullClass;
  label: string;
  summary: string;
  strongLine: string;
  weakLine: string;
  /* Extra role note (siege bonus for heavy hulls), or null. */
  siegeLine: string | null;
  /* Carrier shield aura (ship type `shieldAura`), or null. */
  auraLine: string | null;
}

/* Player-facing role description of a ship type, derived from the live tables above. */
export function describeHullRole(shipType: { hullClass?: string; shieldAura?: number } | undefined): HullRoleText {
  const hullClass = getHullClass(shipType);
  const info = HULL_CLASS_INFO[hullClass];
  const strong = HULL_CLASS_EFFECTIVENESS[hullClass][info.strongAgainst];
  const weakTaken = HULL_CLASS_EFFECTIVENESS[info.weakAgainst][hullClass];
  const siege = HULL_CLASS_EFFECTIVENESS[hullClass].structure;
  return {
    hullClass,
    label: info.label,
    summary: info.summary,
    strongLine: `Strong vs ${HULL_CLASS_INFO[info.strongAgainst].label.toLowerCase()} hulls (+${bonusPercent(strong)}% damage)`,
    weakLine: `Weak vs ${HULL_CLASS_INFO[info.weakAgainst].label.toLowerCase()} hulls (they deal +${bonusPercent(weakTaken)}% damage)`,
    siegeLine: siege > 1 ? `Siege: +${bonusPercent(siege)}% damage to planet defenses and stations` : null,
    auraLine: (shipType?.shieldAura ?? 0) > 0
      ? `Shield aura: it and allies within its gun range take ${Math.round((shipType!.shieldAura ?? 0) * 100)}% less damage (does not stack)`
      : null,
  };
}

/*
 * Armour: a ship's `defense` reduces incoming damage by a percentage,
 * ARMOR_SCALE / (ARMOR_SCALE + defense) (defense 28 → −22%). A percentage
 * (not a flat subtraction) keeps armour independent of how ships are
 * grouped into stacks: flat subtraction per volley made a fleet of 28
 * single-ship stacks fight far weaker against armour than 29 ships grouped
 * in stacks of five.
 */
export const ARMOR_SCALE = 100;

export function armorFactor(defense: number): number {
  return ARMOR_SCALE / (ARMOR_SCALE + Math.max(0, defense));
}

/* Damage reduction of an armour value in whole percent, for UI text. */
export function armorReductionPercent(defense: number): number {
  return Math.round((1 - armorFactor(defense)) * 100);
}

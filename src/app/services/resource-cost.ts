import { Faction } from '../components/star-map/star-map.models';

/*
 * =========================================================
 * RESOURCE COSTS (shared purchase rules)
 * =========================================================
 *
 * Single source of truth for what buildings and ships cost and how a
 * purchase touches a faction's stock. The human UI, StarMap building
 * placement, ProductionService and the AI (EnemyEconomyService) all go
 * through these helpers, so player and AI pay by the same rules.
 *
 * Costs come from data:
 *  - buildings: planet-data.json `price` (credits) + `rawMaterialCost`
 *  - ships:     ship-data.json `cost` (credits) + `rawMaterialCost`
 * A missing `rawMaterialCost` reads as 0 (legacy/custom data).
 *
 * Invariant: a purchase is all-or-nothing. `payCost` checks every
 * resource before deducting anything, so a failed purchase never
 * consumes a partial amount, and balances never go negative through a
 * purchase.
 */

export interface ResourceCost {
  credits: number;
  rawmaterials: number;
}

export const NO_COST: Readonly<ResourceCost> = { credits: 0, rawmaterials: 0 };

export function buildingCost(def: { price?: number; rawMaterialCost?: number }): ResourceCost {
  return { credits: def.price ?? 0, rawmaterials: def.rawMaterialCost ?? 0 };
}

/*
 * Campaign price factors by ship type id (MissionDysonRules.constructorCostFactor:
 * Mission 7's Swarm Constructor). Session state like the research horizon:
 * StarMap sets it on every load ({} outside a campaign), and every price —
 * shown, charged or judged by the AI — goes through shipCost.
 */
let campaignShipPriceFactors: Readonly<Record<string, number>> = {};

export function setCampaignShipPriceFactors(factors: Readonly<Record<string, number>>): void {
  campaignShipPriceFactors = { ...factors };
}

export function shipCost(type: { id?: string; cost?: number; rawMaterialCost?: number }, quantity = 1): ResourceCost {
  const factor = (type.id !== undefined ? campaignShipPriceFactors[type.id] : undefined) ?? 1;
  return {
    credits: Math.round((type.cost ?? 0) * factor) * quantity,
    rawmaterials: Math.round((type.rawMaterialCost ?? 0) * factor) * quantity,
  };
}

export function addCosts(a: ResourceCost, b: ResourceCost): ResourceCost {
  return { credits: a.credits + b.credits, rawmaterials: a.rawmaterials + b.rawmaterials };
}

/* Rounded share of a cost, e.g. the unbuilt part of a cancelled order. */
export function scaleCost(cost: ResourceCost, fraction: number): ResourceCost {
  const f = Math.max(0, Math.min(1, fraction));
  return { credits: Math.round(cost.credits * f), rawmaterials: Math.round(cost.rawmaterials * f) };
}

export function canAffordCost(faction: Faction, cost: ResourceCost): boolean {
  return (
    (faction.currencies['credits'] ?? 0) >= cost.credits
    && (faction.currencies['rawmaterials'] ?? 0) >= cost.rawmaterials
  );
}

/* Deducts the cost when affordable; returns false and changes nothing otherwise. */
export function payCost(faction: Faction, cost: ResourceCost): boolean {
  if (!canAffordCost(faction, cost)) {
    return false;
  }
  faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) - cost.credits;
  faction.currencies['rawmaterials'] = (faction.currencies['rawmaterials'] ?? 0) - cost.rawmaterials;
  return true;
}

export function refundCost(faction: Faction, cost: ResourceCost): void {
  if (cost.credits > 0) {
    faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) + cost.credits;
  }
  if (cost.rawmaterials > 0) {
    faction.currencies['rawmaterials'] = (faction.currencies['rawmaterials'] ?? 0) + cost.rawmaterials;
  }
}

/* Which resources a faction is missing for a cost (for UI messages and AI diagnostics). */
export function missingResources(faction: Faction, cost: ResourceCost): ('credits' | 'rawmaterials')[] {
  const missing: ('credits' | 'rawmaterials')[] = [];
  if ((faction.currencies['credits'] ?? 0) < cost.credits) missing.push('credits');
  if ((faction.currencies['rawmaterials'] ?? 0) < cost.rawmaterials) missing.push('rawmaterials');
  return missing;
}

import { Faction, Fleet, SpaceBase } from '../components/star-map/star-map.models';
import { areFactionsHostile } from '../components/star-map/diplomacy';
import { CampaignSiteDef, CampaignSiteState } from './campaign.models';

/*
 * =========================================================
 * CAMPAIGN SITES (pure rules)
 * =========================================================
 *
 * docs/campaign-design.md §13 (Mission 6's Remnant archives and the Lacuna
 * core). A site is claimed by holding it:
 *
 * - present: a faction with a living fleet of at least `minWarships`
 *   warships (not in a wormhole) within `radius` cells of the site;
 * - contested: something hostile to that faction is within the radius too —
 *   another faction's fleet with a warship, or a space base (a Remnant
 *   guardian platform is an outlaw base, hostile to everyone). A contested
 *   faction does not advance;
 * - each uncontested present faction gains the elapsed seconds; every other
 *   faction loses twice that, down to 0 (leaving costs progress, it is not
 *   frozen);
 * - the first to reach `holdSeconds` claims the site, for good. Faction
 *   order breaks a tie on the same tick (deterministic).
 *
 * CampaignService owns the state (saved in the session) and applies the
 * claim's rewards; `activeWhen` is evaluated there too.
 */

export interface SiteWorld {
  factions: readonly Faction[];
  fleets: readonly Fleet[];
  spaceBases: readonly SpaceBase[];
  /* Living warships in a fleet (ShipService knows the roles). */
  warships: (fleet: Fleet) => number;
}

export function emptySiteState(): CampaignSiteState {
  return { progress: {} };
}

/* Factions present at the site and whether each is contested, in faction order. */
export function sitePresence(def: CampaignSiteDef, world: SiteWorld): { factionId: string; contested: boolean }[] {
  const near = (x: number, y: number) => Math.hypot(Math.floor(x) - def.x, Math.floor(y) - def.y) <= def.radius;
  const armed = world.fleets.filter((f) => !f.destroyed && !f.transit && near(f.x, f.y) && world.warships(f) > 0);
  const bases = world.spaceBases.filter((b) => near(b.x, b.y));
  const result: { factionId: string; contested: boolean }[] = [];
  for (const faction of world.factions) {
    const own = armed.filter((f) => f.factionId === faction.id);
    if (!own.some((f) => world.warships(f) >= def.minWarships)) continue;
    const hostileFleet = armed.some((f) => {
      const other = world.factions.find((x) => x.id === f.factionId);
      return f.factionId !== faction.id && areFactionsHostile(faction, other);
    });
    const hostileBase = bases.some((b) => {
      const owner = world.factions.find((x) => x.id === b.factionId);
      return b.factionId !== faction.id && areFactionsHostile(faction, owner);
    });
    result.push({ factionId: faction.id, contested: hostileFleet || hostileBase });
  }
  return result;
}

/* Advances one site by `dt` seconds; returns the claimant when this tick claims it. */
export function advanceSite(def: CampaignSiteDef, state: CampaignSiteState, world: SiteWorld, dt: number): string | null {
  if (state.claimedBy || dt <= 0) return null;
  const presence = sitePresence(def, world);
  const advancing = new Set(presence.filter((p) => !p.contested).map((p) => p.factionId));
  for (const factionId of Object.keys(state.progress)) {
    if (advancing.has(factionId)) continue;
    const left = (state.progress[factionId] ?? 0) - 2 * dt;
    if (left > 0) state.progress[factionId] = left;
    else delete state.progress[factionId];
  }
  let claimant: string | null = null;
  for (const factionId of advancing) {
    const held = (state.progress[factionId] ?? 0) + dt;
    state.progress[factionId] = held;
    if (!claimant && held >= def.holdSeconds) claimant = factionId;
  }
  if (claimant) {
    state.claimedBy = claimant;
    state.progress = {};
  }
  return claimant;
}

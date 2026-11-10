import { Injectable } from '@angular/core';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { CampaignService } from '../../campaign/campaign.service';
import { CampaignAiDirective, CampaignSiteDef, CampaignSiteState } from '../../campaign/campaign.models';
import { livingWarships } from '../../campaign/campaign-objectives';
import { EnemyInvasionService } from './enemy-invasion.service';
import { SpaceBaseService } from './space-base.service';
import { buildBaseDefenseFleet, isCivilianMissionFleet } from './space-base';
import { stationTurretCount } from './station-defense';
import { areFactionsHostile } from './diplomacy';
import { AiActionLedger } from './ai-action-ledger';

/*
 * =========================================================
 * ENEMY CAMPAIGN SERVICE
 * =========================================================
 *
 * AI behavior toward campaign sites (docs/campaign-design.md §9, Mission 6):
 * the mission's directives (MissionDefinition.aiDirectives) say which AI
 * empire goes for which site, from when, and how carefully. Outside a
 * campaign (or a mission without directives) it does nothing.
 *
 * - claim: once the game clock passes `after` and the site is open and
 *   unclaimed, the strongest free combat fleet with `minWarships` living
 *   warships is sent to the site — but only when a battle forecast against
 *   the site's hostile space bases (the Remnant guardians) leaves at least
 *   `minSurvival` of it alive (Varkon bold, the Concordium cautious). The
 *   fleet stays on the site cell: the base battle starts there, then the
 *   hold progress runs (campaign-sites.ts).
 * - guard: a site the faction holds keeps one free fleet parked on it.
 *
 * Ownership follows the EnemyDysonService rule: fleets this service has
 * ordered (getOrderedFleetIds) are reserved by StarMapAiTickService from
 * EnemyFleetService and the other layers. An order ends — the fleet returns
 * to EnemyFleetService — when the site is claimed (claim) or lost (guard),
 * closes, or the fleet has no warship left.
 *
 * State: the per-faction decision clock and the orders (in memory, dropped
 * by reset()); a load re-derives them from the world and the directives.
 */
interface SiteOrder {
  siteId: string;
  mode: CampaignAiDirective['mode'];
}

@Injectable({ providedIn: 'root' })
export class EnemyCampaignService {
  static readonly DECISION_INTERVAL = 3;
  /* Share of a claim fleet's strength the forecast must leave alive, unless the directive says otherwise. */
  static readonly DEFAULT_MIN_SURVIVAL = 0.3;

  private readonly accumulators = new Map<string, number>();
  private readonly orders = new Map<number, SiteOrder>();

  constructor(
    private readonly campaign: CampaignService,
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
    private readonly invasion: EnemyInvasionService,
    private readonly bases: SpaceBaseService,
    private readonly actionLedger: AiActionLedger,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.orders.clear();
  }

  getOrderedFleetIds(): ReadonlySet<number> {
    return new Set(this.orders.keys());
  }

  /* The site a fleet's order is for (the debug panel and the ownership check of the simulation). */
  orderedSite(fleetId: number): string | undefined {
    return this.orders.get(fleetId)?.siteId;
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    data: { factions: Faction[]; fleets: Fleet[]; starSystems: StarSystem[] },
    reserved: ReadonlySet<number>,
    gameSeconds: number,
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) return false;
    const directives = this.campaign.aiDirectivesFor(faction.id);
    if (directives.length === 0) return false;
    const accumulator = (this.accumulators.get(faction.id) ?? 0) + gameDeltaTime;
    if (accumulator < EnemyCampaignService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, accumulator - EnemyCampaignService.DECISION_INTERVAL);

    const sites = new Map(this.campaign.siteEntries().map((e) => [e.def.id, e]));
    let changed = this.releaseFinished(faction, data.fleets, sites);
    for (const directive of directives) {
      const site = sites.get(directive.siteId);
      if (!site || site.state.active === false) continue;
      if (directive.mode === 'claim') changed = this.claim(faction, directive, site, data, reserved, gameSeconds) || changed;
      else changed = this.guard(faction, directive, site, data.fleets, reserved) || changed;
    }
    return changed;
  }

  private claim(
    faction: Faction,
    directive: CampaignAiDirective,
    site: { def: CampaignSiteDef; state: CampaignSiteState },
    data: { factions: Faction[]; fleets: Fleet[] },
    reserved: ReadonlySet<number>,
    gameSeconds: number,
  ): boolean {
    if (site.state.claimedBy || gameSeconds < (directive.after ?? 0)) return false;
    const current = this.orderedFleet(faction, data.fleets, site.def.id);
    if (current) return this.sendTo(current, site.def.x, site.def.y);

    const minWarships = Math.max(site.def.minWarships, directive.minWarships ?? 0);
    const minSurvival = directive.minSurvival ?? EnemyCampaignService.DEFAULT_MIN_SURVIVAL;
    const guardians = this.bases.bases.filter((b) => {
      const owner = data.factions.find((f) => f.id === b.factionId);
      return Math.hypot(b.x - site.def.x, b.y - site.def.y) <= site.def.radius && b.factionId !== faction.id && areFactionsHostile(faction, owner);
    });
    const candidates = this.freeCombatFleets(faction, data.fleets, reserved)
      .filter((f) => livingWarships(f) >= minWarships)
      .sort((a, b) => this.strength(b) - this.strength(a) || a.id - b.id);
    for (const fleet of candidates) {
      if (!this.survivesGuardians(fleet, guardians, data.factions, minSurvival)) continue;
      this.orders.set(fleet.id, { siteId: site.def.id, mode: 'claim' });
      this.actionLedger.record(faction, 'campaign_site_order');
      this.sendTo(fleet, site.def.x, site.def.y);
      return true;
    }
    return false;
  }

  private guard(
    faction: Faction,
    directive: CampaignAiDirective,
    site: { def: CampaignSiteDef; state: CampaignSiteState },
    fleets: Fleet[],
    reserved: ReadonlySet<number>,
  ): boolean {
    if (site.state.claimedBy !== faction.id) return false;
    const current = this.orderedFleet(faction, fleets, site.def.id);
    if (current) return this.sendTo(current, site.def.x, site.def.y);
    // The second-strongest free fleet: the strongest stays with EnemyFleetService for defense.
    const free = this.freeCombatFleets(faction, fleets, reserved)
      .filter((f) => livingWarships(f) >= (directive.minWarships ?? 1))
      .sort((a, b) => this.strength(b) - this.strength(a) || a.id - b.id);
    const pick = free[1];
    if (!pick) return false;
    this.orders.set(pick.id, { siteId: site.def.id, mode: 'guard' });
    this.actionLedger.record(faction, 'campaign_site_order');
    this.sendTo(pick, site.def.x, site.def.y);
    return true;
  }

  /* A forecast against every guardian at once (they fight together on the site). */
  private survivesGuardians(fleet: Fleet, guardians: { id: number }[], factions: Faction[], minSurvival: number): boolean {
    if (guardians.length === 0) return true;
    const defenders = this.bases.bases
      .filter((b) => guardians.some((g) => g.id === b.id))
      .map((b) => buildBaseDefenseFleet(b, stationTurretCount(this.researchService.getModifiers(factions.find((f) => f.id === b.factionId) ?? null).stationTurrets)));
    const forecast = this.invasion.forecastFleetBattle([fleet], defenders);
    return forecast.win && forecast.survivingRatio >= minSurvival;
  }

  private releaseFinished(faction: Faction, fleets: Fleet[], sites: Map<string, { def: CampaignSiteDef; state: CampaignSiteState }>): boolean {
    let changed = false;
    for (const [fleetId, order] of [...this.orders]) {
      const fleet = fleets.find((f) => f.id === fleetId);
      if (!fleet) {
        this.orders.delete(fleetId);
        continue;
      }
      if (fleet.factionId !== faction.id) continue;
      const site = sites.get(order.siteId);
      const done = fleet.destroyed || livingWarships(fleet) === 0 || !site || site.state.active === false
        || (order.mode === 'claim' ? !!site.state.claimedBy : site.state.claimedBy !== faction.id);
      if (!done) continue;
      this.orders.delete(fleetId);
      if (!fleet.destroyed) {
        fleet.targetX = null;
        fleet.targetY = null;
      }
      changed = true;
    }
    return changed;
  }

  private orderedFleet(faction: Faction, fleets: Fleet[], siteId: string): Fleet | undefined {
    for (const [fleetId, order] of this.orders) {
      if (order.siteId !== siteId) continue;
      const fleet = fleets.find((f) => f.id === fleetId);
      if (fleet && fleet.factionId === faction.id && !fleet.destroyed) return fleet;
    }
    return undefined;
  }

  private freeCombatFleets(faction: Faction, fleets: Fleet[], reserved: ReadonlySet<number>): Fleet[] {
    return fleets.filter(
      (f) => f.factionId === faction.id && !f.destroyed && !f.transit && !reserved.has(f.id) && !this.orders.has(f.id)
        && !isCivilianMissionFleet(f) && livingWarships(f) > 0,
    );
  }

  private strength(fleet: Fleet): number {
    return this.shipService.calculateFleetStrength(fleet.ships.filter((s) => !s.destroyed));
  }

  /* Orders a galaxy move unless the fleet is already there or on its way; clears other roles' fields. */
  private sendTo(fleet: Fleet, x: number, y: number): boolean {
    const there = Math.floor(fleet.x) === x && Math.floor(fleet.y) === y;
    const heading = fleet.targetX === x && fleet.targetY === y;
    if (there || heading) return false;
    fleet.system = null;
    fleet.targetX = x;
    fleet.targetY = y;
    fleet.interceptAsteroidId = null;
    fleet.attackFleetId = null;
    fleet.raidTraderId = null;
    return true;
  }
}

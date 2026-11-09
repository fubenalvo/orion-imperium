import { Component, Input } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { PlanetEconomyEntry, PlanetTile } from '../star-map.models';
import { planetTypeTraits } from '../planet-types';
import { PlanetDepositView, planetDepositView } from '../raw-deposits';
import { COMFORT_CONFIG } from '../comfort';

/*
 * Planet details summary, shared by the planet view sidebar (DETAILS tab)
 * and the system view's planet info card, so both show the same minimal
 * panel (docs/ui-styling.md, Screen treatments → Planet view).
 *
 * Deliberately a game panel, not a spreadsheet: headline values and spare
 * capacity, alerts only when something is wrong, and the exact figures
 * behind tooltips built here. Purely presentational: everything is derived
 * from the planet and its PlanetEconomyEntry (EconomyService).
 *
 * The host provides the scroll container and the panel chrome; this
 * component only lays out its content.
 */
@Component({
  selector: 'app-planet-details',
  standalone: true,
  imports: [DecimalPipe, UpperCasePipe],
  templateUrl: './planet-details.component.html',
  styleUrl: './planet-details.component.scss',
})
export class PlanetDetailsComponent {
  @Input() planet: PlanetTile | null = null;
  @Input() planetEconomy: PlanetEconomyEntry | null = null;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  /* Off on the planet screen, where the buildings stand on the surface itself. */
  @Input() showBuildings = true;
  /* The system view's planet card: buildings shrink to a count (the list is
     its tooltip), and the planet-type and deposit how-to hints are dropped,
     so the card stays small over the system scene. */
  @Input() compact = false;

  /* Below this drift (%/s) satisfaction counts as steady, so tiny oscillations show no arrow. */
  private static readonly SATISFACTION_STEADY_DRIFT = 0.01;

  /* What the planet's type changes in the economy (planet-types.ts). */
  get planetTypeSummary(): string {
    return planetTypeTraits(this.planet?.type).summary;
  }

  /* Seconds of capture protection left (no rebellion meanwhile), or null. */
  get rebellionGraceSeconds(): number | null {
    const grace = this.planet?.rebellionGraceSeconds;
    return grace !== undefined && grace > 0 ? Math.ceil(grace) : null;
  }

  /*
   * Seconds until the planet rebels at its current satisfaction drift, or
   * null when it is not heading for 0%. Satisfaction moves toward its
   * target (comfort.ts), so only a target of 0 (a severe energy shortage)
   * ends in rebellion. A planet under capture protection cannot rebel
   * before the protection ends.
   */
  get secondsToRebellion(): number | null {
    const economy = this.planetEconomy;
    if (!economy || economy.satisfactionDrift >= 0 || economy.satisfactionTarget > 0) return null;
    const grace = this.rebellionGraceSeconds ?? 0;
    if (economy.satisfaction <= 0 && grace === 0) return null;
    return Math.max(grace, Math.ceil(economy.satisfaction / -economy.satisfactionDrift));
  }

  get satisfactionTrend(): 'rising' | 'falling' | 'steady' {
    const drift = this.planetEconomy?.satisfactionDrift ?? 0;
    const steady = PlanetDetailsComponent.SATISFACTION_STEADY_DRIFT;
    return drift > steady ? 'rising' : drift < -steady ? 'falling' : 'steady';
  }

  get satisfactionTooltip(): string {
    const e = this.planetEconomy;
    if (!e) return '';
    const lines = [
      `Heading toward ${Math.round(e.satisfactionTarget)}% (${e.satisfactionDrift >= 0 ? '+' : ''}${e.satisfactionDrift.toFixed(2)}%/s)`,
    ];
    if (e.habitabilityDrift !== 0)
      lines.push(
        `World habitability ${e.habitabilityDrift >= 0 ? '+' : ''}${e.habitabilityDrift.toFixed(2)}/s`,
      );
    if (e.buildingMoraleBonus !== 0)
      lines.push(
        `Entertainment ${e.buildingMoraleBonus >= 0 ? '+' : ''}${e.buildingMoraleBonus.toFixed(2)}/s`,
      );
    return lines.join('\n');
  }

  /* Workers left over after staffing every building; negative = a shortage. */
  get spareWorkers(): number {
    const e = this.planetEconomy;
    return e ? e.workforceAvailable - e.workforceRequired : 0;
  }

  get energyTooltip(): string {
    const e = this.planetEconomy;
    return e
      ? `Energy: ${Math.round(e.energyProduction)} produced, ${Math.round(e.energyConsumption)} used`
      : '';
  }

  get workforceTooltip(): string {
    const e = this.planetEconomy;
    return e ? `Workers: ${e.workforceAvailable} available, ${e.workforceRequired} needed` : '';
  }

  /* Comfort (comfort.ts) only matters above the free population, so below it the tile reads OK. */
  get comfortTooltip(): string {
    const e = this.planetEconomy;
    if (!e) return '';
    if (e.comfortNeed <= 0)
      return `No comfort needed below ${COMFORT_CONFIG.freePopulation.toLocaleString('en-US')} people.`;
    const set = e.comfortFullSet ? '\nFull set of comfort kinds: +15%' : '';
    return `Comfort: ${e.comfortProvided.toFixed(1)} provided, ${e.comfortNeed.toFixed(1)} needed${set}`;
  }

  /*
   * The planet's raw-material deposit (null without one). Deposits are part
   * of what an explored planet shows, so the player can judge colonization
   * and mining targets; only the owner's mines change it.
   */
  get depositView(): PlanetDepositView | null {
    return this.planet ? planetDepositView(this.planet, this.planetEconomy?.miningRate ?? 0) : null;
  }

  depositTooltip(deposit: PlanetDepositView): string {
    const rate = deposit.status === 'active' ? `\nMining ${deposit.miningRate.toFixed(1)}/s` : '';
    return (
      `${deposit.label}: ${Math.round(deposit.remaining).toLocaleString('en-US')} of ${Math.round(deposit.total).toLocaleString('en-US')} left` +
      ` · richness ×${deposit.richness.toFixed(2)}${rate}`
    );
  }

  formatDepositTime(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return '—';
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  }

  /* Buildings grouped by name, most numerous first ("Large Residential Block ×12"). */
  get buildingGroups(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const b of this.planet?.buildings ?? []) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  get buildingCount(): number {
    return this.planet?.buildings?.length ?? 0;
  }

  get buildingsTooltip(): string {
    const groups = this.buildingGroups;
    if (groups.length === 0) return 'No buildings yet.';
    return ['Buildings', ...groups.map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name))].join('\n');
  }

  /* Rounded, sign-prefixed readout ("+140", "−7"). */
  signed(value: number | undefined): string {
    const v = Math.round(value ?? 0);
    return v > 0
      ? `+${v.toLocaleString('en-US')}`
      : v < 0
        ? `−${(-v).toLocaleString('en-US')}`
        : '0';
  }
}

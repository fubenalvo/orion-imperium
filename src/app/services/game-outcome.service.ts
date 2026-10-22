import { Injectable } from '@angular/core';
import { Faction, Fleet, PlanetTile, StarMapData, StarSystem } from '../components/star-map/star-map.models';

export type GameOutcome = 'inProgress' | 'victory' | 'defeat';

@Injectable({ providedIn: 'root' })
export class GameOutcomeService {
  private lastOutcome: GameOutcome = 'inProgress';

  getLastOutcome(): GameOutcome { return this.lastOutcome; }
  reset(): void { this.lastOutcome = 'inProgress'; }
  setLastOutcome(outcome: GameOutcome): void { this.lastOutcome = outcome; }

  evaluate(data: StarMapData): GameOutcome {
    const outcome = this.evaluateOutcome(data.factions, data.starSystems, data.fleets);
    this.lastOutcome = outcome;
    return outcome;
  }

  evaluateOutcome(factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): GameOutcome {
    const playerFaction = factions.find(f => f.id === 'player');
    if (!playerFaction) return 'defeat';

    const aiFactionIds = factions.filter(f => f.ai === true).map(f => f.id);
    const alliedFactionIds = new Set<string>();
    alliedFactionIds.add('player');
    for (const faction of factions) {
      if (faction.id === 'player') continue;
      if (faction.ai === false && faction.team !== 0 && faction.team === playerFaction.team) {
        alliedFactionIds.add(faction.id);
      }
    }

    const inhabitedPlanets: PlanetTile[] = [];
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId === 'unhabited') continue;
        if ((planet.population ?? 0) <= 0 && !(planet.buildings ?? []).length) continue;
        inhabitedPlanets.push(planet);
      }
    }

    if (inhabitedPlanets.length === 0) {
      if (!this.hasSurvivingFleet(fleets, 'player')) return 'defeat';
      return this.lastOutcome === 'victory' ? 'victory' : 'inProgress';
    }

    const hostileAiFactionIds = new Set<string>();
    for (const factionId of aiFactionIds) {
      if (alliedFactionIds.has(factionId)) continue;
      hostileAiFactionIds.add(factionId);
    }

    for (const planet of inhabitedPlanets) {
      if (planet.factionId === 'unhabited') continue;
      if (alliedFactionIds.has(planet.factionId)) continue;
      return 'inProgress';
    }

    for (const factionId of hostileAiFactionIds) {
      if (this.hasSurvivingFleet(fleets, factionId)) return 'inProgress';
    }

    const playerHasAnyInhabitedPlanet = inhabitedPlanets.some(p => alliedFactionIds.has(p.factionId));
    if (!playerHasAnyInhabitedPlanet) {
      if (!this.hasSurvivingFleet(fleets, 'player')) return 'defeat';
      return 'inProgress';
    }

    return 'victory';
  }

  private hasSurvivingFleet(fleets: Fleet[], factionId: string): boolean {
    for (const fleet of fleets ?? []) {
      if (fleet.factionId !== factionId) continue;
      if (fleet.destroyed) continue;
      if ((fleet.ships ?? []).some(s => s.destroyed !== true)) return true;
    }
    return false;
  }
}

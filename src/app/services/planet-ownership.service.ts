import { Injectable } from '@angular/core';
import { Faction, FactionProduction, PlanetTile } from '../components/star-map/star-map.models';
import { ProductionService } from './production.service';

export type OwnershipChangeReason = 'colonized' | 'captured' | 'battle_won' | 'rebellion';

/*
 * =========================================================
 * PLANET OWNERSHIP SERVICE
 * =========================================================
 *
 * The single authoritative pathway for changing `PlanetTile.factionId`.
 * Every gameplay rule that changes a planet's owner goes through
 * transferPlanet: colonization (player arrival and AI executor),
 * capture of an undefended planet (player arrival and AI invasion),
 * planet battle victory (battle screen and AI auto-resolve) and
 * rebellion (EconomyService). Callers decide WHETHER a transfer is
 * allowed by their rule; this service performs it consistently:
 *
 *  - writes the new owner;
 *  - cancels the previous owner's production orders on that planet and
 *    refunds their unbuilt part (a captured factory must not keep
 *    building ships for the faction that lost it — ProductionService.tick
 *    only refunds orders whose planet disappeared entirely);
 *  - bumps `revision`, which StarMap watches to re-evaluate the game
 *    outcome after ownership changes made during the frame loop.
 *
 * Population, buildings, satisfaction and the persisted planetary shield
 * pool stay with the planet: the conqueror takes the planet as it is.
 * Transfers to the current owner are ignored, so a rule that fires more
 * than once cannot apply the same change twice.
 */
@Injectable({ providedIn: 'root' })
export class PlanetOwnershipService {
  private revisionCounter = 0;

  constructor(private readonly productionService: ProductionService) {}

  get revision(): number {
    return this.revisionCounter;
  }

  transferPlanet(
    data: { production?: FactionProduction[]; factions?: Faction[] },
    planet: PlanetTile,
    newOwnerId: string,
    _reason: OwnershipChangeReason,
  ): boolean {
    const previousOwnerId = planet.factionId;
    if (previousOwnerId === newOwnerId) {
      return false;
    }

    const previousProduction = data.production?.find((p) => p.factionId === previousOwnerId);
    const orders = previousProduction?.ordersByPlanet[planet.id];
    if (previousProduction && orders && orders.length > 0) {
      for (const order of [...orders]) {
        this.productionService.cancelOrder(data, previousOwnerId, planet.id, order.id, data.factions ?? []);
      }
      delete previousProduction.ordersByPlanet[planet.id];
    }

    planet.factionId = newOwnerId;
    this.revisionCounter++;
    return true;
  }
}

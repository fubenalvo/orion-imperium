import { Injectable } from '@angular/core';
import { Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';
import { FleetRepairResult, advanceFleetRepair } from './fleet-repair';
import { SpaceportService } from '../../services/spaceport.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { SpaceBaseService } from './space-base.service';
import { isStationComplete } from './station-construction';
import { isDysonAnchor } from './dyson-anchor';

export interface FleetRepairWorld {
  fleets: Fleet[];
  shipStock?: FactionShipStock[];
  factions: Faction[];
  starSystems: StarSystem[];
}

/*
 * Resolves the repair sites of the live world for the pure repair rules
 * (fleet-repair.ts): Spaceport systems per faction, the faction's completed
 * space bases (not Dyson anchors) when it has a `stationRepair`
 * technology. StarMap calls it from the game loop and the AI simulation
 * spec calls it the same way, so both run one rule.
 */
@Injectable({ providedIn: 'root' })
export class FleetRepairService {
  constructor(
    private readonly spaceportService: SpaceportService,
    private readonly spaceBaseService: SpaceBaseService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
  ) {}

  step(world: FleetRepairWorld, deltaSeconds: number): FleetRepairResult {
    // Spaceport system cells per faction, built once per step.
    const spaceportCells = new Map<string, Set<string>>();
    const cellsOf = (factionId: string): Set<string> => {
      let cells = spaceportCells.get(factionId);
      if (!cells) {
        cells = new Set(
          this.spaceportService
            .listSpaceports(factionId, world.starSystems)
            .map(({ system }) => `${Math.floor(system.x)}-${Math.floor(system.y)}`),
        );
        spaceportCells.set(factionId, cells);
      }
      return cells;
    };
    const baseRepair = new Map<string, boolean>();
    const hasBaseRepair = (factionId: string): boolean => {
      if (!baseRepair.has(factionId)) {
        const faction = world.factions.find((f) => f.id === factionId);
        baseRepair.set(factionId, !!faction && this.researchService.getModifiers(faction).stationRepair > 0);
      }
      return baseRepair.get(factionId)!;
    };

    return advanceFleetRepair(
      {
        fleets: world.fleets,
        shipStock: world.shipStock,
        factionsWithSpaceport: new Set(
          (world.shipStock ?? []).map((s) => s.factionId).filter((id) => cellsOf(id).size > 0),
        ),
        maxHp: (typeId) => this.shipService.getShipType(typeId)?.hitPoints,
        siteFor: (fleet) => {
          const col = Math.floor(fleet.x);
          const row = Math.floor(fleet.y);
          if (cellsOf(fleet.factionId).has(`${col}-${row}`)) return 'spaceport';
          const base = this.spaceBaseService.getBaseAtCell(col, row);
          const repairs =
            !!base &&
            base.factionId === fleet.factionId &&
            isStationComplete(base) &&
            !isDysonAnchor(base) &&
            hasBaseRepair(fleet.factionId);
          return repairs ? 'base' : null;
        },
      },
      deltaSeconds,
    );
  }
}

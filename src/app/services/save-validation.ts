import { StarMapData } from '../components/star-map/star-map.models';
import shipData from '../components/star-map/ship-data.json';

interface ShipDataFile {
  shipTypes: Array<{ id: string }>;
}

/*
 * Save format versioning and validation.
 *
 * `SAVE_VERSION` is the current on-disk format version. Saves without the
 * field are treated as version 0 and migrated on first load; migration must
 * be idempotent so repeated load/save cycles never drift.
 *
 * `validateSaveData` is the single structural gate shared by the save slot
 * activation path and StarMap.loadGame. It must never throw on malformed
 * input and never mutate the data it inspects.
 */
export const KNOWN_SHIP_TYPES: ReadonlySet<string> = new Set(
  (shipData as ShipDataFile).shipTypes.map((shipType) => shipType.id),
);

export const SAVE_VERSION = 1;

export const CURRENT_MAP_GRID = { width: 300, height: 180 } as const;

export interface SaveValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface SaveValidationResult {
  ok: boolean;
  errors: SaveValidationIssue[];
  warnings: SaveValidationIssue[];
}

function error(code: string, path: string, message: string): SaveValidationIssue {
  return { code, path, message, severity: 'error' };
}

function warning(code: string, path: string, message: string): SaveValidationIssue {
  return { code, path, message, severity: 'warning' };
}

const PLAYER_FACTION_ID = 'player';

export function validateSaveData(
  data: unknown,
  knownShipTypes: ReadonlySet<string> = KNOWN_SHIP_TYPES,
): SaveValidationResult {
  const errors: SaveValidationIssue[] = [];
  const warnings: SaveValidationIssue[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    errors.push(error('not_object', 'root', 'Save data must be an object'));
    return { ok: false, errors, warnings };
  }

  const save = data as Partial<StarMapData>;

  if (
    save.saveVersion !== undefined &&
    (typeof save.saveVersion !== 'number' ||
      !Number.isInteger(save.saveVersion) ||
      save.saveVersion < 0 ||
      save.saveVersion > SAVE_VERSION)
  ) {
    errors.push(
      error(
        'save_version_invalid',
        'saveVersion',
        `saveVersion must be an integer between 0 and ${SAVE_VERSION}`,
      ),
    );
  }

  if (!Array.isArray(save.factions)) {
    errors.push(error('factions_not_array', 'factions', 'factions must be an array'));
  }
  if (!Array.isArray(save.starSystems)) {
    errors.push(error('starSystems_not_array', 'starSystems', 'starSystems must be an array'));
  }
  if (!Array.isArray(save.fleets)) {
    errors.push(error('fleets_not_array', 'fleets', 'fleets must be an array'));
  }

  if (!save.map || typeof save.map !== 'object') {
    errors.push(error('map_missing', 'map', 'map configuration is missing'));
  } else {
    const width = save.map.width;
    const height = save.map.height;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
      errors.push(error('map_width_invalid', 'map.width', 'map width must be a positive number'));
    }
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
      errors.push(error('map_height_invalid', 'map.height', 'map height must be a positive number'));
    }
  }

  if (Array.isArray(save.factions)) {
    if (save.factions.length === 0) {
      errors.push(error('factions_empty', 'factions', 'at least one faction is required'));
    }
    const seen = new Set<string>();
    let playerFound = false;
    for (const [i, faction] of save.factions.entries()) {
      const path = `factions[${i}]`;
      if (!faction || typeof faction !== 'object') {
        errors.push(error('faction_invalid', path, 'faction must be an object'));
        continue;
      }
      if (typeof faction.id !== 'string' || faction.id.length === 0) {
        errors.push(error('faction_id_invalid', `${path}.id`, 'faction id must be a non-empty string'));
      } else {
        if (seen.has(faction.id)) {
          warnings.push(warning('faction_id_duplicate', `${path}.id`, `duplicate faction id "${faction.id}"`));
        }
        seen.add(faction.id);
        if (faction.id === PLAYER_FACTION_ID) {
          playerFound = true;
        }
      }
      if (
        !faction.currencies ||
        typeof faction.currencies !== 'object' ||
        Array.isArray(faction.currencies)
      ) {
        errors.push(error('currency_invalid', `${path}.currencies`, 'currencies must be an object'));
      } else {
        for (const [key, value] of Object.entries(faction.currencies)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(
              error('currency_nan', `${path}.currencies.${key}`, `currency value must be a finite number`),
            );
          }
        }
      }
      if (faction.researchedTechnologies !== undefined) {
        if (!Array.isArray(faction.researchedTechnologies)) {
          errors.push(
            error('research_not_array', `${path}.researchedTechnologies`, 'researchedTechnologies must be an array'),
          );
        } else if (faction.researchedTechnologies.some((t) => typeof t !== 'string')) {
          errors.push(
            error('research_invalid_entry', `${path}.researchedTechnologies`, 'researchedTechnology entries must be strings'),
          );
        }
      }
    }
    if (!playerFound) {
      errors.push(error('player_faction_missing', 'factions', 'player faction is missing'));
    }
  }

  if (Array.isArray(save.starSystems)) {
    if (save.starSystems.length === 0) {
      errors.push(error('starSystems_empty', 'starSystems', 'at least one star system is required'));
    }
    const seen = new Set<string>();
    for (const [i, system] of save.starSystems.entries()) {
      const path = `starSystems[${i}]`;
      if (!system || typeof system !== 'object') {
        errors.push(error('system_invalid', path, 'star system must be an object'));
        continue;
      }
      if (typeof system.id !== 'string' || system.id.length === 0) {
        errors.push(error('system_id_invalid', `${path}.id`, 'star system id must be a non-empty string'));
      } else if (seen.has(system.id)) {
        errors.push(error('system_id_duplicate', `${path}.id`, `duplicate star system id "${system.id}"`));
      } else {
        seen.add(system.id);
      }
      if (typeof system.x !== 'number' || !Number.isFinite(system.x)) {
        errors.push(error('system_x_invalid', `${path}.x`, 'system x must be a finite number'));
      }
      if (typeof system.y !== 'number' || !Number.isFinite(system.y)) {
        errors.push(error('system_y_invalid', `${path}.y`, 'system y must be a finite number'));
      }
      if (system.planetsTiles !== undefined) {
        if (!Array.isArray(system.planetsTiles)) {
          errors.push(error('planets_not_array', `${path}.planetsTiles`, 'planetsTiles must be an array'));
        } else {
          for (const [j, planet] of system.planetsTiles.entries()) {
            const planetPath = `${path}.planetsTiles[${j}]`;
            if (!planet || typeof planet !== 'object') {
              errors.push(error('planet_invalid', planetPath, 'planet must be an object'));
              continue;
            }
            if (typeof planet.id !== 'number' || !Number.isFinite(planet.id)) {
              errors.push(error('planet_id_invalid', `${planetPath}.id`, 'planet id must be a finite number'));
            }
            if (typeof planet.factionId !== 'string') {
              errors.push(error('planet_faction_invalid', `${planetPath}.factionId`, 'planet factionId must be a string'));
            }
            if (!Array.isArray(planet.buildings)) {
              errors.push(error('buildings_not_array', `${planetPath}.buildings`, 'planet buildings must be an array'));
            }
            if (typeof planet.population !== 'number' || !Number.isFinite(planet.population) || planet.population < 0) {
              warnings.push(warning('population_invalid', `${planetPath}.population`, 'population should be a non-negative number'));
            }
            if (
              planet.satisfaction !== undefined &&
              (typeof planet.satisfaction !== 'number' ||
                !Number.isFinite(planet.satisfaction) ||
                planet.satisfaction < 0 ||
                planet.satisfaction > 100)
            ) {
              errors.push(
                error('satisfaction_invalid', `${planetPath}.satisfaction`, 'satisfaction must be a finite number in [0, 100]'),
              );
            }
            if (
              planet.shieldPoolCurrent !== undefined &&
              (typeof planet.shieldPoolCurrent !== 'number' ||
                !Number.isFinite(planet.shieldPoolCurrent) ||
                planet.shieldPoolCurrent < 0)
            ) {
              errors.push(
                error('shield_current_invalid', `${planetPath}.shieldPoolCurrent`, 'shieldPoolCurrent must be a non-negative finite number'),
              );
            }
            if (planet.resourceTiles !== undefined && !Array.isArray(planet.resourceTiles)) {
              errors.push(error('resource_tiles_not_array', `${planetPath}.resourceTiles`, 'resourceTiles must be an array'));
            }
          }
        }
      }
    }
  }

  if (Array.isArray(save.fleets)) {
    const seenFleetIds = new Set<number>();
    const seenShipIds = new Set<number>();
    for (const [i, fleet] of save.fleets.entries()) {
      const path = `fleets[${i}]`;
      if (!fleet || typeof fleet !== 'object') {
        errors.push(error('fleet_invalid', path, 'fleet must be an object'));
        continue;
      }
      if (typeof fleet.id !== 'number' || !Number.isFinite(fleet.id)) {
        errors.push(error('fleet_id_invalid', `${path}.id`, 'fleet id must be a finite number'));
      } else if (seenFleetIds.has(fleet.id)) {
        errors.push(error('fleet_id_duplicate', `${path}.id`, `duplicate fleet id ${fleet.id}`));
      } else {
        seenFleetIds.add(fleet.id);
      }
      if (typeof fleet.x !== 'number' || !Number.isFinite(fleet.x)) {
        errors.push(error('fleet_x_invalid', `${path}.x`, 'fleet x must be a finite number'));
      }
      if (typeof fleet.y !== 'number' || !Number.isFinite(fleet.y)) {
        errors.push(error('fleet_y_invalid', `${path}.y`, 'fleet y must be a finite number'));
      }
      if (
        fleet.targetX !== null &&
        fleet.targetX !== undefined &&
        (typeof fleet.targetX !== 'number' || !Number.isFinite(fleet.targetX))
      ) {
        errors.push(error('fleet_target_invalid', `${path}.targetX`, 'fleet targetX must be null or a finite number'));
      }
      if (
        fleet.targetY !== null &&
        fleet.targetY !== undefined &&
        (typeof fleet.targetY !== 'number' || !Number.isFinite(fleet.targetY))
      ) {
        errors.push(error('fleet_target_invalid', `${path}.targetY`, 'fleet targetY must be null or a finite number'));
      }
      if (!Array.isArray(fleet.ships)) {
        errors.push(error('ships_not_array', `${path}.ships`, 'fleet ships must be an array'));
      } else {
        for (const [j, ship] of fleet.ships.entries()) {
          const shipPath = `${path}.ships[${j}]`;
          if (!ship || typeof ship !== 'object') {
            errors.push(error('ship_invalid', shipPath, 'ship must be an object'));
            continue;
          }
          if (typeof ship.id !== 'number' || !Number.isFinite(ship.id)) {
            errors.push(error('ship_id_invalid', `${shipPath}.id`, 'ship id must be a finite number'));
          } else if (seenShipIds.has(ship.id)) {
            warnings.push(warning('ship_id_duplicate', `${shipPath}.id`, `duplicate ship id ${ship.id}`));
          } else {
            seenShipIds.add(ship.id);
          }
          if (typeof ship.type !== 'string' || ship.type.length === 0) {
            errors.push(error('ship_type_invalid', `${shipPath}.type`, 'ship type must be a non-empty string'));
          } else if (!knownShipTypes.has(ship.type)) {
            warnings.push(warning('ship_type_unknown', `${shipPath}.type`, `unknown ship type "${ship.type}"`));
          }
          if (
            ship.currentHp !== undefined &&
            (typeof ship.currentHp !== 'number' || !Number.isFinite(ship.currentHp) || ship.currentHp < 0)
          ) {
            errors.push(error('ship_hp_invalid', `${shipPath}.currentHp`, 'currentHp must be a non-negative finite number'));
          }
        }
      }
    }
  }

  if (save.shipStock !== undefined) {
    if (!Array.isArray(save.shipStock)) {
      errors.push(error('stock_not_array', 'shipStock', 'shipStock must be an array'));
    } else {
      for (const [i, factionStock] of save.shipStock.entries()) {
        const path = `shipStock[${i}]`;
        if (!factionStock || typeof factionStock !== 'object') {
          errors.push(error('stock_entry_invalid', path, 'ship stock entry must be an object'));
          continue;
        }
        if (typeof factionStock.factionId !== 'string' || factionStock.factionId.length === 0) {
          errors.push(error('stock_faction_invalid', `${path}.factionId`, 'ship stock factionId must be a non-empty string'));
        }
        if (!Array.isArray(factionStock.ships)) {
          errors.push(error('stock_ships_not_array', `${path}.ships`, 'ship stock ships must be an array'));
          continue;
        }
        for (const [j, stockShip] of factionStock.ships.entries()) {
          const shipPath = `${path}.ships[${j}]`;
          if (!stockShip || typeof stockShip !== 'object') {
            errors.push(error('stock_ship_invalid', shipPath, 'ship stock ship must be an object'));
            continue;
          }
          if (typeof stockShip.id !== 'number' || !Number.isFinite(stockShip.id)) {
            errors.push(error('stock_ship_id_invalid', `${shipPath}.id`, 'ship stock ship id must be a finite number'));
          }
          if (typeof stockShip.type !== 'string' || stockShip.type.length === 0) {
            errors.push(error('stock_ship_type_invalid', `${shipPath}.type`, 'ship stock ship type must be a non-empty string'));
          } else if (!knownShipTypes.has(stockShip.type)) {
            warnings.push(warning('stock_ship_type_unknown', `${shipPath}.type`, `unknown ship type "${stockShip.type}"`));
          }
        }
      }
    }
  }
  if (save.production !== undefined && !Array.isArray(save.production)) {
    errors.push(error('production_not_array', 'production', 'production must be an array'));
  }
  if (Array.isArray(save.production)) {
    for (const [i, factionProd] of save.production.entries()) {
      const path = `production[${i}]`;
      if (!factionProd || typeof factionProd !== 'object') {
        errors.push(error('production_entry_invalid', path, 'production entry must be an object'));
        continue;
      }
      if (!factionProd.ordersByPlanet || typeof factionProd.ordersByPlanet !== 'object' || Array.isArray(factionProd.ordersByPlanet)) {
        errors.push(error('orders_invalid', `${path}.ordersByPlanet`, 'ordersByPlanet must be an object'));
        continue;
      }
      for (const [planetKey, orders] of Object.entries(factionProd.ordersByPlanet)) {
        const keyPath = `${path}.ordersByPlanet["${planetKey}"]`;
        if (!Array.isArray(orders)) {
          errors.push(error('queue_not_array', keyPath, 'planet queue must be an array'));
          continue;
        }
        for (const [j, order] of orders.entries()) {
          const orderPath = `${keyPath}[${j}]`;
          if (!order || typeof order !== 'object') {
            errors.push(error('order_invalid', orderPath, 'order must be an object'));
            continue;
          }
          if (typeof order.id !== 'number' || !Number.isFinite(order.id)) {
            errors.push(error('order_id_invalid', `${orderPath}.id`, 'order id must be a finite number'));
          }
          if (typeof order.quantity !== 'number' || !Number.isFinite(order.quantity) || order.quantity <= 0) {
            errors.push(error('order_quantity_invalid', `${orderPath}.quantity`, 'order quantity must be a positive finite number'));
          }
          if (typeof order.progress !== 'number' || !Number.isFinite(order.progress)) {
            errors.push(error('order_progress_invalid', `${orderPath}.progress`, 'order progress must be a finite number'));
          }
          if (typeof order.startedAtTick !== 'number' || !Number.isFinite(order.startedAtTick)) {
            errors.push(error('order_tick_invalid', `${orderPath}.startedAtTick`, 'order startedAtTick must be a finite number'));
          }
          if (typeof order.shipTypeId !== 'string' || order.shipTypeId.length === 0) {
            errors.push(error('order_ship_type_invalid', `${orderPath}.shipTypeId`, 'order shipTypeId must be a non-empty string'));
          } else if (!knownShipTypes.has(order.shipTypeId)) {
            warnings.push(warning('order_ship_type_unknown', `${orderPath}.shipTypeId`, `unknown ship type "${order.shipTypeId}"`));
          }
        }
      }
    }
  }

  if (save.exploredGridCells !== undefined && !Array.isArray(save.exploredGridCells)) {
    errors.push(error('fog_not_array', 'exploredGridCells', 'exploredGridCells must be an array'));
  }

  return { ok: errors.length === 0, errors, warnings };
}
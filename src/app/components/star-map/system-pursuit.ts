import { Fleet, StarSystem } from './star-map.models';
import { SYSTEM_FLEET_ENTRY_VW, systemCellAtVw } from './system-grid';

/*
 * In-system battle separation and pursuit (docs/game-systems.md, "Star
 * system view").
 *
 * Fleet battles normally start when two hostile fleets share a galaxy cell
 * (StarMapBattleDetectionService.checkForBattles). A star system is one
 * galaxy cell, so without this rule an enemy that reached the system on the
 * galaxy map would hit a player fleet anywhere inside it at once, even one
 * the player had already moved deep into the system.
 *
 * Rule: when a pair with a human side shares a system's galaxy cell and at
 * least one of them has an in-system position in that system
 * (`Fleet.system`), they fight only once their in-system cells match. A
 * fleet without an in-system position stands at SYSTEM_FLEET_ENTRY_VW.
 * When neither has one (nobody entered the system view), the plain galaxy
 * cell rule applies, so galaxy-map play is unchanged.
 *
 * Pursuit: a computer-side fleet (AI or outlaw) with warships that is
 * stopped in the system (no galaxy target) and hostile to a human fleet
 * inside it enters at the entry point and flies after the nearest such
 * fleet at in-system speed. Movement itself is StarMapMovementService's
 * ordinary `fleet.system` target handling, so it runs in every view.
 *
 * The system view also shows a jump-point warning (systemEntryAlert below).
 *
 * AI-vs-AI pairs keep the galaxy cell rule: AI fleets only get in-system
 * positions from the player's system view or from asteroid mining, and the
 * AI never plans in-system moves to reach an enemy.
 */

export interface SystemPursuitHooks {
  /* True for AI and outlaw fleets; the human side never pursues automatically. */
  isComputerFleet(fleet: Fleet): boolean;
  /* True when `hunter` may attack `quarry` now (war, opening grace, has warships). */
  mayHunt(hunter: Fleet, quarry: Fleet): boolean;
}

/* The fleet's in-system position in `systemId`; the entry point if it has none there. */
export function systemPositionOf(fleet: Fleet, systemId: string): { x: number; y: number } {
  return fleet.system?.id === systemId ? { x: fleet.system.x, y: fleet.system.y } : SYSTEM_FLEET_ENTRY_VW;
}

function systemAtGalaxyCell(starSystems: readonly StarSystem[], x: number, y: number): StarSystem | undefined {
  const col = Math.floor(x);
  const row = Math.floor(y);
  return starSystems.find((s) => Math.floor(s.x) === col && Math.floor(s.y) === row);
}

/*
 * True when two fleets on the same galaxy cell are kept apart inside the
 * system there (see the module comment). The caller has already checked
 * the shared galaxy cell and that one side is human.
 */
export function separatedInsideSystem(a: Fleet, b: Fleet, starSystems: readonly StarSystem[]): boolean {
  if (!a.system && !b.system) return false;
  const system = systemAtGalaxyCell(starSystems, a.x, a.y);
  if (!system || (a.system?.id !== system.id && b.system?.id !== system.id)) return false;
  const pa = systemPositionOf(a, system.id);
  const pb = systemPositionOf(b, system.id);
  const ca = systemCellAtVw(pa.x, pa.y);
  const cb = systemCellAtVw(pb.x, pb.y);
  return ca.col !== cb.col || ca.row !== cb.row;
}

/*
 * Re-aims every pursuing fleet at its nearest quarry. Returns true when a
 * hunter got an in-system position or a new in-system target.
 */
export function updateSystemPursuit(
  fleets: readonly Fleet[],
  starSystems: readonly StarSystem[],
  hooks: SystemPursuitHooks,
): boolean {
  let changed = false;
  for (const hunter of fleets) {
    if (hunter.destroyed || hunter.targetX !== null || hunter.targetY !== null) continue;
    if (!hooks.isComputerFleet(hunter)) continue;
    const system = systemAtGalaxyCell(starSystems, hunter.x, hunter.y);
    if (!system) continue;

    const from = systemPositionOf(hunter, system.id);
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (const quarry of fleets) {
      if (quarry === hunter || quarry.destroyed || hooks.isComputerFleet(quarry)) continue;
      if (Math.floor(quarry.x) !== Math.floor(hunter.x) || Math.floor(quarry.y) !== Math.floor(hunter.y)) continue;
      // Neither side inside the system view yet: the galaxy cell rule decides.
      if (quarry.system?.id !== system.id && hunter.system?.id !== system.id) continue;
      if (!hooks.mayHunt(hunter, quarry)) continue;
      const to = systemPositionOf(quarry, system.id);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = to;
      }
    }
    // Already on the quarry: battle detection takes over (re-aiming here would
    // only snap the target away again every frame).
    if (!best || bestDistance <= 0.01) continue;

    if (hunter.system?.id !== system.id) {
      hunter.system = { id: system.id, x: from.x, y: from.y, targetX: null, targetY: null };
      changed = true;
    }
    const location = hunter.system!;
    if (location.targetX !== best.x || location.targetY !== best.y) {
      location.targetX = best.x;
      location.targetY = best.y;
      changed = true;
    }
  }
  return changed;
}

/*
 * Jump-point warning for the system view: hostile fleets standing at the
 * entry point, or flying toward this system's galaxy cell and due within
 * SYSTEM_INBOUND_WARNING_SECONDS. Inside the system they are drawn on the
 * grid like any fleet; this marker covers the moment before they show up.
 * The ETA is a straight-line estimate (no nebula or route detour), so the
 * view rounds it and shows it as approximate.
 */
export const SYSTEM_INBOUND_WARNING_SECONDS = 30;

export interface SystemEntryAlert {
  kind: 'present' | 'inbound';
  /* Soonest arrival in game seconds (inbound only). */
  seconds: number | null;
  fleetIds: number[];
}

export interface SystemEntryAlertHooks {
  /* Hostile to the player and visible to the player's sensors. */
  isThreat(fleet: Fleet): boolean;
  /* Open-space galaxy speed (StarMapMovementService.galaxyCellsPerSecond). */
  cellsPerSecond(fleet: Fleet): number;
}

export function systemEntryAlert(
  fleets: readonly Fleet[],
  system: StarSystem,
  hooks: SystemEntryAlertHooks,
): SystemEntryAlert | null {
  const col = Math.floor(system.x);
  const row = Math.floor(system.y);
  const entry = systemCellAtVw(SYSTEM_FLEET_ENTRY_VW.x, SYSTEM_FLEET_ENTRY_VW.y);
  const present: number[] = [];
  const inbound: number[] = [];
  let soonest = Infinity;
  for (const fleet of fleets) {
    if (fleet.destroyed || !hooks.isThreat(fleet)) continue;
    const here = Math.floor(fleet.x) === col && Math.floor(fleet.y) === row;
    if (here) {
      const p = systemPositionOf(fleet, system.id);
      const cell = systemCellAtVw(p.x, p.y);
      if (cell.col === entry.col && cell.row === entry.row) present.push(fleet.id);
      continue;
    }
    if (fleet.targetX === null || fleet.targetY === null) continue;
    if (Math.floor(fleet.targetX) !== col || Math.floor(fleet.targetY) !== row) continue;
    const speed = hooks.cellsPerSecond(fleet);
    if (speed <= 0) continue;
    const seconds = Math.hypot(fleet.targetX - fleet.x, fleet.targetY - fleet.y) / speed;
    if (seconds > SYSTEM_INBOUND_WARNING_SECONDS) continue;
    inbound.push(fleet.id);
    soonest = Math.min(soonest, seconds);
  }
  if (present.length > 0) return { kind: 'present', seconds: null, fleetIds: [...present, ...inbound] };
  if (inbound.length > 0) return { kind: 'inbound', seconds: soonest, fleetIds: inbound };
  return null;
}

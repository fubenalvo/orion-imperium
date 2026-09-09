import {
  BattleFleetOutcome,
  BattleModelState,
  BattleOutcome,
  BattleShipOutcome,
  BattleSide,
} from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — RESULT BUILDER
 * =========================================================
 *
 * Maps the battle-local simulation state back onto the input fleet
 * rosters. Pure and deterministic: it reads only BattleModelState and
 * never touches overworld Fleet objects. The returned BattleOutcome is
 * what the outside game uses to update its fleet state.
 */

export function buildBattleOutcome(state: BattleModelState): BattleOutcome {
  const attacker = fleetOutcome(
    state.attackerFleetId,
    state.attackerFactionId,
    'attacker',
    state.attackerShips,
  );
  const defender = fleetOutcome(
    state.defenderFleetId,
    state.defenderFactionId,
    'defender',
    state.defenderShips,
  );

  const winnerSide: BattleSide = state.winner ?? 'attacker';
  const winnerFleetId = winnerSide === 'attacker' ? attacker.fleetId : defender.fleetId;
  const loserFleetId = winnerSide === 'attacker' ? defender.fleetId : attacker.fleetId;

  return {
    winnerSide,
    winnerFleetId,
    loserFleetId,
    attacker,
    defender,
    rounds: state.round,
    battleType: state.battleType,
    planetId: state.planetId,
  };
}

function fleetOutcome(
  fleetId: number,
  factionId: string,
  side: BattleSide,
  roster: BattleModelState['attackerShips'],
): BattleFleetOutcome {
  const ships: BattleShipOutcome[] = roster.map((s) => ({
    shipId: s.shipId,
    typeId: s.typeId,
    name: s.name,
    hp: Math.max(0, Math.round(s.hp)),
    destroyed: !s.alive,
  }));
  const survivors = ships.filter((s) => !s.destroyed);
  return {
    fleetId,
    side,
    factionId,
    ships,
    survivors,
    wipedOut: survivors.length === 0,
  };
}

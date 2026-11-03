import { Injectable } from '@angular/core';
import { Faction, Fleet } from './star-map.models';

/*
 * =========================================================
 * OPENING GRACE (hidden difficulty aid)
 * =========================================================
 *
 * Every game starts with everyone at war with everyone (docs/diplomacy.md).
 * For the first OPENING_GRACE_SECONDS of game time an AI still does not
 * attack the human player: the war stands on paper, but no AI starts a
 * fleet battle, a planet assault or a station battle against the player,
 * and the AI layers do not pick the player's fleets or planets as attack
 * targets. The player is not told about it; it only keeps the opening from
 * ending before the player has learned the controls.
 *
 * - Only AI → human aggression is blocked. The player may attack AI fleets
 *   and planets as usual, and a battle the player starts is fought.
 *   AI-vs-AI wars are unaffected.
 * - The AI still sees the player as hostile for threat and defense
 *   (posture, defend goals), so it can prepare; it just does not strike.
 * - The clock is the saved game clock (StarMapData.gameSeconds), so the
 *   grace survives save/load and ends at the same moment at any speed.
 *
 * The 240 s value is a first guess, not a measured balance value: watch
 * the opening in play (and the passive-player survival times in the QA
 * runs, docs/qa-fix-prompts.md) and change it if the opening is still too
 * harsh or too soft. See docs/planet-capture.md, "Opening grace".
 */
export const OPENING_GRACE_SECONDS = 240;

/* The human player's faction (the codebase's single human empire). */
const HUMAN_FACTION_ID = 'player';

/* True while `attacker` (an AI) must not attack `target` (the human). */
export function isSparedByOpeningGrace(
  attacker: Pick<Faction, 'ai'> | undefined,
  target: Pick<Faction, 'id'> | string | undefined,
  gameSeconds: number,
): boolean {
  if (!(gameSeconds < OPENING_GRACE_SECONDS) || attacker?.ai !== true) return false;
  const targetId = typeof target === 'string' ? target : target?.id;
  return targetId === HUMAN_FACTION_ID;
}

/*
 * A fleet contact between an AI fleet and a player fleet during the grace
 * is fought only when the player started it: an attack order on that AI
 * fleet, or the player fleet moving onto a stationary AI fleet. Otherwise
 * (the AI moved, or both just pass through) no battle starts.
 */
export function blocksOpeningFleetBattle(
  fleet1: Fleet,
  faction1: Faction,
  fleet2: Fleet,
  faction2: Faction,
  gameSeconds: number,
): boolean {
  const [ai, aiFleet, human, humanFleet] =
    faction1.ai === true ? [faction1, fleet1, faction2, fleet2] : [faction2, fleet2, faction1, fleet1];
  if (!isSparedByOpeningGrace(ai, human, gameSeconds)) return false;
  const moving = (f: Fleet) => f.targetX !== null && f.targetY !== null;
  const playerStarted = humanFleet.attackFleetId === aiFleet.id || (moving(humanFleet) && !moving(aiFleet));
  return !playerStarted;
}

/*
 * Holds the game clock for the grace checks of services that do not get
 * it passed in. StarMap sets it on every load (so a new game never
 * inherits the previous session's clock) and StarMapAiTickService.tick on
 * every AI tick that is given the saved clock. Until a clock is set the
 * grace is off (Infinity): a service used without a game session, as in
 * unit tests, behaves as after the opening.
 */
@Injectable({ providedIn: 'root' })
export class OpeningGraceService {
  private seconds = Infinity;

  setGameSeconds(seconds: number): void {
    this.seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : Infinity;
  }

  get gameSeconds(): number {
    return this.seconds;
  }

  spares(attacker: Pick<Faction, 'ai'> | undefined, target: Pick<Faction, 'id'> | string | undefined): boolean {
    return isSparedByOpeningGrace(attacker, target, this.seconds);
  }

  blocksFleetBattle(fleet1: Fleet, faction1: Faction, fleet2: Fleet, faction2: Faction): boolean {
    return blocksOpeningFleetBattle(fleet1, faction1, fleet2, faction2, this.seconds);
  }
}

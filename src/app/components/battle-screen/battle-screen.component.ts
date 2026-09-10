import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import {
  Battle,
  BattleModelState,
  BattleOutcome,
  BattleStack,
  GridCell,
} from './battle/battle.types';
import { createBattleState, isSidePlayerControlled } from './battle/battle-state';
import { getAttackTargetIds as computeAttackTargetIds, getReachableCells, getMoveToAttackTargetIds } from './battle/battle-grid';
import { buildBattleOutcome } from './battle/battle-result';
import { BattleMovementService } from './battle/battle-movement.service';
import { BattleCombatService } from './battle/battle-combat.service';
import { BattleTurnService } from './battle/battle-turn.service';
import { BattleAnimationService } from './battle/battle-animation.service';
import { BattleAiService } from './battle/battle-ai.service';
import { BattleGridComponent } from './battle-grid/battle-grid.component';

/*
 * =========================================================
 * BATTLE SCREEN COMPONENT
 * =========================================================
 *
 * Orchestrator for the self-contained tactical battle minigame.
 * It receives the Battle transport object from BattleService, builds
 * battle-local state (deep-cloned ships), and forwards player input to
 * the battle services. All simulation state lives in this component's
 * BattleModelState — the minigame never touches StarMap state.
 *
 * Navigation flow (unchanged from the old placeholder):
 * 1. StarMap detects collision -> BattleService.setBattle() -> navigate to /battle
 * 2. The minigame runs turn-based, AP-driven combat
 * 3. "Back to Star Map" persists the BattleOutcome and navigates back
 * 4. StarMap applies the outcome via reloadAfterBattle()
 */

@Component({
  selector: 'app-battle-screen',
  standalone: true,
  imports: [CommonModule, BattleGridComponent],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss',
})
export class BattleScreenComponent implements OnInit, OnDestroy {
  private battle: Battle | null = null;
  private state: BattleModelState | null = null;
  private ticksSub: Subscription;

  selectedStackId: string | null = null;

  private pointerX = 0.5;
  private pointerY = 0.5;
  private motionEnabled = false;
  private motionPermissionRequested = false;

  constructor(
    private router: Router,
    private battleService: BattleService,
    private shipService: ShipService,
    private planetBattleService: PlanetBattleService,
    private saveGameService: SaveGameService,
    private gameTimeService: GameTimeService,
    private movement: BattleMovementService,
    private combat: BattleCombatService,
    private turn: BattleTurnService,
    private ai: BattleAiService,
    readonly anim: BattleAnimationService,
    private cdr: ChangeDetectorRef,
  ) {
    this.battle = this.battleService.getBattle();
    this.ticksSub = this.anim.ticks$.subscribe(() => this.cdr.detectChanges());
    // Bind callbacks passed to child components to preserve `this` context
    this.onStackClick = this.onStackClick.bind(this);
    this.onCellClick = this.onCellClick.bind(this);
  }

  get battleState(): BattleModelState | null {
    return this.state;
  }

  get liveStacks(): BattleModelState['stacks'] {
    return this.state?.stacks.filter((s) => !s.destroyed) ?? [];
  }

  get battleOver(): boolean {
    return this.state?.winner != null;
  }

  get playerControlsActiveSide(): boolean {
    if (!this.state || this.state.winner) {
      return false;
    }
    return isSidePlayerControlled(this.state, this.state.activeSide);
  }

  get canAct(): boolean {
    return this.playerControlsActiveSide && !this.anim?.isBusy;
  }

  get canEndTurn(): boolean {
    return this.playerControlsActiveSide && !this.anim?.isBusy;
  }

  get shouldPulseEndTurn(): boolean {
    if (!this.state || !this.playerControlsActiveSide || this.anim?.isBusy) {
      return false;
    }
    // Pulse when AP is depleted
    if (this.state.ap <= 0) {
      return true;
    }
    // Pulse when no player-controlled stacks have valid actions remaining
    const playerStacks = this.state.stacks.filter(
      (s) => s.side === this.state!.activeSide && !s.destroyed && !s.immobile
    );
    if (playerStacks.length === 0) {
      return true;
    }
    const hasValidAction = playerStacks.some((stack) => {
      // Can move at least one cell
      const canMove =
        stack.cellsMovedThisTurn < stack.moveRange &&
        this.state!.ap >= stack.moveApPerCell;
      // Can attack
      const canAttack = !stack.attackedThisTurn && this.state!.ap >= stack.attackAp;
      return canMove || canAttack;
    });
    return !hasValidAction;
  }

  get phaseLabel(): string {
    if (!this.state) {
      return '';
    }
    if (this.state.winner) {
      return 'BATTLE OVER';
    }
    return this.state.activeSide === 'attacker' ? 'ATTACKER TURN' : 'DEFENDER TURN';
  }

  get moveCells(): GridCell[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !this.playerControlsActiveSide) {
      return [];
    }
    return getReachableCells(this.state, stack);
  }

  get attackTargetIds(): string[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !this.playerControlsActiveSide) {
      return [];
    }
    return computeAttackTargetIds(this.state, stack);
  }

  get moveToAttackTargetIds(): string[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !this.playerControlsActiveSide) {
      return [];
    }
    return getMoveToAttackTargetIds(this.state, stack);
  }

  get effect(): BattleModelState['effect'] {
    return this.state?.effect ?? null;
  }

  get bgDeepTransform(): string {
    const offsetX = (this.pointerX - 0.5) * 2;
    const offsetY = (this.pointerY - 0.5) * 2;
    return `translate(${offsetX * 5}vw, ${offsetY * 5}vh)`;
  }

  get bgForegroundTransform(): string {
    const offsetX = (this.pointerX - 0.5) * 2;
    const offsetY = (this.pointerY - 0.5) * 2;
    return `translate(${offsetX * 2.5}vw, ${offsetY * 2.5}vh)`;
  }

  public onPointerMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX / window.innerWidth;
    this.pointerY = event.clientY / window.innerHeight;
  };

  public onPointerLeave = (): void => {
    this.pointerX = 0.5;
    this.pointerY = 0.5;
  };

  public onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.motionEnabled) {
      return;
    }
    const gamma = event.gamma ?? 0;
    const beta = event.beta ?? 0;
    this.pointerX = Math.max(0, Math.min(1, (gamma + 90) / 180));
    this.pointerY = Math.max(0, Math.min(1, (beta + 45) / 90));
    this.cdr.detectChanges();
  };

  public async requestMotionPermission(): Promise<void> {
    if (this.motionPermissionRequested) {
      return;
    }
    this.motionPermissionRequested = true;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        if (response === 'granted') {
          this.enableMotion();
        }
      } catch {
        // Permission denied or unavailable — background remains centered.
      }
    } else if ('DeviceOrientationEvent' in window) {
      this.enableMotion();
    }
  }

  private enableMotion(): void {
    this.motionEnabled = true;
    window.addEventListener('deviceorientation', this.onDeviceOrientation);
  }

  ngOnInit(): void {
    if (this.battle) {
      this.state = createBattleState(this.battle, this.shipService, this.planetBattleService);
      this.turn.checkVictory(this.state);
      console.log('[BattleScreen] Initial state:', {
        attackerFactionId: this.state.attackerFactionId,
        defenderFactionId: this.state.defenderFactionId,
        activeSide: this.state.activeSide,
        playerControlsActiveSide: isSidePlayerControlled(this.state, this.state.activeSide),
        canAct: isSidePlayerControlled(this.state, this.state.activeSide) && !this.anim.isBusy,
        animBusy: this.anim.isBusy,
        stacks: this.state.stacks.map(s => ({ id: s.stackId, side: s.side, col: s.col, row: s.row, destroyed: s.destroyed }))
      });
      void this.runAiTurns();
    }
    this.gameTimeService.pause();
  }

  ngOnDestroy(): void {
    this.ticksSub.unsubscribe();
    this.anim.reset();
    this.gameTimeService.resume();
    window.removeEventListener('deviceorientation', this.onDeviceOrientation);
  }

  onStackClick(stackId: string): void {
    console.log('[BattleScreen] onStackClick:', stackId, 'canAct:', this.canAct, 'activeSide:', this.state?.activeSide, 'playerControlsActiveSide:', this.playerControlsActiveSide, 'animBusy:', this.anim?.isBusy);
    if (!this.state || !this.canAct) {
      return;
    }
    const stack = this.state.stacks.find((s) => s.stackId === stackId);
    if (!stack || stack.destroyed) {
      return;
    }
    if (stack.side === this.state.activeSide) {
      // Own stack: select it to reveal movement / attack options.
      this.selectedStackId = stack.stackId;
      console.log('[BattleScreen] Selected stack:', stackId, 'moveCells:', this.moveCells, 'attackTargetIds:', this.attackTargetIds, 'moveToAttackTargetIds:', this.moveToAttackTargetIds);
      return;
    }
    // Enemy stack: attack it if the selected stack can.
    const selected = this.selectedStack();
    if (!selected) {
      return;
    }
    // Direct attack
    if (computeAttackTargetIds(this.state, selected).includes(stack.stackId)) {
      void this.doAttack(selected, stack);
      return;
    }
    // Move-to-attack
    if (this.moveToAttackTargetIds.includes(stack.stackId)) {
      void this.doMoveToAttack(selected, stack);
    }
  }

  onCellClick(col: number, row: number): void {
    console.log('[BattleScreen] onCellClick:', col, row, 'canAct:', this.canAct);
    if (!this.state || !this.canAct) {
      return;
    }
    const selected = this.selectedStack();
    if (!selected) {
      return;
    }
    if (!getReachableCells(this.state, selected).some((c) => c.col === col && c.row === row)) {
      return;
    }
    void this.doMove(selected, col, row);
  }

  selectedStack(): BattleStack | null {
    if (!this.state || !this.selectedStackId) {
      return null;
    }
    return this.state.stacks.find((s) => s.stackId === this.selectedStackId && !s.destroyed) ?? null;
  }

  private async doMove(stack: BattleStack, col: number, row: number): Promise<void> {
    if (!this.state) {
      return;
    }
    await this.movement.moveStack(this.state, stack.stackId, col, row);
    if (!this.selectedStack()) {
      this.selectedStackId = null;
    }
    this.cdr.detectChanges();
  }

  private async doAttack(attacker: BattleStack, target: BattleStack): Promise<void> {
    if (!this.state) {
      return;
    }
    await this.combat.attackStack(this.state, attacker.stackId, target.stackId);
    if (!this.selectedStack()) {
      this.selectedStackId = null;
    }
    this.cdr.detectChanges();
  }

  private async doMoveToAttack(attacker: BattleStack, target: BattleStack): Promise<void> {
    if (!this.state) {
      return;
    }
    console.log('[BattleScreen] doMoveToAttack:', attacker.stackId, '->', target.stackId);
    await this.movement.moveToAttack(this.state, attacker.stackId, target.stackId);
    if (!this.selectedStack()) {
      this.selectedStackId = null;
    }
    this.cdr.detectChanges();
  }

  onEndTurn(): void {
    if (!this.state || !this.canEndTurn) {
      return;
    }
    this.turn.endTurn(this.state);
    this.selectedStackId = null;
    void this.runAiTurns();
    this.cdr.detectChanges();
  }

  /* Plays AI turns for however many consecutive AI-controlled sides
   * remain active (AI-vs-AI collisions included). */
  private async runAiTurns(): Promise<void> {
    if (!this.state) {
      return;
    }
    let safetyCounter = 0;
    while (!this.state.winner && !isSidePlayerControlled(this.state, this.state.activeSide)) {
      console.log('[BattleScreen] AI turn start:', { activeSide: this.state.activeSide, ap: this.state.ap, animBusy: this.anim.isBusy });
      try {
        await this.ai.playTurn(this.state);
      } catch (e) {
        console.error('[BattleScreen] AI turn error:', e);
        break;
      }
      console.log('[BattleScreen] AI turn end:', { winner: this.state.winner, activeSide: this.state.activeSide, animBusy: this.anim.isBusy });
      safetyCounter++;
      if (safetyCounter > 10) {
        console.error('[BattleScreen] AI turn safety limit reached, breaking');
        break;
      }
    }
    console.log('[BattleScreen] runAiTurns complete, playerControlsActiveSide:', this.playerControlsActiveSide);
    this.cdr.detectChanges();
  }

  getActiveSideName(): string {
    if (!this.state) {
      return '';
    }
    return this.state.activeSide === 'attacker' ? this.state.attackerName : this.state.defenderName;
  }

  isActiveSide(side: 'attacker' | 'defender'): boolean {
    return this.state?.activeSide === side && !this.state.winner;
  }

  getSideResult(side: 'attacker' | 'defender'): 'winner' | 'loser' | null {
    if (!this.state?.winner) {
      return null;
    }
    return this.state.winner === side ? 'winner' : 'loser';
  }

  backToStarMap(): void {
    const battle = this.battle;
    if (battle && this.state) {
      const outcome = buildBattleOutcome(this.state);
      this.battleService.setBattleResult(outcome);

      if (outcome.battleType === 'planet') {
        // The virtual defense fleet id is negative (-planet.id); only a
        // real wiped-out attacker is reported to the overworld.
        if (outcome.winnerSide === 'defender') {
          this.battleService.setDestroyedFleetId(outcome.attacker.fleetId);
        }
      } else {
        this.battleService.setDestroyedFleetId(outcome.loserFleetId);
      }

      if (battle.type === 'planet' && battle.planetId) {
        this.applyPlanetBattleResult(battle, outcome);
      } else {
        this.persistFleetBattleResult(outcome);
      }
    } else {
      this.battleService.clearBattle();
    }

    // Resume the galaxy-map simulation before navigating (safety net for
    // route reuse, same as the old placeholder).
    this.gameTimeService.resume();
    this.router.navigate(['/star-map']);
  }

  /*
   * Persists fleet-vs-fleet damage to the autosave slot. Both real
   * fleets get their per-ship roster (final HP + destroyed flags)
   * written back; a wiped-out fleet is additionally marked destroyed.
   * StarMap.reloadAfterBattle() reads the same slot on the next
   * /star-map navigation.
   */
  private persistFleetBattleResult(outcome: BattleOutcome): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.fleets) {
      return;
    }
    for (const fleetOutcome of [outcome.attacker, outcome.defender]) {
      const fleet = data.fleets.find((f) => f.id === fleetOutcome.fleetId);
      if (!fleet) {
        continue;
      }
      fleet.ships = shipsToSave(fleetOutcome.ships);
      if (fleetOutcome.wipedOut) {
        fleet.destroyed = true;
      }
    }
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }

  /*
   * Persists a planet battle outcome: on attacker victory the planet
   * changes owner; the attacker's ship roster is always written back so
   * a damaged winner returns damaged. The virtual defense fleet is
   * never written back.
   */
  private applyPlanetBattleResult(battle: Battle, outcome: BattleOutcome): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.starSystems) {
      return;
    }
    for (const system of data.starSystems) {
      const planet = system.planetsTiles?.find((p) => p.id === battle.planetId);
      if (!planet) {
        continue;
      }
      if (outcome.winnerSide === 'attacker') {
        planet.factionId = outcome.attacker.factionId;
      }
      const fleet = data.fleets?.find((f) => f.id === outcome.attacker.fleetId);
      if (fleet) {
        fleet.ships = shipsToSave(outcome.attacker.ships);
        if (outcome.attacker.wipedOut) {
          fleet.destroyed = true;
        }
      }
      break;
    }
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }
}

/* Converts outcome ship records back to the overworld FleetShip shape. */
function shipsToSave(
  ships: BattleOutcome['attacker']['ships'],
): { id: number; name: string; type: string; currentHp: number; destroyed: boolean }[] {
  return ships.map((s) => ({
    id: s.shipId,
    name: s.name,
    type: s.typeId,
    currentHp: s.hp,
    destroyed: s.destroyed,
  }));
}

import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import { BattleTimeService, BattleSpeed } from './battle/battle-time.service';
import {
  Battle,
  BattleFleetOutcome,
  BattleModelState,
  BattleOutcome,
  BattlePlanetVisual,
  BattleShieldPool,
  BattleSide,
  BattleStack,
  GridCell,
} from './battle/battle.types';
import {
  AI_ACTION_INTERVAL_MS,
  MOVE_TO_ATTACK_UPDATE_INTERVAL_MS,
  SHIELD_REGEN_INTERVAL_MS,
  ANIMATION_MS,
} from './battle/battle.types';
import { createBattleState, isSidePlayerControlled } from './battle/battle-state';
import {
  getAttackTargetIds as computeAttackTargetIds,
  getReachableCells,
  getMoveToAttackTargetIds,
  computeCarrierBoostTargets,
  checkVictory,
  updateStackPositions,
  regenerateAllShields,
  linePath,
  occupiedCols,
  isInBounds,
  isOccupied,
  occupiesCell,
  BATTLE_GRID_COLUMNS,
  BATTLE_GRID_ROWS,
  isPathClear,
  isAbsoluteInRange,
} from './battle/battle-grid';
import { buildBattleOutcome } from './battle/battle-result';
import { BattleMovementService } from './battle/battle-movement.service';
import { BattleCombatService } from './battle/battle-combat.service';
import { BattleGameLoopService } from './battle/battle-game-loop.service';
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
 * Real-time model: stacks move at speed-based rates via a RAF game loop.
 * Both sides are active simultaneously. The AI takes one action per 0.2s
 * tick (configurable via AI_ACTION_INTERVAL_MS). Animation lock gates
 * attacks only — movement is continuous.
 *
 * Navigation flow:
 * 1. StarMap detects collision -> BattleService.setBattle() -> navigate to /battle
 * 2. The minigame runs real-time combat
 * 3. "Back to Star Map" persists the BattleOutcome and navigates back
 * 4. StarMap applies the outcome via reloadAfterBattle()
 */

interface BattleResultSideSummary {
  side: BattleSide;
  name: string;
  color: string;
  result: 'winner' | 'loser';
  survivors: number;
  total: number;
  losses: number;
}

@Component({
  selector: 'app-battle-screen',
  standalone: true,
  imports: [CommonModule, BattleGridComponent],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss',
})
export class BattleScreenComponent implements OnInit, AfterViewChecked, OnDestroy {
  private battle: Battle | null = null;
  private state: BattleModelState | null = null;
  private ticksSub: Subscription;
  private battleTimeSub: Subscription;
  private commandQueue: Array<{ command: () => Promise<boolean>; stackId?: string }> = [];
  private commandRunning = false;

  private _selectedStackId: string | null = null;

  get selectedStackId(): string | null {
    return this._selectedStackId;
  }

  set selectedStackId(value: string | null) {
    if (value === this._selectedStackId) {
      return;
    }
    // Clear old stack's explicit attack target whenever selection changes
    if (this._selectedStackId && this.state) {
      const oldStack = this.state.stacks.find((s) => s.stackId === this._selectedStackId);
      if (oldStack) {
        oldStack.explicitAttackTargetId = null;
      }
    }
    this._selectedStackId = value;
  }

  private pointerX = 0.5;
  private pointerY = 0.5;
  private motionEnabled = false;
  private motionPermissionRequested = false;
  private resultModalFocused = false;
  private moveFailedUntil = 0;
  private movementHintTimer: number | null = null;

  private aiTickAccumulator = 0;
  private shieldRegenAccumulator = 0;
  private moveToAttackUpdateAccumulator = 0;

  @ViewChild('resultBackButton') resultBackButton: ElementRef<HTMLButtonElement> | null = null;

  constructor(
    private router: Router,
    private battleService: BattleService,
    private shipService: ShipService,
    private planetBattleService: PlanetBattleService,
    private saveGameService: SaveGameService,
    private gameTimeService: GameTimeService,
    readonly battleTime: BattleTimeService,
    private gameLoop: BattleGameLoopService,
    private movement: BattleMovementService,
    private combat: BattleCombatService,
    private ai: BattleAiService,
    readonly anim: BattleAnimationService,
    private cdr: ChangeDetectorRef,
  ) {
    this.battle = this.battleService.getBattle();
    this.ticksSub = this.anim.ticks$.subscribe(() => this.cdr.detectChanges());
    this.battleTimeSub = this.battleTime.state$.subscribe(() => this.cdr.detectChanges());
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

  get showBattleResult(): boolean {
    return this.battleOver && !this.anim.isBusy;
  }

  get resultWinnerName(): string {
    const outcome = this.battleOutcome;
    if (!outcome || !this.state) {
      return '';
    }
    return outcome.winnerSide === 'attacker' ? this.state.attackerName : this.state.defenderName;
  }

  get resultWinnerSideLabel(): string {
    return this.battleOutcome?.winnerSide === 'attacker' ? 'ATTACKER' : 'DEFENDER';
  }

  get resultBattleTypeLabel(): string {
    return this.battleOutcome?.battleType === 'planet' ? 'PLANET BATTLE' : 'FLEET BATTLE';
  }

  get resultSideSummaries(): BattleResultSideSummary[] {
    const outcome = this.battleOutcome;
    if (!outcome || !this.state) {
      return [];
    }
    return [
      this.createSideSummary('attacker', this.state.attackerName, this.state.attackerColor, outcome.attacker),
      this.createSideSummary('defender', this.state.defenderName, this.state.defenderColor, outcome.defender),
    ];
  }

  private createSideSummary(
    side: BattleSide,
    name: string,
    color: string,
    fleet: BattleFleetOutcome,
  ): BattleResultSideSummary {
    const total = fleet.ships.length;
    const survivors = fleet.survivors.length;
    return {
      side,
      name,
      color,
      result: this.getSideResult(side) ?? 'loser',
      survivors,
      total,
      losses: total - survivors,
    };
  }

  get playerHasStacks(): boolean {
    if (!this.state || this.state.winner) {
      return false;
    }
    return this.state.stacks.some((s) => !s.destroyed && isSidePlayerControlled(this.state!, s.side));
  }

  get canAct(): boolean {
    return this.playerHasStacks;
  }

  get canPlayerAct(): boolean {
    if (!this.state || !this.canAct) {
      return false;
    }
    const stack = this.selectedStack();
    return !!stack && !stack.destroyed;
  }

  get battleSpeed(): BattleSpeed {
    return this.battleTime.speed;
  }

  get battlePaused(): boolean {
    return this.battleTime.isPaused;
  }

  toggleBattlePause(): void {
    this.battleTime.togglePause();
    if (!this.battleTime.isPaused) {
      void this.drainCommandQueue();
    }
  }

  setBattleSpeed(speed: BattleSpeed): void {
    this.battleTime.setSpeed(speed);
    void this.drainCommandQueue();
  }

  private enqueueCommand(command: () => Promise<boolean>, stackId?: string): Promise<boolean> {
    if (this.battleTime.isPaused) {
      // When paused, always queue (replace if same stack)
      this.replaceOrEnqueueCommand(command, stackId);
      return Promise.resolve(false);
    }
    if (this.commandRunning) {
      // Replace if same stack, otherwise append
      this.replaceOrEnqueueCommand(command, stackId);
      return Promise.resolve(false);
    }
    return this.executeCommand(command, stackId);
  }

  /** Replace existing queued command for same stackId, or append if different stack. */
  private replaceOrEnqueueCommand(command: () => Promise<boolean>, stackId?: string): void {
    if (stackId) {
      const index = this.commandQueue.findIndex((item) => item.stackId === stackId);
      if (index >= 0) {
        this.commandQueue[index] = { command, stackId };
        return;
      }
    }
    this.commandQueue.push({ command, stackId });
  }

  private async executeCommand(command: () => Promise<boolean>, stackId?: string): Promise<boolean> {
    if (this.commandRunning) {
      this.replaceOrEnqueueCommand(command, stackId);
      return false;
    }

    this.commandRunning = true;
    try {
if (stackId && this.anim.isStackBusy(stackId)) {
          await this.waitForStackAnimationWithTimeout(stackId, 1500);
        } else if (!stackId && this.anim.isBusy) {
        await this.anim.waitForAnimation();
      }
      return await command();
    } catch {
      return false;
    } finally {
      this.commandRunning = false;
      void this.drainCommandQueue();
    }
  }

  /** Wait for stack animation with timeout to prevent indefinite blocking. */
  private async waitForStackAnimationWithTimeout(stackId: string, timeoutMs: number): Promise<void> {
    const waitPromise = this.anim.waitForStackAnimation(stackId);
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([waitPromise, timeoutPromise]);
    // If timeout, animation is still running but we proceed anyway
  }

  private async drainCommandQueue(): Promise<void> {
    if (this.commandRunning || this.battleTime.isPaused) {
      return;
    }

    while (this.commandQueue.length > 0 && !this.battleTime.isPaused) {
      const { command, stackId } = this.commandQueue.shift()!;
      this.commandRunning = true;
      try {
        if (stackId && this.anim.isStackBusy(stackId)) {
          await this.waitForStackAnimationWithTimeout(stackId, 1500);
        } else if (!stackId && this.anim.isBusy) {
          await this.anim.waitForAnimation();
        }
        await command();
      } catch {
        // Invalid or interrupted commands are discarded without blocking the queue.
      } finally {
        this.commandRunning = false;
      }
    }
  }

  private clearCommandQueue(): void {
    this.commandQueue = [];
    this.commandRunning = false;
  }

  get moveCells(): GridCell[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !stack.destroyed) {
      return [];
    }
    // Return all empty cells in bounds (exclude cells occupied by this stack).
    // Also requires a clear straight-line path (isPathClear) — matches
    // moveStack() validation exactly so UI shows only reachable cells.
    const cells: GridCell[] = [];
    for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
      for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
        if (occupiesCell(stack, c, r)) continue;
        const destCols = occupiedCols(stack, c);
        if (destCols.some((dc) => !isInBounds(dc, r) || isOccupied(this.state!, dc, r, stack.stackId))) {
          continue;
        }
        const path = linePath({ col: stack.col, row: stack.row }, { col: c, row: r });
        if (!path || !isPathClear(this.state, path, stack)) {
          continue;
        }
        cells.push({ col: c, row: r });
      }
    }
    return cells;
  }

  get isMoveBlocked(): boolean {
    return performance.now() < this.moveFailedUntil;
  }

  get attackTargetIds(): string[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !this.canPlayerAct) {
      return [];
    }
    return computeAttackTargetIds(this.state, stack);
  }

  get moveToAttackTargetIds(): string[] {
    const stack = this.selectedStack();
    if (!this.state || !stack || !this.canPlayerAct) {
      return [];
    }
    return getMoveToAttackTargetIds(this.state, stack);
  }

  get effect(): BattleModelState['effect'] {
    return this.state?.effect ?? null;
  }

  /*
   * Planet-battle presentation data. planetVisual is null in fleet battles,
   * which keeps the planet component and its shared-shield bar out of that
   * mode entirely.
   */
  get planetVisual(): BattlePlanetVisual | null {
    if (!this.state?.planetName) {
      return null;
    }
    return {
      name: this.state.planetName,
      color: this.state.planetColor ?? '#ffffff',
    };
  }

  get planetShield(): BattleShieldPool | null {
    return this.state?.defenderShieldPool ?? null;
  }

  get planetShieldFraction(): number {
    const pool = this.planetShield;
    if (!pool || pool.max <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, pool.current / pool.max));
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
      checkVictory(this.state);
    }
    this.gameTimeService.pause();
    this.battleTime.reset();
    this.startGameLoop();
  }

  ngAfterViewChecked(): void {
    if (this.showBattleResult && !this.resultModalFocused) {
      this.resultBackButton?.nativeElement.focus();
      this.resultModalFocused = true;
    } else if (!this.showBattleResult) {
      this.resultModalFocused = false;
    }
  }

  ngOnDestroy(): void {
    this.ticksSub.unsubscribe();
    this.battleTimeSub.unsubscribe();
    this.clearCommandQueue();
    this.movement.cancelPendingMovementWaits();
    this.gameLoop.stopGameLoop();
    this.anim.reset();
    this.battleTime.reset();
    this.gameTimeService.resume();
    window.removeEventListener('deviceorientation', this.onDeviceOrientation);
    if (this.movementHintTimer !== null) {
      clearTimeout(this.movementHintTimer);
      this.movementHintTimer = null;
    }
  }

  onStackClick(stackId: string): void {
    if (!this.state || !this.canAct) {
      return;
    }
    const stack = this.state.stacks.find((s) => s.stackId === stackId);
    if (!stack || stack.destroyed) {
      return;
    }
    // Player can only control stacks on their own side (determined per-stack).
    if (isSidePlayerControlled(this.state, stack.side)) {
      // Own stack: select it to reveal movement / attack options.
      // Selection works even while moving — commands can be redirected at any time.
      // Clear any pending commands for the old stack when switching
      if (this._selectedStackId !== stack.stackId) {
        this.clearCommandQueue();
      }
      this.selectedStackId = stack.stackId;
      return;
    }
    // Enemy stack: attack it immediately when it is in absolute range.
    const selected = this.selectedStack();
    if (!selected) {
      return;
    }
    if (computeAttackTargetIds(this.state, selected).includes(stack.stackId)) {
      void this.doAttack(selected, stack);
      return;
    }
    // Otherwise move towards the enemy and attack when in range.
    void this.moveTowardsAndAttack(selected, stack);
  }

  onCellClick(col: number, row: number): void {
    if (!this.state || !this.canPlayerAct) {
      return;
    }
    const selected = this.selectedStack();
    if (!selected) {
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

  /* Aggregate stats for the selected stack's info panel. Pure reads of
   * BattleStack/BattleShip state; no combat logic is duplicated here —
   * the sums mirror the values used by BattleCombatService (totalAttack)
   * and BattleGridComponent.hullFraction (HP fraction). */
  get selectedShipCount(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.filter((s) => s.alive).length : 0;
  }

  get selectedTotalHp(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.hp : sum), 0) : 0;
  }

  get selectedMaxHp(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => sum + s.maxHp, 0) : 0;
  }

  get selectedTotalAttack(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.attack : sum), 0) : 0;
  }

  get selectedTotalDefense(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.defense : sum), 0) : 0;
  }

  /* Aggregate shield for the selected stack's info panel. Pure reads of
   * BattleShip.shield/maxShield — no combat logic duplicated here. */
  get selectedTotalShield(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + (s.shield ?? 0) : sum), 0) : 0;
  }

  get selectedMaxShield(): number {
    const stack = this.selectedStack();
    return stack ? stack.ships.reduce((sum, s) => sum + (s.maxShield ?? 0), 0) : 0;
  }

  get selectedShieldFraction(): number {
    const max = this.selectedMaxShield;
    return max > 0 ? Math.max(0, this.selectedTotalShield / max) : 0;
  }

  get selectedHullFraction(): number {
    const max = this.selectedMaxHp;
    return max > 0 ? Math.max(0, this.selectedTotalHp / max) : 0;
  }

  /* Carrier Shield Pulse: the selected stack is a Carrier that can act,
   * is not moving, and has not yet been blocked by the busy lock.
   * Pure read of existing state — no combat logic duplicated here. */
  get canCarrierBoost(): boolean {
    if (!this.state || !this.canAct) {
      return false;
    }
    const stack = this.selectedStack();
    if (!stack || stack.typeId !== 'carrier' || stack.destroyed) {
      return false;
    }
    if (stack.moving || stack.immobile) {
      return false;
    }
    return computeCarrierBoostTargets(this.state, stack).length > 0;
  }

  /* Friendly stacks that would be restored by a Shield Pulse. Pure read
   * of existing state — used only to highlight them in the grid. */
  get carrierBoostTargetIds(): string[] {
    const stack = this.selectedStack();
    return stack && this.state ? computeCarrierBoostTargets(this.state, stack) : [];
  }

  /* Move line from selected stack to its move target.
   * Returns null when no stack is selected or not moving. */
  get moveConnectionLine(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    if (!this.state || !this.selectedStackId) {
      return null;
    }
    const stack = this.selectedStack();
    if (!stack || !stack.moving || stack.targetX == null || stack.targetY == null) {
      return null;
    }
    return {
      from: { x: stack.x ?? 0, y: stack.y ?? 0 },
      to: { x: stack.targetX, y: stack.targetY },
    };
  }

  /* Attack line from selected stack to its attack target.
   * Returns null when no stack is selected or no attack target. */
  get attackConnectionLine(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    if (!this.state || !this.selectedStackId) {
      return null;
    }
    const stack = this.selectedStack();
    if (!stack) {
      return null;
    }
    const targetId = stack.explicitAttackTargetId || stack.moveToAttackTargetId;
    if (!targetId) {
      return null;
    }
    const target = this.state.stacks.find(
      (s) => !s.destroyed && s.stackId === targetId,
    );
    if (!target) {
      return null;
    }
    return {
      from: { x: stack.x ?? 0, y: stack.y ?? 0 },
      to: { x: target.x ?? 0, y: target.y ?? 0 },
    };
  }

  async doCarrierBoost(): Promise<boolean> {
    const stack = this.selectedStack();
    if (!stack) {
      return Promise.resolve(false);
    }
    return this.enqueueCommand(async () => {
      if (!this.state) {
        return false;
      }
      const success = this.combat.carrierShieldBoost(this.state, stack.stackId);
      if (success) {
        this.cdr.detectChanges();
      }
      return success;
    }, stack.stackId);
  }

  private async doMoveToAttack(attacker: BattleStack, target: BattleStack): Promise<boolean> {
    return this.enqueueCommand(async () => {
      const currentAttacker = this.state?.stacks.find(
        (stack) => stack.stackId === attacker.stackId && !stack.destroyed,
      );
      const currentTarget = this.state?.stacks.find(
        (stack) => stack.stackId === target.stackId && !stack.destroyed,
      );
      if (!this.state || !currentAttacker || !currentTarget) {
        return false;
      }
      currentAttacker.explicitAttackTargetId = null;
      const success = await this.movement.moveToAttack(
        this.state,
        currentAttacker.stackId,
        currentTarget.stackId,
      );
      if (!success) {
        return false;
      }
      if (currentAttacker.moving) {
        await this.movement.waitForMovement(currentAttacker);
      }
      return true;
    }, attacker.stackId);
  }

  private async moveTowardsAndAttack(attacker: BattleStack, target: BattleStack): Promise<boolean> {
    return this.enqueueCommand(async () => {
      const currentAttacker = this.state?.stacks.find(
        (stack) => stack.stackId === attacker.stackId && !stack.destroyed,
      );
      const currentTarget = this.state?.stacks.find(
        (stack) => stack.stackId === target.stackId && !stack.destroyed,
      );
      if (!this.state || !currentAttacker || !currentTarget) {
        return false;
      }

      currentAttacker.explicitAttackTargetId = currentTarget.stackId;
      currentAttacker.attackCooldownUntil = 0;
      const success = await this.movement.moveToAttack(
        this.state,
        currentAttacker.stackId,
        currentTarget.stackId,
      );
      if (!success) {
        return false;
      }
      if (currentAttacker.moving) {
        await this.movement.waitForMovement(currentAttacker);
      }

      const latestTarget = this.state.stacks.find(
        (stack) => stack.stackId === currentTarget.stackId && !stack.destroyed,
      );
      if (
        latestTarget &&
        !latestTarget.destroyed &&
        latestTarget.side !== currentAttacker.side &&
        isAbsoluteInRange(currentAttacker, latestTarget, currentAttacker.attackRange)
      ) {
        return this.tryAutoAttack(currentAttacker);
      }
      return true;
    }, attacker.stackId);
  }

  private async doMove(
    stack: BattleStack,
    col: number,
    row: number,
    waitForCompletion = false,
  ): Promise<boolean> {
    waitForCompletion = waitForCompletion || this.battleTime.isPaused || this.commandRunning;
return this.enqueueCommand(async () => {
      const currentStack = this.state?.stacks.find(
        (candidate) => candidate.stackId === stack.stackId && !candidate.destroyed,
      );
      if (!this.state || !currentStack) {
        return false;
      }

      currentStack.explicitAttackTargetId = null;
      const success = await this.movement.moveStack(this.state, currentStack.stackId, col, row);
      if (!success) {
        if (!waitForCompletion) {
          this.moveFailedUntil = performance.now() + 1500;
          this.cdr.detectChanges();
          if (this.movementHintTimer !== null) {
            clearTimeout(this.movementHintTimer);
          }
          this.movementHintTimer = window.setTimeout(() => {
            this.moveFailedUntil = 0;
            this.movementHintTimer = null;
            this.cdr.detectChanges();
          }, 1500);
        }
        return false;
      }

      if (waitForCompletion && currentStack.moving) {
        await this.movement.waitForMovement(currentStack);
      }
      this.moveFailedUntil = 0;
      if (this.movementHintTimer !== null) {
        clearTimeout(this.movementHintTimer);
      }
      this.cdr.detectChanges();
      return true;
    }, stack.stackId);
  }

  /* Single auto-attack attempt for a player-controlled stack.
   * Returns true if an attack was initiated, false otherwise.
   * Called from game loop for all player stacks. */
  private async tryAutoAttack(attacker: BattleStack): Promise<boolean> {
    if (!this.state || this.state.winner || this.battleTime.isPaused) {
      return false;
    }
    // Only player-controlled stacks auto-attack
    if (!isSidePlayerControlled(this.state, attacker.side)) {
      return false;
    }
    if (attacker.destroyed) {
      return false;
    }
    // Per-stack fire-rate cooldown using battle-local time
    const now = this.battleTime.battleElapsedMs;
    if (attacker.attackCooldownUntil && attacker.attackCooldownUntil > now) {
      return false;
    }
    // Per-stack animation lock: don't start new attack if this stack is already animating
    if (this.anim.isStackBusy(attacker.stackId)) {
      return false;
    }

    // Check explicit attack target
    let targetStack: BattleStack | undefined;
    const explicitTargetId = attacker.explicitAttackTargetId;

    if (explicitTargetId) {
      targetStack = this.state.stacks.find((s) => s.stackId === explicitTargetId);
      const inRange = targetStack
        && !targetStack.destroyed
        && targetStack.side !== attacker.side
        && computeAttackTargetIds(this.state, attacker).includes(targetStack.stackId);

      if (!inRange) {
        attacker.explicitAttackTargetId = null;
        targetStack = undefined;
      }
    }

    // Normal auto-attack target selection
    if (!targetStack) {
      const targets = computeAttackTargetIds(this.state, attacker);
      if (targets.length === 0) {
        return false;
      }
      targetStack = this.state.stacks.find((s) => s.stackId === targets[0]);
      if (!targetStack) {
        return false;
      }
    }

    // Initiate attack
    const success = await this.combat.attackStack(this.state, attacker.stackId, targetStack.stackId);
    if (!success) {
      return false;
    }
    this.cdr.detectChanges();

    // Set per-stack cooldown for next attack using battle-local time
    const fireRate = attacker.fireRate ?? 1.5;
    const fireRateMs = (1 / fireRate) * 1000;
    const hullBonus = Math.floor(attacker.ships.reduce((sum, s) => sum + s.hp, 0) * 0.3);
    attacker.attackCooldownUntil = now + fireRateMs + hullBonus;

    // If explicit target was destroyed, clear it
    if (explicitTargetId && targetStack.destroyed) {
      attacker.explicitAttackTargetId = null;
    }

    return true;
  }

  private async doAttack(attacker: BattleStack, target: BattleStack): Promise<boolean> {
    return this.enqueueCommand(async () => {
      if (!this.state) {
        return false;
      }
      const currentAttacker = this.state.stacks.find((s) => s.stackId === attacker.stackId && !s.destroyed);
      const currentTarget = this.state.stacks.find((s) => s.stackId === target.stackId && !s.destroyed);
      if (!currentAttacker || !currentTarget) {
        return false;
      }
      // Set explicit attack target - overrides auto-attack until target destroyed or new command
      currentAttacker.explicitAttackTargetId = currentTarget.stackId;
      // Clear cooldown so explicit attack fires immediately
      currentAttacker.attackCooldownUntil = 0;
      // Fire explicit attack immediately (bypasses game loop cooldown)
      const success = await this.combat.attackStack(this.state, currentAttacker.stackId, currentTarget.stackId);
      this.cdr.detectChanges();

      // If explicit target was destroyed, clear it
      if (currentTarget.destroyed) {
        currentAttacker.explicitAttackTargetId = null;
      }
      return success;
    }, attacker.stackId);
  }

  private startGameLoop(): void {
    if (!this.state) {
      return;
    }
    this.gameLoop.startGameLoop((deltaTime: number) => {
      this.gameLoopCallback(deltaTime);
    });
  }

  private gameLoopCallback(deltaTime: number): void {
    if (!this.state) {
      return;
    }

    // Skip all updates when paused (deltaTime === 0 when paused)
    const isPaused = this.battleTime.isPaused || deltaTime <= 0;

    // 1. Update stack positions (real-time movement).
    if (!this.state.winner && !isPaused) {
      updateStackPositions(this.state, deltaTime, (stackId) => this.movement.completeMovement(stackId));
    } else if (!this.state.winner && isPaused) {
      // When paused, don't keep stacks in moving state - they'll resume on unpause
      for (const stack of this.state.stacks) {
        if (stack.moving && stack.targetX != null && stack.targetY != null) {
          // Keep target but don't animate
        }
      }
    }

    // 2. AI tick: one action every AI_ACTION_INTERVAL_MS.
    // AI service internally checks per-stack animation locks.
    if (!this.state.winner && !isPaused) {
      this.aiTickAccumulator += deltaTime * 1000;
      if (this.aiTickAccumulator >= AI_ACTION_INTERVAL_MS) {
        this.aiTickAccumulator = 0;
        void this.ai.playAction(this.state);
      }
    }

    // 2b. Player auto-attack: attempt attack for all player-controlled stacks.
    // Runs every frame; per-stack cooldown prevents over-attacking.
    if (!this.state.winner && !isPaused) {
      const state = this.state!; // non-null after winner check
      const playerStacks = state.stacks.filter(
        (s) => !s.destroyed && isSidePlayerControlled(state, s.side)
      );
      for (const stack of playerStacks) {
        void this.tryAutoAttack(stack);
      }
    }

    // 3. Shield regeneration: every SHIELD_REGEN_INTERVAL_MS for all sides.
    if (!this.state.winner && !isPaused) {
      this.shieldRegenAccumulator += deltaTime * 1000;
      if (this.shieldRegenAccumulator >= SHIELD_REGEN_INTERVAL_MS) {
        this.shieldRegenAccumulator = 0;
        regenerateAllShields(this.state);
        this.state.round++;
      }
    }

    // 3b. Move-to-attack re-computation: every MOVE_TO_ATTACK_UPDATE_INTERVAL_MS.
    // Re-evaluates destination cells for stacks chasing moving targets.
    if (!this.state.winner && !isPaused) {
      this.moveToAttackUpdateAccumulator += deltaTime * 1000;
      if (this.moveToAttackUpdateAccumulator >= MOVE_TO_ATTACK_UPDATE_INTERVAL_MS) {
        this.moveToAttackUpdateAccumulator = 0;
        this.movement.updateMoveToAttackTargets(this.state);
      }
    }

    // 4. Victory check after movement and AI action.
    checkVictory(this.state);

    // 5. Trigger change detection for real-time position updates and result display.
    this.anim.tick();
  }

  getSideResult(side: 'attacker' | 'defender'): 'winner' | 'loser' | null {
    if (!this.state?.winner) {
      return null;
    }
    return this.state.winner === side ? 'winner' : 'loser';
  }

  /* BattleOutcome built from the current simulation state. Pure: reads only
   * BattleModelState, never mutates anything. Used by the end-of-battle
   * result view so the UI presents the same outcome the overworld persists. */
  get battleOutcome(): BattleOutcome | null {
    if (!this.state || !this.state.winner) {
      return null;
    }
    return buildBattleOutcome(this.state);
  }

  /* Planet-battle result label derived purely from BattleOutcome fields.
   * 'CAPTURED' = attacker (player or AI) took the planet.
   * 'DEFENDED' = the planet's defenders held it.
   * Empty string for fleet battles (no planet line to show). */
  getPlanetResultLabel(): string {
    const outcome = this.battleOutcome;
    if (!outcome || outcome.battleType !== 'planet') {
      return '';
    }
    return outcome.winnerSide === 'attacker' ? 'CAPTURED' : 'DEFENDED';
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
    const defenderFleet = battle.attackerId === battle.fleet1.id ? battle.fleet2 : battle.fleet1;
    const garrisonFleetId = defenderFleet.garrisonFleetId;
    const garrisonShipMap = defenderFleet.garrisonShipMap;

    for (const system of data.starSystems) {
      const planet = system.planetsTiles?.find((p) => p.id === battle.planetId);
      if (!planet) {
        continue;
      }
      if (outcome.winnerSide === 'attacker') {
        planet.factionId = outcome.attacker.factionId;
      }
      if (outcome.defender.shieldPoolCurrent !== undefined) {
        planet.shieldPoolCurrent = outcome.defender.shieldPoolCurrent;
      }
      const fleet = data.fleets?.find((f) => f.id === outcome.attacker.fleetId);
      if (fleet) {
        fleet.ships = shipsToSave(outcome.attacker.ships);
        if (outcome.attacker.wipedOut) {
          fleet.destroyed = true;
        }
      }

      // Persist the real garrison fleet's damage and losses. Virtual turret
      // ids below 1000000 are never in garrisonShipMap and are skipped.
      if (garrisonFleetId != null) {
        const garrisonFleet = data.fleets?.find((f) => f.id === garrisonFleetId);
        if (garrisonFleet) {
          if (outcome.winnerSide === 'attacker') {
            // The captured garrison is destroyed along with the planet loss.
            garrisonFleet.destroyed = true;
            for (const ship of garrisonFleet.ships) {
              ship.destroyed = true;
            }
          } else if (garrisonShipMap) {
            for (const shipOutcome of outcome.defender.ships) {
              const originalShipId = garrisonShipMap[shipOutcome.shipId];
              if (originalShipId === undefined) {
                continue;
              }
              const ship = garrisonFleet.ships.find((s) => s.id === originalShipId);
              if (ship) {
                ship.currentHp = Math.max(0, shipOutcome.hp);
                ship.destroyed = shipOutcome.destroyed;
              }
            }
            if (garrisonFleet.ships.length > 0 && garrisonFleet.ships.every((s) => s.destroyed === true)) {
              garrisonFleet.destroyed = true;
            }
          }
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

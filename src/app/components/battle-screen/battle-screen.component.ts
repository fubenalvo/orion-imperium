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
import { Subscription, skip } from 'rxjs';
import { CommonModule } from '@angular/common';
import { BattleService } from '../../services/battle.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import { BattleSettingsService } from '../../services/battle-settings.service';
import { BattleTimeService, BattleSpeed } from './battle/battle-time.service';
import {
  Battle,
  BattleAttackEffect,
  BattleProjectile,
  BattleFleetOutcome,
  BattleModelState,
  BattleOutcome,
  BattlePlanetVisual,
  BattleShieldPool,
  BattleSide,
  BattleStack,
} from './battle/battle.types';
import {
  AI_ACTION_INTERVAL_MS,
  SHIELD_REGEN_INTERVAL_MS,
  MOVE_REPLAN_INTERVAL_MS,
  BATTLE_RANGE_UNIT_VW,
  BattleTargetingMode,
  DEFAULT_TARGETING_MODE,
} from './battle/battle.types';
import { createBattleState, isSidePlayerControlled } from './battle/battle-state';
import {
  getAttackTargetIds as computeAttackTargetIds,
  computeCarrierBoostTargets,
  checkVictory,
  updateStackPositions,
  regenerateAllShields,
  canAttack,
  effectiveAttackRange,
} from './battle/battle-grid';
import {
  TARGETING_MODES,
  TARGETING_MODE_LABELS,
  setTargetingMode,
} from './battle/battle-targeting';
import { buildBattleOutcome } from './battle/battle-result';
import { updateStackHeadings } from './battle/battle-heading';
import { BattleMovementService } from './battle/battle-movement.service';
import { BattleCombatService } from './battle/battle-combat.service';
import { BattleGameLoopService } from './battle/battle-game-loop.service';
import { BattleAnimationService } from './battle/battle-animation.service';
import { BattleAiService } from './battle/battle-ai.service';
import { BattleGridComponent } from './battle-grid/battle-grid.component';
import { BattleParallax } from './battle/battle-parallax';
import { GameHeaderComponent, GameHeaderSpeedOption } from '../game-header/game-header.component';

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
 * Both sides are active simultaneously. Every frame the shared fire control
 * lets each stack (both sides) fire at its own cadence; the tactical AI
 * re-plans movement every AI_ACTION_INTERVAL_MS.
 *
 * Player orders are plain state changes on the stack (no command queue),
 * so they apply instantly — also while paused — and several stacks can be
 * given orders during a pause:
 *   - click enemy  → manual attack order (explicitAttackTargetId), chased
 *                    while out of reach, cleared only when the target dies
 *                    or the stack gets a new order;
 *   - click cell   → manual move order (replaces any attack order).
 * Selecting other stacks never changes existing orders. AUTO only drives
 * stacks without a manual order.
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
  imports: [CommonModule, BattleGridComponent, GameHeaderComponent],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss',
})
export class BattleScreenComponent implements OnInit, AfterViewChecked, OnDestroy {
  private battle: Battle | null = null;
  private state: BattleModelState | null = null;
  private ticksSub: Subscription;
  private battleTimeSub: Subscription;

  /* Purely a UI focus. Changing it must never touch any stack's orders. */
  selectedStackId: string | null = null;

  /* Sides the player controls; fixed for the whole battle, so computed once
   * in ngOnInit instead of a getter (keeps the grid input stable per frame). */
  playerSides: BattleSide[] = [];

  readonly targetingModes = TARGETING_MODES;
  readonly targetingModeLabels = TARGETING_MODE_LABELS;

  readonly parallax = new BattleParallax();
  private motionEnabled = false;
  private motionPermissionRequested = false;
  private resultModalFocused = false;
  private moveFailedUntil = 0;
  private movementHintTimer: number | null = null;

  private aiTickAccumulator = 0;
  private shieldRegenAccumulator = 0;
  private autoBattleTickAccumulator = 0;
  private replanAccumulator = 0;

  @ViewChild('resultBackButton') resultBackButton: ElementRef<HTMLButtonElement> | null = null;

  constructor(
    private router: Router,
    private battleService: BattleService,
    private battleOutcomeService: BattleOutcomeService,
    private shipService: ShipService,
    private planetBattleService: PlanetBattleService,
    private saveGameService: SaveGameService,
    private gameTimeService: GameTimeService,
    private battleSettings: BattleSettingsService,
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
    // state$ is a BehaviorSubject: skip its synchronous replay, which would
    // run detectChanges() before the view exists (Angular asserts, and rxjs
    // rethrows the error asynchronously as an uncaught console error).
    this.battleTimeSub = this.battleTime.state$.pipe(skip(1)).subscribe(() => this.cdr.detectChanges());
    this.onStackClick = this.onStackClick.bind(this);
    this.onCellClick = this.onCellClick.bind(this);
  }

  get autoBattleEnabled(): boolean {
    return this.battleSettings.autoBattleEnabled();
  }

  toggleAutoBattle(): void {
    this.battleSettings.toggleAutoBattle();
    this.cdr.detectChanges();
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

  /* The overlay waits until the last bolts and impact effects are gone so
   * the final hit is visible. Bolts deal no damage once a winner is set, so
   * the outcome shown cannot change while waiting. */
  get showBattleResult(): boolean {
    return (
      this.battleOver &&
      !this.anim.isBusy &&
      (this.state?.projectiles.length ?? 0) === 0 &&
      (this.state?.effects.length ?? 0) === 0
    );
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
    const outcome = this.battleOutcome;
    if (outcome?.battleType !== 'planet') return 'FLEET BATTLE';
    return outcome.spaceBaseId != null ? 'STATION BATTLE' : 'PLANET BATTLE';
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
  }

  setBattleSpeed(speed: BattleSpeed): void {
    this.battleTime.setSpeed(speed);
  }

  /** Battle's internal speeds are shown as 1x / 2x in the shared header. */
  readonly battleSpeedOptions: readonly GameHeaderSpeedOption[] = [
    { value: 0.625, label: '1x' },
    { value: 1.25, label: '2x' },
  ];

  onHeaderSpeed(speed: number): void {
    this.setBattleSpeed(speed as BattleSpeed);
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

  /* The selected stack's manual attack target, highlighted on the grid so
   * the player can see which order is active. */
  get orderTargetId(): string | null {
    const stack = this.selectedStack();
    return stack?.explicitAttackTargetId ?? null;
  }

  /* Effective reach of the selected stack (range + tolerance) in vw, for
   * the range ring. Uses the same value as the canAttack gate. */
  get selectedRangeRing(): { x: number; y: number; radiusVw: number } | null {
    const stack = this.selectedStack();
    if (!stack) {
      return null;
    }
    return { x: stack.x, y: stack.y, radiusVw: effectiveAttackRange(stack) * BATTLE_RANGE_UNIT_VW };
  }

  get selectedTargetingMode(): BattleTargetingMode {
    return this.selectedStack()?.targetingMode ?? DEFAULT_TARGETING_MODE;
  }

  setSelectedTargetingMode(mode: BattleTargetingMode): void {
    const stack = this.selectedStack();
    if (!stack || !this.state || !isSidePlayerControlled(this.state, stack.side)) {
      return;
    }
    setTargetingMode(stack, mode);
    this.cdr.detectChanges();
  }

  /* Short status of the selected stack's current order for the panel. */
  get selectedOrderLabel(): string {
    const stack = this.selectedStack();
    if (!stack || !this.state) {
      return '';
    }
    const target = stack.explicitAttackTargetId
      ? this.state.stacks.find((s) => s.stackId === stack.explicitAttackTargetId && !s.destroyed)
      : null;
    if (target) {
      return canAttack(stack, target) ? `ATTACKING ${target.typeName}` : `CHASING ${target.typeName}`;
    }
    if (stack.manualMoveOrder && stack.moving) {
      return 'MOVING';
    }
    return 'AUTO TARGET';
  }

  get isSelectedPlayerStack(): boolean {
    const stack = this.selectedStack();
    return !!stack && !!this.state && isSidePlayerControlled(this.state, stack.side);
  }

  get effects(): BattleAttackEffect[] {
    return this.state?.effects ?? [];
  }

  get projectiles(): BattleProjectile[] {
    return this.state?.projectiles ?? [];
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
      kind: this.state.spaceBaseId != null ? 'station' : 'planet',
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

  /* Parallax layer transforms. Deeper layers move more; every layer is
   * oversized in the SCSS by at least its maximum travel so no edge shows. */
  get bgDeepTransform(): string {
    return this.parallaxTransform(5);
  }

  get bgNebulaTransform(): string {
    return this.parallaxTransform(3.75);
  }

  get bgForegroundTransform(): string {
    return this.parallaxTransform(2.5);
  }

  private parallaxTransform(amplitude: number): string {
    return `translate3d(${this.parallax.x * amplitude}vw, ${this.parallax.y * amplitude}vh, 0)`;
  }

  /* Only sets the parallax target; the game loop eases toward it. There is
   * intentionally no mouseleave handler (see BattleParallax). */
  public onPointerMove = (event: MouseEvent): void => {
    const el = event.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    this.parallax.setPointer(event.clientX, event.clientY, rect);
  };

  public onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.motionEnabled) {
      return;
    }
    this.parallax.setTilt(event.gamma, event.beta);
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
      const state = this.state;
      this.playerSides = (['attacker', 'defender'] as const).filter((side) =>
        isSidePlayerControlled(state, side),
      );
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
    this.movement.cancelPendingMovementWaits();
    this.gameLoop.stopGameLoop();
    this.combat.clearProjectiles(this.state);
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
      // Own stack: select it. Selection is UI-only; orders of the previously
      // selected stack stay in force.
      this.selectedStackId = stack.stackId;
      return;
    }
    const selected = this.selectedStack();
    if (!selected) {
      return;
    }
    this.orderAttack(selected, stack);
  }

  onCellClick(col: number, row: number): void {
    if (!this.state || !this.canPlayerAct) {
      return;
    }
    const selected = this.selectedStack();
    if (!selected) {
      return;
    }
    void this.orderMove(selected, col, row);
  }

  /*
   * Manual attack order. Replaces any previous order of this stack. Fire
   * control shoots the target whenever it is in reach (respecting the fire
   * cooldown — re-clicking does not fire faster); while it is out of reach
   * the stack chases it and maintainAttackOrders() keeps re-issuing the
   * chase until the target dies or a new order is given.
   */
  orderAttack(attacker: BattleStack, target: BattleStack): void {
    if (!this.state || attacker.destroyed || target.destroyed || attacker.side === target.side) {
      return;
    }
    attacker.explicitAttackTargetId = target.stackId;
    attacker.manualMoveOrder = false;
    attacker.moveToAttackTargetId = null;
    if (canAttack(attacker, target)) {
      // Cancel a previous move so the stack does not drift out of reach.
      if (attacker.moving) {
        this.movement.stopStack(this.state, attacker.stackId);
      }
    } else {
      void this.movement.moveToAttack(this.state, attacker.stackId, target.stackId);
    }
    this.cdr.detectChanges();
  }

  /* Manual move order. Replaces any attack order only when the move is
   * legal; a blocked path leaves the previous order untouched. */
  async orderMove(stack: BattleStack, col: number, row: number): Promise<boolean> {
    if (!this.state || stack.destroyed) {
      return false;
    }
    const success = await this.movement.moveStack(this.state, stack.stackId, col, row);
    if (!success) {
      this.showMoveBlockedHint();
      return false;
    }
    stack.explicitAttackTargetId = null;
    stack.moveToAttackTargetId = null;
    stack.manualMoveOrder = true;
    this.moveFailedUntil = 0;
    this.cdr.detectChanges();
    return true;
  }

  private showMoveBlockedHint(): void {
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

  /* Carrier Shield Pulse availability for the selected player Carrier.
   * Delegates to BattleCombatService so the button and the action share
   * the same rules (stationary, off fire cooldown, an ally needs shield). */
  get canCarrierBoost(): boolean {
    if (!this.state || !this.canAct) {
      return false;
    }
    const stack = this.selectedStack();
    if (!stack || !isSidePlayerControlled(this.state, stack.side)) {
      return false;
    }
    return this.combat.canCarrierBoost(this.state, stack.stackId);
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

  doCarrierBoost(): boolean {
    const stack = this.selectedStack();
    if (!stack || !this.state) {
      return false;
    }
    const success = this.combat.carrierShieldBoost(this.state, stack.stackId);
    if (success) {
      this.cdr.detectChanges();
    }
    return success;
  }

  private startGameLoop(): void {
    if (!this.state) {
      return;
    }
    this.gameLoop.startGameLoop((deltaTime: number, realDeltaTime: number) => {
      this.gameLoopCallback(deltaTime, realDeltaTime);
    });
  }

  /*
   * One simulation frame. deltaTime is already scaled by battle speed and
   * is 0 while paused, in which case nothing advances (orders given while
   * paused are stored and take effect on resume).
   *
   * Order matters:
   *   1. positions         — movement interpolation
   *   2. AI / AUTO ticks   — movement decisions (never firing)
   *   3. re-planning       — chase destinations + manual order upkeep
   *   4. fire control      — every stack, both sides, own cadence
   *   5. shield regen
   *   6. victory check + view tick (always, so the result modal appears)
   *
   * realDeltaTime (unscaled, also while paused) only drives presentation:
   * the background parallax easing.
   */
  private gameLoopCallback(deltaTime: number, realDeltaTime = 0): void {
    this.parallax.step(realDeltaTime);
    if (!this.state) {
      return;
    }
    const state = this.state;
    const running = !state.winner && !this.battleTime.isPaused && deltaTime > 0;

    if (running) {
      const deltaMs = deltaTime * 1000;
      // Headings first: this frame's movement speed depends on how far each
      // hull is still turned away from its course (battle-heading.ts).
      updateStackHeadings(state, deltaTime);
      updateStackPositions(state, deltaTime, (stackId) => this.movement.completeMovement(stackId));

      this.aiTickAccumulator += deltaMs;
      if (this.aiTickAccumulator >= AI_ACTION_INTERVAL_MS) {
        this.aiTickAccumulator = 0;
        void this.ai.playAction(state);
      }

      // AUTO drives only player stacks without a manual order.
      if (this.autoBattleEnabled) {
        this.autoBattleTickAccumulator += deltaMs;
        if (this.autoBattleTickAccumulator >= AI_ACTION_INTERVAL_MS) {
          this.autoBattleTickAccumulator = 0;
          void this.ai.playAction(state, true);
        }
      }

      this.replanAccumulator += deltaMs;
      if (this.replanAccumulator >= MOVE_REPLAN_INTERVAL_MS) {
        this.replanAccumulator = 0;
        this.movement.maintainAttackOrders(state);
        this.movement.updateMoveToAttackTargets(state);
      }

      this.combat.runFireControl(state);

      this.shieldRegenAccumulator += deltaMs;
      if (this.shieldRegenAccumulator >= SHIELD_REGEN_INTERVAL_MS) {
        this.shieldRegenAccumulator = 0;
        regenerateAllShields(state);
        state.round++;
      }
    }

    // Bolts fly on battle time, after movement so hit tests see this
    // frame's positions. Runs after victory too (no damage then), so the
    // last bolts and explosion finish before the result overlay appears.
    if (!this.battleTime.isPaused && deltaTime > 0) {
      this.combat.updateProjectiles(state, deltaTime);
    }

    checkVictory(state);
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
    if (outcome.spaceBaseId != null) {
      // A space base is never captured: losing destroys it.
      return outcome.winnerSide === 'attacker' ? 'DESTROYED' : 'DEFENDED';
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
      } else if (battle.type === 'planet' && battle.spaceBaseId != null) {
        this.applySpaceBaseBattleResult(outcome);
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
   * Persists fleet-vs-fleet damage to the autosave slot through
   * BattleOutcomeService. StarMap.reloadAfterBattle() reads the same slot
   * on the next /star-map navigation.
   */
  private persistFleetBattleResult(outcome: BattleOutcome): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.fleets) {
      return;
    }
    this.battleOutcomeService.applyFleetBattleOutcome(data, outcome);
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }

  /*
   * Persists a planet battle outcome through BattleOutcomeService, the
   * same code path AI auto-resolved invasions use: on attacker victory the
   * planet changes owner (PlanetOwnershipService), the attacker's roster
   * is always written back and a real garrison keeps its damage.
   */
  private applyPlanetBattleResult(battle: Battle, outcome: BattleOutcome): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.starSystems) {
      return;
    }
    this.battleOutcomeService.applyPlanetBattleOutcome(data, battle, outcome);
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }

  /*
   * Persists a space base battle to the autosave snapshot through the same
   * BattleOutcomeService path AI-vs-AI base battles use: attacker victory
   * removes the base (and with it its territory claim); the attacker's
   * roster is always written back.
   */
  private applySpaceBaseBattleResult(outcome: BattleOutcome): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data) {
      return;
    }
    this.battleOutcomeService.applySpaceBaseBattleOutcome(data, outcome);
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }
}

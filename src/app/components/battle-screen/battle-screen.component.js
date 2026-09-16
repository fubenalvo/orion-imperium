import { __decorate } from "tslib";
import { Component, ViewChild, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SaveSlotId } from '../../services/save-game.service';
import { AI_ACTION_INTERVAL_MS, SHIELD_REGEN_INTERVAL_MS, } from './battle/battle.types';
import { createBattleState, isSidePlayerControlled } from './battle/battle-state';
import { getAttackTargetIds as computeAttackTargetIds, getReachableCells, getMoveToAttackTargetIds, computeCarrierBoostTargets, checkVictory, updateStackPositions, regenerateAllShields } from './battle/battle-grid';
import { buildBattleOutcome } from './battle/battle-result';
import { BattleGridComponent } from './battle-grid/battle-grid.component';
let BattleScreenComponent = class BattleScreenComponent {
    router;
    battleService;
    shipService;
    planetBattleService;
    saveGameService;
    gameTimeService;
    gameLoop;
    movement;
    combat;
    ai;
    anim;
    cdr;
    battle = null;
    state = null;
    ticksSub;
    selectedStackId = null;
    pointerX = 0.5;
    pointerY = 0.5;
    motionEnabled = false;
    motionPermissionRequested = false;
    resultModalFocused = false;
    aiTickAccumulator = 0;
    shieldRegenAccumulator = 0;
    resultBackButton = null;
    constructor(router, battleService, shipService, planetBattleService, saveGameService, gameTimeService, gameLoop, movement, combat, ai, anim, cdr) {
        this.router = router;
        this.battleService = battleService;
        this.shipService = shipService;
        this.planetBattleService = planetBattleService;
        this.saveGameService = saveGameService;
        this.gameTimeService = gameTimeService;
        this.gameLoop = gameLoop;
        this.movement = movement;
        this.combat = combat;
        this.ai = ai;
        this.anim = anim;
        this.cdr = cdr;
        this.battle = this.battleService.getBattle();
        this.ticksSub = this.anim.ticks$.subscribe(() => this.cdr.detectChanges());
        this.onStackClick = this.onStackClick.bind(this);
        this.onCellClick = this.onCellClick.bind(this);
    }
    get battleState() {
        return this.state;
    }
    get liveStacks() {
        return this.state?.stacks.filter((s) => !s.destroyed) ?? [];
    }
    get battleOver() {
        return this.state?.winner != null;
    }
    get showBattleResult() {
        return this.battleOver && !this.anim.isBusy;
    }
    get resultWinnerName() {
        const outcome = this.battleOutcome;
        if (!outcome || !this.state) {
            return '';
        }
        return outcome.winnerSide === 'attacker' ? this.state.attackerName : this.state.defenderName;
    }
    get resultWinnerSideLabel() {
        return this.battleOutcome?.winnerSide === 'attacker' ? 'ATTACKER' : 'DEFENDER';
    }
    get resultBattleTypeLabel() {
        return this.battleOutcome?.battleType === 'planet' ? 'PLANET BATTLE' : 'FLEET BATTLE';
    }
    get resultSideSummaries() {
        const outcome = this.battleOutcome;
        if (!outcome || !this.state) {
            return [];
        }
        return [
            this.createSideSummary('attacker', this.state.attackerName, this.state.attackerColor, outcome.attacker),
            this.createSideSummary('defender', this.state.defenderName, this.state.defenderColor, outcome.defender),
        ];
    }
    createSideSummary(side, name, color, fleet) {
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
    get playerHasStacks() {
        if (!this.state || this.state.winner) {
            return false;
        }
        return this.state.stacks.some((s) => !s.destroyed && isSidePlayerControlled(this.state, s.side));
    }
    get canAct() {
        return this.playerHasStacks && !this.anim?.isBusy;
    }
    get canPlayerAct() {
        if (!this.state || !this.canAct) {
            return false;
        }
        const stack = this.selectedStack();
        return !!stack && !stack.moving && !stack.destroyed;
    }
    get moveCells() {
        const stack = this.selectedStack();
        if (!this.state || !stack || !this.canPlayerAct) {
            return [];
        }
        return getReachableCells(this.state, stack);
    }
    get attackTargetIds() {
        const stack = this.selectedStack();
        if (!this.state || !stack || !this.canPlayerAct) {
            return [];
        }
        return computeAttackTargetIds(this.state, stack);
    }
    get moveToAttackTargetIds() {
        const stack = this.selectedStack();
        if (!this.state || !stack || !this.canPlayerAct) {
            return [];
        }
        return getMoveToAttackTargetIds(this.state, stack);
    }
    get effect() {
        return this.state?.effect ?? null;
    }
    /*
     * Planet-battle presentation data. planetVisual is null in fleet battles,
     * which keeps the planet component and its shared-shield bar out of that
     * mode entirely.
     */
    get planetVisual() {
        if (!this.state?.planetName) {
            return null;
        }
        return {
            name: this.state.planetName,
            color: this.state.planetColor ?? '#ffffff',
        };
    }
    get planetShield() {
        return this.state?.defenderShieldPool ?? null;
    }
    get planetShieldFraction() {
        const pool = this.planetShield;
        if (!pool || pool.max <= 0) {
            return 0;
        }
        return Math.max(0, Math.min(1, pool.current / pool.max));
    }
    get bgDeepTransform() {
        const offsetX = (this.pointerX - 0.5) * 2;
        const offsetY = (this.pointerY - 0.5) * 2;
        return `translate(${offsetX * 5}vw, ${offsetY * 5}vh)`;
    }
    get bgForegroundTransform() {
        const offsetX = (this.pointerX - 0.5) * 2;
        const offsetY = (this.pointerY - 0.5) * 2;
        return `translate(${offsetX * 2.5}vw, ${offsetY * 2.5}vh)`;
    }
    onPointerMove = (event) => {
        this.pointerX = event.clientX / window.innerWidth;
        this.pointerY = event.clientY / window.innerHeight;
    };
    onPointerLeave = () => {
        this.pointerX = 0.5;
        this.pointerY = 0.5;
    };
    onDeviceOrientation = (event) => {
        if (!this.motionEnabled) {
            return;
        }
        const gamma = event.gamma ?? 0;
        const beta = event.beta ?? 0;
        this.pointerX = Math.max(0, Math.min(1, (gamma + 90) / 180));
        this.pointerY = Math.max(0, Math.min(1, (beta + 45) / 90));
        this.cdr.detectChanges();
    };
    async requestMotionPermission() {
        if (this.motionPermissionRequested) {
            return;
        }
        this.motionPermissionRequested = true;
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const response = await DeviceOrientationEvent.requestPermission();
                if (response === 'granted') {
                    this.enableMotion();
                }
            }
            catch {
                // Permission denied or unavailable — background remains centered.
            }
        }
        else if ('DeviceOrientationEvent' in window) {
            this.enableMotion();
        }
    }
    enableMotion() {
        this.motionEnabled = true;
        window.addEventListener('deviceorientation', this.onDeviceOrientation);
    }
    ngOnInit() {
        if (this.battle) {
            this.state = createBattleState(this.battle, this.shipService, this.planetBattleService);
            checkVictory(this.state);
        }
        this.gameTimeService.pause();
        this.startGameLoop();
    }
    ngAfterViewChecked() {
        if (this.showBattleResult && !this.resultModalFocused) {
            this.resultBackButton?.nativeElement.focus();
            this.resultModalFocused = true;
        }
        else if (!this.showBattleResult) {
            this.resultModalFocused = false;
        }
    }
    ngOnDestroy() {
        this.ticksSub.unsubscribe();
        this.gameLoop.stopGameLoop();
        this.anim.reset();
        this.gameTimeService.resume();
        window.removeEventListener('deviceorientation', this.onDeviceOrientation);
    }
    onStackClick(stackId) {
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
            if (!stack.moving) {
                this.selectedStackId = stack.stackId;
            }
            return;
        }
        // Enemy stack: attack it if the selected stack can.
        const selected = this.selectedStack();
        if (!selected || selected.moving) {
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
    onCellClick(col, row) {
        if (!this.state || !this.canPlayerAct) {
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
    selectedStack() {
        if (!this.state || !this.selectedStackId) {
            return null;
        }
        return this.state.stacks.find((s) => s.stackId === this.selectedStackId && !s.destroyed) ?? null;
    }
    /* Aggregate stats for the selected stack's info panel. Pure reads of
     * BattleStack/BattleShip state; no combat logic is duplicated here —
     * the sums mirror the values used by BattleCombatService (totalAttack)
     * and BattleGridComponent.hullFraction (HP fraction). */
    get selectedShipCount() {
        const stack = this.selectedStack();
        return stack ? stack.ships.filter((s) => s.alive).length : 0;
    }
    get selectedTotalHp() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.hp : sum), 0) : 0;
    }
    get selectedMaxHp() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => sum + s.maxHp, 0) : 0;
    }
    get selectedTotalAttack() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.attack : sum), 0) : 0;
    }
    get selectedTotalDefense() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + s.defense : sum), 0) : 0;
    }
    /* Aggregate shield for the selected stack's info panel. Pure reads of
     * BattleShip.shield/maxShield — no combat logic duplicated here. */
    get selectedTotalShield() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => (s.alive ? sum + (s.shield ?? 0) : sum), 0) : 0;
    }
    get selectedMaxShield() {
        const stack = this.selectedStack();
        return stack ? stack.ships.reduce((sum, s) => sum + (s.maxShield ?? 0), 0) : 0;
    }
    get selectedShieldFraction() {
        const max = this.selectedMaxShield;
        return max > 0 ? Math.max(0, this.selectedTotalShield / max) : 0;
    }
    get selectedHullFraction() {
        const max = this.selectedMaxHp;
        return max > 0 ? Math.max(0, this.selectedTotalHp / max) : 0;
    }
    /* Carrier Shield Pulse: the selected stack is a Carrier that can act,
     * is not moving, and has not yet been blocked by the busy lock.
     * Pure read of existing state — no combat logic duplicated here. */
    get canCarrierBoost() {
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
    get carrierBoostTargetIds() {
        const stack = this.selectedStack();
        return stack && this.state ? computeCarrierBoostTargets(this.state, stack) : [];
    }
    async doCarrierBoost() {
        if (!this.state) {
            return;
        }
        const stack = this.selectedStack();
        if (!stack) {
            return;
        }
        this.combat.carrierShieldBoost(this.state, stack.stackId);
    }
    /*
     * Move-to-attack: move to the best cell within attack range of the target.
     * If already in range, attack directly. The attack (if any) is handled
     * by the combat service which respects the animation busy lock.
     */
    async doMoveToAttack(attacker, target) {
        if (!this.state) {
            return;
        }
        await this.movement.moveToAttack(this.state, attacker.stackId, target.stackId);
        this.cdr.detectChanges();
    }
    async doMove(stack, col, row) {
        if (!this.state) {
            return;
        }
        await this.movement.moveStack(this.state, stack.stackId, col, row);
        this.cdr.detectChanges();
    }
    async doAttack(attacker, target) {
        if (!this.state) {
            return;
        }
        await this.combat.attackStack(this.state, attacker.stackId, target.stackId);
        this.cdr.detectChanges();
    }
    startGameLoop() {
        if (!this.state) {
            return;
        }
        this.gameLoop.startGameLoop((deltaTime) => {
            this.gameLoopCallback(deltaTime);
        });
    }
    gameLoopCallback(deltaTime) {
        if (!this.state || this.state.winner) {
            return;
        }
        // 1. Update stack positions (real-time movement).
        updateStackPositions(this.state, deltaTime);
        // 2. AI tick: one action every AI_ACTION_INTERVAL_MS when not busy.
        this.aiTickAccumulator += deltaTime * 1000;
        if (this.aiTickAccumulator >= AI_ACTION_INTERVAL_MS && !this.anim.isBusy) {
            this.aiTickAccumulator = 0;
            void this.ai.playAction(this.state);
        }
        // 3. Shield regeneration: every SHIELD_REGEN_INTERVAL_MS for all sides.
        this.shieldRegenAccumulator += deltaTime * 1000;
        if (this.shieldRegenAccumulator >= SHIELD_REGEN_INTERVAL_MS) {
            this.shieldRegenAccumulator = 0;
            regenerateAllShields(this.state);
            this.state.round++;
        }
        // 4. Victory check after movement and AI action.
        checkVictory(this.state);
        // 5. Trigger change detection for real-time position updates.
        this.anim.tick();
    }
    getSideResult(side) {
        if (!this.state?.winner) {
            return null;
        }
        return this.state.winner === side ? 'winner' : 'loser';
    }
    /* BattleOutcome built from the current simulation state. Pure: reads only
     * BattleModelState, never mutates anything. Used by the end-of-battle
     * result view so the UI presents the same outcome the overworld persists. */
    get battleOutcome() {
        if (!this.state || !this.state.winner) {
            return null;
        }
        return buildBattleOutcome(this.state);
    }
    /* Planet-battle result label derived purely from BattleOutcome fields.
     * 'CAPTURED' = attacker (player or AI) took the planet.
     * 'DEFENDED' = the planet's defenders held it.
     * Empty string for fleet battles (no planet line to show). */
    getPlanetResultLabel() {
        const outcome = this.battleOutcome;
        if (!outcome || outcome.battleType !== 'planet') {
            return '';
        }
        return outcome.winnerSide === 'attacker' ? 'CAPTURED' : 'DEFENDED';
    }
    backToStarMap() {
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
            }
            else {
                this.battleService.setDestroyedFleetId(outcome.loserFleetId);
            }
            if (battle.type === 'planet' && battle.planetId) {
                this.applyPlanetBattleResult(battle, outcome);
            }
            else {
                this.persistFleetBattleResult(outcome);
            }
        }
        else {
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
    persistFleetBattleResult(outcome) {
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
    applyPlanetBattleResult(battle, outcome) {
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
                    }
                    else if (garrisonShipMap) {
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
};
__decorate([
    ViewChild('resultBackButton')
], BattleScreenComponent.prototype, "resultBackButton", void 0);
BattleScreenComponent = __decorate([
    Component({
        selector: 'app-battle-screen',
        standalone: true,
        imports: [CommonModule, BattleGridComponent],
        templateUrl: './battle-screen.component.html',
        styleUrl: './battle-screen.component.scss',
    })
], BattleScreenComponent);
export { BattleScreenComponent };
/* Converts outcome ship records back to the overworld FleetShip shape. */
function shipsToSave(ships) {
    return ships.map((s) => ({
        id: s.shipId,
        name: s.name,
        type: s.typeId,
        currentHp: s.hp,
        destroyed: s.destroyed,
    }));
}

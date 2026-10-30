import { Component, ElementRef, HostListener, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {
  SaveGameService,
  SaveSlot,
  SaveSlotId,
  MANUAL_SLOT_START,
} from '../services/save-game.service';
import { GameSettingsService } from '../services/game-settings.service';
import { NewGameService } from '../services/new-game.service';
import { NewGameConfig } from '../services/new-game.models';
import { createDefaultNewGameConfig } from '../services/new-game-config';
import { NewGameSetupComponent, NewGameStartRequest } from './new-game-setup/new-game-setup.component';

interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-main-menu',
  imports: [NewGameSetupComponent],
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu implements OnInit, OnDestroy {
  showNewGameSetup = false;
  newGameErrors: string[] = [];
  startingNewGame = false;
  showLoadGameSlots = false;
  showInstallButton = false;
  showIOSGuide = false;

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor(
    private saveGameService: SaveGameService,
    private router: Router,
    private gameSettingsService: GameSettingsService,
    private newGameService: NewGameService,
    private host: ElementRef<HTMLElement>,
  ) {}

  ngOnInit(): void {
    this.updateInstallVisibility();
    this.startParallax();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateInstallVisibility();
  }

  private updateInstallVisibility(): void {
    if (this.isStandalone) {
      this.showInstallButton = false;
      this.showIOSGuide = false;
      this.removeDisplayModeListener();
      return;
    }
    if (this.isMobile) {
      this.showInstallButton = true;
      this.addDisplayModeListener();
    } else {
      this.showInstallButton = false;
      this.removeDisplayModeListener();
    }
  }

  ngOnDestroy(): void {
    this.removeDisplayModeListener();
    this.stopParallax();
  }

  /*
   * Pointer parallax for the decorative background scene. The pointer
   * position is written as --px/--py (-1..1) on the host and the SCSS maps
   * them to per-layer offsets. A plain window listener is used on purpose
   * (instead of @HostListener) so pointer movement never schedules change
   * detection; the value is only consumed by CSS. Skipped for users who
   * prefer reduced motion and on touch-only devices.
   */
  private parallaxFrame = 0;
  private parallaxActive = false;

  private readonly onParallaxPointerMove = (event: PointerEvent): void => {
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    cancelAnimationFrame(this.parallaxFrame);
    this.parallaxFrame = requestAnimationFrame(() => {
      const style = this.host.nativeElement.style;
      style.setProperty('--px', x.toFixed(3));
      style.setProperty('--py', y.toFixed(3));
    });
  };

  private startParallax(): void {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (reducedMotion || !finePointer) {
      return;
    }
    window.addEventListener('pointermove', this.onParallaxPointerMove, { passive: true });
    this.parallaxActive = true;
  }

  private stopParallax(): void {
    if (!this.parallaxActive) {
      return;
    }
    window.removeEventListener('pointermove', this.onParallaxPointerMove);
    cancelAnimationFrame(this.parallaxFrame);
    this.parallaxActive = false;
  }

  get slots(): SaveSlot[] {
    return this.saveGameService.getSlots();
  }

  get hasAnySave(): boolean {
    return this.saveGameService.hasAnySave();
  }

  formatDate(date: string | null): string {
    if (!date) {
      return 'Empty';
    }

    const d = new Date(date);
    return d.toLocaleString();
  }

  onInstallClick(): void {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          this.showInstallButton = false;
        }
        this.deferredPrompt = null;
      });
    } else {
      this.showIOSGuide = true;
    }
  }

  onCloseIOSGuide(): void {
    this.showIOSGuide = false;
  }

  openNewGameSetup(): void {
    this.newGameErrors = [];
    this.showNewGameSetup = true;
  }

  closeNewGameSetup(): void {
    this.showNewGameSetup = false;
    this.newGameErrors = [];
  }

  onStartNewGame(request: NewGameStartRequest): void {
    this.newGame(request.slotIndex, request.config);
  }

  /*
   * Generates a galaxy from `config`, stores it in the manual slot and
   * activates it (autosave becomes the live session). Navigation happens
   * only after the whole pipeline succeeded; otherwise the errors are shown
   * on the setup screen and the current saves stay untouched.
   */
  newGame(slotIndex: number, config: NewGameConfig = createDefaultNewGameConfig()): boolean {
    if (slotIndex < MANUAL_SLOT_START) {
      return false;
    }

    this.startingNewGame = true;
    const result = this.newGameService.startNewGame(config, slotIndex);
    this.startingNewGame = false;
    if (!result.ok) {
      this.newGameErrors = result.errors;
      return false;
    }
    this.newGameErrors = [];
    this.router.navigate(['/star-map']);
    return true;
  }

  loadGame(slotIndex: number): void {
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return;
    }
    this.router.navigate(['/star-map']);
  }

  onOptions(): void {
    this.gameSettingsService.openOptionsMenu();
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: Event): void {
    const promptEvent = event as BeforeInstallPromptEvent;
    promptEvent.preventDefault();
    this.deferredPrompt = promptEvent;
    if (this.isMobile && !this.isStandalone) {
      this.showInstallButton = true;
    }
  }

  @HostListener('window:appinstalled')
  onAppInstalled(): void {
    this.showInstallButton = false;
    this.showIOSGuide = false;
    this.deferredPrompt = null;
    this.removeDisplayModeListener();
  }

  @HostListener('window:load')
  onWindowLoad(): void {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone) {
      this.showInstallButton = false;
      this.showIOSGuide = false;
    }
  }

  private get isMobile(): boolean {
    return window.innerWidth <= 768;
  }

  private get isStandalone(): boolean {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const displayModeStandalone =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)').matches
        : false;
    return nav.standalone === true || displayModeStandalone;
  }

  private displayModeListener: ((e: MediaQueryListEvent) => void) | null = null;

  private addDisplayModeListener(): void {
    this.removeDisplayModeListener();
    const mq = window.matchMedia('(display-mode: standalone)');
    this.displayModeListener = (e: MediaQueryListEvent) => {
      if (e.matches) {
        this.showInstallButton = false;
        this.showIOSGuide = false;
      }
    };
    mq.addEventListener('change', this.displayModeListener);
  }

  private removeDisplayModeListener(): void {
    if (this.displayModeListener) {
      const mq = window.matchMedia('(display-mode: standalone)');
      mq.removeEventListener('change', this.displayModeListener);
      this.displayModeListener = null;
    }
  }
}

import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {
  SaveGameService,
  SaveSlot,
  SaveSlotId,
  MANUAL_SLOT_START,
} from '../services/save-game.service';
import { GameSettingsService } from '../services/game-settings.service';
import { StarMapData } from '../components/star-map/star-map.models';
import starMapData from '../components/star-map/star-map-data.json';

interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu implements OnInit, OnDestroy {
  showNewGameSlots = false;
  showLoadGameSlots = false;
  showInstallButton = false;
  showIOSGuide = false;

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor(
    private saveGameService: SaveGameService,
    private router: Router,
    private gameSettingsService: GameSettingsService,
  ) {}

  ngOnInit(): void {
    this.updateInstallVisibility();
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

  newGame(slotIndex: number): void {
    if (slotIndex < MANUAL_SLOT_START) {
      return;
    }

    const defaultData = structuredClone(starMapData) as StarMapData;
    this.saveGameService.saveToSlot(slotIndex, defaultData);
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return;
    }
    this.router.navigate(['/star-map']);
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

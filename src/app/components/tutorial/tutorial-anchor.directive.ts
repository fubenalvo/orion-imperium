import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { TutorialService } from '../../services/tutorial.service';

/*
 * Marks an element a tutorial hint may point at: `[appTutorialAnchor]="'hud.time'"`.
 * Keys are the stable names the step table uses (tutorial-steps.ts), so steps
 * never find UI by CSS class. A null / empty key registers nothing, which lets
 * a template mark an element only in a given state (e.g. only the spot the
 * Mining Complex can go).
 */
@Directive({ selector: '[appTutorialAnchor]' })
export class TutorialAnchorDirective implements OnDestroy {
  readonly appTutorialAnchor = input<string | null | undefined>(null);

  private readonly tutorial = inject(TutorialService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private registered: string | null = null;

  constructor() {
    effect(() => {
      const key = this.appTutorialAnchor() || null;
      if (key === this.registered) return;
      if (this.registered) this.tutorial.unregisterAnchor(this.registered, this.element);
      this.registered = key;
      if (key) this.tutorial.registerAnchor(key, this.element);
    });
  }

  ngOnDestroy(): void {
    if (this.registered) this.tutorial.unregisterAnchor(this.registered, this.element);
  }
}

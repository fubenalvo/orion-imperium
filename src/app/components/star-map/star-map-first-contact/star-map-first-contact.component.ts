import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ContactDialogueVm, ContactResolution } from '../first-contact.service';
import { ContactStance } from '../first-contact';

export interface ContactAnswer {
  replies: number[];
  stance: ContactStance;
  giftTier: number;
}

/*
 * First contact dialogue (docs/first-contact.md): greeting, two questions
 * with three replies each, a closing stance with an optional gift, then the
 * other empire's answer. Presentational: StarMap builds the view model,
 * pauses the game, resolves the answer (FirstContactService) and hands the
 * result back for the last step. There is no close button before the
 * result: a meeting must be answered.
 */
@Component({
  selector: 'app-star-map-first-contact',
  standalone: true,
  imports: [UpperCasePipe],
  templateUrl: './star-map-first-contact.component.html',
  styleUrl: './star-map-first-contact.component.scss',
})
export class StarMapFirstContactComponent implements OnChanges {
  @Input({ required: true }) vm!: ContactDialogueVm;
  @Input() result: ContactResolution | null = null;
  @Output() answer = new EventEmitter<ContactAnswer>();
  @Output() close = new EventEmitter<void>();

  /* 0 greeting, 1..n questions, n+1 stance (then the result). */
  step = 0;
  replies: (number | null)[] = [];
  stance: ContactStance | null = null;
  giftTier = 0;
  sent = false;

  readonly stances: { id: ContactStance; label: string; hint: string }[] = [
    { id: 'welcome', label: 'Welcome', hint: 'Open friendship' },
    { id: 'cautious', label: 'Cautious', hint: 'Correct and distant' },
    { id: 'warning', label: 'Warning', hint: 'Stay out of our space' },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vm'] && changes['vm'].previousValue?.factionId !== this.vm.factionId) {
      this.step = 0;
      this.replies = this.vm.questions.map(() => null);
      this.stance = null;
      this.giftTier = 0;
      this.sent = false;
    }
  }

  get questionIndex(): number {
    return this.step - 1;
  }

  get onQuestion(): boolean {
    return this.step >= 1 && this.step <= this.vm.questions.length;
  }

  get onStance(): boolean {
    return this.step === this.vm.questions.length + 1;
  }

  pickReply(index: number): void {
    if (!this.onQuestion) return;
    this.replies[this.questionIndex] = index;
  }

  next(): void {
    if (this.onQuestion && this.replies[this.questionIndex] === null) return;
    this.step++;
  }

  send(): void {
    if (!this.onStance || !this.stance || this.sent) return;
    this.sent = true;
    this.answer.emit({ replies: this.replies.map((r) => r ?? 1), stance: this.stance, giftTier: this.giftTier });
  }
}

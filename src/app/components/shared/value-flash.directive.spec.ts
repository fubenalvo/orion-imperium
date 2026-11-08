import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ValueFlashDirective } from './value-flash.directive';

@Component({
  standalone: true,
  imports: [ValueFlashDirective],
  template: `<span class="value" [uiValueFlash]="value()">{{ value() }}</span>`,
})
class HostComponent {
  value = signal(1000);
}

describe('ValueFlashDirective', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  const span = () => fixture.nativeElement.querySelector('.value') as HTMLElement;
  const set = (value: number) => {
    fixture.componentInstance.value.set(value);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('stays quiet for routine income ticks', () => {
    for (let v = 1005; v <= 1100; v += 5) set(v);
    expect(span().classList.contains('ui-flash-up')).toBe(false);
    expect(span().querySelector('.ui-delta')).toBeNull();
  });

  it('flashes red and floats the amount when a purchase drops the value', () => {
    for (let v = 1005; v <= 1050; v += 5) set(v);
    set(550);
    expect(span().classList.contains('ui-flash-down')).toBe(true);
    expect(span().querySelector('.ui-delta--down')?.textContent).toBe('−500');
  });

  it('flashes green on a large gain, and the jump does not raise the baseline', () => {
    for (let v = 1005; v <= 1050; v += 5) set(v);
    set(2050);
    expect(span().classList.contains('ui-flash-up')).toBe(true);
    expect(span().querySelector('.ui-delta--up')?.textContent).toBe('+1,000');
    const directive = fixture.debugElement.children[0].injector.get(ValueFlashDirective);
    expect(directive.isJump(40)).toBe(true);
  });
});

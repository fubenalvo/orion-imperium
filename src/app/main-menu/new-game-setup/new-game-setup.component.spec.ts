import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NewGameSetupComponent, NewGameStartRequest } from './new-game-setup.component';
import { SaveSlot } from '../../services/save-game.service';

describe('NewGameSetupComponent', () => {
  let fixture: ComponentFixture<NewGameSetupComponent>;
  let component: NewGameSetupComponent;
  let host: HTMLElement;

  const emptySlots = (): SaveSlot[] => Array.from({ length: 5 }, () => ({ data: null, date: null }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NewGameSetupComponent] }).compileComponents();
    fixture = TestBed.createComponent(NewGameSetupComponent);
    component = fixture.componentInstance;
    const slots = emptySlots();
    slots[1] = { data: {} as never, date: new Date().toISOString() };
    fixture.componentRef.setInput('slots', slots);
    fixture.detectChanges();
    host = fixture.nativeElement;
  });

  const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.player-row'));

  it('shows three galaxy sizes and the default players with the human marked', () => {
    expect(host.querySelectorAll('.galaxy-size')).toHaveLength(3);
    expect(rows()).toHaveLength(3);
    expect(rows()[0].classList).toContain('player-row--human');
    expect(rows()[0].querySelector('.player-row__badge')!.textContent!.trim()).toBe('YOU');
    expect(rows()[1].querySelector('.player-row__badge')!.textContent!.trim()).toBe('AI');
    // Only AI rows offer a difficulty selector.
    expect(rows()[0].querySelector('select.player-row__difficulty')).toBeNull();
    expect(rows()[1].querySelector('select.player-row__difficulty')).not.toBeNull();
  });

  it('defaults to the first empty manual slot', () => {
    expect(component.slotIndex).toBe(2);
  });

  it('adds players up to the galaxy limit and trims when shrinking the galaxy', () => {
    const add = host.querySelector<HTMLButtonElement>('.setup-add')!;
    for (let i = 0; i < 5; i++) add.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(6);
    expect(add.disabled).toBe(true);

    host.querySelectorAll<HTMLButtonElement>('.galaxy-size')[0].click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(3);
  });

  it('disables colors already used by another player', () => {
    const takenByPlayer0 = component.config.players[0].color;
    expect(component.isColorTaken(takenByPlayer0, 1)).toBe(true);
    component.setColor(1, takenByPlayer0);
    expect(component.config.players[1].color).not.toBe(takenByPlayer0);
  });

  it('blocks Start while the configuration is invalid', () => {
    const name = rows()[1].querySelector<HTMLInputElement>('.player-row__name')!;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const start = host.querySelector<HTMLButtonElement>('.setup-actions__start')!;
    expect(start.disabled).toBe(true);
    expect(host.querySelector('.setup-errors')!.textContent).toContain('name is required');
  });

  it('emits the configuration, seed and slot on Start', () => {
    const emitted = vi.fn<(req: NewGameStartRequest) => void>();
    component.start.subscribe(emitted);

    host.querySelectorAll<HTMLButtonElement>('.galaxy-size')[1].click();
    component.setSeed({ target: { value: '12345' } } as unknown as Event);
    const difficulty = rows()[1].querySelector<HTMLSelectElement>('select.player-row__difficulty')!;
    difficulty.value = 'hard';
    difficulty.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('.setup-actions__start')!.click();

    expect(emitted).toHaveBeenCalledTimes(1);
    const request = emitted.mock.calls[0][0];
    expect(request.slotIndex).toBe(2);
    expect(request.config.galaxySize).toBe('medium');
    expect(request.config.seed).toBe(12345);
    expect(request.config.players[1].difficulty).toBe('hard');
  });

  it('rejects a non-numeric seed', () => {
    component.setSeed({ target: { value: 'abc' } } as unknown as Event);
    expect(component.validationErrors.join()).toContain('Seed');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BattleStack } from '../battle/battle.types';
import { BattleGridComponent } from './battle-grid.component';

function makeStack(size: number): BattleStack {
  return {
    stackId: `attacker:fighter:${size}`,
    side: 'attacker',
    typeId: 'fighter',
    typeName: 'Fighter',
    col: 2,
    row: 4,
    ships: [],
    size,
    tier: size,
    moveApPerCell: 1,
    attackAp: 1,
    moveRange: 5,
    attackRange: 2,
    immobile: false,
    cellsMovedThisTurn: 0,
    attackedThisTurn: false,
    moving: false,
    firing: false,
    moveMs: 180,
    destroyed: false,
    role: 'Interceptor',
  };
}

describe('BattleGridComponent', () => {
  let fixture: ComponentFixture<BattleGridComponent>;
  let component: BattleGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BattleGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BattleGridComponent);
    component = fixture.componentInstance;
  });

  it.each([2, 3])('does not turn a size-%i stack click into a grid move', (size) => {
    const stack = makeStack(size);
    const onStackClick = vi.fn();
    const onCellClick = vi.fn();

    component.stacks = [stack];
    component.selectedStackId = stack.stackId;
    component.moveCells = [{ col: 1, row: 1 }];
    component.onStackClick = onStackClick;
    component.onCellClick = onCellClick;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.stack') as HTMLButtonElement;
    button.click();

    expect(onStackClick).toHaveBeenCalledOnce();
    expect(onStackClick).toHaveBeenCalledWith(stack.stackId);
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('renders the separate planet marker only when a planet is provided', () => {
    expect(fixture.nativeElement.querySelector('app-battle-planet')).toBeNull();

    fixture.componentRef.setInput('planet', { name: 'Mars', color: '#b35a2a' });
    fixture.componentRef.setInput('planetShieldFraction', 0.5);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-battle-planet')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.battle-planet__name')?.textContent,
    ).toContain('Mars');
  });
});

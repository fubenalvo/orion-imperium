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
    speed: 3,
    attackRange: 2,
    immobile: false,
    moving: false,
    firing: false,
    destroyed: false,
    role: 'Interceptor',
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    fireRate: 1.5,
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

  it('getConnectionLine returns null when no connectionLine input', () => {
    expect(component.getConnectionLine()).toBeNull();
  });

  it('getConnectionLine returns line geometry when connectionLine is provided', () => {
    fixture.componentRef.setInput('connectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 20, y: 14 },
    });
    fixture.detectChanges();

    const line = component.getConnectionLine();
    expect(line).not.toBeNull();
    expect(line!.x).toBe(4);
    expect(line!.y).toBe(14);
    expect(line!.length).toBe(16);
    expect(line!.angleDeg).toBe(0);
  });

  it('getConnectionLine returns null when connectionLine length is too short', () => {
    fixture.componentRef.setInput('connectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 4.001, y: 14 },
    });
    fixture.detectChanges();

    expect(component.getConnectionLine()).toBeNull();
  });

  it('renders connection-line div when connectionLine input is set', () => {
    fixture.componentRef.setInput('connectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 20, y: 14 },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.connection-line') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.left).toBe('4vw');
    expect(el.style.top).toBe('14vw');
    expect(el.style.width).toBe('16vw');
    expect(el.style.getPropertyValue('--connection-angle')).toBe('0deg');
  });

  it('does not render connection-line div when connectionLine is null', () => {
    fixture.componentRef.setInput('connectionLine', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.connection-line')).toBeNull();
  });

  it('getAttackConnectionLine returns null when no attackConnectionLine input', () => {
    expect(component.getAttackConnectionLine()).toBeNull();
  });

  it('getAttackConnectionLine returns line geometry when attackConnectionLine is provided', () => {
    fixture.componentRef.setInput('attackConnectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 20, y: 14 },
    });
    fixture.detectChanges();

    const line = component.getAttackConnectionLine();
    expect(line).not.toBeNull();
    expect(line!.x).toBe(4);
    expect(line!.y).toBe(14);
    expect(line!.length).toBe(16);
    expect(line!.angleDeg).toBe(0);
  });

  it('getAttackConnectionLine returns null when attackConnectionLine length is too short', () => {
    fixture.componentRef.setInput('attackConnectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 4.001, y: 14 },
    });
    fixture.detectChanges();

    expect(component.getAttackConnectionLine()).toBeNull();
  });

  it('renders attack connection-line div when attackConnectionLine input is set', () => {
    fixture.componentRef.setInput('attackConnectionLine', {
      from: { x: 4, y: 14 },
      to: { x: 20, y: 14 },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.connection-line.attack') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.left).toBe('4vw');
    expect(el.style.top).toBe('14vw');
    expect(el.style.width).toBe('16vw');
    expect(el.style.getPropertyValue('--connection-angle')).toBe('0deg');
  });

  it('does not render attack connection-line div when attackConnectionLine is null', () => {
    fixture.componentRef.setInput('attackConnectionLine', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.connection-line.attack')).toBeNull();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BattleStack } from '../battle/battle.types';
import { BattleGridComponent, clientPointToCell } from './battle-grid.component';

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

  describe('clientPointToCell', () => {
    // A field rendered at an arbitrary scale/position: 760 x ~295.6 px.
    const rect = { left: 40, top: 100, width: 760, height: (760 * 28) / 72 };

    it('maps pointer positions to cells using only the rendered rect', () => {
      expect(clientPointToCell(41, 101, rect)).toEqual({ col: 1, row: 1 });
      expect(clientPointToCell(40 + 759, 100 + rect.height - 1, rect)).toEqual({ col: 38, row: 16 });
      // Centre of the field.
      expect(clientPointToCell(40 + 380, 100 + rect.height / 2, rect)).toEqual({ col: 20, row: 9 });
    });

    it('gives the same cell at any rendered scale', () => {
      const big = { left: 0, top: 0, width: 3000, height: (3000 * 28) / 72 };
      const small = { left: 0, top: 0, width: 600, height: (600 * 28) / 72 };
      // 25% / 60% of the field in both cases.
      expect(clientPointToCell(big.width * 0.25, big.height * 0.6, big)).toEqual(
        clientPointToCell(small.width * 0.25, small.height * 0.6, small),
      );
    });

    it('returns null outside the field or for an empty rect', () => {
      expect(clientPointToCell(10, 150, rect)).toBeNull();
      expect(clientPointToCell(400, 99, rect)).toBeNull();
      expect(clientPointToCell(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    });
  });

  describe('layering', () => {
    it('stacks lower rows over upper rows and moving ships over stationary ones', () => {
      const upper = { ...makeStack(1), row: 3 };
      const lower = { ...makeStack(1), stackId: 'b', row: 9 };
      const moving = { ...makeStack(1), stackId: 'c', row: 9, moving: true };
      expect(component.stackZIndex(lower)).toBeGreaterThan(component.stackZIndex(upper));
      expect(component.stackZIndex(moving)).toBeGreaterThan(component.stackZIndex(lower));
    });

    it('lifts the selected ship above every other ship but below bolts (z 60)', () => {
      const selected = { ...makeStack(1), stackId: 'sel', row: 1 };
      const bottomMover = { ...makeStack(1), stackId: 'm', row: 16, moving: true };
      component.selectedStackId = 'sel';
      expect(component.stackZIndex(selected)).toBeGreaterThan(component.stackZIndex(bottomMover));
      expect(component.stackZIndex(selected)).toBeLessThan(60);
    });

    it('renders field positions through the --u battlefield unit', () => {
      expect(component.u(12.5)).toBe('calc(var(--u) * 12.5)');
    });
  });

  it('marks player-controlled stacks as friendly and the others as enemy', () => {
    const own = makeStack(1);
    const enemy: BattleStack = { ...makeStack(1), stackId: 'defender:fighter:0', side: 'defender' };
    fixture.componentRef.setInput('stacks', [own, enemy]);
    fixture.componentRef.setInput('playerSides', ['attacker']);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.stack') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].classList).toContain('stack--friendly');
    expect(buttons[0].getAttribute('aria-label')).toBe('Friendly Fighter');
    expect(buttons[1].classList).toContain('stack--enemy');
    expect(buttons[1].getAttribute('aria-label')).toBe('Enemy Fighter');
    expect(buttons[0].querySelector('.stack__marker')).toBeTruthy();
    expect(buttons[1].querySelector('.stack__marker')).toBeTruthy();
  });

  it('follows the player side when the player defends', () => {
    const attacker = makeStack(1);
    fixture.componentRef.setInput('stacks', [attacker]);
    fixture.componentRef.setInput('playerSides', ['defender']);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.stack') as HTMLButtonElement;
    expect(button.classList).toContain('stack--enemy');
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
    expect(el.style.left).toBe('calc(var(--u) * 4)');
    expect(el.style.top).toBe('calc(var(--u) * 14)');
    expect(el.style.width).toBe('calc(var(--u) * 16)');
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
    expect(el.style.left).toBe('calc(var(--u) * 4)');
    expect(el.style.top).toBe('calc(var(--u) * 14)');
    expect(el.style.width).toBe('calc(var(--u) * 16)');
    expect(el.style.getPropertyValue('--connection-angle')).toBe('0deg');
  });

  it('does not render attack connection-line div when attackConnectionLine is null', () => {
    fixture.componentRef.setInput('attackConnectionLine', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.connection-line.attack')).toBeNull();
  });
});

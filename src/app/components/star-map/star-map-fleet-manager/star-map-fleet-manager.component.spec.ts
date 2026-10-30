import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Fleet, FleetShip, ShipStockEntry } from '../star-map.models';
import { FleetOrganizationPlan } from '../../../services/fleet-organization.service';
import { StarMapFleetManagerComponent } from './star-map-fleet-manager.component';

let shipSeq = 0;
const ships = (type: string, n: number): FleetShip[] =>
  Array.from({ length: n }, () => ({ id: ++shipSeq, name: 'Ship', type, currentHp: 50 }));

const fleet = (id: number, list: FleetShip[]): Fleet => ({
  id,
  name: `Fleet ${id}`,
  factionId: 'player',
  x: 3,
  y: 3,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  ships: list,
});

describe('StarMapFleetManagerComponent', () => {
  let fixture: ComponentFixture<StarMapFleetManagerComponent>;
  let el: HTMLElement;
  let applied: FleetOrganizationPlan[];
  let cancelled: number;

  const render = (fleets: Fleet[], reserve: ShipStockEntry[] | null = null): void => {
    fixture = TestBed.createComponent(StarMapFleetManagerComponent);
    fixture.componentRef.setInput('fleets', fleets);
    fixture.componentRef.setInput('reserve', reserve);
    fixture.componentRef.setInput('locationLabel', 'Sol system');
    applied = [];
    cancelled = 0;
    fixture.componentInstance.apply.subscribe((p) => applied.push(p));
    fixture.componentInstance.cancel.subscribe(() => cancelled++);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  };

  const update = (): void => {
    fixture.detectChanges();
  };

  const columns = () => Array.from(el.querySelectorAll<HTMLElement>('.fm-fleet'));
  const rows = (column: HTMLElement) =>
    Array.from(column.querySelectorAll<HTMLElement>('.fm-ship__row'));
  const button = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.trim().startsWith(text),
    )!;

  beforeEach(() => (shipSeq = 0));

  it('shows one column per fleet with class rows and counts', () => {
    render([
      fleet(1, [...ships('fighter', 3), ...ships('cruiser', 1)]),
      fleet(2, ships('scout', 2)),
    ]);
    expect(columns().length).toBe(2);
    expect(
      rows(columns()[0]).map((r) => r.querySelector('.fm-ship__name')!.textContent!.trim()),
    ).toEqual(['Cruiser', 'Fighter']);
    expect(el.querySelector('.fm__title')!.textContent).toContain('Sol system');
  });

  it('moves a selected quantity into a new fleet by clicking, then applies', () => {
    render([fleet(1, [...ships('fighter', 3), ...ships('cruiser', 1)])]);
    const fighterRow = rows(columns()[0])[1];
    fighterRow.click();
    update();
    // Default selection is the whole class; step down to 2.
    button(el, '−').click();
    update();
    expect(el.querySelector('.fm__hint')!.textContent).toContain('2');

    el.querySelector<HTMLButtonElement>('.fm-new__btn')!.click();
    update();

    expect(columns().length).toBe(2);
    expect(columns()[1].classList).toContain('fm-fleet--new');
    expect(rows(columns()[1]).length).toBe(1);

    button(el, 'Apply changes').click();
    expect(applied.length).toBe(1);
    expect(applied[0].fleets.map((f) => [f.fleetId, f.shipIds.length])).toEqual([
      [1, 2],
      [null, 2],
    ]);
  });

  it('merges by transferring a whole fleet and drops the emptied column', () => {
    render([fleet(1, ships('fighter', 2)), fleet(2, ships('scout', 1))]);
    button(columns()[1], 'Select all').click();
    update();
    columns()[0].querySelector<HTMLButtonElement>('.fm-fleet__drop')!.click();
    update();

    expect(columns().length).toBe(1);
    expect(el.querySelector('.fm__summary')!.textContent).toContain('Fleet 2 dissolved');
    // With a single fleet left, merge shortcuts disappear.
    expect(button(el, 'Gather here')).toBeUndefined();
  });

  it('disables the new-fleet slot when the selection is the entire fleet', () => {
    render([fleet(1, ships('fighter', 2))]);
    rows(columns()[0])[0].click();
    update();
    expect(el.querySelector<HTMLButtonElement>('.fm-new__btn')!.disabled).toBe(true);
  });

  it('asks before discarding changes and keeps Apply disabled while clean', () => {
    render([fleet(1, ships('fighter', 2)), fleet(2, ships('scout', 1))]);
    expect(button(el, 'Apply changes').disabled).toBe(true);
    button(columns()[0], 'Gather here').click();
    update();

    button(el, 'Cancel').click();
    update();
    expect(cancelled).toBe(0);
    expect(el.querySelector('.fm__confirm')).not.toBeNull();

    button(el, 'Discard').click();
    expect(cancelled).toBe(1);
  });

  it('Escape clears the selection before closing', () => {
    render([fleet(1, ships('fighter', 2))]);
    rows(columns()[0])[0].click();
    update();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    update();
    expect(fixture.componentInstance.selection).toBeNull();
    expect(cancelled).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toBe(1);
  });

  it('blocks Apply while a fleet name is blank', () => {
    render([fleet(1, ships('fighter', 2))]);
    const input = el.querySelector<HTMLInputElement>('.fm-fleet__name')!;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    update();
    expect(button(el, 'Apply changes').disabled).toBe(true);
    expect(el.textContent).toContain('Every fleet needs a name.');
  });

  it('shows no reserve column away from a Spaceport', () => {
    render([fleet(1, ships('fighter', 2))]);
    expect(el.querySelector('.fm-fleet--reserve')).toBeNull();
  });

  it('reinforces from the reserve column and returns ships to it', () => {
    render([fleet(1, ships('fighter', 2))], [{ id: 900, type: 'frigate', name: 'Ship' }]);
    const reserve = el.querySelector<HTMLElement>('.fm-fleet--reserve')!;
    expect(reserve.textContent).toContain('Reserve');
    // Reserve has no fleet tools.
    expect(button(reserve, 'Gather here')).toBeUndefined();

    rows(reserve)[0].click();
    update();
    columns()[1].querySelector<HTMLButtonElement>('.fm-fleet__drop')!.click();
    update();
    expect(el.querySelector('.fm__summary')!.textContent).toContain('1 from reserve');

    rows(columns()[1])[1].click(); // fighters
    update();
    const strip = el.querySelector<HTMLElement>('.fm-fleet--reserve .fm-fleet__drop')!;
    expect(strip.textContent).toContain('to reserve');
    strip.click();
    update();

    button(el, 'Apply changes').click();
    expect(applied[0].fleets[0].shipIds).toEqual([900]);
    expect(applied[0].reserveShipIds?.length).toBe(2);
  });
});

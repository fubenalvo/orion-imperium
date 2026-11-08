import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { ProductionPanelViewModel, StarMapProductionPanelComponent } from './star-map-production-panel.component';
import { PlanetTile, StarSystem } from '../star-map.models';

/* EQUIPMENT tab of NEW PRODUCTION ORDER (docs/ship-equipment.md). */
describe('StarMapProductionPanelComponent equipment orders', () => {
  const vm = (credits = 5000): ProductionPanelViewModel => ({
    planet: { id: 1 } as PlanetTile,
    system: { id: 'sol' } as StarSystem,
    factionId: 'player',
    buildable: [],
    modules: [
      { id: 'railgun', name: 'Railgun', slot: 'weapon', description: 'd', effects: ['kinetic damage', '+16 attack'], credits: 300, rawmaterials: 250, buildTime: 30, unlocked: true, lockedBy: null, inInventory: 1 },
      { id: 'warp_drive', name: 'Warp Drive', slot: 'engine', description: 'd', effects: ['+1 map speed'], credits: 500, rawmaterials: 300, buildTime: 50, unlocked: false, lockedBy: 'Orbital Engineering', inInventory: 0 },
    ],
    capacity: 1,
    power: 0.5,
    queue: [{ id: 7, shipTypeId: '', equipmentId: 'railgun', quantity: 1, progress: 0.5, startedAtTick: 0 }],
    shipCosts: {},
    shipBuildTimes: {},
    etas: { 7: 30 },
    factionCredits: credits,
    factionRawMaterials: 5000,
  });

  const render = (model = vm()) => {
    const fixture = TestBed.createComponent(StarMapProductionPanelComponent);
    fixture.componentRef.setInput('vm', model);
    fixture.componentRef.setInput('showBuildMenu', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (selector: string, text?: string) => {
      Array.from(el.querySelectorAll<HTMLElement>(selector)).find((n) => !text || n.textContent?.includes(text))!.click();
      fixture.detectChanges();
    };
    return { fixture, el, click };
  };

  it('labels equipment orders in the queue by module name', () => {
    expect(render().el.querySelector('.production-panel__row-type')?.textContent?.trim()).toBe('RAILGUN');
  });

  it('queues an unlocked module and shows locked ones with their technology', () => {
    const { fixture, el, click } = render();
    const orders: unknown[] = [];
    fixture.componentInstance.queueOrder.subscribe((r) => orders.push(r));
    click('.production-panel__tab', 'EQUIPMENT');
    const cards = el.querySelectorAll<HTMLButtonElement>('.production-panel__module');
    expect(cards.length).toBe(2);
    expect(cards[1].disabled).toBe(true);
    expect(cards[1].textContent).toContain('Needs Orbital Engineering');
    click('.production-panel__module', 'Railgun');
    click('.production-panel__quantity button', '+');
    expect(el.querySelector('.production-panel__total')?.textContent).toContain('600 cr · 500 rm');
    click('.production-panel__modal-actions .btn-primary');
    expect(orders).toEqual([{ shipTypeId: '', equipmentId: 'railgun', quantity: 2 }]);
  });

  it('blocks QUEUE when the module is unaffordable', () => {
    const { el, click } = render(vm(100));
    click('.production-panel__tab', 'EQUIPMENT');
    click('.production-panel__module', 'Railgun');
    expect((el.querySelector('.production-panel__modal-actions .btn-primary') as HTMLButtonElement).disabled).toBe(true);
  });
});

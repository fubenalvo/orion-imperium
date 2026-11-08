import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import type { Fleet, ShipStockEntry } from '../star-map.models';
import { ShipCustomizationComponent } from './ship-customization.component';
import { buildRoster, compareLoadouts, moduleOptions, statLines, weakTo, withModule } from './ship-customization-view';
import { resolveShipStats } from '../ship-stats';

const fleet = (): Fleet => ({
  id: 1,
  name: 'Home Guard',
  factionId: 'player',
  x: 10.5,
  y: 20.5,
  targetX: null,
  targetY: null,
  speed: 4,
  system: { id: 'sol', x: 26, y: 12, targetX: null, targetY: null },
  ships: [
    { id: 1, name: 'Ship', type: 'cruiser', currentHp: 140, equipment: { weapon: 'railgun' } },
    { id: 2, name: 'Ship', type: 'colonizer' },
    { id: 3, name: 'Ship', type: 'fighter', destroyed: true },
  ],
});
const reserve = (): ShipStockEntry[] => [{ id: 9, type: 'destroyer', name: 'Ship', equipment: { engine: 'warp_drive' } }];

describe('ship customization view model', () => {
  let ships: ShipService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    ships = TestBed.inject(ShipService);
  });

  it('lists living fleet ships, then the reserve, with hull and upgraded slots', () => {
    const groups = buildRoster(fleet(), reserve(), (id) => ships.getShipType(id));
    expect(groups.map((g) => [g.label, g.reserve, g.ships.map((s) => s.id)])).toEqual([
      ['Home Guard', false, [1, 2]],
      ['Reserve', true, [9]],
    ]);
    expect(groups[0].ships[0].hullPercent).toBe(50);
    expect(groups[0].ships[0].upgraded).toEqual({ engine: false, weapon: true, defense: false });
    expect(groups[1].ships[0].upgraded.engine).toBe(true);
  });

  it('names the damage type each profile is weak to', () => {
    expect(weakTo('energy')).toBe('kinetic');
    expect(weakTo('kinetic')).toBe('missile');
    expect(weakTo('missile')).toBe('energy');
  });

  it('shows the resolved battle values', () => {
    const cruiser = ships.getShipType('cruiser')!;
    const lines = statLines(cruiser, resolveShipStats(cruiser, { weapon: 'railgun' }));
    const value = (key: string) => lines.find((l) => l.key === key)!.value;
    expect(value('attack')).toBe(`${cruiser.attack + 16}`);
    expect(value('damage')).toBe('kinetic');
    expect(value('profile')).toBe(`${cruiser.weakness} · weak to ${weakTo(cruiser.weakness)}`);
  });

  it('compares only what changes, with direction, and the fleet map speed for engines', () => {
    const f = fleet();
    const cruiser = ships.getShipType('cruiser')!;
    const toLaser = compareLoadouts(cruiser, f.ships[0], withModule(f.ships[0].equipment, 'weapon', 'laser_cannon'), f);
    const byLabel = Object.fromEntries(toLaser.map((l) => [l.label, l]));
    expect(byLabel['Attack']).toMatchObject({ from: `${cruiser.attack + 16}`, to: `${cruiser.attack + 8}`, trend: -1 });
    expect(byLabel['Fire rate'].trend).toBe(1);
    expect(byLabel['Damage type']).toMatchObject({ from: 'kinetic', to: 'energy', trend: 0 });
    expect(byLabel['Shield']).toBeUndefined();

    const warp = compareLoadouts(cruiser, f.ships[0], withModule(f.ships[0].equipment, 'engine', 'warp_drive'), f);
    // The colonizer still has a standard engine, so the fleet stays at its base speed, and the line says why.
    expect(warp.find((l) => l.label === 'Map speed bonus')).toMatchObject({ from: '0', to: '1', trend: 1 });
    expect(warp.find((l) => l.label === 'Fleet map speed')).toMatchObject({ from: '4', to: '4 (slowest engine)', trend: null });
    f.ships[1].equipment = { engine: 'warp_drive' };
    const warpAll = compareLoadouts(cruiser, f.ships[0], withModule(f.ships[0].equipment, 'engine', 'warp_drive'), f);
    expect(warpAll.find((l) => l.label === 'Fleet map speed')).toMatchObject({ from: '4', to: '5', trend: 1 });
  });

  it('lists every upgrade module of a slot with counts and lock state', () => {
    const options = moduleOptions('weapon', 'railgun', { railgun: 2 }, { laser_cannon: 1 }, new Set(['railgun', 'laser_cannon']), { missile_launcher: 'Missile Technology' });
    expect(options.map((o) => [o.module.id, o.available, o.inProduction, o.unlocked, o.lockedBy, o.installed])).toEqual([
      ['missile_launcher', 0, 0, false, 'Missile Technology', false],
      ['laser_cannon', 0, 1, true, null, false],
      ['railgun', 2, 0, true, null, true],
    ]);
  });
});

describe('ShipCustomizationComponent', () => {
  const render = (inventory: Record<string, number> = { laser_cannon: 1, energy_shield: 0 }) => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ShipCustomizationComponent);
    fixture.componentRef.setInput('fleet', fleet());
    fixture.componentRef.setInput('reserve', reserve());
    fixture.componentRef.setInput('inventory', inventory);
    fixture.componentRef.setInput('unlockedModuleIds', ['laser_cannon', 'railgun', 'energy_shield', 'warp_drive']);
    fixture.componentRef.setInput('locationLabel', 'Sol system');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (selector: string, text?: string) => {
      const target = Array.from(el.querySelectorAll<HTMLElement>(selector)).find((n) => !text || n.textContent?.includes(text));
      target!.click();
      fixture.detectChanges();
    };
    return { fixture, el, click, component: fixture.componentInstance };
  };

  it('opens on the first ship and shows its hardpoints and roster', () => {
    const { el } = render();
    expect(el.querySelector('.sc__title')?.textContent?.trim()).toBe('Home Guard');
    expect(el.querySelectorAll('.sc-ship').length).toBe(3);
    expect(el.querySelector('.sc-ship--selected .sc-ship__name')?.textContent).toContain('#1');
    expect(el.querySelector('.bp-slot--weapon .bp-slot__module')?.textContent?.trim()).toBe('Railgun');
    expect(el.querySelector('.bp-slot--engine .bp-slot__module')?.textContent?.trim()).toBe('Standard Engine');
  });

  it('installs a picked module after CONFIRM, and only when it is in the inventory', () => {
    const { el, click, component } = render();
    const installs: unknown[] = [];
    component.install.subscribe((r) => installs.push(r));

    click('.bp-slot--defense');
    click('.sc-module', 'Energy Shield');
    expect(el.querySelector('.sc-compare__blocker')?.textContent).toContain('None in the inventory');
    expect((el.querySelector('.sc-compare__actions .btn-primary') as HTMLButtonElement).disabled).toBe(true);

    click('.bp-slot--weapon');
    click('.sc-module', 'Laser Cannon');
    expect(el.querySelector('.sc-compare__table')?.textContent).toContain('Damage type');
    click('.sc-compare__actions .btn-primary');
    expect(installs).toEqual([{ shipId: 1, moduleId: 'laser_cannon' }]);
  });

  it('removes an upgrade back to the standard module', () => {
    const { click, component } = render();
    const removals: unknown[] = [];
    component.uninstall.subscribe((r) => removals.push(r));
    click('.bp-slot--weapon');
    click('.sc-module--remove');
    click('.sc-compare__actions .btn-primary');
    expect(removals).toEqual([{ shipId: 1, slot: 'weapon' }]);
  });

  it('locks weapon and defense hardpoints on civil hulls', () => {
    const { el, click } = render();
    click('.sc-ship', 'Colonizer');
    expect((el.querySelector('.bp-slot--weapon') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('.bp-slot--engine') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('.bp__civil')).not.toBeNull();
  });

  it('peels Escape back: pick, slot, then close', () => {
    const { click, component, fixture } = render();
    let closed = 0;
    component.close.subscribe(() => closed++);
    click('.bp-slot--weapon');
    click('.sc-module', 'Laser Cannon');
    const esc = () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
    };
    esc();
    expect(component.candidateId).toBeNull();
    expect(component.selectedSlot).toBe('weapon');
    esc();
    expect(component.selectedSlot).toBeNull();
    expect(closed).toBe(0);
    esc();
    expect(closed).toBe(1);
  });
});

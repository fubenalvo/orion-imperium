import { TestBed } from '@angular/core/testing';
import { StarMapFleetInfoComponent } from './star-map-fleet-info.component';
import { Fleet } from '../star-map.models';

describe('StarMapFleetInfoComponent move feedback', () => {
  const fleet: Fleet = {
    id: 1,
    name: 'ORION',
    factionId: 'player',
    x: 1,
    y: 1,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships: [],
  };

  const render = (moveError: string | null, isPlayerFleet = true): HTMLElement => {
    const fixture = TestBed.createComponent(StarMapFleetInfoComponent);
    fixture.componentRef.setInput('fleet', fleet);
    fixture.componentRef.setInput('isPlayerFleet', isPlayerFleet);
    fixture.componentRef.setInput('moveError', moveError);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows the rejection reason next to the fleet actions', () => {
    const message = render('Cannot move onto an allied planet.').querySelector('.fleet-info__move-error');
    expect(message?.textContent?.trim()).toBe('Cannot move onto an allied planet.');
  });

  it('renders no message when the last move was accepted', () => {
    expect(render(null).querySelector('.fleet-info__move-error')).toBeNull();
  });
});

describe('StarMapFleetInfoComponent speed', () => {
  const fleetWith = (ships: Fleet['ships']): Fleet => ({
    id: 1,
    name: 'ORION',
    factionId: 'player',
    x: 1,
    y: 1,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships,
  });

  const speedText = (fleet: Fleet): string => {
    const fixture = TestBed.createComponent(StarMapFleetInfoComponent);
    fixture.componentRef.setInput('fleet', fleet);
    fixture.detectChanges();
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.ui-stat'));
    const row = rows.find((r) => r.querySelector('.ui-stat__label')?.textContent?.trim() === 'Speed');
    return row?.querySelector('.ui-stat__value')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  };

  it('shows the stored speed for standard engines', () => {
    expect(speedText(fleetWith([{ id: 1, name: 'S', type: 'cruiser' }]))).toBe('4');
  });

  it('shows the engine-adjusted speed with its base', () => {
    const ships = [
      { id: 1, name: 'S', type: 'cruiser', equipment: { engine: 'warp_drive' } },
      { id: 2, name: 'S', type: 'cruiser', equipment: { engine: 'ion_engine' } },
    ];
    expect(speedText(fleetWith(ships))).toBe('4.5 (base 4)');
  });
});

describe('StarMapFleetInfoComponent ship customization button', () => {
  const fleet: Fleet = {
    id: 1, name: 'ORION', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, system: null,
    ships: [{ id: 1, name: 'S', type: 'cruiser' }],
  };

  const render = (canCustomize: boolean) => {
    const fixture = TestBed.createComponent(StarMapFleetInfoComponent);
    fixture.componentRef.setInput('fleet', fleet);
    fixture.componentRef.setInput('isPlayerFleet', true);
    fixture.componentRef.setInput('canOrganize', true);
    fixture.componentRef.setInput('canCustomize', canCustomize);
    fixture.componentRef.setInput('customizeBlockedReason', canCustomize ? null : 'Move closer.');
    fixture.detectChanges();
    let opened = 0;
    fixture.componentInstance.customize.subscribe(() => opened++);
    const button = (fixture.nativeElement as HTMLElement).querySelector('.fleet-customize') as HTMLButtonElement;
    return { button, opened: () => opened };
  };

  it('opens the screen when the fleet is near an own Spaceport planet', () => {
    const { button, opened } = render(true);
    expect(button.disabled).toBe(false);
    button.click();
    expect(opened()).toBe(1);
  });

  it('is disabled with the reason elsewhere', () => {
    const { button } = render(false);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Move closer.');
  });
});

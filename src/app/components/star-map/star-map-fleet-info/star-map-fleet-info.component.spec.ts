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

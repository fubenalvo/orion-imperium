import { TestBed } from '@angular/core/testing';
import { FleetShipComponent } from './fleet-ship.component';

describe('FleetShipComponent', () => {
  function render(heading: number, thrusting: boolean): HTMLElement {
    const fixture = TestBed.createComponent(FleetShipComponent);
    fixture.componentRef.setInput('heading', heading);
    fixture.componentRef.setInput('thrusting', thrusting);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('rotates the hull and its engine trail together', () => {
    const el = render(135, true);
    const ship = el.querySelector('.ship') as HTMLElement;
    expect(ship.style.transform).toBe('rotate(135deg)');
    // The trail is inside the rotated element, so it follows the heading.
    expect(ship.querySelector('.ship__engine')).not.toBeNull();
    expect(ship.querySelector('img.ship__hull')).not.toBeNull();
    expect(ship.classList).toContain('ship--thrusting');
  });

  it('switches the engine trail off for a stationary fleet', () => {
    const el = render(0, false);
    expect(el.querySelector('.ship')?.classList).not.toContain('ship--thrusting');
  });
});

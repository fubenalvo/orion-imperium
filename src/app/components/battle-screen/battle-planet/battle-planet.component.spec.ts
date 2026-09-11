import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BattlePlanetComponent } from './battle-planet.component';

describe('BattlePlanetComponent', () => {
  let fixture: ComponentFixture<BattlePlanetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BattlePlanetComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BattlePlanetComponent);
  });

  it('renders the planet name and color when a planet is provided', () => {
    fixture.componentRef.setInput('planet', { name: 'Mars', color: 'rgb(94, 26, 26)' });
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.battle-planet') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.getPropertyValue('--planet-color')).toBe('rgb(94, 26, 26)');
    expect(
      fixture.nativeElement.querySelector('.battle-planet__name')?.textContent,
    ).toContain('Mars');
  });

  it('renders nothing when no planet is provided', () => {
    fixture.componentRef.setInput('planet', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.battle-planet')).toBeNull();
  });

  it('renders the shared shield bubble only while the pool is non-empty', () => {
    fixture.componentRef.setInput('planet', { name: 'Mars', color: '#ffffff' });
    fixture.componentRef.setInput('shieldFraction', 0.5);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.battle-planet__shield')).toBeTruthy();

    fixture.componentRef.setInput('shieldFraction', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.battle-planet__shield')).toBeNull();
  });
});

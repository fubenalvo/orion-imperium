import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { UiSoundService } from './services/ui-sound.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  // Without this call no UI sound ever plays (the listeners are global).
  it('installs the UI sound listeners', () => {
    const install = vi.spyOn(TestBed.inject(UiSoundService), 'install');
    TestBed.createComponent(App);
    expect(install).toHaveBeenCalled();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StarMap } from './star-map';

describe('StarMap', () => {
  let component: StarMap;
  let fixture: ComponentFixture<StarMap>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StarMap],
    }).compileComponents();

    fixture = TestBed.createComponent(StarMap);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

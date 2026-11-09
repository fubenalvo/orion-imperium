import { TestBed } from '@angular/core/testing';
import { StarMapCampaignObjectivesComponent } from './star-map-campaign-objectives.component';
import { ObjectiveView } from '../../../campaign/campaign.service';

describe('StarMapCampaignObjectivesComponent', () => {
  const objectives: ObjectiveView[] = [
    { id: 'a', title: 'Scout Proxima', optional: false, status: 'active', progress: null },
    { id: 'b', title: 'Grow', optional: false, status: 'active', progress: { current: 800, target: 1500 } },
    { id: 'c', title: 'Old task', optional: false, status: 'done', progress: null },
    { id: 'd', title: 'Radar', optional: true, status: 'active', progress: null },
  ];

  it('groups main and optional objectives, shows progress and collapses', async () => {
    await TestBed.configureTestingModule({ imports: [StarMapCampaignObjectivesComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StarMapCampaignObjectivesComponent);
    fixture.componentRef.setInput('missionTitle', 'Proving Ground');
    fixture.componentRef.setInput('objectives', objectives);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.main.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(fixture.componentInstance.optional.map((o) => o.id)).toEqual(['d']);
    expect(element.textContent).toContain('800 / 1500');
    expect(element.querySelector('.objective--done .objective__marker')?.textContent).toBe('✓');

    (element.querySelector('.tracker__head') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('.tracker__list')).toBeNull();
    expect(element.querySelector('.tracker__eyebrow')?.textContent).toContain('OBJECTIVES · 2');
  });
});

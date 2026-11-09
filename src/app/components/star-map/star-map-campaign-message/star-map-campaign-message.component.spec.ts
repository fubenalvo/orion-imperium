import { TestBed } from '@angular/core/testing';
import { CampaignMessageVm, StarMapCampaignMessageComponent } from './star-map-campaign-message.component';

describe('StarMapCampaignMessageComponent', () => {
  const vm = (choices: CampaignMessageVm['choices']): CampaignMessageVm => ({
    eventId: 'e1', speakerName: 'Mission Control', speakerColor: '#8cc4ff', title: 'Signal', text: 'A signal.', choices,
  });

  const create = (model: CampaignMessageVm) => {
    const fixture = TestBed.createComponent(StarMapCampaignMessageComponent);
    fixture.componentRef.setInput('vm', model);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StarMapCampaignMessageComponent] }).compileComponents();
  });

  it('answers once, and ignores unavailable choices', () => {
    const fixture = create(vm([
      { id: 'a', label: 'Accept', consequences: 'x', disabled: false },
      { id: 'b', label: 'Refuse', consequences: 'y', disabled: true },
    ]));
    const sent: (string | null)[] = [];
    fixture.componentInstance.choose.subscribe((c) => sent.push(c));
    fixture.componentInstance.pick('b');
    fixture.componentInstance.pick('a');
    fixture.componentInstance.pick('a');
    expect(sent).toEqual(['a']);
  });

  it('offers CONTINUE for a message without choices and re-enables for the next message', () => {
    const fixture = create(vm([]));
    const sent: (string | null)[] = [];
    fixture.componentInstance.choose.subscribe((c) => sent.push(c));
    const button = (fixture.nativeElement as HTMLElement).querySelector('.message__actions button') as HTMLButtonElement;
    expect(button.textContent).toContain('CONTINUE');
    button.click();
    expect(sent).toEqual([null]);
    fixture.componentRef.setInput('vm', { ...vm([]), eventId: 'e2' });
    fixture.detectChanges();
    expect(fixture.componentInstance.answered).toBe(false);
  });
});

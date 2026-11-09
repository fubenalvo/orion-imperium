import { TestBed } from '@angular/core/testing';
import { CampaignScreenComponent } from './campaign-screen.component';
import { CampaignProgressService } from '../../campaign/campaign-progress.service';
import { SaveSlot } from '../../services/save-game.service';

describe('CampaignScreenComponent', () => {
  const emptySlots: SaveSlot[] = Array.from({ length: 5 }, () => ({ data: null, date: null }));

  const create = (setup?: (c: CampaignScreenComponent) => void) => {
    const fixture = TestBed.createComponent(CampaignScreenComponent);
    fixture.componentInstance.slots = emptySlots;
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [CampaignScreenComponent] }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('lists developer missions only when asked (dev builds)', () => {
    const screen = create().componentInstance;
    expect(screen.buildCards(false).some((c) => c.mission.devOnly)).toBe(false);
    expect(screen.buildCards(true).some((c) => c.mission.id === 'm0_fixture')).toBe(true);
  });

  it('starts the selected mission with the chosen difficulty and the first empty manual slot', () => {
    const fixture = create((c) => (c.initialMissionId = 'm0_fixture'));
    const screen = fixture.componentInstance;
    screen.cards = screen.buildCards(true);
    screen.selectedId = 'm0_fixture';
    const emitted: unknown[] = [];
    screen.start.subscribe((r) => emitted.push(r));
    screen.setDifficulty('hard');
    screen.onStart();
    expect(emitted).toEqual([{ missionId: 'm0_fixture', difficulty: 'hard', slotIndex: 1 }]);
  });

  it('shows a completed mission with its ending and defaults the difficulty to the last one used', () => {
    TestBed.inject(CampaignProgressService).recordCompletion('m0_fixture', {
      endingId: 'cleared', difficulty: 'easy', records: {}, researchedTechnologies: [],
    });
    const screen = create().componentInstance;
    const card = screen.buildCards(true).find((c) => c.mission.id === 'm0_fixture')!;
    expect(card.status).toBe('completed');
    expect(card.endingTitle).toBe('Range Cleared');
    expect(screen.difficulty).toBe('easy');
  });

  it('never starts a locked mission', () => {
    const screen = create().componentInstance;
    const locked = { ...screen.buildCards(true)[0], status: 'locked' as const };
    screen.cards = [locked];
    screen.selectedId = null;
    screen.select(locked);
    expect(screen.selectedId).toBeNull();
    expect(screen.canStart).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { Faction } from './star-map.models';
import { CONTACT_POOLS, SIGNATURE_QUESTIONS } from './contact-dialogue';
import {
  aiReplyIndex,
  aiStance,
  chooseQuestions,
  evaluateContact,
  isWarlikeTemperament,
  temperamentOf,
} from './first-contact';
import { AI_PERSONALITIES, WARLIKE_PERSONALITIES } from './ai-personality';
import { isWarlikePersonality } from './enemy-diplomacy.service';
import { getRelationKind, inContact, normalizeRelations } from './diplomacy';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { FirstContactService } from './first-contact.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';

/* First contact (docs/first-contact.md). */
describe('first contact rules', () => {
  const faction = (id: string, personality?: string): Faction =>
    ({ id, name: id, color: '#fff', team: id === 'player' ? 1 : 2, ai: id !== 'player', aiPersonality: personality, currencies: {} }) as Faction;

  it('keeps the warlike list in step with the diplomacy profiles', () => {
    for (const personality of AI_PERSONALITIES) {
      expect(WARLIKE_PERSONALITIES.includes(personality), personality).toBe(isWarlikePersonality(personality));
      expect(isWarlikeTemperament(personality), personality).toBe(isWarlikePersonality(personality));
    }
  });

  it('has five questions with three replies per temperament, and campaign signature questions', () => {
    for (const [temperament, pool] of Object.entries(CONTACT_POOLS)) {
      expect(pool.questions.length, temperament).toBe(5);
      for (const q of pool.questions) expect(q.replies.map((r) => r.tone).sort(), q.id).toEqual(['hard', 'neutral', 'open']);
    }
    expect(Object.keys(SIGNATURE_QUESTIONS).sort()).toEqual(['concordium', 'meridian', 'observers', 'varkon']);
  });

  it('asks the same two questions in the same reply order for the same game, and a signature question first', () => {
    const asker = faction('enemy1', 'technologist');
    const player = faction('player');
    expect(chooseQuestions(asker, player, 42)).toEqual(chooseQuestions(asker, player, 42));
    expect(chooseQuestions(asker, player, 42).questions.length).toBe(2);
    expect(chooseQuestions(faction('varkon', 'militarist'), player, 42).questions[0].id).toBe('sig_varkon');
    expect(temperamentOf(player)).toBe('balanced');
  });

  const base = { replyValues: [0, 0], stance: 'cautious' as const, giftTier: 0, strengthRatio: 1, territoriesClose: false, roll: 0 };

  it('gives peaceful temperaments peace, a cold peace or war by disposition', () => {
    expect(evaluateContact({ ...base, temperament: 'technologist' })).toMatchObject({ outcome: 'peace', opinion: 20 });
    expect(evaluateContact({ ...base, temperament: 'balanced', replyValues: [-10, -12], stance: 'cautious' }).outcome).toBe('cold_peace');
    expect(evaluateContact({ ...base, temperament: 'balanced', replyValues: [-10, -12], stance: 'warning' }).outcome).toBe('war');
  });

  it('makes peace with warlike temperaments rare: a typical meeting is war, the best case a small chance', () => {
    expect(evaluateContact({ ...base, temperament: 'militarist', replyValues: [10, 10] }).outcome).toBe('war');
    const best = { ...base, temperament: 'militarist', replyValues: [10, 10], stance: 'warning' as const, giftTier: 3, strengthRatio: 4 };
    const result = evaluateContact({ ...best, roll: 0 });
    expect(result.disposition).toBeCloseTo(11, 5);
    expect(result.outcome, 'a lucky roll').toBe('cold_peace');
    expect(evaluateContact({ ...best, roll: 0.07 }).outcome, 'the chance is about 6%').toBe('war');
    const expansionist = evaluateContact({ ...best, temperament: 'expansionist', roll: 0.15 });
    expect(expansionist.outcome, 'about 16% for an expansionist').toBe('cold_peace');
    expect(evaluateContact({ ...best, temperament: 'expansionist', roll: 0.2 }).outcome).toBe('war');
  });

  it('lets AIs answer in character', () => {
    const question = CONTACT_POOLS['militarist'].questions[0];
    expect(question.replies[aiReplyIndex(question, 'militarist')].tone).toBe('hard');
    expect(question.replies[aiReplyIndex(question, 'technologist')].tone).toBe('open');
    expect(aiStance('expansionist')).toBe('warning');
    expect(aiStance('technologist')).toBe('welcome');
  });

  it('treats pairs without the contact flag (older saves) as met', () => {
    const a = faction('enemy1');
    const b = faction('enemy2');
    b.team = 3;
    normalizeRelations([a, b]);
    expect(inContact(a, b)).toBe(true);
    a.relations!['enemy2'].contact = false;
    normalizeRelations([a, b]);
    expect(b.relations!['enemy1'].contact, 'symmetric').toBe(false);
    expect(inContact(a, b)).toBe(false);
  });
});

describe('first contact in a StarMap skirmish', () => {
  const createStarMap = (): StarMap => {
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };
  const run = (map: StarMap, seconds: number, dt = 0.25) => {
    for (let t = 0; t < seconds; t += dt) map['gameLoopCallback'](dt);
  };
  const start = (): StarMap => {
    expect(TestBed.inject(NewGameService).startNewGame({ ...createDefaultNewGameConfig('small'), seed: 2026, tutorial: false }, 1).ok).toBe(true);
    return createStarMap();
  };
  const meetFirstAi = (map: StarMap) => {
    const ai = map.factions.find((f) => f.ai)!;
    const home = map.starSystems.find((s) => s.planetsTiles.some((p) => p.factionId === ai.id))!;
    const scout = map.fleets.find((f) => f.factionId === 'player')!;
    Object.assign(scout, { system: null, x: home.x + 1, y: home.y, targetX: null, targetY: null });
    return ai;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with every empire unknown, at peace, and off the Diplomacy screen', () => {
    const map = start();
    const ai = map.factions.find((f) => f.ai)!;
    expect(map.getFactionName(ai.id)).toBe('Unknown');
    expect(getRelationKind(map.factions.find((f) => f.id === 'player')!, ai)).toBe('peace');
    expect(map.getDiplomacyRows().length).toBe(0);
  });

  it('opens the contact dialogue once on a sighting, pauses, and applies the answer', () => {
    const map = start();
    const ai = meetFirstAi(map);
    run(map, 1.5);
    expect(map.contactDialogue?.factionId).toBe(ai.id);
    expect(TestBed.inject(GameTimeService).isPaused).toBe(true);
    expect(map.contactDialogue!.questions.length).toBe(2);

    map.onContactAnswer({ replies: [0, 0], stance: 'welcome', giftTier: 0 });
    expect(map.contactResult).not.toBeNull();
    const player = map.factions.find((f) => f.id === 'player')!;
    expect(inContact(player, ai)).toBe(true);
    expect(map.getFactionName(ai.id)).toBe(ai.name);
    expect(map.getDiplomacyRows().map((r) => r.id)).toContain(ai.id);
    map.onContactClose();
    expect(map.contactDialogue).toBeNull();

    run(map, 3);
    expect(map.contactDialogue, 'never twice').toBeNull();
    const saved = TestBed.inject(SaveGameService).loadFromSlot(SaveSlotId.AUTOSAVE)!;
    expect(saved.factions.find((f) => f.id === 'player')!.relations![ai.id].contact).toBeUndefined();
  });

  it('asks again after a reload when the meeting was not answered', () => {
    const map = start();
    meetFirstAi(map);
    run(map, 1.5);
    expect(map.contactDialogue).not.toBeNull();
    map['saveGame']();
    const reloaded = createStarMap();
    expect(reloaded.contactDialogue).toBeNull();
    run(reloaded, 1.5);
    expect(reloaded.contactDialogue).not.toBeNull();
  });

  it('lets AI empires meet each other on their own', () => {
    const map = start();
    const [a, b] = map.factions.filter((f) => f.ai);
    const fleetA = map.fleets.find((f) => f.factionId === a.id)!;
    const homeB = map.starSystems.find((s) => s.planetsTiles.some((p) => p.factionId === b.id))!;
    Object.assign(fleetA, { system: null, x: homeB.x + 1, y: homeB.y, targetX: null, targetY: null });
    TestBed.inject(FirstContactService).tick(2, { factions: map.factions, fleets: map.fleets, starSystems: map.starSystems, seed: 2026 });
    expect(inContact(a, b)).toBe(true);
  });
});

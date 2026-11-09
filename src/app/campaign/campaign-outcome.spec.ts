import { GameOutcomeService } from '../services/game-outcome.service';
import { buildMission } from './mission-builder';
import { M0_FIXTURE } from './missions/m0-fixture';

/* GameOutcomeService rule 1a: the mission decides a campaign game (docs/campaign-design.md §12). */
describe('GameOutcomeService with a campaign mission', () => {
  const build = () => buildMission(M0_FIXTURE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  it('stays in progress where the standard rules would declare victory', () => {
    const data = build();
    const service = new GameOutcomeService();
    expect(service.evaluate(data)).toBe('inProgress');
    delete data.campaign;
    expect(service.evaluate(data), 'the same world as a normal game').toBe('victory');
  });

  it('returns the saved mission outcome', () => {
    const data = build();
    data.campaign!.outcome = { kind: 'defeat', reason: 'x' };
    expect(new GameOutcomeService().evaluate(data)).toBe('defeat');
    data.campaign!.outcome = { kind: 'victory', endingId: 'cleared' };
    expect(new GameOutcomeService().evaluate(data)).toBe('victory');
  });

  it('still ends a mission by elimination', () => {
    const data = build();
    for (const planet of data.starSystems.flatMap((s) => s.planetsTiles)) planet.factionId = 'unhabited';
    expect(new GameOutcomeService().evaluate(data)).toBe('defeat');
  });

  it('accepts the standard victory when the mission allows it', () => {
    const data = build();
    data.campaign!.rules.standardVictory = true;
    expect(new GameOutcomeService().evaluate(data)).toBe('victory');
  });
});

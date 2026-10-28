import { describe, it, expect } from 'vitest';
import { StarMapData } from '../components/star-map/star-map.models';
import { GalaxyGeneratorService } from './galaxy-generator.service';
import { validateGeneratedGalaxy } from './galaxy-validation';
import { createDefaultNewGameConfig } from './new-game-config';

const config = createDefaultNewGameConfig('medium');
const fresh = (): StarMapData => new GalaxyGeneratorService().generate(config, 2024);

function errorsAfter(mutate: (data: StarMapData) => void): string {
  const data = fresh();
  mutate(data);
  return validateGeneratedGalaxy(data, config).errors.join('\n');
}

describe('validateGeneratedGalaxy', () => {
  it('accepts a freshly generated galaxy', () => {
    expect(validateGeneratedGalaxy(fresh(), config)).toEqual({ ok: true, errors: [] });
  });

  it('detects duplicate ids', () => {
    expect(errorsAfter((d) => (d.starSystems[1].id = d.starSystems[0].id))).toContain('duplicate star system id');
    expect(
      errorsAfter((d) => (d.starSystems[1].planetsTiles[0].id = d.starSystems[0].planetsTiles[0].id)),
    ).toContain('duplicate planet id');
    expect(errorsAfter((d) => (d.fleets[1].ships[0].id = d.fleets[0].ships[0].id))).toContain('duplicate ship id');
    expect(
      errorsAfter((d) => (d.starSystems[1].planetsTiles[0].name = d.starSystems[0].planetsTiles[0].name)),
    ).toContain('duplicate planet name');
  });

  it('detects invalid faction references', () => {
    expect(errorsAfter((d) => (d.fleets[0].factionId = 'ghost'))).toContain('unknown faction "ghost"');
    expect(errorsAfter((d) => (d.starSystems[0].planetsTiles[0].factionId = 'ghost'))).toContain('unknown faction');
  });

  it('detects a missing homeworld or starting fleet', () => {
    expect(
      errorsAfter((d) => {
        for (const p of d.starSystems.flatMap((s) => s.planetsTiles)) {
          if (p.factionId === 'enemy1') p.factionId = 'unhabited';
        }
      }),
    ).toContain('"enemy1" has no homeworld');
    expect(errorsAfter((d) => (d.fleets = d.fleets.filter((f) => f.factionId !== 'enemy2')))).toContain(
      '"enemy2" has no starting fleet',
    );
  });

  it('detects invalid coordinates and black hole problems', () => {
    expect(errorsAfter((d) => (d.starSystems[0].x = d.map.width + 5))).toContain('invalid coordinates');
    expect(
      errorsAfter((d) => {
        d.fleets[0].x = d.map.width / 2;
        d.fleets[0].y = d.map.height / 2;
      }),
    ).toContain('inside the black hole clearance');
    expect(errorsAfter((d) => (d.specialObjects![0].x += 1))).toContain('not the map center');
    expect(errorsAfter((d) => (d.specialObjects = []))).toContain('exactly one black hole');
  });

  it('detects incorrect player assignments', () => {
    expect(errorsAfter((d) => (d.factions.find((f) => f.id === 'player')!.ai = true))).toContain('"player" must exist');
    expect(errorsAfter((d) => (d.factions.find((f) => f.id === 'enemy1')!.name = 'Wrong'))).toContain('name mismatch');
    expect(errorsAfter((d) => (d.factions.find((f) => f.id === 'enemy1')!.aiDifficulty = 'hard'))).toContain(
      'difficulty mismatch',
    );
    expect(errorsAfter((d) => (d.defaultView = { type: 'planet', systemId: 'nowhere', planetId: 1 }))).toContain(
      'defaultView',
    );
  });

  it('detects invalid buildings', () => {
    expect(
      errorsAfter((d) => d.starSystems[0].planetsTiles[0].buildings.push({ name: 'Death Star', size: 1, x: 8, y: 8 })),
    ).toContain('unknown building');
    expect(
      errorsAfter((d) =>
        d.starSystems[0].planetsTiles[0].buildings.push({ name: 'Laser Turret', size: 1, x: 0, y: 0 }),
      ),
    ).toContain('overlapping');
  });
});

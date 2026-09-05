import { describe, it, expect, beforeEach } from 'vitest';
import { SaveGameService } from './save-game.service';
import { StarMapData, Faction } from '../components/star-map/star-map.models';

describe('SaveGameService — research migration', () => {
  let service: SaveGameService;

  beforeEach(() => {
    service = new SaveGameService();
  });

  const makeData = (overrides: Partial<StarMapData> = {}): StarMapData => ({
    factions: [
      {
        id: 'player',
        name: 'Player',
        color: '#8cc4ff',
        team: 1,
        currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
      } as Faction,
      {
        id: 'enemy1',
        name: 'Enemy 1',
        color: '#d65757',
        team: 2,
        currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
      } as Faction,
    ],
    map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [],
    fleets: [],
    ...overrides,
  });

  it('should backfill researchedTechnologies with starting techs for factions that lack the field', () => {
    const data = makeData();
    const migrated = service.migrateSave(data);

    for (const faction of migrated.factions) {
      expect(faction.researchedTechnologies).toEqual([
        'basic_engineering',
        'basic_science',
        'basic_industry',
        'basic_power',
      ]);
    }
  });

  it('should not overwrite existing researchedTechnologies', () => {
    const data = makeData({
      factions: [
        {
          id: 'player',
          name: 'Player',
          color: '#8cc4ff',
          team: 1,
          currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
          researchedTechnologies: ['basic_engineering'],
        } as Faction,
      ],
    });
    const migrated = service.migrateSave(data);

    expect(migrated.factions[0].researchedTechnologies).toEqual(['basic_engineering']);
  });

  it('should preserve other migration behaviors', () => {
    const data = makeData({
      shipStock: undefined,
      production: undefined,
      starSystems: [
        {
          id: 'sol',
          name: 'SOL',
          x: 1,
          y: 1,
          planets: 1,
          color: '#ffcc00',
          planetsTiles: [
            {
              id: 1,
              index: 1,
              name: 'Earth',
              factionId: 'player',
              x: 1,
              y: 1,
              type: 'earthlike',
              size: 'medium',
              population: 100,
              buildings: [],
              explored: true,
            },
          ],
        },
      ],
    });
    const migrated = service.migrateSave(data);

    expect(migrated.shipStock).toEqual([]);
    expect(migrated.production).toEqual([]);
    expect(migrated.starSystems[0].planetsTiles[0].resourceTiles).toEqual([]);
  });
});

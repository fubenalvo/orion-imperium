import { describe, it, expect, beforeEach } from 'vitest';
import { ResearchService } from './research.service';
import { Faction } from '../components/star-map/star-map.models';

describe('ResearchService', () => {
  let service: ResearchService;
  let player: Faction;

  beforeEach(() => {
    service = new ResearchService();
    player = {
      id: 'player',
      name: 'Player',
      color: '#8cc4ff',
      team: 1,
      currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
      researchedTechnologies: undefined,
    };
  });

  describe('getAllTechnologies / getTechnology', () => {
    it('should return all technologies from the JSON', () => {
      const all = service.getAllTechnologies();
      expect(all.length).toBeGreaterThanOrEqual(12);
    });

    it('should return a technology by id', () => {
      const tech = service.getTechnology('basic_engineering');
      expect(tech).toBeDefined();
      expect(tech!.name).toBe('Basic Engineering');
    });

    it('should return undefined for unknown ids', () => {
      expect(service.getTechnology('does_not_exist')).toBeUndefined();
    });
  });

  describe('starting technologies', () => {
    it('should return the four starting tech ids', () => {
      const starting = service.getStartingTechnologyIds();
      expect(starting).toEqual([
        'basic_engineering',
        'basic_science',
        'basic_industry',
        'basic_power',
      ]);
    });

    it('should be considered researched when present on the faction', () => {
      player.researchedTechnologies = service.getStartingTechnologyIds();
      const starting = service.getStartingTechnologyIds();
      for (const id of starting) {
        expect(service.isResearched(player, id)).toBe(true);
      }
    });
  });

  describe('getStatus', () => {
    it('returns researched for already-researched tech', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.getStatus(player, 'basic_engineering')).toBe('researched');
    });

    it('returns locked when prerequisites are missing', () => {
      expect(service.getStatus(player, 'advanced_engineering')).toBe('locked');
    });

    it('returns available when prerequisites are met', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.getStatus(player, 'advanced_engineering')).toBe('available');
    });

    it('returns locked for unknown technology ids', () => {
      expect(service.getStatus(player, 'unknown_tech')).toBe('locked');
    });
  });

  describe('canResearch', () => {
    it('returns false if already researched', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.canResearch(player, 'basic_engineering')).toBe(false);
    });

    it('returns false if prerequisites are missing', () => {
      expect(service.canResearch(player, 'advanced_engineering')).toBe(false);
    });

    it('returns false if research points are insufficient', () => {
      player.researchedTechnologies = ['basic_engineering'];
      player.currencies['research'] = 10;
      expect(service.canResearch(player, 'advanced_engineering')).toBe(false);
    });

    it('returns true when prerequisites and cost are satisfied', () => {
      player.researchedTechnologies = ['basic_engineering'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'advanced_engineering')).toBe(true);
    });
  });

  describe('researchTechnology', () => {
    it('deducts the correct research cost and marks as researched', () => {
      player.researchedTechnologies = ['basic_engineering'];
      player.currencies['research'] = 1000;

      const result = service.researchTechnology(player, 'advanced_engineering');
      expect(result.ok).toBe(true);
      expect(result.technology!.id).toBe('advanced_engineering');
      expect(player.currencies['research']).toBe(1000 - 150);
      expect(player.researchedTechnologies).toContain('advanced_engineering');
    });

    it('fails if already researched', () => {
      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering'];
      const result = service.researchTechnology(player, 'advanced_engineering');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('already_researched');
    });

    it('fails if prerequisites are missing', () => {
      const result = service.researchTechnology(player, 'advanced_engineering');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('prerequisites_missing');
    });

    it('fails if research points are insufficient', () => {
      player.researchedTechnologies = ['basic_engineering'];
      player.currencies['research'] = 10;
      const result = service.researchTechnology(player, 'advanced_engineering');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('insufficient_research');
    });
  });

  describe('isShipUnlocked', () => {
    it('returns true when an unlocking tech is researched', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'scout')).toBe(true);
      expect(service.isShipUnlocked(player, 'fighter')).toBe(true);
    });

    it('returns false when no researched tech unlocks the ship', () => {
      player.researchedTechnologies = ['basic_science'];
      expect(service.isShipUnlocked(player, 'scout')).toBe(false);
    });

    it('returns false when nothing is researched', () => {
      expect(service.isShipUnlocked(player, 'scout')).toBe(false);
    });
  });

  describe('isBuildingUnlocked', () => {
    it('returns true when an unlocking tech is researched', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isBuildingUnlocked(player, 'spaceship_factory')).toBe(true);
      expect(service.isBuildingUnlocked(player, 'spaceport')).toBe(true);
    });

    it('returns false when no researched tech unlocks the building', () => {
      player.researchedTechnologies = ['basic_science'];
      expect(service.isBuildingUnlocked(player, 'spaceship_factory')).toBe(false);
    });

    it('returns false when nothing is researched', () => {
      expect(service.isBuildingUnlocked(player, 'spaceship_factory')).toBe(false);
    });
  });
});

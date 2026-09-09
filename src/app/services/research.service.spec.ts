import { describe, it, expect, beforeEach } from 'vitest';
import { ResearchService, ValidationError } from './research.service';
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

    it('returns available for starting technologies with no prerequisites', () => {
      expect(service.getStatus(player, 'basic_engineering')).toBe('available');
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

    it('returns true for colonizer when basic_engineering is researched', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });

    it('returns true for corvette when advanced_engineering is researched', () => {
      player.researchedTechnologies = ['advanced_engineering'];
      expect(service.isShipUnlocked(player, 'corvette')).toBe(true);
    });

    it('returns true for destroyer when military_engineering is researched', () => {
      player.researchedTechnologies = ['military_engineering'];
      expect(service.isShipUnlocked(player, 'destroyer')).toBe(true);
    });

    it('returns true for cruiser when advanced_shipyards is researched', () => {
      player.researchedTechnologies = ['advanced_shipyards'];
      expect(service.isShipUnlocked(player, 'cruiser')).toBe(true);
    });

    it('returns true for dreadnought when capital_ship_technology is researched', () => {
      player.researchedTechnologies = ['capital_ship_technology'];
      expect(service.isShipUnlocked(player, 'dreadnought')).toBe(true);
    });

    it('returns true for colonizer via colonization_technology', () => {
      player.researchedTechnologies = ['colonization_technology'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
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

    it('returns true for medium_residential when advanced_construction is researched', () => {
      player.researchedTechnologies = ['advanced_construction'];
      expect(service.isBuildingUnlocked(player, 'medium_residential')).toBe(true);
    });

    it('returns true for large_residential when urban_infrastructure is researched', () => {
      player.researchedTechnologies = ['urban_infrastructure'];
      expect(service.isBuildingUnlocked(player, 'large_residential')).toBe(true);
    });

    it('returns true for fusion_plant when fusion_power is researched', () => {
      player.researchedTechnologies = ['fusion_power'];
      expect(service.isBuildingUnlocked(player, 'fusion_plant')).toBe(true);
    });

    it('returns true for research_lab when advanced_research is researched', () => {
      player.researchedTechnologies = ['advanced_research'];
      expect(service.isBuildingUnlocked(player, 'research_lab')).toBe(true);
    });
  });

  describe('getSensorRangeBonus', () => {
    it('returns 0 when no bonus techs are researched', () => {
      player.researchedTechnologies = [];
      expect(service.getSensorRangeBonus(player)).toBe(0);
    });

    it('returns the correct bonus for a single researched radar tech', () => {
      player.researchedTechnologies = ['basic_radar'];
      expect(service.getSensorRangeBonus(player)).toBe(1);
    });

    it('returns the sum of all researched sensorRange bonuses', () => {
      player.researchedTechnologies = ['basic_radar', 'advanced_radar', 'long_range_radar'];
      expect(service.getSensorRangeBonus(player)).toBe(3);
    });

    it('ignores techs without sensorRange bonuses', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.getSensorRangeBonus(player)).toBe(0);
    });

    it('returns 0 when researchedTechnologies is undefined', () => {
      player.researchedTechnologies = undefined;
      expect(service.getSensorRangeBonus(player)).toBe(0);
    });
  });

  describe('multiple prerequisites', () => {
    it('cannot research urban_infrastructure with only one prerequisite', () => {
      player.researchedTechnologies = ['advanced_construction'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'urban_infrastructure')).toBe(false);
    });

    it('cannot research urban_infrastructure with the other prerequisite only', () => {
      player.researchedTechnologies = ['advanced_manufacturing'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'urban_infrastructure')).toBe(false);
    });

    it('can research urban_infrastructure when both prerequisites are met', () => {
      player.researchedTechnologies = ['advanced_construction', 'advanced_manufacturing'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'urban_infrastructure')).toBe(true);
    });

    it('cannot research colonization_technology with only one prerequisite', () => {
      player.researchedTechnologies = ['advanced_construction'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'colonization_technology')).toBe(false);
    });

    it('can research colonization_technology when both prerequisites are met', () => {
      player.researchedTechnologies = ['advanced_construction', 'advanced_science'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'colonization_technology')).toBe(true);
    });
  });

  describe('residential progression', () => {
    it('medium_residential unlock requires advanced_construction', () => {
      player.researchedTechnologies = ['basic_engineering'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'advanced_construction')).toBe(false);
    });

    it('medium_residential is unlocked after advanced_construction is researched', () => {
      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering', 'advanced_construction'];
      expect(service.isBuildingUnlocked(player, 'medium_residential')).toBe(true);
    });

    it('large_residential requires urban_infrastructure', () => {
      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering', 'advanced_construction'];
      player.currencies['research'] = 1000;
      expect(service.canResearch(player, 'urban_infrastructure')).toBe(false);
    });

    it('large_residential is unlocked after urban_infrastructure is researched', () => {
      player.researchedTechnologies = [
        'basic_engineering',
        'advanced_engineering',
        'advanced_construction',
        'advanced_industry',
        'advanced_manufacturing',
        'urban_infrastructure',
      ];
      expect(service.isBuildingUnlocked(player, 'large_residential')).toBe(true);
    });
  });

  describe('ship progression', () => {
    it('scout and fighter available from basic_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'scout')).toBe(true);
      expect(service.isShipUnlocked(player, 'fighter')).toBe(true);
    });

    it('corvette and frigate require advanced_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'corvette')).toBe(false);
      expect(service.isShipUnlocked(player, 'frigate')).toBe(false);

      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering'];
      expect(service.isShipUnlocked(player, 'corvette')).toBe(true);
      expect(service.isShipUnlocked(player, 'frigate')).toBe(true);
    });

    it('destroyer requires military_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'destroyer')).toBe(false);

      player.researchedTechnologies = ['basic_engineering', 'military_engineering'];
      expect(service.isShipUnlocked(player, 'destroyer')).toBe(true);
    });

    it('cruiser and carrier require advanced_shipyards', () => {
      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering', 'orbital_engineering'];
      expect(service.isShipUnlocked(player, 'cruiser')).toBe(false);
      expect(service.isShipUnlocked(player, 'carrier')).toBe(false);

      player.researchedTechnologies.push('advanced_shipyards');
      expect(service.isShipUnlocked(player, 'cruiser')).toBe(true);
      expect(service.isShipUnlocked(player, 'carrier')).toBe(true);
    });

    it('battleship, battlecruiser, dreadnought require capital_ship_technology', () => {
      player.researchedTechnologies = ['basic_engineering', 'military_engineering', 'advanced_weapons'];
      expect(service.isShipUnlocked(player, 'battleship')).toBe(false);
      expect(service.isShipUnlocked(player, 'battlecruiser')).toBe(false);
      expect(service.isShipUnlocked(player, 'dreadnought')).toBe(false);

      player.researchedTechnologies.push('capital_ship_technology');
      expect(service.isShipUnlocked(player, 'battleship')).toBe(true);
      expect(service.isShipUnlocked(player, 'battlecruiser')).toBe(true);
      expect(service.isShipUnlocked(player, 'dreadnought')).toBe(true);
    });

    it('colonizer is unlockable via basic_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });

    it('colonizer is also unlockable via colonization_technology', () => {
      player.researchedTechnologies = ['colonization_technology'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });
  });

  describe('validation', () => {
    it('returns no structural errors for the current tree', () => {
      const errors = service.getValidationErrors();
      const duplicateIds = errors.filter((e) => e.type === 'duplicate_id');
      const missingPrereqs = errors.filter((e) => e.type === 'missing_prerequisite');
      const selfRefs = errors.filter((e) => e.type === 'self_reference');
      const circulars = errors.filter((e) => e.type === 'circular_dependency');
      const invalidShips = errors.filter((e) => e.type === 'invalid_ship');
      const invalidBuildings = errors.filter((e) => e.type === 'invalid_building');
      expect(duplicateIds).toHaveLength(0);
      expect(missingPrereqs).toHaveLength(0);
      expect(selfRefs).toHaveLength(0);
      expect(circulars).toHaveLength(0);
      expect(invalidShips).toHaveLength(0);
      expect(invalidBuildings).toHaveLength(0);
    });
  });

  describe('save/load compatibility', () => {
    it('preserves existing researched technologies after loading', () => {
      player.researchedTechnologies = [
        'basic_engineering',
        'basic_science',
        'basic_industry',
        'basic_power',
        'advanced_engineering',
      ];
      expect(service.isResearched(player, 'basic_engineering')).toBe(true);
      expect(service.isResearched(player, 'advanced_engineering')).toBe(true);
      expect(service.isResearched(player, 'unknown_tech')).toBe(false);
    });

    it('does not break when researchedTechnologies is undefined', () => {
      player.researchedTechnologies = undefined;
      expect(service.getResearchedTechnologies(player)).toEqual([]);
      expect(service.isResearched(player, 'basic_engineering')).toBe(false);
      expect(service.getStatus(player, 'basic_engineering')).toBe('available');
    });
  });

  describe('AI compatibility', () => {
    it('basic_engineering remains a valid prerequisite for AI colonization', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isResearched(player, 'basic_engineering')).toBe(true);
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });

    it('colonizer remains unlockable via basic_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });

    it('colonizer is also unlockable via colonization_technology with prerequisites', () => {
      player.researchedTechnologies = ['basic_engineering', 'advanced_engineering', 'advanced_construction', 'advanced_science', 'colonization_technology'];
      expect(service.isShipUnlocked(player, 'colonizer')).toBe(true);
    });
  });

  describe('building unlocks', () => {
    it('unlocks spaceship_factory from basic_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isBuildingUnlocked(player, 'spaceship_factory')).toBe(true);
    });

    it('unlocks spaceport from basic_engineering', () => {
      player.researchedTechnologies = ['basic_engineering'];
      expect(service.isBuildingUnlocked(player, 'spaceport')).toBe(true);
    });

    it('unlocks solar_array from basic_power', () => {
      player.researchedTechnologies = ['basic_power'];
      expect(service.isBuildingUnlocked(player, 'solar_array')).toBe(true);
    });

    it('unlocks fusion_plant from fusion_power', () => {
      player.researchedTechnologies = ['fusion_power'];
      expect(service.isBuildingUnlocked(player, 'fusion_plant')).toBe(true);
    });

    it('unlocks small_research_lab from basic_science', () => {
      player.researchedTechnologies = ['basic_science'];
      expect(service.isBuildingUnlocked(player, 'small_research_lab')).toBe(true);
    });

    it('unlocks research_lab from advanced_research', () => {
      player.researchedTechnologies = ['advanced_research'];
      expect(service.isBuildingUnlocked(player, 'research_lab')).toBe(true);
    });

    it('unlocks planetary_shield from military_engineering', () => {
      player.researchedTechnologies = ['military_engineering'];
      expect(service.isBuildingUnlocked(player, 'planetary_shield')).toBe(true);
    });

    it('unlocks entertainment_center from advanced_industry', () => {
      player.researchedTechnologies = ['advanced_industry'];
      expect(service.isBuildingUnlocked(player, 'entertainment_center')).toBe(true);
    });
  });
});

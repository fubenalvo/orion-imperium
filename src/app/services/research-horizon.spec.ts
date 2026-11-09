import { TestBed } from '@angular/core/testing';
import { Faction, Technology } from '../components/star-map/star-map.models';
import { RESEARCH_TECHNOLOGIES, ResearchService } from './research.service';

/*
 * Research horizon and campaign-only technologies (docs/campaign-design.md
 * §14). A small fake tree, because the shipped tree has no campaign-only
 * entries yet.
 */
const tech = (id: string, prerequisites: string[] = [], campaignOnly = false): Technology => ({
  id, name: id, description: '', researchCost: 100, prerequisites, unlocksShips: [], unlocksBuildings: [],
  ...(campaignOnly ? { campaignOnly: true } : {}),
});

const TREE: Technology[] = [
  tech('basic_engineering'),
  tech('radar', ['basic_engineering']),
  tech('deep_radar', ['radar']),
  tech('ancient_lattice', [], true),
];

describe('ResearchService research horizon', () => {
  let research: ResearchService;
  const faction = (researched: string[] = ['basic_engineering']): Faction => ({
    id: 'player', name: 'P', color: '#fff', team: 1, currencies: { research: 10_000, credits: 100_000 }, researchedTechnologies: [...researched],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: RESEARCH_TECHNOLOGIES, useValue: TREE }] });
    research = TestBed.inject(ResearchService);
  });

  it('hides campaign-only technologies outside a campaign: not listed, not available, not researchable', () => {
    expect(research.getAllTechnologies().map((t) => t.id)).not.toContain('ancient_lattice');
    expect(research.isAvailable(faction(), 'ancient_lattice')).toBe(false);
    const f = faction();
    expect(research.researchTechnology(f, 'ancient_lattice')).toMatchObject({ ok: false, reason: 'outside_horizon' });
    expect(research.getStatus(f, 'ancient_lattice')).toBe('locked');
  });

  it('allows only horizon technologies during a campaign, plus per-faction extras', () => {
    research.setCampaignHorizon({ technologies: ['basic_engineering', 'radar'], extras: { player: ['deep_radar'] } });
    const f = faction(['basic_engineering', 'radar']);
    const other = { ...faction(['basic_engineering', 'radar']), id: 'varkon' };
    expect(research.canResearch(f, 'deep_radar')).toBe(true);
    expect(research.getResearchBlocker(other, 'deep_radar')).toBe('outside_horizon');
    expect(research.getStatus(other, 'deep_radar')).toBe('locked');
    expect(research.researchTechnology(other, 'deep_radar').ok).toBe(false);
    expect(research.getAllTechnologies().length, 'a campaign session lists the whole tree').toBe(TREE.length);
  });

  it('always treats owned technologies as available, so granted and carried ones stay visible', () => {
    research.setCampaignHorizon({ technologies: ['basic_engineering'] });
    const f = faction(['basic_engineering', 'ancient_lattice']);
    expect(research.isAvailable(f, 'ancient_lattice')).toBe(true);
    expect(research.getStatus(f, 'ancient_lattice')).toBe('researched');
  });

  it('restores the standard tree when the horizon is cleared', () => {
    research.setCampaignHorizon({ technologies: ['basic_engineering'] });
    expect(research.isAvailable(faction(), 'radar')).toBe(false);
    research.setCampaignHorizon(null);
    expect(research.isAvailable(faction(), 'radar')).toBe(true);
    expect(research.hasCampaignHorizon()).toBe(false);
  });
});

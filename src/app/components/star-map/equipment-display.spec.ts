import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { Fleet } from './star-map.models';
import { getFleetShipTypeSummary, getFleetTotalAttack, getFleetTotalDefense } from './star-map-display.util';
import { FleetOrganizationDraft } from './star-map-fleet-manager/fleet-organization-draft';
import { StarMapResearchTreeComponent } from './star-map-research-tree/star-map-research-tree.component';
import { ResearchService } from '../../services/research.service';

/*
 * Phase 7 of docs/ship-equipment.md: displays that summarize ships show
 * installed equipment (fleet panel ATK/DEF, Fleet Command marker, research
 * effect icons).
 */

const fleet = (ships: Fleet['ships']): Fleet => ({
  id: 1, name: 'F', factionId: 'player', x: 1, y: 1, targetX: null, targetY: null, speed: 4, system: null, ships,
});

describe('fleet panel ATK / DEF with equipment', () => {
  it('equals the hull values for standard ships', () => {
    const f = fleet([{ id: 1, name: 'S', type: 'cruiser' }, { id: 2, name: 'S', type: 'fighter' }]);
    expect(getFleetTotalAttack(f)).toBe(66 + 15);
    expect(getFleetTotalDefense(f)).toBe(14 + 3);
    expect(getFleetShipTypeSummary(f).map((r) => [r.typeId, r.count, r.attack, r.defense])).toEqual([
      ['cruiser', 1, 66, 14],
      ['fighter', 1, 15, 3],
    ]);
  });

  it('adds module values, and averages a type with mixed equipment', () => {
    const f = fleet([
      { id: 1, name: 'S', type: 'cruiser', equipment: { weapon: 'railgun', defense: 'kinetic_barrier' } },
      { id: 2, name: 'S', type: 'cruiser' },
    ]);
    expect(getFleetTotalAttack(f)).toBe(66 * 2 + 16);
    expect(getFleetTotalDefense(f)).toBe(14 * 2 + 6);
    expect(getFleetShipTypeSummary(f)).toEqual([{ typeId: 'cruiser', typeName: 'Cruiser', count: 2, attack: 74, defense: 17 }]);
  });
});

describe('Fleet Command refitted marker', () => {
  it('counts ships of a class with at least one upgrade, reserve included', () => {
    const f = fleet([
      { id: 1, name: 'S', type: 'cruiser', equipment: { engine: 'warp_drive' } },
      { id: 2, name: 'S', type: 'cruiser', equipment: { weapon: 'standard_weapon' } },
      { id: 3, name: 'S', type: 'scout' },
    ]);
    const draft = new FleetOrganizationDraft([f], [], [{ id: 9, type: 'cruiser', name: 'S', equipment: { weapon: 'railgun' } }]);
    const groups = draft.groups(draft.fleets[0]);
    expect(groups.map((g) => [g.typeId, g.upgraded])).toEqual([
      ['cruiser', 1],
      ['scout', 0],
    ]);
    expect(draft.groups(draft.reserve!)[0].upgraded).toBe(1);
  });
});

describe('research effect icons', () => {
  it('give the equipment line its own icon so bonus icons stay aligned', () => {
    TestBed.configureTestingModule({});
    const component = TestBed.createComponent(StarMapResearchTreeComponent).componentInstance;
    const tech = TestBed.inject(ResearchService).getTechnology('advanced_weapons')!;
    const rows = component.getEffectRows(tech);
    expect(rows.map((r) => r.text)[0]).toContain('Unlocks ship equipment: Point-Defense Array');
    expect(rows[0].icon).toBe('weapons');
    // The bonus lines that follow keep their own categories.
    expect(rows.length).toBe(1 + (tech.bonuses?.length ?? 0));
  });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EnemyProgressService } from './enemy-progress.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { EnemyPlanService } from './enemy-plan.service';
import { ActionResult, Faction, Fleet, StarSystem } from './star-map.models';

/* Deadlock detectors driven with hand-made state, one simulated second per step. */
describe('EnemyProgressService', () => {
  let service: EnemyProgressService;
  let goals: EnemyGoalService;
  let fleetOps: EnemyFleetService;
  let plan: EnemyPlanService;

  const faction: Faction = { id: 'enemy1', name: 'E', color: '#f00', team: 2, ai: true, currencies: {}, researchedTechnologies: [] };
  const systems: StarSystem[] = [{ id: 's', name: 's', x: 10, y: 10, planets: 1, color: '#fff', planetsTiles: [] }];

  const run = (seconds: number, action: ActionResult | undefined, fleets: Fleet[] = [], pipeline: number[] = [], executed = false) => {
    for (let t = 0; t < seconds; t++) {
      service.recordExecution('enemy1', action, executed);
      service.tick(1, faction, { starSystems: systems, fleets, shipStock: [] }, action, new Set(pipeline));
    }
  };

  const action = (type: ActionResult['type'], reason: string): ActionResult => ({
    type, factionId: 'enemy1', goalType: 'attack', goal: { type: 'attack', targetFleetId: 9 }, reason,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyProgressService);
    goals = TestBed.inject(EnemyGoalService);
    fleetOps = TestBed.inject(EnemyFleetService);
    plan = TestBed.inject(EnemyPlanService);
  });

  it('abandons a primary goal whose action stays "none" for the same reason', () => {
    const abandon = vi.spyOn(goals, 'abandonGoal');
    run(55, action('none', 'target_too_strong'));
    expect(abandon).not.toHaveBeenCalled();
    run(20, action('none', 'target_too_strong'));
    expect(abandon).toHaveBeenCalledWith('enemy1', 'primary');
    expect(service.getEvents().map((e) => e.type)).toEqual(['no_valid_action']);
  });

  it('replans an assembly that never succeeds, but not one that did', () => {
    const abandon = vi.spyOn(goals, 'abandonGoal');
    run(100, { ...action('assemble_fleet', 'Colonizer in stock but no fleet has it'), goalType: 'colonize' }, [], [], true);
    expect(abandon).not.toHaveBeenCalled();
    service.reset();
    run(100, { ...action('assemble_fleet', 'Colonizer in stock but no fleet has it'), goalType: 'colonize' });
    expect(abandon).toHaveBeenCalledWith('enemy1', 'primary');
    expect(service.getEvents().some((e) => e.type === 'repeated_failure')).toBe(true);
  });

  it('releases a managed fleet whose order cannot be carried out (it does not move)', () => {
    const fleet: Fleet = { id: 4, name: 'F', factionId: 'enemy1', x: 5, y: 5, targetX: 20, targetY: 20, speed: 0, system: null, ships: [{ id: 1, name: 'f', type: 'frigate' }] };
    const release = vi.spyOn(fleetOps, 'releaseFleet');
    run(45, undefined, [fleet]);
    expect(release).toHaveBeenCalledWith(fleet);
    expect(service.getEvents().filter((e) => e.type === 'stuck_fleet')).toHaveLength(1);
  });

  it('a moving fleet is never reported stuck', () => {
    const fleet: Fleet = { id: 4, name: 'F', factionId: 'enemy1', x: 5, y: 5, targetX: 100, targetY: 5, speed: 4, system: null, ships: [{ id: 1, name: 'f', type: 'frigate' }] };
    for (let t = 0; t < 60; t++) {
      fleet.x += 0.2;
      service.tick(1, faction, { starSystems: systems, fleets: [fleet], shipStock: [] }, undefined, new Set());
    }
    expect(service.getEvents()).toEqual([]);
  });

  it('distinguishes stagnation with opportunities (replan) from saturation (no replan)', () => {
    const abandon = vi.spyOn(goals, 'abandonGoal');
    const posture = plan.getPosture(faction);
    vi.spyOn(plan, 'getPosture').mockReturnValue({ ...posture, scores: { economy: 0, defense: 0, expansion: 0, offense: 0, research: 0 } });
    run(260, undefined);
    expect(service.getEvents().map((e) => e.type)).toEqual(['saturated']);
    expect(abandon).not.toHaveBeenCalled();

    vi.spyOn(plan, 'getPosture').mockReturnValue({ ...posture, scores: { economy: 0, defense: 0, expansion: 1, offense: 0, research: 0 } });
    run(260, undefined);
    expect(service.getEvents().some((e) => e.type === 'stagnation')).toBe(true);
    expect(abandon).toHaveBeenCalledWith('enemy1', 'colonization');
  });

  it('replans at most once per cooldown', () => {
    run(300, action('none', 'stuck'));
    expect(service.getEvents().filter((e) => e.type === 'no_valid_action').length).toBeLessThanOrEqual(5);
  });
});

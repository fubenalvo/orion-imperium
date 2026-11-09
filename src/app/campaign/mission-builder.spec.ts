import { validateSaveData } from '../services/save-validation';
import { SaveGameService } from '../services/save-game.service';
import { TestBed } from '@angular/core/testing';
import { MissionDefinition } from './campaign.models';
import { buildMission, playerStartingTechnologies } from './mission-builder';
import { validateCampaign, validateMission } from './mission-validation';
import { MISSION_DEFINITIONS } from './missions';
import { M0_FIXTURE } from './missions/m0-fixture';

const noCarry = { flags: {}, technologies: [] };

/* A fixture variant with two AI empires, for relation and faction rules. */
function withAis(): MissionDefinition {
  const mission = structuredClone(M0_FIXTURE);
  mission.id = 'm0_ais';
  mission.map.factions.push(
    { id: 'concordium', name: 'The Concordium', color: '#39b8a8', kind: 'ai', personality: 'technologist', currencies: { credits: 1000, rawmaterials: 1000, research: 0 } },
    { id: 'varkon', name: 'Varkon Dominion', color: '#d65757', kind: 'ai', personality: 'militarist', difficulty: 'hard', currencies: { credits: 1000, rawmaterials: 1000, research: 0 } },
  );
  mission.map.systems[1].planets[0].owner = 'concordium';
  mission.map.relations = [
    { a: 'player', b: 'concordium', state: 'peace', opinion: 20 },
    { a: 'player', b: 'varkon', state: 'peace', opinion: -10, opinionBA: -30 },
    { a: 'concordium', b: 'varkon', state: 'war' },
  ];
  return mission;
}

describe('mission builder', () => {
  it('builds the same save twice from the same definition (deterministic replays)', () => {
    const a = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: noCarry });
    const b = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: noCarry });
    expect(a).toEqual(b);
  });

  it('builds a save that passes the save validation and survives normalizeSave', () => {
    const data = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: noCarry });
    expect(validateSaveData(data).errors).toEqual([]);
    const normalized = TestBed.inject(SaveGameService).normalizeSave(structuredClone(data));
    expect(normalized.anomalies?.anomalies, 'no random anomalies in a mission').toEqual([]);
    expect(normalized.campaign).toEqual(data.campaign);
  });

  it('has no black hole (Dyson off), places the player fleet at its planet and tags fleets', () => {
    const data = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: noCarry });
    expect(data.specialObjects).toEqual([]);
    const orion = data.fleets.find((f) => f.name === 'ORION')!;
    expect(orion.system?.id).toBe('sol');
    expect([orion.x, orion.y]).toEqual([25, 32]);
    const sentinel = data.fleets.find((f) => f.name === 'SENTINEL')!;
    expect(data.campaign!.fleetTags['sentinel']).toEqual([sentinel.id]);
    expect(data.factions.find((f) => f.id === 'remnant')).toMatchObject({ outlaw: true, team: 0, ai: false });
    const earth = data.starSystems[0].planetsTiles[0];
    expect(earth.buildings.map((b) => b.name)).toContain('Capital');
    expect(earth.rawDeposit?.remaining, 'starting deposit').toBeGreaterThan(0);
  });

  it('writes authored relations on both sides and never leaves a pair at the default war', () => {
    const data = buildMission(withAis(), { difficulty: 'easy', carry: noCarry });
    const byId = new Map(data.factions.map((f) => [f.id, f]));
    expect(byId.get('player')!.relations!['concordium']).toMatchObject({ state: 'peace', opinion: 20 });
    expect(byId.get('varkon')!.relations!['player']).toMatchObject({ state: 'peace', opinion: -30 });
    expect(byId.get('concordium')!.relations!['varkon'].state).toBe('war');
    expect(byId.get('concordium')!.aiDifficulty, 'campaign difficulty').toBe('easy');
    expect(byId.get('varkon')!.aiDifficulty, 'pinned difficulty').toBe('hard');
    expect(byId.get('varkon')!.team).not.toBe(byId.get('concordium')!.team);
  });

  it('starts the player with the basics, the baseline and only the carried technologies inside the horizon', () => {
    const mission = { ...M0_FIXTURE, baselineTechnologies: ['improved_power'] };
    const techs = playerStartingTechnologies(mission, ['basic_radar', 'advanced_engineering']);
    expect(techs).toEqual(expect.arrayContaining(['basic_engineering', 'improved_power', 'basic_radar']));
    expect(techs).not.toContain('advanced_engineering');
    const data = buildMission(mission, { difficulty: 'normal', carry: { flags: { met: true }, technologies: ['basic_radar'] } });
    expect(data.factions.find((f) => f.id === 'player')!.researchedTechnologies).toContain('basic_radar');
    expect(data.campaign!.flags['met']).toBe(true);
    expect(data.campaign!.carry).toEqual({ flags: { met: true }, technologies: ['basic_radar'] });
  });
});

describe('mission validation', () => {
  it('accepts every registered mission and the campaign order', () => {
    for (const mission of MISSION_DEFINITIONS) expect(validateMission(mission)).toEqual([]);
    expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
    expect(validateMission(withAis())).toEqual([]);
  });

  it('reports a missing relation pair, which would otherwise default to war', () => {
    const mission = withAis();
    mission.map.relations.pop();
    expect(validateMission(mission).some((e) => e.includes('concordium–varkon is missing'))).toBe(true);
  });

  it('reports unknown references in objectives, effects and fleets', () => {
    const mission = structuredClone(M0_FIXTURE);
    mission.objectives[0].after = ['nope'];
    mission.objectives[0].onComplete = [{ kind: 'event', eventId: 'missing_event' }];
    mission.objectives[1].condition = { kind: 'system_charted', systemId: 'atlantis' };
    mission.map.fleets[0].ships.push('warp_gate');
    const errors = validateMission(mission).join('\n');
    expect(errors).toContain('unknown "nope"');
    expect(errors).toContain('unknown event "missing_event"');
    expect(errors).toContain('unknown system "atlantis"');
    expect(errors).toContain('unknown ship type "warp_gate"');
  });

  it('requires a prerequisite-closed horizon with the basics, and cumulative horizons across missions', () => {
    const mission = structuredClone(M0_FIXTURE);
    mission.researchHorizon = ['basic_engineering', 'advanced_radar'];
    const errors = validateMission(mission).join('\n');
    expect(errors).toContain('lacks the starting technology "basic_science"');
    expect(errors).toContain('needs "basic_radar"');
    const next = { ...structuredClone(M0_FIXTURE), id: 'm0_next', requires: ['m0_fixture'], researchHorizon: ['basic_engineering'] };
    expect(validateCampaign([M0_FIXTURE, next]).join('\n')).toContain('drops "basic_science"');
  });

  it('rejects a map that is not 5:3, systems that are too close and belts that cut a start off', () => {
    const mission = structuredClone(M0_FIXTURE);
    mission.map.height = 61;
    mission.map.systems[1].x = 30;
    mission.map.systems[1].y = 30;
    expect(validateMission(mission).join('\n')).toMatch(/5:3[\s\S]*too close/);

    const walled = structuredClone(M0_FIXTURE);
    // A vertical wall from edge to edge between Sol and Proxima.
    walled.map.asteroidBelts = [{ id: 1, points: [{ x: 48, y: -5 }, { x: 48, y: 70 }], halfWidth: 2, visualSeed: 1 }];
    expect(validateMission(walled).join('\n')).toContain('no route from "sol" to "proxima"');
  });
});

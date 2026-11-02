import { TestBed } from '@angular/core/testing';
import { StarMapSystemInfoComponent, getSystemStatus } from './star-map-system-info.component';
import { PlanetTile, StarSystem } from '../star-map.models';

describe('StarMapSystemInfoComponent status', () => {
  const planet = (id: number, factionId: string, explored: boolean): PlanetTile =>
    ({ id, index: id, name: `P${id}`, factionId, explored } as PlanetTile);

  const system = (planetsTiles: PlanetTile[]): StarSystem => ({
    id: 'sol',
    name: 'Sol',
    x: 10,
    y: 10,
    planets: planetsTiles.length,
    color: '#fff',
    // Every generated system has this set; the status must not rely on it.
    explored: true,
    planetsTiles,
  });

  const factionName = (id: string): string => (id === 'vega' ? 'Vega Dominion' : id);

  const renderStatus = (sys: StarSystem, charted: boolean): string => {
    const fixture = TestBed.createComponent(StarMapSystemInfoComponent);
    fixture.componentRef.setInput('system', sys);
    fixture.componentRef.setInput('charted', charted);
    fixture.componentRef.setInput('getFactionName', factionName);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector('.system-info__status');
    return el?.textContent?.trim() ?? '';
  };

  it('shows the home system as the player\'s own from the first frame', () => {
    // Not charted yet: ownership alone is enough.
    const home = system([planet(1, 'player', true), planet(2, 'unhabited', false)]);
    expect(renderStatus(home, false)).toBe('YOUR SYSTEM');
  });

  it('shows an uncharted system as unexplored', () => {
    expect(renderStatus(system([planet(1, 'vega', false)]), false)).toBe('UNEXPLORED');
  });

  it('changes once a player fleet has charted the system', () => {
    const sys = system([planet(1, 'vega', false), planet(2, 'unhabited', false)]);
    expect(renderStatus(sys, false)).toBe('UNEXPLORED');
    expect(renderStatus(sys, true)).toBe('EXPLORED');
  });

  it('reveals a foreign owner only through explored planets', () => {
    expect(getSystemStatus(system([planet(1, 'vega', false)]), true, factionName).label).toBe('Explored');
    expect(getSystemStatus(system([planet(1, 'vega', true)]), true, factionName)).toEqual({
      label: 'Vega Dominion',
      tone: 'foreign',
    });
  });

  it('marks a system with several known owners as contested', () => {
    const sys = system([planet(1, 'player', true), planet(2, 'vega', true)]);
    expect(getSystemStatus(sys, true, factionName).tone).toBe('contested');
  });
});

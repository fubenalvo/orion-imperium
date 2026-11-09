import { StarMapFleetButtonsComponent, RosterPlanet } from './star-map-fleet-buttons.component';
import { StarSystem } from '../star-map.models';

describe('StarMapFleetButtonsComponent planet steppers', () => {
  const system = {
    id: 'sol',
    planetsTiles: [
      { id: 1, factionId: 'player' },
      { id: 2, factionId: 'ai1' },
      { id: 3, factionId: 'player' },
    ],
  } as unknown as StarSystem;

  function roster(selectedPlanetId: number | null): { component: StarMapFleetButtonsComponent; opened: number[] } {
    const component = new StarMapFleetButtonsComponent();
    component.systems = [system];
    component.selectedPlanetId = selectedPlanetId;
    const opened: number[] = [];
    component.openPlanet.subscribe((entry: RosterPlanet) => opened.push(entry.planet.id));
    return { component, opened };
  }

  it('steps through own planets only and wraps around', () => {
    const { component, opened } = roster(3);
    component.step(1);
    component.step(-1);
    expect(opened).toEqual([1, 1]);
  });

  it('steps from a planet outside the list to the first or last own planet', () => {
    const { component, opened } = roster(2);
    component.step(1);
    component.step(-1);
    expect(opened).toEqual([1, 3]);
  });

  it('hides fleets when showFleets is off', () => {
    const { component } = roster(1);
    component.fleets = [{ id: 7, factionId: 'player' } as never];
    component.showFleets = false;
    expect(component.playerFleets).toEqual([]);
  });
});

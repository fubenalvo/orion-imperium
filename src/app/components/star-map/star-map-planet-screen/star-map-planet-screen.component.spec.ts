import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StarMapPlanetScreenComponent } from './star-map-planet-screen.component';
import { PlanetTile, ResourceDeposit } from '../star-map.models';
import { CommonModule } from '@angular/common';

describe('StarMapPlanetScreenComponent', () => {
  let component: StarMapPlanetScreenComponent;
  let fixture: ComponentFixture<StarMapPlanetScreenComponent>;

  const mockPlanet: PlanetTile = {
    id: 1,
    index: 1,
    name: 'Test Planet',
    factionId: 'player',
    x: 0,
    y: 0,
    type: 'earthlike',
    size: 'medium',
    population: 100,
    buildings: [],
    explored: true,
    resourceTiles: [{ type: 'rawmaterial', x: 2, y: 1 }],
  };

  const buildingTypes = [
    {
      id: 'mining_complex',
      name: 'Mining Complex',
      role: 'industry',
      price: 100,
      size: 3,
      maintenanceCost: 20,
      population: 0,
      workforce: 80,
      moraleRate: -1,
      energyConsumption: 20,
      energyProduction: 0,
      production: { rawmaterials: 5 },
      consumption: { energy: 20 },
      defense: null,
    },
    {
      id: 'small_residential',
      name: 'Small Residential Block',
      role: 'housing',
      price: 100,
      size: 1,
      maintenanceCost: 3,
      population: 100,
      workforce: 2,
      moraleRate: 0,
      energyConsumption: 3,
      energyProduction: 0,
      production: {},
      consumption: { energy: 3 },
      defense: null,
    },
  ] as any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, StarMapPlanetScreenComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StarMapPlanetScreenComponent);
    component = fixture.componentInstance;
    component.planet = mockPlanet;
    component.gridSize = 9;
    (component as any).buildingTypes = buildingTypes;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('isResourceTile', () => {
    it('should return true for a cell that contains a resource deposit', () => {
      expect(component.isResourceTile(1, 2)).toBe(true);
    });

    it('should return false for a cell without a resource deposit', () => {
      expect(component.isResourceTile(0, 0)).toBe(false);
    });
  });

  describe('updatePreview - Mine placement', () => {
    it('should be valid when Mine footprint touches a resource tile', () => {
      component.selectBuildingType('mining_complex');
      component.onCellClick(1, 1);
      expect(component.isPreviewValid).toBe(true);
      expect(component.buildError).toBe('');
    });

    it('should be invalid when Mine footprint does not touch any resource tile', () => {
      component.selectBuildingType('mining_complex');
      component.onCellClick(5, 5);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toContain('near a raw material deposit');
    });
  });

  describe('updatePreview - other buildings', () => {
    it('should be invalid when another building overlaps a resource tile', () => {
      component.selectBuildingType('small_residential');
      component.onCellClick(1, 2);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toContain('Cannot build directly on a resource deposit');
    });

    it('should be valid when another building does not overlap a resource tile', () => {
      component.selectBuildingType('small_residential');
      component.onCellClick(0, 0);
      expect(component.isPreviewValid).toBe(true);
      expect(component.buildError).toBe('');
    });
  });

  describe('updatePreview - existing rules', () => {
    it('should still reject placements outside grid bounds', () => {
      component.selectBuildingType('small_residential');
      component.onCellClick(9, 9);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toBe('This area does not fit the building.');
    });

    it('should still reject placements overlapping existing buildings', () => {
      mockPlanet.buildings = [{ name: 'Large Residential Block', size: 3, x: 0, y: 0 }];
      component.selectBuildingType('small_residential');
      component.onCellClick(0, 0);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toBe('Area overlaps with existing buildings.');
    });
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  PLANET_SURFACE_ZOOM_SCALES,
  StarMapPlanetScreenComponent,
} from './star-map-planet-screen.component';
import { PlanetTile, ResourceDeposit } from '../star-map.models';
import { CommonModule } from '@angular/common';
import { encodeBlockedMask } from '../planet-surface/planet-surface';

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
      requiresOreProximity: true,
    },
    {
      id: 'spaceship_factory',
      name: 'Spaceship Factory',
      role: 'industry',
      price: 100,
      size: 3,
      maintenanceCost: 30,
      population: 0,
      workforce: 100,
      moraleRate: -0.02,
      energyConsumption: 30,
      energyProduction: 0,
      production: { rawmaterials: 10 },
      consumption: { energy: 30 },
      defense: null,
      requiresOreProximity: false,
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
    (component as any)._buildingTypes = buildingTypes;
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

  describe('updatePreview - Factory placement', () => {
    it('should be valid when Factory footprint is away from resource tiles', () => {
      component.selectBuildingType('spaceship_factory');
      component.onCellClick(5, 5);
      expect(component.isPreviewValid).toBe(true);
      expect(component.buildError).toBe('');
    });

    it('should be invalid when Factory footprint overlaps a resource tile', () => {
      component.selectBuildingType('spaceship_factory');
      component.onCellClick(1, 2);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toContain('Cannot build directly on a resource deposit');
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

  describe('surface zoom levels', () => {
    const zoomButtons = (): HTMLButtonElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.planet-surface__zoom-btn'));

    it('opens at the MEDIUM zoom level', () => {
      expect(component.zoomLevel).toBe('medium');
      const active = fixture.nativeElement.querySelector('.planet-surface__zoom-btn--active');
      expect(active.textContent.trim()).toBe('MEDIUM');
      expect(component.cameraTransform).toContain(`scale(${PLANET_SURFACE_ZOOM_SCALES.medium})`);
    });

    it('keeps CLOSE at the unscaled cell size', () => {
      expect(PLANET_SURFACE_ZOOM_SCALES.close).toBe(1);
      component.setZoomLevel('close');
      expect(component.cameraTransform).toBe('translate(0vw, 0vw) scale(1)');
    });

    it('orders the levels CLOSE > MEDIUM > FAR in scale', () => {
      expect(PLANET_SURFACE_ZOOM_SCALES.close).toBeGreaterThan(PLANET_SURFACE_ZOOM_SCALES.medium);
      expect(PLANET_SURFACE_ZOOM_SCALES.medium).toBeGreaterThan(PLANET_SURFACE_ZOOM_SCALES.far);
    });

    it('keeps an even step between consecutive levels', () => {
      const closeToMedium = PLANET_SURFACE_ZOOM_SCALES.medium / PLANET_SURFACE_ZOOM_SCALES.close;
      const mediumToFar = PLANET_SURFACE_ZOOM_SCALES.far / PLANET_SURFACE_ZOOM_SCALES.medium;
      expect(mediumToFar).toBeCloseTo(closeToMedium, 2);
    });

    it('switches level through the buttons, repeatedly, marking exactly one active', () => {
      const labels = ['CLOSE', 'MEDIUM', 'FAR'];
      for (let round = 0; round < 3; round++) {
        for (const label of [...labels, ...[...labels].reverse()]) {
          zoomButtons().find((b) => b.textContent!.trim() === label)!.click();
          fixture.detectChanges();
          const active = fixture.nativeElement.querySelectorAll('.planet-surface__zoom-btn--active');
          expect(active.length).toBe(1);
          expect(active[0].textContent.trim()).toBe(label);
          expect(component.zoomLevel).toBe(label.toLowerCase());
        }
      }
    });

    it('does not touch planet data when zooming', () => {
      const before = JSON.stringify(mockPlanet);
      component.setZoomLevel('far');
      component.setZoomLevel('close');
      expect(JSON.stringify(mockPlanet)).toBe(before);
    });

    it('rescales the pan offset so the viewed point stays centered', () => {
      component.setZoomLevel('close');
      component.scrollX = 4;
      component.scrollY = -2;
      // jsdom has no layout, so disable clamping to observe the raw rescale.
      (component as any).updateClamp = () => {};
      component.setZoomLevel('far');
      expect(component.scrollX).toBeCloseTo(4 * PLANET_SURFACE_ZOOM_SCALES.far);
      expect(component.scrollY).toBeCloseTo(-2 * PLANET_SURFACE_ZOOM_SCALES.far);
    });

    it('resets to MEDIUM when a different planet is shown', () => {
      component.setZoomLevel('far');
      fixture.componentRef.setInput('planet', { ...mockPlanet, id: 2, name: 'Other' });
      fixture.detectChanges();
      expect(component.zoomLevel).toBe('medium');
    });

    it('keeps the chosen zoom when the same planet object is refreshed', () => {
      fixture.componentRef.setInput('planet', mockPlanet);
      fixture.detectChanges();
      component.setZoomLevel('far');
      fixture.componentRef.setInput('planet', { ...mockPlanet });
      fixture.detectChanges();
      expect(component.zoomLevel).toBe('far');
    });

    it('starts at MEDIUM again on a fresh component (planet view reopened)', () => {
      component.setZoomLevel('close');
      fixture.destroy();
      const reopened = TestBed.createComponent(StarMapPlanetScreenComponent);
      reopened.componentInstance.planet = mockPlanet;
      reopened.detectChanges();
      expect(reopened.componentInstance.zoomLevel).toBe('medium');
    });
  });

  describe('terrain obstacles', () => {
    // Tiny planet (10×10 grid): rows 0..2 of columns 7..9 are blocked by terrain.
    beforeEach(() => {
      const mask = new Uint8Array(10 * 10);
      for (let y = 0; y < 3; y++) for (let x = 7; x < 10; x++) mask[y * 10 + x] = 1;
      component.planet = {
        ...mockPlanet,
        id: 7,
        size: 'tiny',
        buildings: [],
        resourceTiles: [],
        surface: { version: 1, seed: 1, gridSize: 10, intrusion: 1, blocked: encodeBlockedMask(mask, 10) },
      };
      component.gridSize = 10;
    });

    it('reports blocked cells', () => {
      expect(component.isBlockedCell(0, 7)).toBe(true);
      expect(component.isBlockedCell(3, 7)).toBe(false);
    });

    it('rejects a footprint that touches a blocked cell', () => {
      component.selectBuildingType('spaceship_factory');
      component.onCellClick(1, 5);
      expect(component.isPreviewValid).toBe(false);
      expect(component.buildError).toBe('The terrain here is not suitable for construction.');
    });

    it('accepts the same building next to the obstacle', () => {
      component.selectBuildingType('spaceship_factory');
      component.onCellClick(3, 5);
      expect(component.isPreviewValid).toBe(true);
    });

    it('shows a ghost sprite of the previewed building', () => {
      component.selectBuildingType('small_residential');
      component.onCellClick(4, 4);
      const ghost = component.sprites.find((s) => s.kind === 'ghost');
      expect(ghost?.src).toBe('buildings-svg/small-residential.svg');
      component.exitBuildMode();
      expect(component.sprites.some((s) => s.kind === 'ghost')).toBe(false);
    });
  });

  describe('sprite depth order', () => {
    it('draws a 1×1 building in front of the 4×4 block it stands beside', () => {
      // The 1×1 at (4,0) touches the 4×4's +x side: it is in front even
      // though its front corner (x+y+2·size) is smaller than the 4×4's.
      fixture.componentRef.setInput('planet', {
        ...mockPlanet,
        id: 8,
        resourceTiles: [],
        buildings: [
          { name: 'Spaceport', size: 4, x: 0, y: 0 },
          { name: 'Laser Turret', size: 1, x: 4, y: 0 },
        ],
      });
      fixture.detectChanges();
      const big = component.sprites.find((s) => s.key === 'b0')!;
      const small = component.sprites.find((s) => s.key === 'b1')!;
      expect(small.z).toBeGreaterThan(big.z);
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

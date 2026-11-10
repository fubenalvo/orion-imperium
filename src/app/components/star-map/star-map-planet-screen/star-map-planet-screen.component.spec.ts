import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DEFAULT_PLANET_SURFACE_ZOOM,
  PLANET_SURFACE_ZOOM_MAX,
  PLANET_SURFACE_ZOOM_MIN,
  StarMapPlanetScreenComponent,
} from './star-map-planet-screen.component';
import { PlanetTile, ResourceDeposit } from '../star-map.models';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef } from '@angular/core';
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

  describe('construction sites', () => {
    // A fixture's root component gets no ngDoCheck from a parent: run the
    // scene refresh the way StarMap's change detection would.
    const render = () => {
      component.ngDoCheck();
      // The component's own view ref checks it unconditionally, like StarMap's
      // default change detection does every redraw.
      fixture.componentRef.injector.get(ChangeDetectorRef).detectChanges();
    };

    const withSite = (): PlanetTile => ({
      ...mockPlanet,
      buildings: [{
        name: 'Small Residential Block', size: 1, x: 4, y: 4,
        constructionRemaining: 15, constructionTotal: 30, constructionPaid: { credits: 600, rawmaterials: 150 },
      }],
    });

    it('draws a site as a construction site on the surface, not as a finished sprite', () => {
      fixture.componentRef.setInput('planet', withSite());
      render();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('.construction-site')).toHaveLength(1);
      expect(el.querySelector('.construction-site__scaffold')).not.toBeNull();
      expect(el.querySelector('.construction-site')!.getAttribute('style')).toContain('--progress: 0.5');
      expect(el.querySelectorAll('.planet-surface__sprite:not(.planet-surface__sprite--deposit)')).toHaveLength(0);
    });

    it('swaps the site for the finished sprite once it completes', () => {
      const planet = withSite();
      fixture.componentRef.setInput('planet', planet);
      render();
      delete planet.buildings[0].constructionRemaining;
      render();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('.construction-site')).toHaveLength(0);
      expect(el.querySelectorAll('.planet-surface__sprite:not(.planet-surface__sprite--deposit)')).toHaveLength(1);
    });

    it('lists the site on the BUILD tab with progress, time left, status and cost; cancel asks StarMap', () => {
      fixture.componentRef.setInput('planet', withSite());
      fixture.componentRef.setInput('getConstructionSpeed', () => 1);
      component.setTab('build');
      render();
      const el: HTMLElement = fixture.nativeElement;
      const entry = el.querySelector('.construction-entry')!;
      expect(entry.textContent).toContain('Small Residential Block');
      expect(entry.textContent).toContain('50%');
      expect(entry.textContent).toContain('0:15 left');
      expect(entry.textContent).toContain('BUILDING');
      expect(entry.textContent).toContain('Paid 600 CR');
      const emitted: { x: number; y: number }[] = [];
      component.cancelConstruction.subscribe((e) => emitted.push(e));
      (entry.querySelector('.construction-entry__cancel') as HTMLButtonElement).click();
      expect(emitted).toEqual([{ x: 4, y: 4 }]);
    });

    it('shows PAUSED and freezes the site animation while the game is paused', () => {
      fixture.componentRef.setInput('planet', withSite());
      fixture.componentRef.setInput('isPaused', true);
      component.setTab('build');
      render();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.construction-entry__status')!.textContent).toContain('PAUSED');
      expect(el.querySelector('.construction-site--paused')).not.toBeNull();
    });

    it('the remaining time follows the planet construction speed', () => {
      fixture.componentRef.setInput('planet', withSite());
      component.getConstructionSpeed = () => 1.5;
      expect(component.constructionSiteViews[0].secondsLeft).toBe(10);
      expect(component.constructionSpeedPercent).toBe(150);
    });
  });

  describe('build-list info box', () => {
    const residential = () => buildingTypes.find((b: { id: string }) => b.id === 'small_residential');

    it('opens one box at a time and starts placement at once when buildable', () => {
      component.getBuildBlocker = () => null;
      component.toggleBuildingInfo(residential());
      expect(component.expandedBuildingId).toBe('small_residential');
      expect(component.isBuildMode).toBe(true);
      expect(component.selectedBuildingType?.id).toBe('small_residential');

      component.toggleBuildingInfo(buildingTypes[0]);
      expect(component.expandedBuildingId).toBe(buildingTypes[0].id);
      expect(component.selectedBuildingType?.id).toBe(buildingTypes[0].id);

      component.toggleBuildingInfo(buildingTypes[0]);
      expect(component.expandedBuildingId).toBeNull();
      expect(component.isBuildMode).toBe(false);
    });

    it('a blocked row only opens its box and ends any running placement', () => {
      component.getBuildBlocker = () => null;
      component.toggleBuildingInfo(buildingTypes[0]);
      expect(component.isBuildMode).toBe(true);

      component.getBuildBlocker = () => 'Not researched yet.';
      component.toggleBuildingInfo(residential());
      expect(component.expandedBuildingId).toBe('small_residential');
      expect(component.isBuildMode).toBe(false);
      expect(component.selectedBuildingType).toBeNull();
    });

    it('the list stays visible while placing and the box holds the controls', () => {
      component.getBuildBlocker = () => null;
      component.setTab('build');
      component.toggleBuildingInfo(residential());
      component.ngDoCheck();
      fixture.componentRef.injector.get(ChangeDetectorRef).detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.planet-sidebar__build-list')).not.toBeNull();
      const box = el.querySelector('#building-info-small_residential')!;
      expect(box.querySelector('.planet-sidebar__build-active')).not.toBeNull();
      expect(box.textContent).toContain('CANCEL');
    });

    it('explains why BUILD is disabled', () => {
      component.isBuildingUnlocked = () => false;
      expect(component.getBuildBlocker(residential())).toBe('Not researched yet.');

      component.isBuildingUnlocked = () => true;
      component.getPlayerCredits = () => 0;
      component.getPlayerRawMaterials = () => 0;
      expect(component.getBuildBlocker(residential())).toBe('Not enough credits or raw materials.');

      component.getPlayerCredits = () => 1e6;
      component.getPlayerRawMaterials = () => 1e6;
      expect(component.getBuildBlocker(residential())).toBeNull();
    });
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

  describe('surface zoom', () => {
    const slider = (): HTMLInputElement =>
      fixture.nativeElement.querySelector('.planet-surface__zoom-slider');
    // jsdom has no layout, so clamping would pin every pan offset to 0.
    const disableClamp = () => ((component as any).updateClamp = () => {});
    const pointer = (type: string, id: number, x: number, y: number, pointerType = 'touch') =>
      ({
        type,
        pointerId: id,
        pointerType,
        clientX: x,
        clientY: y,
        target: fixture.nativeElement,
        currentTarget: {
          setPointerCapture: () => {},
          releasePointerCapture: () => {},
          hasPointerCapture: () => false,
          classList: { add: () => {}, remove: () => {} },
        },
      }) as unknown as PointerEvent;

    it('opens at the default zoom with the slider in sync', () => {
      expect(component.zoomScale).toBe(DEFAULT_PLANET_SURFACE_ZOOM);
      expect(component.cameraTransform).toContain(`scale(${DEFAULT_PLANET_SURFACE_ZOOM})`);
      fixture.detectChanges();
      expect(Number(slider().value)).toBe(component.zoomSliderValue);
    });

    it('reaches closer than the unscaled cell size', () => {
      expect(PLANET_SURFACE_ZOOM_MAX).toBeGreaterThan(1);
      expect(PLANET_SURFACE_ZOOM_MIN).toBeLessThan(DEFAULT_PLANET_SURFACE_ZOOM);
    });

    it('clamps the zoom to its range', () => {
      component.setZoom(10);
      expect(component.zoomScale).toBe(PLANET_SURFACE_ZOOM_MAX);
      expect(component.zoomSliderValue).toBe(component.zoomSliderSteps);
      component.setZoom(0.01);
      expect(component.zoomScale).toBe(PLANET_SURFACE_ZOOM_MIN);
      expect(component.zoomSliderValue).toBe(0);
    });

    it('maps the slider ends to the zoom range', () => {
      fixture.detectChanges();
      slider().value = String(component.zoomSliderSteps);
      slider().dispatchEvent(new Event('input'));
      expect(component.zoomScale).toBeCloseTo(PLANET_SURFACE_ZOOM_MAX);
      slider().value = '0';
      slider().dispatchEvent(new Event('input'));
      expect(component.zoomScale).toBeCloseTo(PLANET_SURFACE_ZOOM_MIN);
    });

    it('resets to the default zoom with the magnifier', () => {
      component.setZoom(PLANET_SURFACE_ZOOM_MAX);
      fixture.detectChanges();
      fixture.nativeElement.querySelector('.planet-surface__zoom-icon').click();
      expect(component.zoomScale).toBe(DEFAULT_PLANET_SURFACE_ZOOM);
    });

    it('zooms in on wheel up and out on wheel down', () => {
      const wheel = (deltaY: number) =>
        component.onSurfaceWheel(new WheelEvent('wheel', { deltaY, cancelable: true }));
      wheel(-100);
      expect(component.zoomScale).toBeGreaterThan(DEFAULT_PLANET_SURFACE_ZOOM);
      wheel(100);
      wheel(100);
      expect(component.zoomScale).toBeLessThan(DEFAULT_PLANET_SURFACE_ZOOM);
    });

    it('rescales the pan offset so the viewed center point stays put', () => {
      component.setZoom(1);
      component.scrollX = 4;
      component.scrollY = -2;
      disableClamp();
      component.setZoom(0.6);
      expect(component.scrollX).toBeCloseTo(2.4);
      expect(component.scrollY).toBeCloseTo(-1.2);
    });

    it('keeps the point under an off-center anchor in place', () => {
      component.setZoom(1);
      disableClamp();
      const anchor = { x: 10, y: 5 };
      const worldBefore = (anchor.x + component.scrollX) / component.zoomScale;
      component.setZoom(1.25, anchor);
      expect((anchor.x + component.scrollX) / component.zoomScale).toBeCloseTo(worldBefore);
    });

    it('zooms in with a two-finger pinch and blocks the trailing click', () => {
      disableClamp();
      component.onSurfacePointerDown(pointer('pointerdown', 1, 100, 100));
      component.onSurfacePointerDown(pointer('pointerdown', 2, 200, 100));
      component.onSurfacePointerMove(pointer('pointermove', 2, 250, 100));
      expect(component.zoomScale).toBeCloseTo(DEFAULT_PLANET_SURFACE_ZOOM * 1.5);
      component.onSurfacePointerUp(pointer('pointerup', 2, 250, 100));
      component.onSurfacePointerUp(pointer('pointerup', 1, 100, 100));

      component.selectBuildingType('small_residential');
      component.onCellClick(0, 0);
      expect(component.selectedCell).toBeNull();
    });

    it('does not touch planet data when zooming', () => {
      const before = JSON.stringify(mockPlanet);
      component.setZoom(PLANET_SURFACE_ZOOM_MIN);
      component.setZoom(PLANET_SURFACE_ZOOM_MAX);
      expect(JSON.stringify(mockPlanet)).toBe(before);
    });

    it('resets to the default when a different planet is shown', () => {
      component.setZoom(PLANET_SURFACE_ZOOM_MIN);
      fixture.componentRef.setInput('planet', { ...mockPlanet, id: 2, name: 'Other' });
      fixture.detectChanges();
      expect(component.zoomScale).toBe(DEFAULT_PLANET_SURFACE_ZOOM);
    });

    it('keeps the chosen zoom when the same planet object is refreshed', () => {
      fixture.componentRef.setInput('planet', mockPlanet);
      fixture.detectChanges();
      component.setZoom(PLANET_SURFACE_ZOOM_MIN);
      fixture.componentRef.setInput('planet', { ...mockPlanet });
      fixture.detectChanges();
      expect(component.zoomScale).toBe(PLANET_SURFACE_ZOOM_MIN);
    });

    it('starts at the default again on a fresh component (planet view reopened)', () => {
      component.setZoom(PLANET_SURFACE_ZOOM_MAX);
      fixture.destroy();
      const reopened = TestBed.createComponent(StarMapPlanetScreenComponent);
      reopened.componentInstance.planet = mockPlanet;
      reopened.detectChanges();
      expect(reopened.componentInstance.zoomScale).toBe(DEFAULT_PLANET_SURFACE_ZOOM);
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

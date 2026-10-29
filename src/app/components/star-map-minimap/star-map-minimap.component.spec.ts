import { TestBed } from '@angular/core/testing';
import { StarMapMinimapComponent } from './star-map-minimap.component';
import { nebulaSvgPath } from '../star-map/nebula';
import { Nebula } from '../star-map/star-map.models';

describe('StarMapMinimapComponent nebulae', () => {
  const nebula: Nebula = { id: 3, x: 61, y: 31, radius: 10, lobes: [1, 1, 1], rotation: 0, color: '#7c5cd6' };

  it('draws nebula outlines aligned with the minimap coordinate system', () => {
    const fixture = TestBed.createComponent(StarMapMinimapComponent);
    const minimap = fixture.componentInstance;
    minimap.gridColumns = 120;
    minimap.gridRows = 72;
    minimap.nebulae = [{ id: 3, color: nebula.color, halo: '', body: nebulaSvgPath(nebula), core: '' }];
    fixture.detectChanges();

    const paths = fixture.nativeElement.querySelectorAll('.minimap__nebula');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('fill')).toBe('#7c5cd6');
    // Grid coordinate 61 must land where a system at x = 61 is drawn: (61 - 1) × 2 px.
    const [sx, sy] = [minimap.pxPerCol, minimap.pxPerRow];
    expect(((nebula.x - 0.5) - 0.5) * sx).toBe(minimap.systemX({ x: nebula.x } as never));
    expect(((nebula.y - 0.5) - 0.5) * sy).toBe(minimap.systemY({ y: nebula.y } as never));
    expect(fixture.nativeElement.querySelector('.minimap__nebulae').getAttribute('transform')).toBe(
      `scale(${sx} ${sy}) translate(-0.5 -0.5)`,
    );
  });

  it('renders nothing extra without nebulae', () => {
    const fixture = TestBed.createComponent(StarMapMinimapComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.minimap__nebulae')).toBeNull();
  });

  it('darkens unexplored cells with one fog path and leaves explored cells clear', () => {
    const fixture = TestBed.createComponent(StarMapMinimapComponent);
    const minimap = fixture.componentInstance;
    fixture.componentRef.setInput('gridColumns', 4);
    fixture.componentRef.setInput('gridRows', 2);
    fixture.componentRef.setInput('exploredCells', new Set(['2-1', '3-1']));
    fixture.componentRef.setInput('exploredCount', 2);
    fixture.componentRef.setInput('fogEnabled', true);
    fixture.detectChanges();

    // Row 1: cells 1 and 4 fogged; row 2: all four cells fogged.
    expect(minimap.fogPath).toBe('M0 0H1V1H0ZM3 0H4V1H3ZM0 1H4V2H0Z');
    expect(fixture.nativeElement.querySelectorAll('.minimap__fog').length).toBe(1);

    fixture.componentRef.setInput('fogEnabled', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.minimap__fog')).toBeNull();
  });
});

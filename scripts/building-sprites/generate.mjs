/*
 * Writes one SVG sprite per building in planet-data.json to
 * public/buildings-svg/<id>.svg (underscores → dashes).
 *
 *   npm run sprites:buildings
 *
 * Re-run after changing a design in buildings.mjs or the sprite inset.
 * Fails when a building has no design, so new buildings cannot ship
 * without a sprite. See docs/planet-surface.md#building-sprites.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBuilding } from './buildings.mjs';

/* Must match SPRITE_INSET in star-map-planet-screen.component.ts. */
const SPRITE_INSET = 0.15;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(readFileSync(join(root, 'src/app/components/star-map/planet-data.json'), 'utf8'));
const outDir = join(root, 'public/buildings-svg');
mkdirSync(outDir, { recursive: true });

for (const building of data.buildings) {
  const svg = renderBuilding(building.id, building.size, SPRITE_INSET);
  const file = join(outDir, `${building.id.replace(/_/g, '-')}.svg`);
  writeFileSync(file, svg);
  console.log(`${building.id.padEnd(22)} ${building.size}x${building.size}  ${(svg.length / 1024).toFixed(1)} kB`);
}

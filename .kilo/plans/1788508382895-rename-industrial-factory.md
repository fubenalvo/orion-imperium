# Rename "Industrial Factory" → "Spaceship Factory" everywhere

## Scope
Rename the building currently defined as `Industrial Factory` to `Spaceship Factory` everywhere it appears in the repository. This includes its `name`, its `id`, the SCSS modifier class, and the corresponding image asset. Both the user-facing display name and the programmatic identifier must change to `Spaceship Factory` / `spaceship_factory` (and matching kebab-case where applicable).

## Affected files (exact)

| File | Current | Change |
| --- | --- | --- |
| `src/app/components/star-map/planet-data.json` (line 230–249) | `"id": "factory"`, `"name": "Industrial Factory"` | `"id": "spaceship_factory"`, `"name": "Spaceship Factory"` |
| `src/app/services/economy.service.ts` (line 313) | `filter((b) => b.name === 'Industrial Factory')` | `filter((b) => b.name === 'Spaceship Factory')` |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss` (line 189–191) | `&--factory::after { background-image: url('/buildings/factory.png'); }` | `&--spaceship-factory::after { background-image: url('/buildings/spaceship-factory.png'); }` |
| `public/buildings/factory.png` | asset filename `factory.png` | rename to `spaceship-factory.png` |

The SCSS class `--factory` is generated from the building id (via slug logic that converts `spaceship_factory` → `spaceship-factory`), so the modifier rename must accompany the id rename.

The economy service filter is on `name` (the display string), so it must change to `'Spaceship Factory'`.

## Implementation steps

1. In `src/app/components/star-map/planet-data.json`:
   - Change `"id": "factory"` → `"id": "spaceship_factory"`.
   - Change `"name": "Industrial Factory"` → `"name": "Spaceship Factory"`.
2. In `src/app/services/economy.service.ts:313`:
   - Change `b.name === 'Industrial Factory'` → `b.name === 'Spaceship Factory'`.
3. In `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss:189-191`:
   - Change `&--factory` → `&--spaceship-factory`.
   - Change `url('/buildings/factory.png')` → `url('/buildings/spaceship-factory.png')`.
4. Rename the asset file `public/buildings/factory.png` → `public/buildings/spaceship-factory.png`.

## Files explicitly NOT changed

- `docs/data-models.md` — only references the generic `'industrial'` role value (an example value for the `role` field, unrelated to the building name); no mention of "Industrial Factory".
- `.kilo/plans/1788162570271-4x-feature-roadmap.md` and `.kilo/plans/1788163794403-data-driven-economy-foundation.md` — historical plan notes that mention "Industrial Factory" by name. Out of scope for this rename; leave as historical record unless the user asks otherwise.
- `role: "industry"` on this building — not changed. The user asked to rename the building identity, not the industry role category.
- `ship-data.json` — unrelated (ships, not buildings).

## Validation

- `rg -i "industrial factory" src public docs` returns no matches.
- `rg -i "\"factory\"|'factory'" src public` returns no matches.
- `rg "spaceship[_-]?factory" src public` returns the new occurrences.
- The planet screen still resolves a building icon when a planet has this building (visual smoke check).
- Build / lint passes (no test script present in repo at this time).

## Risks / notes

- The building `id` is the stable programmatic identifier. Saved game state, if any, would break. The project currently has no save/load system, so this is low risk.
- No other code branches on the literal id `"factory"` or name `"Industrial Factory"` outside the files listed above (verified via grep across `*.ts`, `*.json`, `*.html`, `*.scss`, `*.md`).
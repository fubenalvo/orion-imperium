# UI Styling Guide

## Color Palette

The project uses a sci-fi cyan-on-deep-navy color scheme defined in
`src/styles.scss` as CSS custom properties:

| Variable | Value | Usage |
|---|---|---|
| `--color-background` | `#030d1a` | Main background |
| `--color-blue` | `#00f0ff` | Primary accent / borders |
| `--color-blue-light` | `#5cd1ff` | Light accent / headers |
| `--color-blue-bright` | `#8cfffe` | Bright highlights |
| `--color-blue-dark` | `#005d8a` | Darker variants |
| `--color-text` | `#a5f3fc` | Primary text |
| `--color-text-bright` | `#ffffff` | Bright text |
| `--color-text-dim` | `#3a9bb0` | Dim/secondary text |
| `--color-text-disabled` | `#005d8a` | Disabled text |

### Background grid

The star-map and game viewport feature a subtle animated grid pattern:

```scss
background-image:
  radial-gradient(circle at 50% 50%, #082747 0%, #030d1a 100%),
  linear-gradient(rgba(0, 240, 255, 0.05) 1px, transparent 1px),
  linear-gradient(90deg, rgba(0, 240, 255, 0.05) 1px, transparent 1px);
background-size: 100% 100%, 20px 20px, 20px 20px;
```

## Font

The primary font stack is `'VT323'` (retro sci-fi monospace) with
`'Segoe UI', Roboto, 'Courier New', sans-serif` as fallbacks:

```scss
--font-primary: 'VT323', 'Segoe UI', Roboto, 'Courier New', sans-serif;
```

## HUD Panel Frame

### The `hud-frame()` mixin

Defined in `src/styles/_hud-panel.scss`, the `hud-frame()` (or the combined
`hud-panel()` mixin) applies the signature sci-fi frame:

- **Clipped corners** via `clip-path: polygon(...)` — cuts a 20px notch from
  each corner.
- **Accent notches** — a cyan line in the top-left corner (`::before`) and a
  bright-cyan line in the bottom-right corner (`::after`).
- **Glow** — outer `box-shadow` with cyan tint.
- **Background** — semi-transparent dark-blue panel with `backdrop-filter`.

### Usage rules

**Only apply the frame to boxes that do NOT already use `::before`/`::after`
for other visual purposes.** The following elements use their own
pseudo-elements and must NOT receive the frame:

- `.planet-surface__grid--isometric` — uses `&:before`/`&:after` for cloud/tiling effects
- `.planet-surface` — uses `&::before`/`&:after` for cloud overlays
- `.planet-surface__building` — uses `&::before`/`&:after` for isometric building sprites

All other panel boxes — `.panel-style`, `.hud-overlay__panel`,
`.pause-overlay__content`, `.production-panel__modal`, `.star-map-options__content`,
`.context-menu`, `.spaceport-panel` — should use the frame.

### Applying the mixin

From any SCSS file (the `src/styles` include-path makes the partial
globally importable):

```scss
@use 'hud-panel' as *;

.my-panel {
  @include hud-frame;
  @include hud-accent-notches;
}
```

### Close button accommodation

When applying the frame to `.panel-style`, the `button.close-btn` in
`.panel-style__title` is shifted to `right: 1.5em` so it sits inside the
clipped corner rather than being cut off.

## HudDotsComponent

A standalone Angular component (`app-hud-dots`) that renders a row of status
LED indicators, inspired by the sci-fi system-status dots.

### Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| `count` | `number` | `4` | Total number of dots |
| `active` | `number` | `3` | Number of lit dots |
| `size` | `'sm' \| 'md'` | `'md'` | Dot size |

### Example

```html
<app-hud-dots [count]="4" [active]="3" size="sm"></app-hud-dots>
```

### Usage in the codebase

- **Panel titles** — small status indicator next to the title text in
  system-info, fleet-info, planet-info, and research-tree panels.

## Game Header

`GameHeaderComponent` (`src/app/components/game-header/`) is the single top bar of every
in-game screen. The star map, system view and planet view use it through
`StarMapHeaderComponent`; the battle screen uses it directly. Screens never position header
controls themselves — earlier, separately positioned back / menu buttons overlapped the time
controls on narrow screens.

**Layout.** A three-column grid: *start* (back button + title, optional subtitle) · *center*
(⏸ and speed buttons, plus projected extras such as battle AUTO) · *end* (projected status
content such as currencies / ship stock / planet shield, then the ☰ pause-menu button).
The start column may shrink to zero (the title truncates with an ellipsis); the end column
never shrinks below its content. When space is ample both side columns are equal, so the time
controls sit exactly in the middle.

**Sizing.** The height is the global token `--game-header-h` (`styles.scss`,
`clamp(44px, 8dvh, 76px)`). The header defines `--gh-u = --game-header-h / 4`, and every size
inside it — including projected content (currencies, ship stock, battle shield) — is a multiple
of `--gh-u`. Content that sits below the header (planet screen, fleet list, map notices, battle
grid row) offsets itself by `--game-header-h`; never hard-code the header height.

**Buttons.** All header buttons use the `hud-button` mixins in `src/styles/_hud-controls.scss`
(`@use 'hud-controls' as hud;`), which also reset the global gradient `button` look so hover
and press never change a button's size or position.

**Responsive rules** (viewport width): at ≤1100px the back button collapses to its arrow (the
full label stays in its tooltip / aria-label), the ship-stock "STOCK" label is hidden and gaps
tighten; at ≤820px the subtitle is hidden and the title shrinks.

**Constraint.** Do not add `container-type`, `transform`, `filter` or `backdrop-filter` to the
header or its ancestors: they would become the containing block for the `position: fixed`
currency / ship-stock detail overlays rendered inside it.

## Space Scenery

Every screen draws its space backdrop from the same building blocks, so the
game reads as one universe while each screen keeps its own composition. The
main menu set the visual language; the star map, system view and battle
screen follow it.

### Shared partials (`src/styles/`, on the SCSS include path)

| Partial | Provides |
|---|---|
| `_space.scss` | `space-base` (deep navy base with cool/warm washes), `starfield-far` (procedural star tiles + `stars.png`), `starfield-twinkle`, `nebula-cloud($hue, $opacity, $saturate)` (the `nebula.png` art hue-shifted and radially masked), `space-dust`, `space-vignette`, `star-corona($color)`, `star-spikes($color)`, `space-keyframes` |
| `_planets.scss` | `planet-sphere($light-x, $light-y)` (lit sphere: gradient + bands + surface noise, scrolling cloud layer on `::before`, terminator / specular / atmosphere rim on `::after`), `$planet-palettes` and `planet-palette($type)` / `planet-palettes($prefix, $suffix)` per `PlanetType`, `planet-keyframes` |

Rules:

- Backdrop elements are decorative: `aria-hidden`, `pointer-events: none`,
  below every interactive layer (one exception, see below).
- Animate only `transform` / `opacity`; filtered layers (nebulae) never
  animate a property that forces re-filtering.
- Keyframes are emitted by `space-keyframes` / `planet-keyframes`; include
  them at the top level of each stylesheet that uses an animated mixin
  (Angular scopes keyframes per component).
- `planet-sphere` owns the element's `::before` / `::after`, and sizes its
  rim and glow in `em`: set `font-size` to 10% of the planet's diameter.
- Hue-rotating the one nebula image gives all nebula colors: ~185deg
  teal/amber (main palette), ~250deg violet/rose, ~150deg cyan/green.
- Sass interpolates `#{...}` even inside `/* */` comments; use `//`
  comments when describing interpolation in these partials.

### Per screen

| Screen | Composition |
|---|---|
| Main menu | See [Main Menu](#main-menu). |
| Star map (galaxy) | Static deep stars + twinkle (`.star-map-deep`), wrapping nebula field (`SpaceNebulaFieldComponent`, 0.12x camera), the star-texture parallax layer (`.star-map-background`, 0.3x camera), faint dust in front (`.star-map-foreground`, 0.6x). Stars are light sources (corona, diffraction spikes, hot core; a rotating dashed ring when selected). Sensor range is a soft borderless field; fog cells have soft spread edges; the navigation grid is a hairline. Movement paths have a soft beam under the dashes. Styles: `_star-map-backdrop.scss`, `_star-map-star-system.scss`. |
| System view | The system's star at the right edge is the single light source: light wash, slowly turning soft corona rays, glow, granulated disc. Planets use `planet-sphere` lit from the right with per-type palettes; faint orbit rings (`orbitDiameterVw`) connect each planet to the star; hover shows a halo ring. A nebula sits opposite the star. Styles: `star-map-system-grid.component.scss` (scene) and `_star-map-system-view.scss` (wrapper). |
| Battle | Deep stars with a distant star in the band above the field, two nebula formations framing the left and lower right (the middle stays calm behind the units), twinkling dust and a vignette. The field is a fading hairline grid with corner brackets. Ships carry a faction-colored glow and engine light; explosions add a shockwave ring. The planet in planet battles uses `planet-sphere` with a deep palette derived from `--planet-color`. |

### Galaxy view: backdrop over the fog

At the start of a game nearly the whole galaxy is fogged, which would hide
the backdrop entirely. In the map view only, the deep stars and the nebula
field get `.star-map-backdrop--front`: they are drawn above the map viewport
with `mix-blend-mode: screen`. Screen blending only adds light, so it cannot
hide or darken anything, and gameplay terrain (SVG nebulae, belts) stays
under the fog. These decorative nebulae are deliberately faint and edgeless,
unlike gameplay nebulae (dashed edge, on the grid). Never apply the modifier
in the system / planet views, where it would draw over opaque scenery.

### Wrapping nebula field

`SpaceNebulaFieldComponent` (`src/app/components/space-nebula-field/`) draws
a 180 x 130 vw tile of three nebula formations 2 x 2 times in a
viewport-pinned layer and translates it by the camera pan modulo one tile.
Panning only changes a compositor transform, and nebulae are always on
screen however large the galaxy is. Every formation must stay inside its
tile (see the SCSS) or it is cut where the tiles wrap.

### Stylesheet budgets

Angular enforces a 20 kB error budget per component stylesheet. Partials
shared through `@use` are copied into every stylesheet that uses them, so
only `@use` a partial in a component whose template contains its selectors
(see the note at the top of `star-map.scss`).

## Main Menu

The main menu (`src/app/main-menu/`) intentionally departs from the beveled
in-game button and panel look: it is the game's title screen and uses a
cinematic backdrop with borderless navigation. Its styles are fully scoped in
`main-menu.scss`; the shared global button styles are overridden there under
`.main-menu`, so global button changes do not affect the menu (and vice versa).

### Structure

- **`.scene`** — decorative, `aria-hidden`, `pointer-events: none`. Layers,
  back to front (stars, nebula and dust come from the shared
  [space mixins](#space-scenery)): procedural star tiles + `stars.png`, the
  hue-shifted `nebula.png`, the sun (single light source, upper right), the planet (static
  banded base, a drifting `planet-clouds.png` layer, a terminator shade, an
  atmosphere rim), the moon, a ship convoy (`ship.svg`) that crosses about once
  every 75 s, foreground dust, and a readability veil.
- **`.menu`** — logo, tagline and the navigation. Load Game replaces the
  navigation inside the same column, so the logo stays visible.
- **`.sheet`** — framed glass panel that hosts `app-new-game-setup`; the scene
  is dimmed behind it.

### Single-viewport rule

The menu must always fit one viewport with no page scrolling. All sizes are
derived from `dvh`/`vw` through `clamp()`/`min()` tokens on `.main-menu`
(`--col-w`, `--logo-w`, `--label-size`, `--item-pad`, `--planet-size`, ...).
Three layout modes reorganise the UI rather than scaling it:

| Mode | Trigger | Layout |
|---|---|---|
| Default | landscape | Left column; on ultrawide the column is anchored to a centered 16:9 safe area. Planet lower right. |
| Short landscape | `max-height: 560px` and aspect ≥ 5/4 | Logo and navigation side by side; hints, Load Game title and moon hidden. |
| Portrait | aspect ≤ 4/5 or width ≤ 560px | Centered column; planet rises from the bottom edge; moon hidden. |

The only internal scroll area is the New Game setup form itself, which is
long by nature and bounded by its own `max-height`.

### Motion

- Only `transform` and `opacity` are animated. The planet cloud layer and the
  dust plane loop by exactly one texture tile; the geometry notes in
  `main-menu.scss` explain the ratios that keep those loops seamless.
- Pointer parallax: `main-menu.ts` writes `--px`/`--py` (-1..1) on the host
  from a plain `window` `pointermove` listener, which deliberately does not
  trigger change detection. Each `.scene__depth` plane maps them to its own
  offset. Disabled for `prefers-reduced-motion` and coarse pointers.
- `prefers-reduced-motion: reduce` stops all menu animations and hides the
  convoy.

### Assets

Bare `url('x.png')` references in component SCSS only resolve if the file is
listed under `externalDependencies` in `angular.json`; otherwise use a
root-absolute path (the menu uses `url('/nebula.png')`).

## Related documentation

- [Architecture](./architecture.md)
- [Game Systems](./game-systems.md)

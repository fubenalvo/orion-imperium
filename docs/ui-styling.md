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

- **Star-map header** — shows game status (4 active when running, 1 active
  when paused).
- **Panel titles** — small status indicator next to the title text in
  system-info, fleet-info, planet-info, and research-tree panels.

## Related documentation

- [Architecture](./architecture.md)
- [Game Systems](./game-systems.md)

# Make Game Viewport Fully Responsive (100dvh / 100dvw)

## Goal

Remove the forced 16:9 aspect ratio constraint so the game viewport always fills the entire available screen space using `100dvh` and `100dvw`.

## Root Cause

The `.game-viewport` class in `src/styles.scss:165-184` constrains the game to a 16:9 box:

```scss
width: min(100vw, calc(100dvh * 16 / 9));
height: min(100dvh, calc(100vw * 9 / 16));
transform: translate(-50%, -50%);
aspect-ratio: 16 / 9;
```

Additionally, `.crt-container` in `src/app/app.scss:4-10` uses `100vh` instead of `100dvh`.

## Changes

### 1. `src/styles.scss` — `.game-viewport` (lines 165-184)

Replace the constrained dimensions with full viewport coverage:

```scss
.game-viewport {
  position: absolute;

  top: 0;
  left: 0;

  width: 100dvw;
  height: 100dvh;

  overflow: hidden;

  background: var(--color-background);

  color: var(--color-text);
}
```

Remove:
- `top: 50%; left: 50%;`
- `transform: translate(-50%, -50%);`
- `aspect-ratio: 16 / 9;`
- The `min()` expressions for width/height

### 2. `src/styles.scss` — `app-root` (line 154-159)

Already uses `100dvh` — no change needed.

### 3. `src/app/app.scss` — `.crt-container` (lines 4-10)

Change `100vh` to `100dvh` so mobile browsers account for the address bar:

```scss
.crt-container {
  position: relative;
  width: 100dvw;
  height: 100dvh;
  overflow: hidden;
  background-color: #050505;
}
```

## Files Modified

- `src/styles.scss` — `.game-viewport` rule
- `src/app/app.scss` — `.crt-container` rule

## Validation

1. Serve the app and verify the star-map fills the entire browser window at various aspect ratios (16:9, 16:10, 21:9, 4:3, 9:16 portrait with landscape overlay).
2. Verify no black bars appear on the sides or top/bottom.
3. Verify the `.star-map` component (which uses `width: 100%; height: 100%`) correctly inherits the full viewport dimensions.
4. Test on a mobile device / device emulation to confirm `100dvh` accounts for the dynamic address bar.

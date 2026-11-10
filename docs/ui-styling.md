# UI Styling Guide

## Design system

Every in-game screen shares one visual language: a 1990s sci-fi **command
console** (restrained, industrial, after Imperium Galactica). Panels are dark
blue-black **console surfaces** with faint scanlines, held in a chamfered
**metallic frame** with a thin cyan inner outline and small amber lamps (see
[Console frame](#console-frame)). One **cyan accent** carries headings,
values and outlines, labels are muted **blue-gray**, and **amber** marks
status and selection. The typeface is the condensed technical Share Tech
Mono. Screens keep their own composition (see [Per screen](#screen-treatments));
they share tokens, surfaces and controls. The main menu keeps its own scoped
styles (see [Main Menu](#main-menu)).

The look was chosen on 2026-11-03 from a reference image the user supplied as
the design specification (an earlier "Imperial Console" restyle with graphite
panels was rejected the same day); keep new UI within it rather than
reinterpreting it.

Sources of truth:

| File | Holds |
|---|---|
| `src/styles.scss` | Design tokens (`--ui-*` custom properties), global element styles (`button`, inputs, checkbox/radio, range, scrollbars) and the shared global classes listed below |
| `src/styles/_ui.scss` | SCSS mixins for the same building blocks (`@use 'ui';`). Mixins only, so using the partial costs nothing until a mixin is included |
| `src/styles/_hud-controls.scss` | Header-sized buttons (`hud-button`, `-active`, `-dimmed`), scaled by `--gh-u` |
| `src/styles/_hud-panel.scss` | `hud-frame` / `hud-accent-notches` / `hud-panel`: aliases of `ui.glass` + `ui.brackets` for stylesheets that want the panel look on their own selector |
| `public/ui/console-frame.svg` | The metallic console frame, a 9-slice image used by `ui.brackets` (see [Console frame](#console-frame)) |
| `src/styles/_hud-panels.scss` | Global rules for the star map's floating panels (system / fleet / planet info cards, planet + fleet roster, context menu) and the header detail overlay (`.hud-overlay`). Loaded at the end of `styles.scss` with `meta.load-css`, so its placement rules win over `.panel-style` |

### Tokens

Colors (never use literals for UI chrome; use these):

| Token | Value | Use |
|---|---|---|
| `--ui-accent` / `--ui-accent-rgb` | `#25d7e8` | The one UI accent (cyan): headings, important values, outlines, primary actions. Use `rgba(var(--ui-accent-rgb), a)` for tints |
| `--ui-accent-text` | `#2fc6d8` | Accent for small text (section labels) |
| `--ui-ink-bright` / `--ui-ink` / `--ui-ink-dim` / `--ui-ink-faint` | `#e6fbff` / `#bfe2ea` / `#7d97a4` / `#456777` | Text hierarchy: emphasis, primary, secondary labels (blue-gray), disabled/tertiary |
| `--ui-amber` / `--ui-amber-rgb` | `#ffb51b` | Status lamps and readouts, counters, the bar under a selected button or tab |
| `--ui-warm` | `#ffc65a` | Costs, prices, pending orders (a softer amber) |
| `--ui-success` / `--ui-warning` / `--ui-danger` (+ `-rgb`), `--ui-danger-text` | | Status |
| `--ui-anomaly` | `#c39cff` | Nebula / sensor impairment notices |
| `--ui-shield` | `#5cc8ff` | Shield bars and shield abilities |
| `--ui-line` / `--ui-line-soft` / `--ui-line-strong` | accent at 22% / 12% / 45% | Hairlines and borders |
| `--ui-surface-raised` / `--ui-surface-sunken` | | Inset cards inside a panel / trays (time controls, readout strips) |

Faction colors (game data) are the only other hues on screen, so UI chrome
never competes with them. In particular the UI accent is not the player's
blue.

Type scale: `--ui-fs-xs` … `--ui-fs-xl` (0.72rem … 1.5rem, sized for Share
Tech Mono), tracking `--ui-track` / `--ui-track-wide`. Below 900px
width or 600px height the whole scale steps down once (media query on
`:root`), so panels shrink as a unit; do not add per-component mobile font
sizes for text that already uses the tokens. The compact values (xs 0.58,
sm 0.64, md 0.72, lg 0.86, xl 1.05 rem) were lowered on 2026-11-10 because
panel rows wrapped and labels were cut off on landscape phones. `--ui-edge` is the gap between
floating HUD panels and the viewport edge; it stays at least 12px because the
console frame is drawn that far outside each panel.

Exception: the floating info cards of the star map and system view (system,
fleet, planet, asteroid) step down one more time on the same viewports (the
`compact-view` mixin) by overriding the `--ui-fs-*` tokens on the card itself
(xs 0.56, sm 0.62, md 0.68, lg 0.8 rem), and tighten their paddings and the
console letter-spacing of long button hints (fleet card). They are also capped at about half the screen
height (`min(55dvh, …)`) and at `min(44vw, 240px)` width, with a scrolling
content area and the action row pinned at the bottom, so the map stays usable
on phones. Those rules live in `src/styles/_hud-panels.scss` (compact block)
and in each info component's stylesheet.

Legacy tokens (`--color-blue*`, `--color-turquoise*`, `--color-text*`,
`--panel-*`, `--color-success` …) are aliases of the palette above — the
`--color-blue*` and `--color-turquoise*` names now carry the cyan accent.
Prefer `--ui-*` in new code.

### Surfaces

- **Console panel** — `.panel-style` (global class) or `ui.glass` +
  `ui.brackets`: near-opaque blue-black surface with faint horizontal
  scanlines, 1px `--ui-line` outline, deep shadow, inside the metallic
  [console frame](#console-frame). (The mixin names `glass` and `brackets`
  are historical; keeping them gave every panel the console look at once.)
  Panels have no `backdrop-filter` (see the GPU rule under Rules below).
- **Panel header** — `.panel-style__title`: cyan uppercase heading on the
  left, optional amber status / counter pushed to the right
  (`margin-left: auto`), a thin cyan rule underneath. A `button.close-btn`
  inside it renders as a drawn cross at the right edge (its "X" text is
  hidden), so close buttons look identical everywhere.
- **Modal** — `ui.backdrop` (dimmed scene, no blur) + a console sheet with
  the heavy frame (`ui.brackets` size >= 22px) and `ui.modal-title` (title
  between two fading rules).

### Console frame

`ui.brackets($size)` draws the frame from `public/ui/console-frame.svg` as a
9-slice `border-image` (slice 32 of the 96px image): metal band with a light
top edge and a darker groove, a dark gap, the thin cyan inner outline, small
mechanical plates at the top-left and right corners, and two amber lamps on
the bottom edge. Only the 32px corner squares may carry details; everything
between them is stretched. `::before` adds the raised metal plate centred on
the top edge.

- `$size` picks the weight: <= 12px small instruments (22px frame), >= 22px
  modal sheets (40px), otherwise standard panels (32px). Its color/width
  parameters are ignored.
- The frame is pushed outside the box (`border-image-outset`, 3/8 of the
  frame width, about 8–15px), so it never changes layout and the cyan line
  falls on the panel edge. Consequences: leave that much room between
  framed panels and from the viewport edge, and an ancestor with
  `overflow: hidden` clips the frame.
- It needs a border-style other than `none` (`ui.glass` sets one).
- `ui.frame-docked($sides, $w)` docks a framed panel against screen edges:
  on each listed side the frame and the outline are dropped and the panel is
  positioned at 0, flush with the viewport (the frame corners touching those
  sides disappear; the other edges run off screen). Docking the top also
  hides the top plate; a panel docked under the header sets its own `top`
  after the include. `$w` must match the frame width `ui.brackets` picked.
  Docked panels: the bottom-left info card slot (`.system-info`,
  `.fleet-info`, `.planet-info`: left + bottom), the map navigation console
  with the minimap (right + bottom) and the map roster (left + top, under
  the header).
  Used by pause, options, research, currency breakdown,
  battle result and game end.

Rules:

- `ui.brackets` and `.panel-style` own `::before` / `::after`. Do not put
  them on elements that use those pseudo-elements for something else (for
  example `.planet-surface__atmosphere`).
- No `backdrop-filter` blur on in-game panels or modal backdrops. Every
  blurred element is a separate GPU surface that is re-rendered whenever the
  animated scenery under it changes; with several HUD panels and a modal
  open, phones (and weak PC GPUs) ran out of GPU memory and whole screens
  flickered (header, buttons, the research tree). The panels are near-opaque,
  so the blur was not visible anyway. The main menu sheet still blurs (a
  single element over a static scene).
- Do not put map-sized or many-screen-sized layers on the compositor
  (`will-change: transform` on a div as large as the galaxy). Panning exposes
  tiles that are not rasterized yet and they flash black on phones. Pin
  decorative layers to the viewport and wrap a repeating pattern by the pan
  offset modulo one tile instead (`SpaceNebulaFieldComponent`,
  `StarMap.starTextureTransform`).
- `backdrop-filter`, `filter` and `transform` (also a lingering animation
  end state) make an element the containing block of `position: fixed`
  descendants. Entrance animations end on `transform: none`, and the
  `.panel-style` boot uses fill-mode `backwards` (with `both`, Chrome keeps
  the end keyframe's `filter: none` as `brightness(1)`, trapping every fixed
  overlay inside the panel). The planet sidebar is the one deliberate
  exception: it sets `contain: layout` so the production order dialog (a
  fixed overlay with `inset: 0`) fills exactly the sidebar column, without
  a backdrop or console frame of its own.

### Controls

| Control | Global class / element | Mixin |
|---|---|---|
| Secondary button (default) | any `<button>` | `ui.button($size)` |
| Primary call to action (one per panel) | `.btn-primary` | `ui.button-primary` |
| Destructive | `.btn-danger` | `ui.button-danger` |
| Tertiary / text | `.btn-ghost` | |
| Selected / toggled | | `ui.button-selected` (amber bar along the bottom edge) |
| Icon button (close, d-pad, steppers) | | `ui.icon-button($size)` |
| Underline tab | | `ui.tab` + `ui.tab-active` |
| Inputs, select, checkbox, radio, range | elements | |

**Bundle budget rule.** Anything a component stylesheet `@use`s or
`@include`s is copied into that component's CSS, with Angular's
encapsulation attributes on every selector, and that CSS ships inside
`main.js`. So:

- A `<button>` already has the full look from the global rule. In a
  component, adjust only its size (`ui.button-size`, `ui.icon-size`) and put
  the variant in the template (`class="btn-primary"`, `btn-danger`,
  `ui-chip ui-chip--success`). Do not re-include `ui.button` /
  `ui.icon-button` on a `<button>`; keep the full mixins for non-button
  elements and for selected states (`ui.button-selected`, small).
- Styles rendered by several components belong in a global partial
  (`_hud-panels.scss`), not in a partial each component `@use`s. The star
  map panels used to be such a shared partial and pushed the initial bundle
  over its 1 MB error budget.

Component class selectors outrank the global element rules, but the global
`button:hover:not(:disabled)` outranks a plain component class. A component
that restyles a button therefore defines its own `:hover`, or includes a
mixin that does. The global button inherits its font size (`1em`); the
mixins use the rem tokens.

List-style buttons (menu entries, context menu, fleet roster, save slots)
are borderless rows with the diamond marker and an accent bar + wash on
hover — the main menu's item style. They set `justify-content: flex-start`,
since the global button centers its content.

### Content classes

| Class | Purpose |
|---|---|
| `.ui-label` | Section label followed by a fading rule ("ECONOMY ────") |
| `.ui-stat` (`__label`, `__value`, `--positive` / `--warn` / `--danger`) | Label / value row |
| `.ui-figure` (`__value`, `__caption`) | Headline number with caption |
| `.ui-chip` (`--success` / `--warning` / `--danger` / `--muted`) | Small tag (type, status) |
| `.ui-meter` + `__fill` | Thin progress / condition meter |
| `.ui-notice` (`--danger` / `--warning` / `--anomaly` / `--success`) | Inline notice with a colored left bar |
| `.ui-divider` | Hairline separator |

## Font

`--font-primary: 'Share Tech Mono'` (Google Fonts, loaded in `styles.scss`)
everywhere in game. A narrow, technical face like the reference console's
lettering; it runs wider than the former VT323, which is why the type scale
is smaller. Hierarchy comes from size, tracking, color (cyan headings and
values, blue-gray labels) and ink strength rather than weight. Text is
antialiased (`-webkit-font-smoothing: antialiased`).

## Screen overlay

`.crt-overlay` (`app.html`, textured in `app.scss`) lays faint static
scanlines and a soft vignette over the whole game. It is deliberately
static: an earlier flicker animation repainted the full viewport several
times a second and its RGB sub-pixel stripes blurred small text. The one
moving part is a very faint sensor band on `::after` that drifts down every
9 s; it animates only `transform` on its own compositor layer, so nothing
underneath is repainted (removed under `prefers-reduced-motion`).

## Motion and sound

The UI is a console that powers on and off, not a web page that fades.
Tokens, keyframes and the motion classes live in `src/styles/_motion.scss`
(emitted once from `styles.scss`); button and tab states live in the
`_ui.scss` mixins. Keyframe names are global (`ui-*`): Angular only
rewrites keyframes a component defines itself, so components can reference
them by name.

| Effect | Where | How |
|---|---|---|
| Dialog power on / off | modal hosts in `star-map.html` (Fleet Command, Ship Customization, anomaly event, Diplomacy, peace negotiation, research tree), `app.html` (Options), the pause overlay and the production order dialog | `animate.enter="ui-enter" animate.leave="ui-leave"` (Angular native enter/leave). The whole dialog opens from a bright horizontal line like a CRT and collapses back into one on close (`ui-crt-on` / `ui-crt-off`); during the class the host is a full-screen fixed block, which every modal overlay already is. Dialogs no longer have their own slide-in. |
| Panel boot | every `.panel-style` | Plays once on creation: opens from its centre line, brightness overshoot, one flicker (`ui-panel-boot`, 0.36 s). Ends with no clip and no filter (see the containing-block rule above). |
| View change | `star-map.html` | A sensor sweep line runs down the screen on every galaxy / system / planet change (`.ui-view-scan`, re-created by `@for (view of [currentView]; track view)`); the system and planet views also "land" from slightly closer (`ui-view-dive`). |
| Buttons | global `button`, `ui.button` | Hover: a light glint sweeps across the key (first background layer, moved by `background-position`) and a faint outer glow. Press: `scale: 0.97`, lit, shadow inside, instant in and eased out. `scale` is used instead of `transform` so buttons positioned with `transform` / `translate` keep working. Disabled: dead key with faint hatching. Focus: outline plus a soft ring. |
| Primary button | `.btn-primary`, `ui.button-primary` | Breathes slowly (`ui-breathe`) so the call to action is easy to find; stops on hover. |
| Selected key, tabs | `ui.button-selected`, `ui.tab` / `ui.tab-active` | The amber bar casts a glow upward; a hovered tab shows a quarter of its underline; the active tab's text glows. |
| Meters | `ui.meter-fill` | Width glides (0.4 s) instead of jumping. |
| Lists | `ui.stagger-in($count, $step)` | Rows slide in one after another when a list appears: pause menu buttons, Ship Customization roster and modules, Diplomacy cards, production queue and order types. Only plays on creation. |
| Value jumps | `ValueFlashDirective` (`[uiValueFlash]`, `components/shared/`) on the header resources | A value that jumps (not a routine tick) flashes green / red and floats its delta ("−750") below it. The directive learns the routine step size from small changes and reacts only to a change at least 4× larger (and ≥ 10); the first change only teaches the baseline. |

**Sounds** (`UiSoundService`, `services/ui-sound.service.ts`): short
retro sci-fi sounds synthesized with Web Audio — no audio files. Moving
the mouse onto an enabled button gives a soft click (a short band-passed
noise tick over a tiny falling sine); lowpassed square waves give a
two-note beep (plus a metallic FM click) on press; a disabled button gives
a low two-step saw buzz; a dialog powering on plays a 1960s bridge-console
style sine whistle (slides up, holds with vibrato) followed by a quick
burble of sine "bloops", powering off a falling whistle and a low bloop; a panel boot plays
a short high "data chatter" (not within 0.4 s of a dialog opening).
`App` calls `install()` once; it listens on the document for
`pointerover` / `pointerdown` on buttons and for `animationstart` of
`ui-crt-on` / `ui-crt-off` / `ui-panel-boot`, so any element that uses
the shared animations gets the sound for free — renaming those keyframes
breaks the sounds. Every sound has a minimum gap so a fast sweep over a
toolbar does not buzz. Browsers allow audio only after a gesture, so the
AudioContext is created on the first pointerdown (silent before). The
**UI SOUNDS** toggle in Options switches them off (localStorage
`orion_ui_sounds`, default on, not in saves).

The same service plays the **game event sounds** (`GameSound`), which the
owning code triggers directly rather than through document listeners:

| Event | Sound | Played by |
|---|---|---|
| Accepted move / intercept order (map fleet, battle stack) | `order-move`: two rising sine bloops | `StarMap.moveSelectedFleet`, `onInterceptAsteroid`; `BattleScreenComponent.onCellCommand` |
| Accepted attack / raid order | `order-attack`: three rising square notes over a saw swell | `StarMap.orderAttack`, `onRaidTrader`; `BattleScreenComponent.onStackCommand` |
| Rejected order | `deny` (same as a disabled button) | the same handlers |
| Battle volley | `fire-energy` (the four `laser1–4` samples in rotation), `fire-kinetic` (synthesized only, noise layers without a pitched tone: crack, darkening muzzle blast, mid bark, brown-noise punch and rolling tail, faint barrel ring), `fire-missile` (`rocket1`), by the first living ship's `attackType`; pitch ×1.3 light, ×1 medium, ×0.7 heavy, ×0.8 structure (samples follow it at half strength) | `BattleCombatService.attackStack` |
| Bolt hits a stack whose front ship still has shields / hits unshielded without a kill / kills ships / destroys the stack | `shield-hit` (`shiedhit1`) / `hit` (synthesized) / `ship-lost` (`explosion1`, faster and quieter) / `stack-destroyed` (`explosion1`, slower and louder, plus a sub-bass thump) | `BattleCombatService.resolveHit` (the shield is read before the damage) |
| Any stack moving or turning | engine hum: `engineloop` looped once for the whole field, fades in in ~0.2 s, out in ~0.6 s; off while paused, after the decision and when the screen closes | `BattleScreenComponent.gameLoopCallback` → `UiSoundService.setEngineLoop` (turning reported by `updateStackHeadings`) |

**Battle samples.** `public/sfx/*.ogg` (`shiedhit1.ogg` keeps the file's
own spelling) are fetched and decoded right after the AudioContext is
created (first click), listed in `SAMPLE_FILES`. They go through a clean
battle input (compressor and a lighter reverb send, no saturation, which
would distort mastered recordings). A sample that is still loading or
failed to decode falls back to the synthesized sound below, so every
battle sound always has a voice.

The synthesized battle sounds (fallbacks, and the kinetic shot and plain
hit) are layered rather than single waveforms: the laser is two
detuned saws under a resonant, closing lowpass plus an FM shimmer; the
kinetic shot a noise crack, a falling noise body, a sine thump and a short
metal ring; the missile an ignition pop, a swelling whoosh and a brown-noise
rumble; an explosion a crack, a darkening noise body, a long rumble, a
sub-bass thump and thinning debris crackle (`explosion()`, smaller for
`ship-lost`). Each play varies pitch (±8 %) and noise offset, so a long
fight does not repeat one sample. They run through a shared battle bus
(`createBattleBus`): tanh saturation, a compressor that keeps many
simultaneous shots from clipping, and a synthetic-room reverb send. They
are panned by the stack's x position (±0.7) so the side of the field is
audible. Orders are right clicks, which the global
`pointerdown` listener ignores (left button only), so an order never also
plays the button press sound. Auto-resolved battles have no sounds.

**Music** (`MusicService`, `services/music.service.ts`; files in
`public/music/`). Background tracks by scene, each a looping `<audio>`
element:

| Scene | Track | Set by |
|---|---|---|
| `title` | `title.mp3` (restarts on entry) | `MainMenu.ngOnInit` |
| `space` | `sector.mp3` (resumes where it stopped) | `StarMap` constructor and the `currentView` setter (galaxy and system view) |
| `planet` | `airy.mp3` (resumes) | `StarMap.currentView` setter (`'planet'`, the surface view) |
| `battle` | `urgent.mp3` (restarts on entry) | `BattleScreenComponent.ngOnInit` |

A scene change is always a crossfade (2.5 s; 1.2 s into a battle), also
when it changes again mid-fade; a faded-out track is paused. `currentView`
is an accessor on `StarMap` so every view change reaches the music —
assigning the backing field directly would bypass it. Stingers play once
over the music, which is ducked to 35 % meanwhile: `hover.mp3` for every
map notice (`showMapNotice`, at most every 0.8 s) and `victory.mp3` for
the victory popup (not for a defeat), the battle result popup (unless the
player's side lost; `BattleScreenComponent.ngAfterViewChecked`), opening the
Diplomacy screen and an exploration event; closing the Diplomacy screen, the
event or the battle screen fades that fanfare out. Stingers follow the **UI SOUNDS** toggle; the music has its
own **MUSIC** toggle and **MUSIC VOLUME** slider in Options (localStorage
`orion_music`, default on at 50 %, not in saves). A play() refused by the
browser's autoplay rule is retried on the next pointerdown / keydown, so
the title music may start with the first click. Under jsdom (unit tests)
the service creates no elements. `pulse.mp3` and `transmission.mp3` are in
the folder but not used yet.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the UI motion
(dialogs, panels, view dive, buttons, value flashes) runs in 0.001 s — the
enter / leave animations still end, so Angular's bookkeeping completes —
and the view sweep, the value deltas and the CRT band are hidden. Map and
battle animations are game content and are not affected.

**Rules for new UI.** Open a new modal with `animate.enter="ui-enter"
animate.leave="ui-leave"` on its host (or on its full-screen overlay
element) instead of a custom slide-in; give new lists `ui.stagger-in`
where they appear as a whole; animate only `transform`, `opacity`,
`clip-path` and `filter` for short one-shots, and never leave a
`filter` or `transform` in an end state on an element that hosts fixed
overlays.

## Screen treatments

| Screen | Treatment |
|---|---|
| Header (all in-game screens) | Console strip with scanlines and a metal rail (cyan line above it, an amber lamp near each end) along the bottom; cyan title after an amber status lamp, over a thin cyan rule; console-key buttons with the amber selected bar; the time controls and the currencies each sit in a sunken display strip (thin cyan outline, scanlines; no metal frame), the currencies with cyan figures (see [Game Header](#game-header)) |
| Star map | Roster box top left (`.map-roster`, one framed box docked into the corner under the header, no frame on the left and top): a Planets list of the player's planets above the Fleets list, separated by a hairline, same list style with a faction-colored diamond per entry; each list scrolls on its own inside the shared height budget. Clicking a planet opens its surface view directly (its system becomes the selected system, so Back lands in the system view); the planet view shows the same box planets-only, with the open planet highlighted and ◀ ▶ steppers in the title row (kept on phones, where only the word is dropped); clicking a fleet selects it, bottom-left info cards (system, fleet, planet docked into the corner; asteroid and civilian trader cards beside them) with headline figures, one navigation console (d-pad + minimap) docked into the bottom-right corner, context menu as a console list |
| System view | The planet info card's body is `PlanetDetailsComponent` (`star-map/planet-details/`), the same minimal summary as the planet view's Details tab (see below), in its `compact` mode: buildings shrink to a count in the yield strip (the grouped list is its tooltip) and the planet-type and deposit how-to hints are dropped; uninhabited planets add a one-line Colonization note (`.planet-info__note`, dim prose) explaining the next step; the scene stays dominant. The fleet panel shows a primary COLONIZE action button beside MOVE while the fleet can colonize |
| Planet view | Opaque command sidebar (framed like every console panel; its frame is mostly off screen, so it reads as a metal left edge): header, underline tabs (amber bar on the active one), then the active tab. Details (`PlanetDetailsComponent`, shared with the system view's planet card) is minimal by design (a game panel, not a table): owner and type chip (a dim line with the type's effects off earthlike worlds), a headline block (population, signed income, satisfaction meter with target mark and a ▲/▼ trend), danger alerts only when energy or workers run short or a rebellion nears, three vital tiles (spare energy, spare workers, comfort coverage; warning/danger bottom edge), one raw/research yield strip, a one-line deposit with its remaining-share meter, (the system view card's `compact` mode shows buildings only as a count with a grouped tooltip and drops the hints; the planet view hides buildings with `showBuildings`: the buildings stand on the surface; a player Trading Post adds one traders line below). Exact figures (production/consumption, workforce, comfort points, drift sources, deposit amounts and richness) are in tooltips; the empire treasury is not repeated (the header shows it). Build: cards with warm cost text (unaffordable = warning edge, locked = faint). Production / assembly are sections of the sidebar, not nested boxes. Surface d-pad and zoom selector are small framed instruments; the d-pad is compact (1.8em cells) and docked flush into the bottom-left corner with no left / bottom frame (`ui.frame-docked`) |
| Fleet command | Modal console sheet: location title with fleet/ship figures, a hint strip that follows the selection, an optional Reserve column (sunken surface, Spaceport stock) followed by fleet columns on raised surfaces edged in the faction color (class rows with faction-tinted ship SVGs, hull meters, accent-lit selection), dashed "transfer here" strips and new-fleet slot, sunken footer with change chips and Reset / Cancel / Apply (see [Fleet Organization](./fleet-organization.md#ui)) |
| Ship customization | Full-height modal console sheet (`ship-customization/`): eyebrow + fleet title; three columns: a sunken roster (faction-edged ship rows with small blueprint hull icons, hull meters and three diamond slot pips, amber when upgraded; the Reserve group in warm text), a raised blueprint (the hull as cyan line art on a cyan grid — `public/ships/blueprint/`, generated from the battle SVGs by `npm run sprites:blueprints`: outlines only, filled with the paper color `--bp-paper` so covered lines stay hidden, no engine glow or small details, a dashed centreline; three framed hardpoints with leader lines — engine at the stern, weapon at the bow, defense above — upgraded amber, selected accent-lit with the amber bar, locked dashed) above a sunken stat grid, and a sunken inventory column (module rows with counts, warm "+N" in production, faint locked, dashed REMOVE) with a raised comparison card (better values green, worse red). Below 1100 px the sheet fills the screen and the engine / weapon hardpoints move under the hull; landscape keeps the three columns (each scrolls on its own), portrait stacks them. On phone-sized screens (`compact-view` breakpoint) the sheet takes one more step down the type scale locally with a one-line header and tight paddings, so a landscape phone shows roster, blueprint and inventory side by side. See [Ship Equipment](./ship-equipment.md) |
| Diplomacy | Modal console sheet opened from the header DIPLOMACY button (warm badge = open AI proposals): eyebrow + ruled title with gauges: your reputation (shield icon, two-way bar, word) and, only while at war or penalised, a crossed-swords war count ("2 WARS") and, once your exhaustion cuts output, OUTPUT −X%; a result notice; one raised card per empire edged in its faction color (danger wash at war; dimmed and sorted last when eliminated) with relation chip with an icon (crossed swords + war duration / hourglass + truce time left / handshake + peace, all in game time) and a row of icon gauges — attitude (two-way bar + word), fleet (3-segment meter + word), planets (count), and at war a full-width will-to-peace bar (WANTS WAR / WANTS PEACE ends; Unwilling / Open / Eager) — and a MORE DETAILS disclosure per card with the exact numbers and the reasons behind the peace gauge (no hover tooltips on this screen: they fail on touch); icons come from one inline SVG sprite in the template; plus a dim "Also at war with" line; an inline success notice for an open AI proposal (REVIEW primary / DECLINE), an inline danger notice that states the consequences before DECLARE WAR / BREAK TREATY (`btn-danger`); credit demands: an incoming demand as a warning notice (danger for an ultimatum) with a quoted, personality-toned message, ACCEPT (primary) / DECLINE, a refused-ultimatum notice with DECLARE WAR (`btn-danger`) / BACK DOWN, and the inline DEMAND CREDITS form (segmented kind buttons using `button-selected`, amount input, consequence text, SEND DEMAND primary or SEND ULTIMATUM danger); and a footer with the actions (only "Talks possible in …" as text; the reason a demand is unavailable and the truce lock are button tooltips). The rules footnote is a collapsed "How diplomacy works" disclosure. See [Diplomacy](./diplomacy.md#player-ui) |
| Peace negotiation | Modal console sheet above the Diplomacy screen (game paused): faction-swatched title, two side cards edged in faction color, a success notice with the AI's terms on the table, two sunken draft columns (demand / offer: resource inputs with maxima, checkbox lists of systems and planets with warm value text, accent bar on selected rows), and a raised judgment panel (acceptance meter with a bright 50% threshold mark, verdict line, factor bars green/red); sunken footer with CLEAR / CANCEL / SEND PROPOSAL |
| Research | Full-screen dialog: header (points, income, progress meter), status filters (dimming, not removing), then a blueprint-grid **tech board** — one column per tier, icon nodes with a status edge (green / cyan / amber lamp = researchable now / faint), price with RP and credit icons, banked-share bar — beside a **detail console** for the selected node: icon in a metal-rimmed porthole, effects as icon rows, hull class badges for unlocked combat hulls, clickable Requires / Leads-to chips, price, blocker, RESEARCH. Prerequisites and follow-ups of the selection are outlined on the board (cyan / amber dashes). Icons come from one inline SVG sprite in the template (see [Research](./research.md#ui)). On phones (`compact-view`) the dialog takes one more step down the type scale locally and tightens its paddings, but the board and the detail console stay side by side (landscape phones are short, so stacking them left two thin strips); only very narrow portrait screens (≤560px) stack the detail under the board |
| Hull roles | `HullRoleComponent` (`hull-role/`): a chip-style class badge with one hue per class (light = accent, medium = warm, heavy = danger text), "beats X · weak to Y" in success / danger text, or in full mode the role summary, bonus lines and a two-column stat grid. The compact form wraps the text below the badge in narrow cards. Used by the production dialog and the research cards |
| Battle | Shared header in alert tone (danger-tinted title and rule; HOLD paused-start toggle next to AUTO); amber "battle paused" banner over the field before the first shot; a small framed ship info card (top right, faction-edged: slots with amber upgrades and dim standard ones, values, matchup green / red, see [Ship Equipment](./ship-equipment.md)); command bar with readable type, shield-tinted carrier ability, segmented targeting modes; framed result dialog with faction-edged side cards |
| Pause / options / game end | Framed console sheet, ruled title, diamond menu entries, left-barred save slots and setting rows |

## HudDotsComponent

A standalone Angular component (`app-hud-dots`) that renders a row of status
LED indicators. It is currently not used by any template; it follows the
accent tokens if reintroduced.

| Input | Type | Default | Description |
|---|---|---|---|
| `count` | `number` | `4` | Total number of dots |
| `active` | `number` | `3` | Number of lit dots |
| `size` | `'sm' \| 'md'` | `'md'` | Dot size |

## Game Header

`GameHeaderComponent` (`src/app/components/game-header/`) is the single top bar of every
in-game screen. The star map, system view and planet view use it through
`StarMapHeaderComponent`; the battle screen uses it directly. Screens never position header
controls themselves — earlier, separately positioned back / menu buttons overlapped the time
controls on narrow screens.

**Layout.** A three-column grid: *start* (back button + title, optional subtitle) · *center*
(⏸ and speed buttons, plus projected extras such as battle AUTO, inside one sunken tray) ·
*end* (projected status content such as currencies / ship stock / planet shield, then the
full-screen toggle, then the ☰ pause-menu button). Currency readouts share one sunken display strip, separated by short vertical hairlines.
The start column may shrink to zero (the title truncates with an ellipsis); the end column
never shrinks below its content. When space is ample both side columns are equal, so the time
controls sit exactly in the middle.

**Sizing.** The height is the global token `--game-header-h` (`styles.scss`,
`clamp(44px, 8dvh, 76px)`). The header defines `--gh-u = --game-header-h / 4`, and every size
inside it — including projected content (currencies, ship stock, battle shield) — is a multiple
of `--gh-u`. Content that sits below the header (planet screen, fleet list, map notices, battle
grid row) offsets itself by `--game-header-h`; never hard-code the header height.

**Buttons.** All header buttons use the `hud-button` mixins in `src/styles/_hud-controls.scss`
(`@use 'hud-controls' as hud;`), which also reset the global `button` look so hover
and press never change a button's size or position.

**Full-screen toggle.** Shown on every screen (including battle) whenever the browser supports
the Fullscreen API; hidden otherwise (e.g. iPhone Safari). It calls `requestFullscreen` on the
document root and reads its pressed state back from `fullscreenchange`, so leaving full screen
with Esc / F11 keeps the icon in sync. This is browser state only — it is not saved and does not
pause the game.

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
| Star map (galaxy) | Static deep stars + twinkle (`.star-map-deep`), wrapping nebula field (`SpaceNebulaFieldComponent`, 0.12x camera), the star-texture parallax layer (`.star-map-background`, 0.3x camera; viewport-pinned, wrapped modulo one texture tile by `StarMap.starTextureTransform`), faint dust in front (`.star-map-foreground`, 0.6x). Stars are light sources (corona, diffraction spikes, hot core; a rotating dashed ring when selected). Sensor range is a soft borderless field; the fog layer has soft edges (a one-pixel-per-cell canvas, smoothly upscaled); the navigation grid is a hairline. Movement paths have a soft beam under the dashes. Gameplay terrain follows the same look: textured, color-tinted nebula gas, a lensed black hole (Einstein ring, tilted accretion disk, bloom; its dashed no-fly outline appears only while a fleet is selected), and relief-lit static asteroid belts (details in [Star Map Terrain](./star-map-terrain.md)). Empire territory is a quiet layer under the fog: faint blurred faction tint, thin cell-edge borders (solid for the player, dashed for foreign empires), faint dashed base claim rings and small turning-ring station markers (details in [Territory](./territory.md#rendering)). Styles: `_star-map-backdrop.scss`, `_star-map-star-system.scss`. |
| System view | The system's star at the right edge is the single light source: light wash, slowly turning soft corona rays, glow, granulated disc. Planets use `planet-sphere` lit from the right with per-type palettes; faint orbit rings (`orbitDiameterVw`) connect each planet to the star; hover shows a halo ring. A nebula sits opposite the star. Styles: `star-map-system-grid.component.scss` (scene) and `_star-map-system-view.scss` (wrapper). |
| Battle | Deep stars with a distant star in the band above the field, two nebula formations framing the left and lower right (the middle stays calm behind the units), twinkling dust, a forward-motion star stream (two faint star planes drifting left at different speeds, the near one with slightly stretched stars; the main menu dust technique of sliding exactly one tile per loop; off under reduced motion) and a vignette. The field is a fading hairline grid with corner brackets. Ships carry a faction-colored glow and engine light; explosions add a shockwave ring. The planet in planet battles uses `planet-sphere` with a deep palette derived from `--planet-color`. |

### Story campaign UI

The campaign screens reuse existing treatments, no new look ([Campaign Design](./campaign-design.md#implementation-status)):

- **Campaign screen** (`main-menu/campaign-screen/`): hosted in the main menu's glass sheet like the New Game setup, with the same selectable-card style (the galaxy-size cards) for missions and difficulty, and a briefing panel.
- **Objective tracker** (`star-map-campaign-objectives/`): a compact `ui.glass` panel at the right edge under the header in the galaxy and system views, bottom-left above the camera controls in the planet view (the surface panel holds the right edge) (`.campaign-tracker` in `star-map.scss`). The host sets `--tracker-max-h` per position so the panel never grows over the game header; a long list scrolls inside `.tracker__body`. Compact view (`compact-view` breakpoint): one more step down the type scale, a one-line head, tighter rows, active objective descriptions hidden, and the tracker starts collapsed. Collapsible; ◆ open, ✓ done (success color), ✕ failed (struck through).
- **Story message** (`star-map-campaign-message/`): the exploration-event dialog frame (`ui.glass` + `ui.brackets`), accented with the speaker's faction color through `--speaker-color`.
- **Mission end**: the game-end dialog with MISSION COMPLETE / MISSION FAILED; `.game-end-title--long` shrinks the letter-spaced title so it stays inside the frame.

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

`SpaceNebulaFieldComponent` (`src/app/components/space-nebula-field/`)
repeats three nebula formations on a 180 x 130 vw lattice that scrolls with
the camera pan (0.12x). Each copy of a formation near the screen (within
25 vw) is its own small layer keyed by its lattice index and moved by a
compositor transform, so panning only changes transforms, and nebulae are
always on screen however large the galaxy is. The formations' positions and
sizes live in `FORMATIONS` in the component; each must stay inside its tile
or neighbouring copies overlap. The filter and mask sit on the inner element
so they are rasterized into the copy once. (It used to be one 360 x 260 vw
layer of 2 x 2 tiles, the largest GPU texture on phones.)

The star-texture layer (`.star-map-background`) is the screen plus one
texture tile; the tile is at most one screen wide (`StarMap.starTileW` /
`starTileH`, passed to the SCSS as `--star-tile-w` / `--star-tile-h`), so on
phones the layer stays about 2 x 2 screens.

### Stylesheet budgets

Angular enforces a 20 kB error budget per component stylesheet. Partials
shared through `@use` are copied into every stylesheet that uses them, so
only `@use` a partial in a component whose template contains its selectors
(see the note at the top of `star-map.scss`).

## Main Menu

The main menu (`src/app/main-menu/`) is the origin of the [design system](#design-system):
the in-game screens reuse its palette, glass sheet, diamond markers and
borderless list items. It remains the game's title screen with a cinematic
backdrop. Its styles are fully scoped in `main-menu.scss` (it predates the
`--ui-*` tokens and keeps its own local `--accent` / `--ink` variables with
the same values); the global button styles are overridden there under
`.main-menu`, so global button changes do not affect the menu (and vice
versa). The New Game form inside its sheet uses the design-system controls.

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
| Portrait | aspect ≤ 4/5 or width ≤ 560px | Centered column; planet rises from the bottom edge; moon hidden. On touch devices this mode is covered by the app-wide "rotate your device" gate (logo, a turning-phone icon, console panel; `components/orientation-gate/`), so it only shows in narrow desktop windows. |

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

## Image rendering

Images use the browser's default smooth filtering everywhere. The project
moved away from the pixel-art look, so there is no global
`image-rendering: pixelated` reset and components must not add one. The
planet-view building sprites are generated SVGs (`public/buildings-svg/`,
see [Planet Surface](./planet-surface.md#building-sprites)).

## Planet view

The planet view keeps its own layout (full-screen surface plus the command
sidebar on the right); only the console styling applies to it. The user
asked on 2026-11-03 not to rearrange it into the reference console layout.
The planet surface (terrain canvas, tilted ground plane with streets and
grid, sprite layer, atmosphere) is documented in
[Planet Surface](./planet-surface.md#rendering). Its controls (d-pad, zoom
selector with the NAMES toggle) are small framed instruments using the
design-system buttons; the sidebar is described under
[Screen treatments](#screen-treatments).

## Related documentation

- [Architecture](./architecture.md)
- [Game Systems](./game-systems.md)
- [Planet Surface](./planet-surface.md)

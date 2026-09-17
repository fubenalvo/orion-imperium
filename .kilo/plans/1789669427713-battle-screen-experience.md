# Battle Screen — Player Experience & Visual Presentation

> **Scope:** What the player sees, what happens and why, and how every element appears during a tactical battle. Companion to [`battle-screen.md`](./battle-screen.md) (architecture) and [`battle-rules.md`](./battle-rules.md) (combat rules).

---

## 1. Entry — How the Battle Begins

A battle is triggered automatically by the StarMap when:

- **Fleet vs Fleet:** Two hostile fleets occupy the same galaxy grid cell (collision detection runs every frame).
- **Fleet vs Planet:** A fleet arrives at an enemy planet that has defensive buildings.

When triggered, the game:
1. Calls `BattleService.setBattle()` (or `setPlanetBattle()`) with the two fleets and their faction identities.
2. Pauses the galaxy simulation (`GameTimeService.pause()`).
3. Navigates the route to `/battle`.
4. `BattleScreenComponent.ngOnInit()` builds the entire battle from scratch — no state is carried over from previous battles.

**What the player sees:** A full-screen tactical battlefield with a starfield background, a header bar, and an 18x7 grid occupying most of the screen. There is no loading transition — the battle begins immediately.

---

## 2. The Battlefield Layout — What Appears on Screen

The battle screen occupies the full viewport (100vw x 100vh) and is organized in a vertical flex column from top to bottom:

```
[HEADER: "TACTICAL BATTLE" + Planet Shield bar]   <- flex-shrink: 0
[BATTLE GRID (18x7) with stacks, effects, planet]  <- flex: 1
[CONTROLS: SHIELD PULSE or BACK TO STAR MAP]       <- flex-shrink: 0
[HINT: "SELECT A SHIP STACK, MOVE OR ATTACK"]      <- flex-shrink: 0
[SELECTION PANEL: Stats for selected stack]                <- flex-shrink: 0
```

### 2.1 Parallax Background

Two background layers respond to mouse position for a subtle depth effect:

- **Deep layer** (`battle-bg-deep`): A large starfield image (`stars-background-a.jpg`) sized at `200vw x 200vh`, offset to center, and shifted by +/-2vw/+/-2vh relative to the pointer position. Moves slowly (parallax factor ~0.5).
- **Foreground layer** (`battle-bg-foreground`): A repeating star pattern (`stars.png`) at `100vw` with 50% opacity, shifted by +/-1.25vw/+/-1.25vh. Slightly faster parallax.

Both layers are `pointer-events: none` and use `will-change: transform` for GPU-accelerated movement.

### 2.2 Header Bar

- **Title:** "TACTICAL BATTLE" in bold, letter-spaced uppercase, colored in a warm red (`#d65757`). Centered.
- **Planet Shield bar** (planet battles only): Appears below the title as a single shared readout:
  - Label: "PLANET SHIELD" in light blue
  - Progress bar: Blue gradient fill (`#2f8fd6` to `#7fd4ff`) showing `current / max`
  - Numeric text: e.g., `45 / 100`
  - Hidden entirely in fleet battles (no planet, no shared shield)

### 2.3 Battle Grid

The tactical grid renders as an 18 x 7 cell matrix where each cell is **4vw wide and 4vw tall** (72vw x 28vw total). The grid container has `box-shadow: 0 0 200vw 200vw black` — a massive black vignette that isolates the playing field from the parallax background.

Elements rendered inside the grid (all absolutely positioned in vw units):

| Element | What it is | How it appears |
|---------|-----------|----------------|
| **Planet** (`app-battle-planet`) | Planet body for planet battles only | Circular visual with name label and a shield bubble. The bubble scales from 1.0 to 1.08 and opacity from 0.25 to 0.80 based on shield fraction. Never interactive. |
| **Ship Stacks** | Groups of 1-5 ships of the same type on one side | Rectangular buttons positioned at their grid cell center. Show a count badge, an HP bar, a shield bar, and an attack-dot indicator. |
| **Move Cells** | Valid movement targets when a stack is selected | Green-tinted translucent rectangles overlaid on grid cells |
| **Projectile** | In-flight attack animation | A thin colored line from attacker to target, angled along the actual attack vector |
| **Impact** | Hit effect on target | A radial flash at the target position |
| **Explosion** | Kill effect (target destroyed) | A larger, more dramatic expanding ring at the target position |

### 2.4 Ship Stack Appearance

Each stack renders as a styled button element containing:

- **Count badge** (`stack__count`): Number of alive ships in the stack (e.g., "3"), colored in the stack's faction color (red for attacker, green for defender).
- **HP bar** (`stack__hp`): Thin bar showing hull integrity, colored in faction color. Width = sum of alive ship HP / sum of max HP.
- **Shield bar** (`stack__shield`): Thin bar above the HP bar showing shield charge (white/blue tint). When a shield is being hit by an incoming attack, it flashes via `stack__shield--hit` class.
- **Attack dot** (`stack__attack-dot`): A small indicator in the top-right corner showing the stack can attack. Hidden once the stack is moving or has already fired this cooldown cycle.

Stack CSS classes applied dynamically:
- `selected` — blue border glow (player's current selection)
- `moving` — blue tint while traveling to a target
- `firing` — red tint during attack animation
- `attack-target` — red pulsing border (enemy in direct range)
- `move-to-attack-target` — orange tint (enemy reachable after moving)
- `carrier-boost-target` — cyan tint (ally in range of a carrier's Shield Pulse)

---

## 3. How the Battle Unfolds — Real-Time Flow

### 3.1 The RAF Game Loop

The battle runs in **continuous real-time** at 60fps via `requestAnimationFrame` (managed by `BattleGameLoopService`). The loop runs outside Angular's zone for performance and uses raw real delta time (clamped to 0.1s).

Every frame, the following happens in order:

```
1. updateStackPositions()      -> all stacks move toward their targets at speed vw/s
2. AI tick (every 200ms)       -> one AI stack acts (attack -> boost -> move)
3. Player auto-attack          -> each player stack attacks if in range & cooled down
4. Shield regen (every 1s)     -> all ships + planet shield regenerate
5. checkVictory()              -> if one side has 0 alive stacks, battle ends
6. anim.tick()                 -> notify view to re-render
```

**What the player experiences:** Ships continuously glide across the grid toward their targets. Enemy ships move and attack automatically. Player stacks auto-attack enemies in range. Shields slowly refill. The battle is a living, breathing real-time skirmish.

### 3.2 Movement — How Ships Travel

When the player clicks a green highlighted cell (or the AI computes a move):

1. `BattleMovementService.moveStack()` validates: in bounds, path clear, not occupied.
2. The stack's `targetX`/`targetY` are set to the visual center of the destination cell.
3. `stack.moving = true`.
4. Every frame, `updateStackPositions()` moves the stack at its `speed` (vw/s) toward the target. Speed comes from `ship-data.json` (range 1-5 vw/s).
5. When the stack arrives (`distance < 0.01`), it snaps to the grid cell: col/row update, `moving = false`.

**Visual:** Ships smoothly slide across the grid in straight-line paths (orthogonal or diagonal). No teleporting, no stepping animation — pure continuous interpolation.

### 3.3 Combat — How Attacks Look and Resolve

When a stack attacks:

**Phase 1 — Projectile (320ms):**
- A line appears from the attacking stack's center to the target stack's center.
- The attacking stack gets a `firing` class (red tint).
- The `projectile` element renders as a thin colored line with CSS rotation matching the attack angle.

**Phase 2 — Impact (200ms):**
- The projectile line disappears.
- An `impact` element appears at the target position — a radial flash.
- Damage resolves silently (no dice rolls; fully deterministic).
- If the target is destroyed (all ships dead), the impact upgrades to **explosion**.

**Phase 3 — Explosion (420ms):**
- The `explosion` element renders as a larger ring at the target's position.
- The target stack is marked `destroyed` and disappears from the grid after the animation.

**Damage resolution (invisible to the player):**
- Total attack = sum of all alive ships' `attack` in the firing stack.
- Raw damage = `max(1, totalAttack - frontShip.defense)`.
- Weapon effectiveness multiplier (1.5x strong, 1.0x neutral, 0.5x resisted) based on attacker's `attackType` vs target's `weakness`.
- Shield absorbs damage first (per ship), then hull HP. Overkill spills to the next ship.
- Each attack is logged as a `BattleLogEntry`.

### 3.4 Shield Regeneration

Every 1 second, all living ships on both sides gain shield back up to their maximum (amount = `shieldRegen` stat). In planet battles, the shared planetary shield pool also regenerates.

**What the player sees:** Shield bars on stacks gradually fill upward between combat bursts. The round counter increments each regen tick (internally; not displayed in UI).

---

## 4. Player Interaction — How Input Works

### 4.1 Selection

- **Click own stack** -> selects it. Move cells turn green, attack targets glow red. The selection panel at the bottom populates with the stack's stats.
- **Click another own stack** -> switches selection.
- **Click an enemy stack** -> if in range, attacks immediately; if out of range, moves toward it (move-to-attack).
- **Click empty grid cell** -> if a stack is selected, moves it there.

### 4.2 Move Highlight (Green Cells)

When a stack is selected, all reachable cells (in bounds, unoccupied, clear path, no distance limit) light up as green translucent squares. The player can click any green cell to move there.

### 4.3 Attack Highlight (Red Targets)

Enemy stacks within attack range pulse red and are clickable for direct attacks. Enemy stacks just out of range but reachable after a move show an orange tint — clicking them triggers a move-to-attack command.

### 4.4 Shield Pulse (Carrier Special)

When a Carrier stack is selected and can boost allies, a cyan **"SHIELD PULSE"** button appears in the controls bar. Clicking it instantly restores shield to all friendly stacks within the Carrier's attack range, capped at each ship's max shield. This is the Carrier's one special action — no cooldown, but gated by the animation lock.

### 4.5 Input Gating

- **Animation lock** (`anim.isBusy`): When any attack animation is playing (projectile -> impact -> explosion), the player cannot select stacks, move, or attack. Movement itself is never blocked.
- **Battle over**: No input accepted once a winner is declared.
- **Selected stack must not be moving**: A stack in transit cannot receive new commands.

---

## 5. The Selection Panel — What Appears at Bottom

When a stack is selected, a dark panel slides in at the bottom of the screen showing:

| Field | Display |
|-------|---------|
| **Type name** | e.g., "FRIGATE", "CARRIER" (uppercase, bright) |
| **Side** | "ATTACKER" (red) or "DEFENDER" (green) badge |
| **IMMOBILE** | Yellow badge if the stack cannot move (planet defenses) |
| **MOVING** | Blue badge while traveling |
| **Ships** | Alive count / total in stack (e.g., "3 / 5") |
| **Tier** | Combat tier (1-5) |
| **ATK** | Total attack of alive ships |
| **DEF** | Total defense of alive ships |
| **SPEED** | Movement speed (vw/s) |
| **SHIELD** | Shield bar + current/max value |
| **HP** | Hull bar + current/max value (colored by faction) |

All bars animate smoothly via CSS `transition: width 0.25s ease`.

---

## 6. The Result Overlay — How Victory Appears

When one side has zero alive stacks, `checkVictory()` sets `state.winner`. After the final animation completes (`anim.isBusy === false`), the result overlay appears.

### 6.1 Transition

- The entire screen dims with a `rgba(0, 0, 0, 0.76)` overlay with a subtle `backdrop-filter: blur(2px)`.
- The modal slides in with `scale(0.96) -> scale(1)` and a `translateY(0.4rem -> 0)` shift over 180ms ease-out.
- Keyboard focus automatically moves to the "BACK TO STAR MAP" button (accessibility: `aria-modal="true"`, `role="dialog"`).

### 6.2 Modal Contents

**Header:**
- "BATTLE COMPLETE" title in green.
- Winner name, side badge ("ATTACKER" / "DEFENDER"), and battle type ("FLEET BATTLE" / "PLANET BATTLE").
- Round count.
- For planet battles: a colored label — "CAPTURED" (green) if attacker won, "DEFENDED" (red) if defender held.

**Body — Two side cards (grid layout, 2 columns on desktop, 1 on mobile):**

Each card shows:
- Side name and fleet name.
- "VICTORY" (green) or "DEFEAT" (red) badge.
- Survivors count: e.g., "SURVIVORS: 4 / 7".
- Losses count: "LOSSES: 3".
- Winner card has a green border glow and tinted background; loser card has red accents.

**Footer:**
- Single "BACK TO STAR MAP" button in green.
- Clicking it triggers `backToStarMap()`, which:
  - Persists the battle outcome to the AUTOSAVE slot (fleet HP/destruction, planet ownership if applicable).
  - Resumes the galaxy simulation (`gameTimeService.resume()`).
  - Navigates back to `/star-map`.

### 6.3 What the Player Cannot Do During the Result

- The result overlay cannot be dismissed by clicking outside, pressing Escape, or any key — only the button works.
- No battle input is possible (the battle is already over).

---

## 7. Error State — No Active Battle

If the route is `/battle` but no battle was set (direct navigation without trigger), a centered error message appears: "NO ACTIVE BATTLE" in red, with a "BACK TO STAR MAP" button below it. No grid or gameplay elements render.

---

## 8. Mobile Responsive

At `max-width: 900px`:
- The result overlay stretches to full width/height (no side-by-side cards).
- Side cards stack vertically (1 column).
- Header switches to column layout.
- The "BACK TO STAR MAP" button fills the modal width.

---

## 9. What Never Appears

| Element | Reason |
|---------|--------|
| Turn/round counter in the UI | The real-time model has no turns; rounds are internal only |
| Action Point display | No AP system — speed-based, no cooldowns |
| Planet as a targetable unit | Planet visual is presentation-only, never part of combat state |
| Shared shield as a separate unit | Planetary shield is a pool shown in the header bar, not as a stack |
| Virtual defense fleet in fleet battles | Planet battles only; fleet battles have no planet visual |
| Mid-battle save/load | No tactical state persistence; battle is ephemeral |
| Sound effects | Audio is out of scope |

---

## 10. Color Reference

| Element | Color | Usage |
|---------|-------|-------|
| Attacker faction | `#ff5252` (red) | Stacks, HP bars, side badge, faction tint |
| Defender faction | `#4caf50` (green) | Stacks, HP bars, side badge, faction tint |
| Selection | `#3586e5` (blue) | Selected stack border, panel border |
| Move highlight | Green translucent | Valid move cells |
| Attack highlight | Red pulse | Enemy in range |
| Shield bar | Cyan/white gradient | Shield charge bars, planet shield bar |
| Carrier boost | Cyan (`#3ec8ff`) | SHIELD PULSE button, boost target tint |
| IMMOBILE | Orange (`#ffb74d`) | IMMOBILE badge |
| Victory | Green (`#4caf50`) | Result modal border, title, VICTORY badge |
| Defeat | Red (`#d65757`) | DEFEAT badge |
| Background deep | Starfield image | Parallax deep layer |
| Background foreground | Star pattern (50% opacity) | Parallax foreground layer |

---

## 11. Animation Timing Reference

| Animation | Duration | Triggers |
|-----------|----------|----------|
| Projectile (attack line) | 320ms | Every attack, phase 1 |
| Impact (hit flash) | 200ms | Attack hits but target survives |
| Explosion (kill effect) | 420ms | Target stack fully destroyed |
| Result overlay fade-in | 160ms | Victory declared |
| Result modal slide-in | 180ms | Victory declared |
| Shield/HP bar width change | 250ms ease | Any shield/HP change |

---

## 12. Keyboard Accessibility

- All interactive stack buttons are `<button>` elements (natively focusable).
- The result modal has `aria-modal="true"` and `aria-labelledby="battle-result-title"`.
- The "BACK TO STAR MAP" button receives focus automatically when the result appears (`resultModalFocused` flag in `ngAfterViewChecked`).
- Focus outline: `2px solid var(--color-blue-bright)` with `2px` offset on hover/focus-visible.
# Planet Surface — 2x Cells + Scroll (drag / nav buttons / touch)

## Goal
`grid cellek kétszer ekkorák` + scrollozható surface (egér drag, nav gombok, touch), hogy képernyőnél nagyobb surface-ek is használhatók legyenek.

## Context
- `PLANET_SURFACE_CELL_VW = 3` (`src/app/components/star-map/star-map.models.ts:50`), `StarMapPlanetScreenComponent` (`src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts:136`) használja: `gridTemplateColumns = repeat(gridSize, cellVw+'vw')`. SCSS: `.planet-surface__grid { gap:1vw; width:max-content; justify/align center }`, parent `.planet-surface { display:flex; overflow:hidden; background+noise }`, isometric: `.planet-surface__grid--isometric { transform: rotateX(45deg) rotateZ(45deg) }` + `::before/::after` overlay `z-index:10; pointer-events:none`.
- Grid méret: `gridSize = numericSize*2+3` (5/7/9/11). Jelenleg 11x11: `11*3+10*1=43vw` → belefér. 6vw-vel: `11*6+10*1=76vw`, viewport (~74vw széles, ~52vw magas landscape-ben) → túlfolyik, kell pan.
- Isometric diamond window: `overflow:hidden` vágja a 45°-os sarkokat. Galaxytérkép `cameraX/Y + translate + pointer drag (+dragMoved threshold) + clamp` mintát használ — planethez hasonló, de külön state.
- Cell click `onCellClick(row,col)` épület-lerakás — drag után nem szabad placementet triggerelni.

## Decisions
- **Cell duplázás:** `PLANET_SURFACE_CELL_VW: 3 → 6`. Egy helyen változik, `gap:1vw` marad.
- **Pan modell:** transform-alapú pan (nem native `overflow:auto`). Indok: isometric `rotateX/Z` vizuális bbox-a ≠ layout bbox, natív scroll overflow megbízhatatlan. Wrapper `.planet-surface__viewport` (absolute inset 0, `touch-action:none`) + `.planet-surface__grid` absolute `top:50%;left:50%; transform: translate(-50%,-50%) translate(-scrollX vw,-scrollY vw) [rotateX/Z]` — pan screen-térben, centerezés megmarad.
- **State:** `scrollX/Y: number` (vw), `isSurfaceDragging/dragMoved`, `dragStartX/Y`, `dragScrollStartX/Y`, `dragThreshold=5`, `suppressClick` flag. `AfterViewInit` + `HostListener('window:resize')` + `ngOnChanges(gridSize)` → clamp újraszámítás.
- **Clamp:** analitikus: `gridW = 7*gridSize-1` vw; viewport `vw` DOM-ból (`viewport.offsetWidth/(innerWidth/100)`), maxScroll = max(0,(gridW - viewportW)/2) mindkét tengelyen, clamp `[-max,max]`. `0` = centerezett. Elég a diamondhoz (layout alapon konzervatív).
- **Drag:** viewport `(pointerdown/move/up/cancel)` + `setPointerCapture`, `dragMoved` küszöb, `scroll = dragStart - deltaPx * (100/innerWidth)`, clamp, `prevent cell click` guard.
- **Touch:** pointer events + `touch-action:none` lefedi.
- **Nav gombok:** inline d-pad a planet-screenben (nem `StarMapNavigationComponent` újrahasználás — az minimap-et is hoz). 4 irány + center, `pointerdown` → `startPan(dir)` (azonnal + `setInterval 50ms` repeat), `pointerup/leave/touchend/cancel` → `stopPan()`. Pan step ~3vw / tick (galaxy `cameraSpeed=2` mintára).
- **Click suppression:** `pointerdown: dragMoved=false`; `pointermove>thr: dragMoved=true`; `pointerup: if(dragMoved) wasDragged=true`; `onCellClick` elején `if(wasDragged||dragMoved) return` és `pointerdown` reset.

## Tasks (ordered)
1. `src/app/components/star-map/star-map.models.ts` — `PLANET_SURFACE_CELL_VW = 6` (+ comment).
2. `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts`
   - imports: `AfterViewInit, ViewChild, ElementRef, HostListener, OnChanges`.
   - state: `scrollX/Y`, drag vars, `panIntervalId`, `wasDragged`.
   - `@ViewChild('surfaceViewport') viewportRef: ElementRef`.
   - getter `gridTransform: string` → ``translate(-50%,-50%) translate(${-scrollX}vw,${-scrollY}vw)${isometric?' rotateX(45deg) rotateZ(45deg)':''}``.
   - `ngAfterViewInit`,`ngOnChanges`,`onResize` → `updateClamp()` (mér viewport, számol gridW, clamp).
   - `onSurfacePointerDown/Move/Up`, `panBy`, `startPan/stopPan`, `centerScroll()` (scroll=0).
   - guard `onCellClick` elején.
3. `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html`
   - `.planet-surface` belülre: `.planet-surface__viewport #surfaceViewport (pointerdown/move/up/cancel/wheel?)` → benne `.planet-surface__grid [style.transform]="gridTransform"` (keep `[class.planet-surface__grid--isometric]="isometric"` a descendant `.building-name` counter-rotate miatt, de grid `transform` már inline-ból jön — SCSS-ből `transform` sor törlendő).
   - `.planet-surface__nav` d-pad overlay (5 gomb, `(pointerdown)` startPan, `(pointerup/mouseleave/touchend/touchcancel)` stopPan, `(click)` single step fallback, `stopPropagation`).
4. `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss`
   - `.planet-surface { position:relative; overflow:hidden }` (keep).
   - új `.planet-surface__viewport { position:absolute; inset:0; overflow:hidden; touch-action:none; cursor:grab; &.dragging{cursor:grabbing} }`.
   - `.planet-surface__grid { position:absolute; top:50%; left:50%; display:grid; gap:1vw; width:max-content; will-change:transform }`; `.planet-surface__grid--isometric` alól `transform: rotate...` törlése (inline-ban van), `transform-origin:center` és descendant `.building-name {transform:rotate(-45deg)...}` megtartása.
   - `.planet-surface__nav` — absolute bottom-left (vagy bottom-center), `z-index:20`, `display:grid 3x3`, gombok `StarMapNavigation` mintára (border blue, hover bright), `pointer-events:auto`.
5. Docs (opcionális): `docs/game-state.md:4.3` „3vw cells” → „6vw cells, pannable” + pan leírás.
6. Validáció: `npm run build` / `ng test`.

## Risks / Mitigations
- Inline `transform` felülírja SCSS `.isometric` `transform`-ját → fix: teljes transform inline-ban, class csak descendant szabályhoz kell → SCSS-ből grid `transform` sor eltávolítása.
- `::before/::after` z-index 10 fölött van → nav `z-index:20` kell, `pointer-events:none` miatt drag nem blokkolt.
- Drag vs click verseny → `dragMoved` + `wasDragged` guard, `setPointerCapture`.
- Resize/sidebar 26%/320px miatt viewport vw változik → DOM mérés + `window:resize` host listener.

## Validation
- `ng test` — `star-map-planet-screen.component.spec.ts` (11 teszt) pass.
- `ng build` hibátlan.
- Manuál: size 4 bolygó (11x11) → 6vw cellák, diamond pan drag/touch/nav-val, clamp széleken, cell click csak nem-drag esetén helyez.

## Out of scope
- `gridSize` képlet / `planetData` size bővítés (scroll már támogatja, külön task).
- Zoom/pinch, minimap a surface-hez.

---

# Fix: horizontal scroll nélkül marad a clamp (isometric layout bbox ≠ visual bbox)

## Problem
`updateClamp()` a grid **layout** méretét használja:
```ts
const gridSizeVw = this.gridSize * this.cellVw + (this.gridSize - 1) * this.gridGapVw;
this.maxScrollX = Math.max(0, (gridSizeVw - viewportWidthVw) / 2);
```
A grid viszont 45°-os isometric tiltben van (`rotateX(45deg) rotateZ(45deg)`), így a **vizuális** diamond sokkal szélesebb, mint a layout bbox:
- layout szélesség = `gridSize*6 + (gridSize-1)*1` vw
- vizuális szélesség = layout * √2 ≈ layout * 1.414
- vizuális magasság ≈ layout (rotateX 45° összenyomja a függőleges tengelyt)

Earth = medium → gridSize 9 → layout 62vw, vizuális W ≈ 87.7vw, H ≈ 62vw.
Viewport szélessége a sidebar (26%/320px) levonása után ~75vw, magasság ~52vw (landscape).
`maxScrollX = (62-75)/2 = 0` → **horizontálisan nem scrollozható**, a diamond bal/jobb sarkai (a távoli tile-ok) `overflow:hidden`-vel le van vágva, és a pan sem engedi őket láttatni. Vertikálisan viszont a magasság (62vw) > viewport (52vw) → `maxScrollY > 0`, így függőlegesen működik.

## Fix
A clamp-ban a **vizuális** méretet kell használni, nem a layout-ot:

```ts
const gridSizeVw = this.gridSize * this.cellVw + (this.gridSize - 1) * this.gridGapVw;
const visualWidthVw = this.isometric ? gridSizeVw * Math.SQRT2 : gridSizeVw;
const visualHeightVw = this.isometric ? gridSizeVw : gridSizeVw;
this.maxScrollX = Math.max(0, (visualWidthVw - viewportWidthVw) / 2);
this.maxScrollY = Math.max(0, (visualHeightVw - viewportHeightVw) / 2);
```

Megjegyzés: `rotateX(45°) rotateZ(45°)` után a vizuális bbox mérete `W = L*√2`, `H = L` (a rotateX összenyomja a magasságot cos45°-re, ami éppen √2/2, és a rotateZ elforgatja). A `Math.SQRT2` közelítés jó; ha pontosság kell, mérhető a grid `getBoundingClientRect()`-jéből, de a layout-alapú számítás elegendő.

## Tasks
1. `star-map-planet-screen.component.ts:445 updateClamp()` — bevezeti a `visualWidthVw`/`visualHeightVw` számítást a fenti képlettel, és azokat használja a clamp-ban.
2. Validáció: `npm run build` + `npm run test` (345 pass, a pre-existing app.spec.ts failure nem érintett).
3. Manuális: Earth (medium, 9x9) → mostantól bal/jobb gombbal panolva látszódjanak a távoli tile-ok; a clamp széleken ne engedje a diamond teljes eltűnését.

## Risks
- A `Math.SQRT2` közelítés miatt a clamp kissé szűkebb vagy tágabb lehet, mint a pontos bbox; az `overflow:hidden` miatt egy pár pixelnyi eltolódás nem látványos.
- Ha a vizuális méret kisebb, mint a viewport (kis bolygók), `maxScroll` 0 marad, nincs pan — helyes.

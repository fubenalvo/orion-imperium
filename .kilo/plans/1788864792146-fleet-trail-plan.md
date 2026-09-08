# Fleet Movement Trail Feature Plan

## Overview

Add an animated visual trail connecting each moving fleet to its current target,
rendered as a CSS-transformed div line in both galaxy and system views.

## Requirements

- Render in galaxy map view AND system view
- Use CSS-transformed div elements (no SVG/canvas)
- Animated dash pattern to indicate motion direction
- Fog of war ON: show only player faction trails
- Fog of war OFF: show all faction trails

## Files to Modify

1. `star-map-galaxy-view.component.html` - add trail div layer
2. `star-map-galaxy-view.component.ts` - add @Input for trails
3. `star-map-system-grid.component.html` - add trail div layer
4. `star-map-system-grid.component.ts` - add @Input for trails
5. `star-map.ts` - compute trail list, pass to children
6. New shared SCSS file for trail styling

## Implementation Steps

1. Create trail data model (from, to, factionId)
2. Compute trails in star-map.ts based on fleet targets
3. Add trail rendering to both view components
4. Add animated CSS styling
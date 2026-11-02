# Changelog

All notable changes to Orion Imperium. Versioning rules: [docs/versioning.md](docs/versioning.md).

## [Unreleased]

### Changed
- Stations are no longer finished on deployment: a space base takes 60 s and a mining station 180 s of game time to build. Until complete a station claims no territory, senses nothing, extracts nothing and pays no upkeep, and it cannot fire back: any hostile warship fleet destroys the construction site.

### Added
- The Dyson ring: 8 anchor slots and their wedges around the central black hole are shown on the galaxy map, visible to every empire regardless of fog. Anchors themselves are not in the game yet.
- Stellar Engineering (6,000 research points, after Applied Science and Advanced Power) unlocks the Swarm Constructor: a slow, fragile, expensive ship (15,000 credits, 6,000 raw materials) that builds a Dyson anchor on an empty ring slot (DEPLOY ANCHOR, 300 s construction). A completed anchor claims its ring wedge, senses like a radar base and costs 60 upkeep points. Its panel offers a one-time bonus pick and DEMOLISH (no refund, frees the slot). Bonuses per completed anchor, adding up: Stellar Power +1% power-plant energy, Orbital Foundries −1% ship raw-material cost, Swarm Observatory +1 research point every 10 s. Anchors are visible to every empire regardless of fog.
- Dyson Swarm victory: a faction holding a completed anchor on all 8 slots (and at least one planet) starts a 5-minute warm-up, shown to everyone as a countdown at the bottom of the map. Losing any anchor or the last planet cancels it; it restarts from 5 minutes. When it ends, that faction wins (defeat for you if it is an AI). The warm-up is saved.
- Dyson news: every anchor started, completed, destroyed or demolished, and every warm-up start or interruption, is announced to every player regardless of fog of war.
- The ring zone (10 cells around the black hole) is reserved: no star system or space base claims territory there, and ordinary space bases cannot be deployed in it. New galaxies keep nebulae out of it.

## [0.3.0] — 2026-11-02

First versioned release. Earlier builds showed "v0.2" in the main menu without a formal version.

### Changed
- The game version now comes from `package.json` and is shown in the main menu.
- Saves record the game version that wrote them.

### Removed — save compatibility line
- Save format 12 is the new baseline. Saves from earlier builds (format 0–11) are no longer loaded: they are shown as "Incompatible" in the load lists and cannot be resumed.
- All migration code for the old formats was removed.

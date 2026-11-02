# Changelog

All notable changes to Orion Imperium. Versioning rules: [docs/versioning.md](docs/versioning.md).

## [0.3.0] — 2026-11-02

First versioned release. Earlier builds showed "v0.2" in the main menu without a formal version.

### Changed
- The game version now comes from `package.json` and is shown in the main menu.
- Saves record the game version that wrote them.

### Removed — save compatibility line
- Save format 12 is the new baseline. Saves from earlier builds (format 0–11) are no longer loaded: they are shown as "Incompatible" in the load lists and cannot be resumed.
- All migration code for the old formats was removed.

export const PLANET_SIZE_MAP = {
    tiny: 1,
    small: 2,
    medium: 3,
    big: 4,
    huge: 4,
};
export const PLANET_TYPE_COLORS = {
    earthlike: 'rgb(12, 173, 60)',
    marslike: 'rgb(94, 26, 26)',
    venuslike: 'rgb(161, 103, 27)',
    gasgiant: 'rgb(120, 70, 160)',
    ice: 'rgb(187, 218, 218)',
    desert: 'rgb(145, 132, 107)',
};
/*
 * Per-second satisfaction drift imposed by a planet's type when it is owned
 * and populated. Habitable worlds (earthlike, gasgiant) impose no penalty;
 * harsher worlds drain satisfaction and must be offset with social
 * infrastructure. This is a *base* drift — building moraleRate bonuses are
 * added on top in EconomyService.applyEconomyDelta.
 *
 * Units: satisfaction points per second (game time).
 */
export const PLANET_TYPE_HABITABILITY = {
    earthlike: 0,
    marslike: -0.03,
    venuslike: -0.05,
    gasgiant: 0,
    ice: -0.08,
    desert: -0.05,
};
// Planet surface grid cell size in vw units. 80% of the doubled size so
// large planet surfaces still overflow the viewport while leaving room to
// pan a little around the grid. Surfaces larger than the viewport rely on
// panning to be fully visible.
export const PLANET_SURFACE_CELL_VW = 3.36;
// Derives the IDs of AI-controlled factions from the live factions array.
// Replaces the previous hardcoded `new Set(['enemy1', 'enemy2'])` pattern,
// so adding/removing/renameing enemy factions is a data-only change.
export function getAiFactionIds(factions) {
    return factions.filter((f) => f.ai === true).map((f) => f.id);
}

/**
 * TVs crop the picture's edge (overscan); Android TV's guidance keeps
 * everything that matters 5 % in from each side of the 960 × 540 dp screen.
 */
export const TV_SAFE = { x: 48, y: 27 } as const;

/** Poster width on a rail: six and a bit across, so the next one peeks in. */
export const RAIL_POSTER = 132;
export const RAIL_GAP = 16;

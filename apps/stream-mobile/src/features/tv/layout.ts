/**
 * TVs crop the picture's edge (overscan); Android TV's guidance keeps
 * everything that matters 5 % in from each side of the 960 × 540 dp screen.
 */
export const TV_SAFE = { x: 48, y: 27 } as const;

export const SCREEN = { width: 960, height: 540 } as const;

/** The navigation rail, collapsed to icons and opened over the content. */
export const RAIL = { collapsed: 88, expanded: 280 } as const;

/** Where browsing content starts, just right of the collapsed rail. */
export const CONTENT_X = 104;

export const TILE_GAP = 14;

/** Poster tiles (2:3) and box-art tiles (16:9). */
export const POSTER = { width: 112, height: 168 } as const;
export const BOX = { width: 224, height: 126 } as const;

/** Top 10: the rank numeral's share beside its poster. */
export const RANK_WIDTH = 74;

/** A row title's line. */
export const ROW_LABEL = 24;

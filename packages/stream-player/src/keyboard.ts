export type Direction = "up" | "down" | "left" | "right";

/** What the focused element is, read from its `data-player-role`. */
export type FocusTarget = "none" | "control" | "seek" | "volume";

export type PlayerAction =
  | { type: "toggle-play" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek-by"; seconds: number }
  | { type: "seek-fraction"; fraction: number }
  | { type: "seek-edge"; edge: "start" | "end" }
  | { type: "volume-by"; delta: number }
  | { type: "toggle-mute" }
  | { type: "toggle-fullscreen" }
  | { type: "toggle-captions" }
  | { type: "close-menu" }
  | { type: "back" }
  | { type: "focus"; direction: Direction }
  | { type: "reveal" };

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface KeyContext {
  chromeVisible: boolean;
  menuOpen: boolean;
  target: FocusTarget;
}

export const SEEK_STEP_S = 10;
export const VOLUME_STEP = 0.1;

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack"]);

const MEDIA_KEYS: Record<string, PlayerAction> = {
  MediaPlayPause: { type: "toggle-play" },
  MediaPlay: { type: "play" },
  MediaPause: { type: "pause" },
  MediaStop: { type: "pause" },
  MediaFastForward: { type: "seek-by", seconds: SEEK_STEP_S },
  MediaRewind: { type: "seek-by", seconds: -SEEK_STEP_S },
};

function arrowAction(direction: Direction, ctx: KeyContext): PlayerAction {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "down" ? -1 : 1;
  const seek: PlayerAction = { type: "seek-by", seconds: sign * SEEK_STEP_S };
  const volume: PlayerAction = { type: "volume-by", delta: sign * VOLUME_STEP };

  if (!ctx.chromeVisible || ctx.target === "none") {
    return horizontal ? seek : volume;
  }
  if (horizontal && ctx.target === "seek") return seek;
  if (horizontal && ctx.target === "volume") return volume;
  return { type: "focus", direction };
}

/**
 * Maps a key press to a player action. `null` leaves the key to the browser
 * (Tab, Enter on a visible control) or to an open menu.
 */
export function resolveKey(
  input: KeyInput,
  ctx: KeyContext,
): PlayerAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  const { key } = input;

  if (BACK_KEYS.has(key)) {
    return ctx.menuOpen ? { type: "close-menu" } : { type: "back" };
  }
  if (ctx.menuOpen) return null;

  const media = MEDIA_KEYS[key];
  if (media) return media;

  const direction = ARROWS[key];
  if (direction) return arrowAction(direction, ctx);

  if (key === "Enter") {
    if (!ctx.chromeVisible) return { type: "reveal" };
    return ctx.target === "none" ? { type: "toggle-play" } : null;
  }
  if (key === "Home" || key === "End") {
    if (ctx.target !== "seek" && ctx.target !== "none") return null;
    return { type: "seek-edge", edge: key === "Home" ? "start" : "end" };
  }
  if (/^[0-9]$/.test(key)) {
    return { type: "seek-fraction", fraction: Number(key) / 10 };
  }

  switch (key === " " ? key : key.toLowerCase()) {
    case " ":
    case "k":
      return { type: "toggle-play" };
    case "j":
      return { type: "seek-by", seconds: -SEEK_STEP_S };
    case "l":
      return { type: "seek-by", seconds: SEEK_STEP_S };
    case "f":
      return { type: "toggle-fullscreen" };
    case "m":
      return { type: "toggle-mute" };
    case "c":
      return { type: "toggle-captions" };
    default:
      return null;
  }
}

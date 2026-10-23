export interface Tap {
  x: number;
  at: number;
}

export type TapZone = "left" | "center" | "right";
export type TapResult = "single" | "seek-back" | "seek-forward";

export const DOUBLE_TAP_MS = 300;

export function tapZone(x: number, width: number): TapZone {
  if (width <= 0) return "center";
  const fraction = x / width;
  if (fraction < 1 / 3) return "left";
  if (fraction > 2 / 3) return "right";
  return "center";
}

/** A second tap on the same outer third within the window seeks; taps chain. */
export function resolveTap(
  previous: Tap | null,
  next: Tap,
  width: number,
): TapResult {
  if (!previous || next.at - previous.at > DOUBLE_TAP_MS) return "single";
  const zone = tapZone(next.x, width);
  if (zone === "center" || zone !== tapZone(previous.x, width)) return "single";
  return zone === "left" ? "seek-back" : "seek-forward";
}

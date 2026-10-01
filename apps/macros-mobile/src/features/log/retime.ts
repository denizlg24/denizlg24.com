export const RETIME_STEP_MINUTES = 15;
/** Vertical travel per step; a screen's height covers roughly half a day. */
export const RETIME_STEP_POINTS = 12;

const LAST_SLOT = 24 * 60 - RETIME_STEP_MINUTES;

export function minutesOfClock(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

export function clockOfMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The time of day a vertical drag lands on: down is later, up is earlier,
 * snapped to the quarter hour and kept on the entry's own day. No travel
 * leaves the time exactly as it was, off-grid or not.
 */
export function retimedMinutes(base: number, translationY: number): number {
  const steps = Math.trunc(translationY / RETIME_STEP_POINTS);
  if (steps === 0) return base;
  const moved = base + steps * RETIME_STEP_MINUTES;
  const snapped = Math.round(moved / RETIME_STEP_MINUTES) * RETIME_STEP_MINUTES;
  return Math.min(LAST_SLOT, Math.max(0, snapped));
}

/** "+1 h 15 min", "−30 min". */
export function formatShift(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${sign}${rest} min`;
  return rest === 0 ? `${sign}${hours} h` : `${sign}${hours} h ${rest} min`;
}

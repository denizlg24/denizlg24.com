/**
 * Radix menus and sheets hand focus back to their trigger once they have
 * finished closing — which is after the item chosen from them has rendered.
 * An inline editor opened from a menu therefore loses focus a moment after
 * taking it, and because it commits on blur, an empty draft is cancelled
 * before anyone could type. The editor claims focus on mount; a menu whose
 * closing overlaps the claim leaves focus where it is.
 */
const CLAIM_WINDOW_MS = 1_000;
let claimedAt = 0;

export function claimFocus(): void {
  claimedAt = Date.now();
}

export function keepClaimedFocus(event: Event): void {
  if (Date.now() - claimedAt < CLAIM_WINDOW_MS) event.preventDefault();
}

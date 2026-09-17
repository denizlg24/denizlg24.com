import { flushSync } from "react-dom";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Applies a step change as a view transition, so the outgoing step animates
 * out while the incoming one animates in (flow.css). Group every state update
 * that belongs to the change into `update` — an error set outside it would
 * paint on the old step for a frame before the swap.
 *
 * `flushSync` is what makes React commit inside the transition's callback;
 * without it the DOM would still show the old step when the browser takes
 * the "new" snapshot.
 */
export function transitionStep(update: () => void): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  document.startViewTransition(() => {
    flushSync(update);
  });
}

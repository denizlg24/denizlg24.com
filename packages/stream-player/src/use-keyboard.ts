import { type RefObject, useEffect, useRef } from "react";
import { nearestInDirection } from "./focus-nav";
import {
  type Direction,
  type FocusTarget,
  type PlayerAction,
  resolveKey,
} from "./keyboard";

export interface UseKeyboardOptions {
  containerRef: RefObject<HTMLElement | null>;
  chromeVisible: boolean;
  menuOpen: boolean;
  reveal: () => void;
  run: (action: PlayerAction) => void;
}

function focusTarget(element: Element | null): FocusTarget {
  if (!(element instanceof HTMLElement)) return "none";
  const role = element.dataset.playerRole;
  return role === "seek" || role === "volume" || role === "control"
    ? role
    : "none";
}

/** Moves focus to the nearest `[data-player-nav]` element; false when there is none. */
export function moveFocus(container: HTMLElement, direction: Direction) {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>("[data-player-nav]"),
  ).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const current = nodes.findIndex((node) => node === document.activeElement);
  if (current < 0) return false;
  const from = nodes[current];
  if (!from) return false;
  const others = nodes.filter((_, index) => index !== current);
  const next =
    others[
      nearestInDirection(
        from.getBoundingClientRect(),
        others.map((node) => node.getBoundingClientRect()),
        direction,
      )
    ];
  next?.focus({ preventScroll: true });
  return next !== undefined;
}

/**
 * Window-level shortcuts, active while focus is inside the player or nowhere
 * in particular. Keys an element already handled (`defaultPrevented`) are left alone.
 */
export function useKeyboard(options: UseKeyboardOptions) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const { containerRef, chromeVisible, menuOpen, reveal, run } =
        latest.current;
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      const inside = active !== null && container.contains(active);
      if (!inside && active !== null && active !== document.body) return;

      const action = resolveKey(event, {
        chromeVisible,
        menuOpen,
        target: inside ? focusTarget(active) : "none",
      });
      reveal();
      if (!action) return;
      event.preventDefault();
      run(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

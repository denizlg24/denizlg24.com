"use client";

import { useEffect } from "react";

type Direction = "up" | "down" | "left" | "right";

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const FOCUSABLE = "[data-nav]";

function visible(element: HTMLElement): boolean {
  if (element.closest("[inert],[aria-hidden='true']")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Nearest candidate in the pressed direction, scored by distance along the
 * axis plus twice the drift across it — rows win over diagonals, which is
 * what a remote's user expects.
 */
export function pickNext(
  from: DOMRect,
  candidates: { rect: DOMRect; element: HTMLElement }[],
  direction: Direction,
): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: { score: number; element: HTMLElement } | null = null;
  for (const { rect, element } of candidates) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const along =
      direction === "left"
        ? from.left - rect.right
        : direction === "right"
          ? rect.left - from.right
          : direction === "up"
            ? from.top - rect.bottom
            : rect.top - from.bottom;
    if (along < -Math.min(rect.width, rect.height) / 2) continue;
    const across =
      direction === "left" || direction === "right"
        ? Math.abs(y - cy)
        : Math.abs(x - cx);
    const score = Math.max(along, 0) + across * 2;
    if (!best || score < best.score) best = { score, element };
  }
  return best?.element ?? null;
}

function ownsArrows(element: Element, direction: Direction): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return direction === "left" || direction === "right";
  }
  const scope = element.closest<HTMLElement>("[data-nav-own]");
  if (!scope) return false;
  const owned = scope.dataset.navOwn ?? "all";
  return owned === "all" || owned.split(" ").includes(direction);
}

/**
 * Arrow-key focus movement between `[data-nav]` elements, for TV remotes and
 * keyboards. It only acts once focus is already on a navigable element (or
 * on a TV, where nothing else would), so ordinary page scrolling is untouched.
 */
export function SpatialNav({ tv }: { tv: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = KEYS[event.key];
      if (!direction || event.altKey || event.metaKey || event.ctrlKey) return;
      const active = document.activeElement;
      const fromNav =
        active instanceof HTMLElement && active.matches(FOCUSABLE);
      if (!fromNav && !tv) return;
      if (active && ownsArrows(active, direction)) return;
      const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element !== active && visible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }));
      if (candidates.length === 0) return;
      const from =
        fromNav && active instanceof HTMLElement
          ? active.getBoundingClientRect()
          : new DOMRect(window.innerWidth / 2, 0, 0, 0);
      const next = fromNav
        ? pickNext(from, candidates, direction)
        : candidates[0]?.element;
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tv]);

  useEffect(() => {
    if (!tv) return;
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const first = document.querySelector<HTMLElement>(
      "[data-nav-autofocus],[data-nav]",
    );
    first?.focus({ preventScroll: true });
  }, [tv]);

  return null;
}

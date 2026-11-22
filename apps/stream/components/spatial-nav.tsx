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
    if (
      (direction === "up" && y >= cy) ||
      (direction === "down" && y <= cy) ||
      (direction === "left" && x >= cx) ||
      (direction === "right" && x <= cx)
    )
      continue;
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
      const scope = document.querySelector("dialog[open]") ?? document;
      const vertical = direction === "up" || direction === "down";
      const activeRow = active?.closest(".row-scroller");
      const rowBounds = new Map<Element, DOMRect>();
      const candidates = [
        ...scope.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].flatMap((element) => {
        if (
          element === active ||
          element.closest("[inert],[aria-hidden='true']") ||
          element.matches(":disabled")
        )
          return [];
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        const row = element.closest(".row-scroller");
        if (vertical && row) {
          if (row === activeRow) return [];
          const bounds = rowBounds.get(row) ?? row.getBoundingClientRect();
          rowBounds.set(row, bounds);
          if (rect.right <= bounds.left || rect.left >= bounds.right) return [];
        }
        return [{ element, rect }];
      });
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
      // Rows page themselves horizontally; on a TV the focused row sits
      // mid-screen so its heading and the next row stay in sight.
      next.scrollIntoView({
        block: tv && !next.closest("header") ? "center" : "nearest",
        inline: "nearest",
        behavior: tv ? "instant" : "smooth",
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tv]);

  useEffect(() => {
    if (!tv) return;
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const first =
      document.querySelector<HTMLElement>("[data-nav-autofocus]") ??
      document.querySelector<HTMLElement>("[data-nav]");
    first?.focus({ preventScroll: true });
  }, [tv]);

  return null;
}

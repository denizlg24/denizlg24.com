"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";

// Below this, every row mounts as before. A folder of a few hundred items is
// the normal case and takes the exact same code path it always has; only the
// pathological folders pay for windowing, and those are unusable without it —
// each row mounts a context menu, a dropdown and a popover.
const WINDOW_THRESHOLD = 300;
const OVERSCAN_LINES = 6;

export interface RowWindow {
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  padTopPx: number;
  padBottomPx: number;
  windowed: boolean;
  /** Puts a row on screen even when it is not currently mounted. */
  scrollToIndex: (index: number) => void;
}

export function useWindowedRows({
  count,
  scrollRef,
  estimateLineHeight,
  minTileWidth,
  tileGap = 0,
  gridPaddingX = 0,
}: {
  count: number;
  scrollRef: RefObject<HTMLElement | null>;
  /** Height of one line: a table row, or a tile row in grid view. */
  estimateLineHeight: number;
  /** Grid views wrap; omit for a single-column list. */
  minTileWidth?: number;
  /** Column gap in px. Must match the grid's `gap-*` or columns overcount. */
  tileGap?: number;
  /**
   * Horizontal padding inside the grid, in px. `scrollRef` is the scroll
   * container, so its `clientWidth` includes padding the tiles never occupy.
   */
  gridPaddingX?: number;
}): RowWindow {
  const [metrics, setMetrics] = useState({ scrollTop: 0, height: 0, width: 0 });
  const windowed = count > WINDOW_THRESHOLD;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !windowed) return;

    const read = () =>
      setMetrics({
        scrollTop: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
      });

    read();
    element.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [scrollRef, windowed]);

  // auto-fill packs n tracks where n*minTileWidth + (n-1)*tileGap fits the
  // content box, which rearranges to floor((content + gap) / (min + gap)).
  // Dividing raw width by minTileWidth alone overcounts, and a column count
  // one too high shifts the window offset onto the wrong item range.
  const columns = (() => {
    if (!minTileWidth || metrics.width <= 0) return 1;
    const content = metrics.width - gridPaddingX;
    if (content <= 0) return 1;
    return Math.max(
      1,
      Math.floor((content + tileGap) / (minTileWidth + tileGap)),
    );
  })();

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      if (!element || !windowed) return;
      const line = Math.floor(index / columns);
      const top = line * estimateLineHeight;
      const bottom = top + estimateLineHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [scrollRef, windowed, columns, estimateLineHeight],
  );

  if (!windowed) {
    return {
      start: 0,
      end: count,
      padTopPx: 0,
      padBottomPx: 0,
      windowed: false,
      scrollToIndex,
    };
  }

  const totalLines = Math.ceil(count / columns);
  const visibleLines = Math.ceil(
    Math.max(metrics.height, estimateLineHeight) / estimateLineHeight,
  );
  const firstLine = Math.max(
    0,
    Math.floor(metrics.scrollTop / estimateLineHeight) - OVERSCAN_LINES,
  );
  const lastLine = Math.min(
    totalLines,
    firstLine + visibleLines + OVERSCAN_LINES * 2,
  );

  return {
    start: firstLine * columns,
    end: Math.min(count, lastLine * columns),
    padTopPx: firstLine * estimateLineHeight,
    padBottomPx: Math.max(0, (totalLines - lastLine) * estimateLineHeight),
    windowed: true,
    scrollToIndex,
  };
}

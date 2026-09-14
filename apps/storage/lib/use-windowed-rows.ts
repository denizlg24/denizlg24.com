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
  /** Tracks the grid packs at the current width; 1 for a list. */
  columns: number;
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
  /**
   * Height of one line: a table row, or a tile row in grid view. A tile's
   * height follows its width, so the grid passes a function of the track.
   */
  estimateLineHeight: number | ((tileWidth: number) => number);
  /** Grid views wrap; omit (or 0) for a single-column list. */
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
  // The column count is wanted even below the threshold, for arrow keys.
  const measureColumns = Boolean(minTileWidth);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || (!windowed && !measureColumns)) return;

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
  }, [scrollRef, windowed, measureColumns]);

  // auto-fill packs n tracks where n*minTileWidth + (n-1)*tileGap fits the
  // content box, which rearranges to floor((content + gap) / (min + gap)).
  // Dividing raw width by minTileWidth alone overcounts, and a column count
  // one too high shifts the window offset onto the wrong item range.
  const content = Math.max(0, metrics.width - gridPaddingX);
  const columns = (() => {
    if (!minTileWidth || content <= 0) return 1;
    return Math.max(
      1,
      Math.floor((content + tileGap) / (minTileWidth + tileGap)),
    );
  })();
  const tileWidth =
    columns > 0
      ? Math.max(0, (content - tileGap * (columns - 1)) / columns)
      : 0;
  const lineHeight =
    typeof estimateLineHeight === "function"
      ? Math.max(
          1,
          estimateLineHeight(tileWidth || minTileWidth || 0) + tileGap,
        )
      : estimateLineHeight;

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      if (!element || !windowed) return;
      const line = Math.floor(index / columns);
      const top = line * lineHeight;
      const bottom = top + lineHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [scrollRef, windowed, columns, lineHeight],
  );

  if (!windowed) {
    return {
      start: 0,
      end: count,
      padTopPx: 0,
      padBottomPx: 0,
      windowed: false,
      columns,
      scrollToIndex,
    };
  }

  const totalLines = Math.ceil(count / columns);
  const visibleLines = Math.ceil(
    Math.max(metrics.height, lineHeight) / lineHeight,
  );
  const firstLine = Math.max(
    0,
    Math.floor(metrics.scrollTop / lineHeight) - OVERSCAN_LINES,
  );
  const lastLine = Math.min(
    totalLines,
    firstLine + visibleLines + OVERSCAN_LINES * 2,
  );

  return {
    start: firstLine * columns,
    end: Math.min(count, lastLine * columns),
    padTopPx: firstLine * lineHeight,
    padBottomPx: Math.max(0, (totalLines - lastLine) * lineHeight),
    windowed: true,
    columns,
    scrollToIndex,
  };
}

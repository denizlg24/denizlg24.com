import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { POSTER_RATIO } from "@/ui";

/** Side margin of every phone browse surface, and the gap between tiles. */
export const EDGE = 16;
export const GAP = 8;

export interface RowMetrics {
  width: number;
  /** A poster tile: about three and a third across, like Netflix's rows. */
  poster: number;
  posterHeight: number;
  /** A 16:9 tile in a `wide` row: a little over one and a half across. */
  wide: number;
  wideHeight: number;
  /** A Top 10 tile: the numeral, then the poster overlapping it. */
  rankNumeral: number;
  /** One column of a three-up grid. */
  gridColumn: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function rowMetrics(width: number): RowMetrics {
  const poster = Math.floor(clamp((width - EDGE - GAP * 3) / 3.3, 92, 156));
  const wide = Math.floor(clamp((width - EDGE - GAP) / 1.6, 200, 360));
  const gridColumn = Math.floor((width - EDGE * 2 - GAP * 2) / 3);
  return {
    width,
    poster,
    posterHeight: Math.round(poster / POSTER_RATIO),
    wide,
    wideHeight: Math.round((wide * 9) / 16),
    rankNumeral: Math.round(poster * 0.62),
    gridColumn,
  };
}

export function useRowMetrics(): RowMetrics {
  const { width } = useWindowDimensions();
  return useMemo(() => rowMetrics(width), [width]);
}

import { useMemo, useRef } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";
import { TV_SAFE } from "./layout";

/**
 * A horizontal row that keeps the focused item at the left safe margin.
 * Android only scrolls a focused view's unscaled bounds into view, flush
 * with the screen edge, so the last poster's lift and ring ran off screen.
 */
export function useRowScroll() {
  const ref = useRef<ScrollView>(null);
  const xs = useRef<number[]>([]);
  return useMemo(
    () => ({
      ref,
      layout: (index: number) => (event: LayoutChangeEvent) => {
        xs.current[index] = event.nativeEvent.layout.x;
      },
      focus: (index: number) => {
        const x = xs.current[index];
        if (x === undefined) return;
        ref.current?.scrollTo({
          x: Math.max(0, x - TV_SAFE.x),
          animated: true,
        });
      },
    }),
    [],
  );
}

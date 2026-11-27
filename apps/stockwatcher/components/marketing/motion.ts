"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { type RefObject, useEffect } from "react";

let registered = false;

function tools() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return { gsap, ScrollTrigger };
}

export type MotionConditions = {
  /** No `prefers-reduced-motion` preference. */
  motion: boolean;
  /** At least 760px wide: pins and pointer effects are allowed. */
  wide: boolean;
  /** A precise hovering pointer. */
  fine: boolean;
};

type Setup = (
  conditions: MotionConditions,
  kit: ReturnType<typeof tools>,
) => // biome-ignore lint/suspicious/noConfusingVoidType: setup may return a cleanup or nothing
(() => void) | void;

/**
 * Runs GSAP setup scoped to an element under `gsap.matchMedia`, so every tween
 * and ScrollTrigger is reverted when the media conditions change or the
 * component unmounts.
 */
export function useMotion(
  scope: RefObject<HTMLElement | null>,
  setup: Setup,
  deps: readonly unknown[] = [],
) {
  useEffect(() => {
    const element = scope.current;
    if (!element) return;
    const kit = tools();
    const media = kit.gsap.matchMedia();
    media.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        wide: "(min-width: 760px)",
        fine: "(hover: hover) and (pointer: fine)",
      },
      (context) => {
        const { motion, wide, fine } = context.conditions ?? {};
        return setup(
          { motion: Boolean(motion), wide: Boolean(wide), fine: Boolean(fine) },
          kit,
        );
      },
      element,
    );
    return () => media.revert();
  }, deps);
}

export const tone = {
  night: {
    "--mk-bg": "#0c0f0d",
    "--mk-ink": "#e6ebe5",
    "--mk-muted": "#9aa49d",
    "--mk-rule": "#272e29",
    "--mk-rule-strong": "#6b756e",
    "--mk-accent": "#a7d7b4",
    "--mk-accent-ink": "#0c0f0d",
    "--mk-gain": "#6ccf95",
    "--mk-loss": "#ff958c",
    "--mk-amber": "#e3b665",
    "--mk-grid": "rgba(230, 235, 229, 0.04)",
    "--card": "#141815",
    "--input": "#3a433d",
    "--muted": "#1e2420",
  },
  paper: {
    "--mk-bg": "#f5f5ef",
    "--mk-ink": "#121814",
    "--mk-muted": "#566059",
    "--mk-rule": "#dcddd4",
    "--mk-rule-strong": "#1f2622",
    "--mk-accent": "#174e3a",
    "--mk-accent-ink": "#f5f5ef",
    "--mk-gain": "#1b6e45",
    "--mk-loss": "#b0342f",
    "--mk-amber": "#94600f",
    "--mk-grid": "rgba(18, 24, 20, 0)",
    "--card": "#fbfbf7",
    "--input": "#bfc3b8",
    "--muted": "#eaebe3",
  },
} as const;

export type Tone = keyof typeof tone;

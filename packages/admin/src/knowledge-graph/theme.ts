"use client";

import {
  type RefObject,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

export interface GraphTheme {
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  palette: string[];
  scheme: "dark" | "light";
}

const CHART_VARIABLES = [
  "--chart-1",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-2",
] as const;

export function readGraphTheme(element: HTMLElement): GraphTheme {
  const styles = getComputedStyle(element);
  const get = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const isDark = document.documentElement.classList.contains("dark");
  const mutedForeground = get(
    "--muted-foreground",
    isDark ? "#8a8d93" : "#4f5a4a",
  );

  return {
    background: get("--background", isDark ? "#0b0d10" : "#f9f8f6"),
    foreground: get("--foreground", isDark ? "#e6e7ea" : "#2a2b2c"),
    mutedForeground,
    border: get("--border", mutedForeground),
    palette: CHART_VARIABLES.map((name) => get(name, mutedForeground)),
    scheme: isDark ? "dark" : "light",
  };
}

/**
 * Canvas can't read CSS variables, so the theme is resolved into strings and
 * re-read whenever ThemeRoot touches `<html>` (scheme class, inline variables,
 * `data-theme`).
 */
export function useGraphTheme(
  ref: RefObject<HTMLElement | null>,
): GraphTheme | null {
  const [theme, setTheme] = useState<GraphTheme | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setTheme(readGraphTheme(element));
    const observer = new MutationObserver(() =>
      setTheme(readGraphTheme(element)),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [ref]);

  return theme;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function subscribeScheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const schemeSnapshot = (): "dark" | "light" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

export function useColorScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeScheme, schemeSnapshot, () => "dark");
}

const alphaCache = new Map<string, string>();
let probe: CanvasRenderingContext2D | null = null;

/**
 * Theme colours arrive in whatever notation the theme wrote (hex, rgb, oklch),
 * so appending a hex alpha only works for some of them. The canvas normalises
 * sRGB colours to `#rrggbb` / `rgba()`; anything wider falls back to
 * `color-mix`.
 */
export function withAlpha(color: string, alpha: number): string {
  const key = `${color}|${alpha}`;
  const cached = alphaCache.get(key);
  if (cached) return cached;

  probe ??= document.createElement("canvas").getContext("2d");
  let normalized = color;
  if (probe) {
    probe.fillStyle = "#000000";
    probe.fillStyle = color;
    normalized = String(probe.fillStyle);
  }

  let result: string;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(normalized);
  if (hex) {
    const [r, g, b] = [hex[1], hex[2], hex[3]].map((part) =>
      Number.parseInt(part, 16),
    );
    result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } else if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((part) => part.trim());
    result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } else {
    result = `color-mix(in srgb, ${normalized} ${Math.round(alpha * 100)}%, transparent)`;
  }
  alphaCache.set(key, result);
  return result;
}

const FALLBACK_HUE = 210;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function classColor(
  key: string | undefined | null,
  scheme: "dark" | "light" = "dark",
): string {
  const hue =
    !key || key.trim().length === 0
      ? FALLBACK_HUE
      : hashString(key.trim().toLowerCase()) % 360;
  return `hsl(${hue} 62% ${scheme === "dark" ? 64 : 42}%)`;
}

export function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

/** A label on a rounded plate under a node, sized in screen pixels. */
export function drawNodeLabel(
  context: CanvasRenderingContext2D,
  options: {
    text: string;
    x: number;
    y: number;
    globalScale: number;
    theme: GraphTheme;
    weight?: number;
    size?: number;
  },
) {
  const { text, x, y, globalScale, theme, weight = 500, size = 9 } = options;
  const fontSize = size / globalScale;
  context.font = `${weight} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const padX = 4 / globalScale;
  const padY = 2 / globalScale;
  const boxWidth = context.measureText(text).width + padX * 2;
  const boxHeight = fontSize + padY * 2;
  const centerY = y + boxHeight / 2 + 3 / globalScale;

  context.fillStyle = withAlpha(theme.background, 0.93);
  context.beginPath();
  context.roundRect(
    x - boxWidth / 2,
    centerY - boxHeight / 2,
    boxWidth,
    boxHeight,
    3 / globalScale,
  );
  context.fill();

  context.fillStyle = theme.foreground;
  context.fillText(text, x, centerY);
}

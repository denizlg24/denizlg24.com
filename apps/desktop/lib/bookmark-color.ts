const FALLBACK_HUE = 210;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export type ColorScheme = "dark" | "light";

export function hueFromKey(key: string | undefined | null): number {
  if (!key || key.trim().length === 0) return FALLBACK_HUE;
  return hashString(key.trim().toLowerCase()) % 360;
}

export function classColor(
  key: string | undefined | null,
  scheme: ColorScheme = "dark",
): string {
  const hue = hueFromKey(key);
  const sat = 62;
  const light = scheme === "dark" ? 64 : 42;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function classColorMuted(
  key: string | undefined | null,
  scheme: ColorScheme = "dark",
): string {
  const hue = hueFromKey(key);
  const sat = 38;
  const light = scheme === "dark" ? 50 : 55;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

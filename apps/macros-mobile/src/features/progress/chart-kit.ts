const DAY_MS = 86_400_000;

export interface PlotPoint {
  x: number;
  y: number;
}

/** Days since the Unix epoch for a `yyyy-MM-dd` date, independent of the device zone. */
export function isoDayNumber(isoDate: string): number {
  const [year = 1970, month = 1, day = 1] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function linearScale(
  [domainMin, domainMax]: readonly [number, number],
  [rangeMin, rangeMax]: readonly [number, number],
) {
  const span = domainMax - domainMin;
  return (value: number) =>
    span === 0
      ? (rangeMin + rangeMax) / 2
      : rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** A 1/2/2.5/5 × 10ⁿ step, so axis labels read as round numbers. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;
  return factor * magnitude;
}

export function niceTicks(
  [min, max]: readonly [number, number],
  count = 3,
): number[] {
  const step = niceStep((max - min) / Math.max(1, count));
  const ticks: number[] = [];
  for (
    let value = Math.ceil(min / step) * step;
    value <= max + 1e-9;
    value += step
  ) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

/**
 * The value range of a chart with breathing room above and below. `minSpan`
 * stops a flat series from being stretched until noise looks like a trend.
 */
export function paddedDomain(
  values: readonly number[],
  { minSpan = 1, padding = 0.12 }: { minSpan?: number; padding?: number } = {},
): [number, number] | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (max - min < minSpan) {
    const middle = (max + min) / 2;
    min = middle - minSpan / 2;
    max = middle + minSpan / 2;
  }
  const pad = (max - min) * padding;
  return [min - pad, max + pad];
}

/** An SVG path through the points; `null` breaks the line instead of bridging a gap. */
export function linePath(points: ReadonlyArray<PlotPoint | null>): string {
  let path = "";
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    path += `${drawing ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    drawing = true;
  }
  return path;
}

/** A closed area between an upper and a lower edge that share x positions. */
export function bandPath(
  upper: readonly PlotPoint[],
  lower: readonly PlotPoint[],
): string {
  if (upper.length === 0 || upper.length !== lower.length) return "";
  const forward = upper
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join("");
  const back = [...lower]
    .reverse()
    .map((point) => `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join("");
  return `${forward}${back}Z`;
}

/** Index of the entry in an ascending list closest to `value`. */
export function nearestIndex(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return -1;
  let low = 0;
  let high = sorted.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < value) low = middle;
    else high = middle;
  }
  const lowDistance = Math.abs((sorted[low] ?? 0) - value);
  const highDistance = Math.abs((sorted[high] ?? 0) - value);
  return highDistance < lowDistance ? high : low;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

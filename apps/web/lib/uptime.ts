/**
 * Uptime measured in time, not in samples.
 *
 * `healthyChecks / totalChecks` is not an uptime percentage — it is the
 * fraction of *attempts* that succeeded, and it weighs every sample equally
 * regardless of how much time it stands for. Three consequences, all of which
 * made the number read better than reality:
 *
 * - A gap is invisible. If the health-check cron does not run, no rows are
 *   written, and the hours nobody observed are simply absent from the
 *   denominator. A resource down for six hours while the checker was also down
 *   reported 100%.
 * - Manual checks skew it. Every "check now" click adds a sample, so clicking
 *   it while a service is up inflates the month.
 * - A cadence change rewrites history. Samples from a 1-minute period and a
 *   5-minute period were averaged together as equals.
 *
 * Here each sample owns the interval running to the next one, capped at a
 * multiple of the expected cadence. Anything past that cap is *unobserved* and
 * is reported as such rather than folded into either side: an unobserved hour
 * is not an up hour and it is not an outage.
 */

/** How many cadence periods a sample may stand for before the rest is a gap. */
export const CADENCE_CAP_MULTIPLE = 3;

/** Used when a resource has too few samples to infer a cadence from. */
export const FALLBACK_CADENCE_MS = 5 * 60_000;

/**
 * Below this share of a day observed, the day is reported unknown rather than
 * up or down. Stating a verdict on a day nobody watched is the whole failure
 * this module exists to stop.
 */
export const MIN_OBSERVED_DAY_FRACTION = 0.5;

export const DAY_MS = 24 * 60 * 60_000;

export interface UptimeSample {
  checkedAt: Date;
  isHealthy: boolean;
}

export interface UptimeWindow {
  healthyMs: number;
  observedMs: number;
  unobservedMs: number;
}

/**
 * The cadence is the *mode* of the gaps between samples, not the mean or the
 * median. A cron produces one dominant gap and a handful of outliers, so the
 * mode reads it off directly; the mean is dragged by exactly the outages this
 * is meant to detect, and the median needs an accumulator not every deployed
 * MongoDB has. Rounding to five seconds absorbs scheduler jitter.
 */
export function inferCadenceMs(
  sortedCheckedAt: readonly Date[],
): number | null {
  if (sortedCheckedAt.length < 3) return null;

  const buckets = new Map<number, number>();
  for (let i = 1; i < sortedCheckedAt.length; i++) {
    const delta =
      sortedCheckedAt[i].getTime() - sortedCheckedAt[i - 1].getTime();
    if (delta <= 0) continue;
    const bucket = Math.max(5_000, Math.round(delta / 5_000) * 5_000);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  if (buckets.size === 0) return null;

  let best = 0;
  let bestCount = 0;
  for (const [bucket, count] of buckets) {
    // Ties go to the shorter cadence: over-reporting a gap is recoverable,
    // silently absorbing one into the observed window is not.
    if (count > bestCount || (count === bestCount && bucket < best)) {
      best = bucket;
      bestCount = count;
    }
  }
  return best || null;
}

/**
 * Splits the interval a sample stands for across the days it covers, so a gap
 * that straddles midnight is not charged entirely to the day it started in.
 */
function addInterval(
  into: Map<string, UptimeWindow>,
  dayKey: (at: Date) => string,
  from: number,
  to: number,
  healthy: boolean,
  capMs: number,
): void {
  const observedUntil = Math.min(to, from + capMs);
  let cursor = from;
  while (cursor < to) {
    const key = dayKey(new Date(cursor));
    const dayEnd = Math.min(to, endOfDayMs(cursor, dayKey));
    const slice = dayEnd - cursor;
    if (slice <= 0) break;

    const observed = Math.max(0, Math.min(dayEnd, observedUntil) - cursor);
    const window = into.get(key) ?? {
      healthyMs: 0,
      observedMs: 0,
      unobservedMs: 0,
    };
    window.observedMs += observed;
    window.unobservedMs += slice - observed;
    if (healthy) window.healthyMs += observed;
    into.set(key, window);
    cursor = dayEnd;
  }
}

/**
 * Walks forward to the first instant of the next day key. Doing it by key
 * comparison rather than arithmetic keeps DST-shifted days correct — a 23- or
 * 25-hour day is still one day here.
 */
function endOfDayMs(fromMs: number, dayKey: (at: Date) => string): number {
  const key = dayKey(new Date(fromMs));
  let lo = fromMs;
  let hi = fromMs + 2 * DAY_MS;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (dayKey(new Date(mid)) === key) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface TimeWeightedUptime {
  cadenceMs: number;
  byDay: Map<string, UptimeWindow>;
  total: UptimeWindow;
}

/**
 * `windowEndMs` is normally now: the last sample's interval runs to the present,
 * capped, so a checker that stopped three days ago reports three days of gap
 * rather than a clean 100% ending at its final successful ping.
 */
export function computeTimeWeightedUptime(
  samples: readonly UptimeSample[],
  options: {
    windowStartMs: number;
    windowEndMs: number;
    dayKey: (at: Date) => string;
    cadenceMs?: number | null;
  },
): TimeWeightedUptime {
  const ordered = [...samples].sort(
    (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime(),
  );
  const cadenceMs =
    options.cadenceMs ??
    inferCadenceMs(ordered.map((s) => s.checkedAt)) ??
    FALLBACK_CADENCE_MS;
  const capMs = cadenceMs * CADENCE_CAP_MULTIPLE;

  const byDay = new Map<string, UptimeWindow>();

  // Time before the first sample is unobserved, not up. Without this a resource
  // registered yesterday would report a clean month.
  if (ordered.length > 0) {
    const firstMs = ordered[0].checkedAt.getTime();
    if (firstMs > options.windowStartMs) {
      addInterval(
        byDay,
        options.dayKey,
        options.windowStartMs,
        firstMs,
        false,
        0,
      );
    }
  } else {
    addInterval(
      byDay,
      options.dayKey,
      options.windowStartMs,
      options.windowEndMs,
      false,
      0,
    );
  }

  for (let i = 0; i < ordered.length; i++) {
    const from = ordered[i].checkedAt.getTime();
    const to =
      i + 1 < ordered.length
        ? ordered[i + 1].checkedAt.getTime()
        : options.windowEndMs;
    if (to <= from) continue;
    addInterval(byDay, options.dayKey, from, to, ordered[i].isHealthy, capMs);
  }

  const total: UptimeWindow = {
    healthyMs: 0,
    observedMs: 0,
    unobservedMs: 0,
  };
  for (const window of byDay.values()) {
    total.healthyMs += window.healthyMs;
    total.observedMs += window.observedMs;
    total.unobservedMs += window.unobservedMs;
  }

  return { cadenceMs, byDay, total };
}

/** Rounded to two decimals, and 0 rather than NaN when nothing was observed. */
export function uptimePercent(window: UptimeWindow): number {
  if (window.observedMs <= 0) return 0;
  return Math.round((window.healthyMs / window.observedMs) * 10000) / 100;
}

export function dayStatus(
  window: UptimeWindow | undefined,
): "up" | "degraded" | "down" | "unknown" {
  if (!window || window.observedMs <= 0) return "unknown";
  const covered =
    window.observedMs / Math.max(1, window.observedMs + window.unobservedMs);
  if (covered < MIN_OBSERVED_DAY_FRACTION) return "unknown";

  const ratio = window.healthyMs / window.observedMs;
  if (ratio >= 0.9999) return "up";
  if (ratio >= 0.5) return "degraded";
  return "down";
}

export interface Outage {
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
}

/**
 * What the sample-counting model could not produce at all. Consecutive
 * unhealthy intervals collapse into one incident; an outage still running at
 * the end of the window has a null `endedAt` rather than being closed at an
 * arbitrary instant.
 */
export function deriveOutages(
  samples: readonly UptimeSample[],
  windowEndMs: number,
): Outage[] {
  const ordered = [...samples].sort(
    (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime(),
  );
  const outages: Outage[] = [];
  let openedAt: number | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const sample = ordered[i];
    if (!sample.isHealthy) {
      if (openedAt === null) openedAt = sample.checkedAt.getTime();
      continue;
    }
    if (openedAt !== null) {
      const endedAt = sample.checkedAt.getTime();
      outages.push({
        startedAt: new Date(openedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - openedAt,
      });
      openedAt = null;
    }
  }

  if (openedAt !== null) {
    outages.push({
      startedAt: new Date(openedAt).toISOString(),
      endedAt: null,
      durationMs: Math.max(0, windowEndMs - openedAt),
    });
  }

  return outages;
}

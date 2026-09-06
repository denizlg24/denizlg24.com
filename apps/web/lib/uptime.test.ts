import { describe, expect, it } from "bun:test";

import {
  computeTimeWeightedUptime,
  dayStatus,
  deriveOutages,
  inferCadenceMs,
  type UptimeSample,
  uptimePercent,
} from "./uptime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** UTC day keys, which is what the aggregation's timezone formatting produces. */
const dayKey = (at: Date) => at.toISOString().slice(0, 10);

function samples(
  startIso: string,
  entries: { everyMs: number; count: number; healthy: boolean }[],
): UptimeSample[] {
  let cursor = new Date(startIso).getTime();
  const out: UptimeSample[] = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      out.push({ checkedAt: new Date(cursor), isHealthy: entry.healthy });
      cursor += entry.everyMs;
    }
  }
  return out;
}

describe("inferCadenceMs", () => {
  it("reads the dominant gap, not the average", () => {
    const at = samples("2026-09-01T00:00:00Z", [
      { everyMs: 5 * MINUTE, count: 50, healthy: true },
    ]).map((s) => s.checkedAt);
    // One six-hour outage in the checker would drag a mean badly.
    at.push(new Date(at[at.length - 1].getTime() + 6 * HOUR));

    expect(inferCadenceMs(at)).toBe(5 * MINUTE);
  });

  it("returns null when there is not enough to infer from", () => {
    expect(inferCadenceMs([new Date(), new Date()])).toBeNull();
  });
});

describe("computeTimeWeightedUptime", () => {
  /**
   * The headline bug. Six hours down while the checker was also down wrote no
   * rows at all, so the hours were absent from the denominator and the resource
   * reported a clean 100%.
   */
  it("counts a checker gap as unobserved, not as uptime", () => {
    const start = new Date("2026-09-01T00:00:00Z").getTime();
    const before = samples("2026-09-01T00:00:00Z", [
      { everyMs: 5 * MINUTE, count: 72, healthy: true }, // 06:00
    ]);
    const after = samples("2026-09-01T12:00:00Z", [
      { everyMs: 5 * MINUTE, count: 144, healthy: true }, // to 24:00
    ]);

    const result = computeTimeWeightedUptime([...before, ...after], {
      windowStartMs: start,
      windowEndMs: new Date("2026-09-02T00:00:00Z").getTime(),
      dayKey,
    });

    expect(result.cadenceMs).toBe(5 * MINUTE);
    // The gap runs 05:55 → 12:00; 15 minutes of it is within the cap.
    expect(result.total.unobservedMs).toBeGreaterThan(5.5 * HOUR);
    expect(result.total.unobservedMs).toBeLessThan(6.5 * HOUR);
    // Nothing observed was unhealthy, so of what was watched it really was up.
    expect(uptimePercent(result.total)).toBe(100);
    // But the day cannot be called up on 75% coverage alone — it is stated as
    // observed time, and the gap is visible instead of erased.
    expect(result.byDay.get("2026-09-01")?.unobservedMs).toBeGreaterThan(
      5.5 * HOUR,
    );
  });

  it("weighs a real outage by its duration, not by sample count", () => {
    const start = new Date("2026-09-01T00:00:00Z").getTime();
    const all = samples("2026-09-01T00:00:00Z", [
      { everyMs: 5 * MINUTE, count: 216, healthy: true }, // 18h up
      { everyMs: 5 * MINUTE, count: 72, healthy: false }, // 6h down
    ]);

    const result = computeTimeWeightedUptime(all, {
      windowStartMs: start,
      windowEndMs: new Date("2026-09-02T00:00:00Z").getTime(),
      dayKey,
    });

    expect(uptimePercent(result.total)).toBeCloseTo(75, 0);
  });

  /**
   * Every "check now" click writes a sample. Under the old ratio a hundred of
   * them during a healthy hour outvoted a genuine outage; here they compress
   * the intervals they sit in and change nothing.
   */
  it("is unmoved by a burst of manual checks", () => {
    const start = new Date("2026-09-01T00:00:00Z").getTime();
    const base = samples("2026-09-01T00:00:00Z", [
      { everyMs: 5 * MINUTE, count: 144, healthy: true }, // 12h up
      { everyMs: 5 * MINUTE, count: 144, healthy: false }, // 12h down
    ]);
    const withClicks = [
      ...base,
      ...samples("2026-09-01T03:00:00Z", [
        { everyMs: 1000, count: 200, healthy: true },
      ]),
    ];

    const plain = uptimePercent(
      computeTimeWeightedUptime(base, {
        windowStartMs: start,
        windowEndMs: new Date("2026-09-02T00:00:00Z").getTime(),
        dayKey,
        cadenceMs: 5 * MINUTE,
      }).total,
    );
    const clicked = uptimePercent(
      computeTimeWeightedUptime(withClicks, {
        windowStartMs: start,
        windowEndMs: new Date("2026-09-02T00:00:00Z").getTime(),
        dayKey,
        cadenceMs: 5 * MINUTE,
      }).total,
    );

    expect(plain).toBeCloseTo(50, 0);
    expect(clicked).toBeCloseTo(plain, 1);
  });

  it("treats time before the first sample as unobserved", () => {
    const start = new Date("2026-09-01T00:00:00Z").getTime();
    const result = computeTimeWeightedUptime(
      samples("2026-09-02T00:00:00Z", [
        { everyMs: 5 * MINUTE, count: 288, healthy: true },
      ]),
      {
        windowStartMs: start,
        windowEndMs: new Date("2026-09-03T00:00:00Z").getTime(),
        dayKey,
      },
    );

    expect(dayStatus(result.byDay.get("2026-09-01"))).toBe("unknown");
    expect(result.byDay.get("2026-09-01")?.observedMs).toBe(0);
    expect(dayStatus(result.byDay.get("2026-09-02"))).toBe("up");
  });

  it("splits a gap that straddles midnight across both days", () => {
    const result = computeTimeWeightedUptime(
      [
        { checkedAt: new Date("2026-09-01T22:00:00Z"), isHealthy: true },
        { checkedAt: new Date("2026-09-02T02:00:00Z"), isHealthy: true },
      ],
      {
        windowStartMs: new Date("2026-09-01T22:00:00Z").getTime(),
        windowEndMs: new Date("2026-09-02T02:00:00Z").getTime(),
        dayKey,
        cadenceMs: 5 * MINUTE,
      },
    );

    expect(result.byDay.get("2026-09-01")?.unobservedMs).toBeCloseTo(
      2 * HOUR - 15 * MINUTE,
      -3,
    );
    expect(result.byDay.get("2026-09-02")?.unobservedMs).toBeCloseTo(
      2 * HOUR,
      -3,
    );
  });

  it("reports nothing observed rather than zero percent for an empty window", () => {
    const result = computeTimeWeightedUptime([], {
      windowStartMs: new Date("2026-09-01T00:00:00Z").getTime(),
      windowEndMs: new Date("2026-09-02T00:00:00Z").getTime(),
      dayKey,
    });

    expect(result.total.observedMs).toBe(0);
    expect(dayStatus(result.byDay.get("2026-09-01"))).toBe("unknown");
  });
});

describe("deriveOutages", () => {
  it("collapses consecutive unhealthy samples into one incident", () => {
    const outages = deriveOutages(
      [
        { checkedAt: new Date("2026-09-01T00:00:00Z"), isHealthy: true },
        { checkedAt: new Date("2026-09-01T01:00:00Z"), isHealthy: false },
        { checkedAt: new Date("2026-09-01T01:05:00Z"), isHealthy: false },
        { checkedAt: new Date("2026-09-01T02:00:00Z"), isHealthy: true },
      ],
      new Date("2026-09-01T03:00:00Z").getTime(),
    );

    expect(outages).toHaveLength(1);
    expect(outages[0].durationMs).toBe(HOUR);
    expect(outages[0].endedAt).toBe("2026-09-01T02:00:00.000Z");
  });

  it("leaves an outage still running open rather than closing it", () => {
    const outages = deriveOutages(
      [
        { checkedAt: new Date("2026-09-01T00:00:00Z"), isHealthy: true },
        { checkedAt: new Date("2026-09-01T01:00:00Z"), isHealthy: false },
      ],
      new Date("2026-09-01T03:00:00Z").getTime(),
    );

    expect(outages[0].endedAt).toBeNull();
    expect(outages[0].durationMs).toBe(2 * HOUR);
  });
});

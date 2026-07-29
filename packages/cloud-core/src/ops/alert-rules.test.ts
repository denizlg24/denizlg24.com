import { describe, expect, it } from "bun:test";
import type { AlertRule } from "@repo/schemas/cloud";

import {
  describeCondition,
  formatMetricValue,
  nextRuleState,
} from "./alert-rules";

const BASE = new Date("2026-07-29T12:00:00.000Z");

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "swap in use",
    description: null,
    enabled: true,
    series: "host:swap.usage_percent",
    aggregate: "avg",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 20,
    forSeconds: 0,
    severity: "warn",
    cooldownMinutes: 60,
    unit: "percent",
    state: "ok",
    stateSince: null,
    breachingSince: null,
    lastValue: null,
    lastEvaluatedAt: null,
    createdAt: BASE.toISOString(),
    updatedAt: BASE.toISOString(),
    ...overrides,
  };
}

function at(offsetSeconds: number): Date {
  return new Date(BASE.getTime() + offsetSeconds * 1_000);
}

describe("nextRuleState", () => {
  it("fires immediately when forSeconds is zero", () => {
    const result = nextRuleState(rule(), 30, BASE);
    expect(result.transition).toBe("fired");
    expect(result.state).toBe("firing");
  });

  it("does not fire until the breach has been sustained", () => {
    const pending = nextRuleState(rule({ forSeconds: 600 }), 30, BASE);
    expect(pending.transition).toBe("none");
    expect(pending.state).toBe("ok");
    // The first breaching evaluation stamps the clock so the wait survives.
    expect(pending.breachingSince).toEqual(BASE);

    const stillWaiting = nextRuleState(
      rule({ forSeconds: 600, breachingSince: BASE.toISOString() }),
      30,
      at(300),
    );
    expect(stillWaiting.transition).toBe("none");

    const elapsed = nextRuleState(
      rule({ forSeconds: 600, breachingSince: BASE.toISOString() }),
      30,
      at(600),
    );
    expect(elapsed.transition).toBe("fired");
    expect(elapsed.state).toBe("firing");
  });

  it("measures the sustain window against wall time, not sample count", () => {
    // One evaluation, ten minutes after the breach began — a sampler that
    // skipped every beat in between must still fire.
    const result = nextRuleState(
      rule({ forSeconds: 600, breachingSince: BASE.toISOString() }),
      99,
      at(3_600),
    );
    expect(result.transition).toBe("fired");
  });

  it("resets the sustain clock when the breach clears before firing", () => {
    const cleared = nextRuleState(
      rule({ forSeconds: 600, breachingSince: BASE.toISOString() }),
      5,
      at(120),
    );
    expect(cleared.transition).toBe("none");
    expect(cleared.breachingSince).toBeNull();
  });

  it("reports a recovery only from a firing rule", () => {
    expect(nextRuleState(rule({ state: "firing" }), 5, BASE).transition).toBe(
      "resolved",
    );
    expect(nextRuleState(rule({ state: "ok" }), 5, BASE).transition).toBe(
      "none",
    );
  });

  it("keeps re-reporting while firing so the cooldown governs repeats", () => {
    const result = nextRuleState(rule({ state: "firing" }), 30, BASE);
    expect(result.transition).toBe("still_firing");
    expect(result.state).toBe("firing");
  });

  it("holds state when the series has stopped reporting", () => {
    // A collector going quiet is not a recovery; announcing one would clear a
    // real incident from the dashboard.
    const firing = nextRuleState(
      rule({ state: "firing", breachingSince: BASE.toISOString() }),
      null,
      at(60),
    );
    expect(firing.transition).toBe("none");
    expect(firing.state).toBe("firing");
    expect(firing.breachingSince).toEqual(BASE);

    const quiet = nextRuleState(rule(), null, at(60));
    expect(quiet.transition).toBe("none");
    expect(quiet.state).toBe("ok");
  });

  it("honours less-than comparisons", () => {
    const low = rule({
      comparison: "lt",
      threshold: 10,
      series: "db:redis.connected_clients",
    });
    expect(nextRuleState(low, 4, BASE).transition).toBe("fired");
    expect(nextRuleState(low, 40, BASE).transition).toBe("none");
  });
});

describe("value formatting", () => {
  it("renders each unit in its own terms", () => {
    expect(formatMetricValue(42.567, "percent")).toBe("42.6%");
    expect(formatMetricValue(1.5, "ratio")).toBe("1.50");
    expect(formatMetricValue(64.2, "celsius")).toBe("64.2°C");
    expect(formatMetricValue(12, "count")).toBe("12");
    expect(formatMetricValue(1_073_741_824, "bytes")).toBe("1.0 GiB");
    expect(formatMetricValue(1_048_576, "bytes_per_second")).toBe("1.0 MiB/s");
    expect(formatMetricValue(0, "bytes")).toBe("0 B");
  });

  it("describes a condition the way the alert body states it", () => {
    expect(
      describeCondition({
        aggregate: "avg",
        windowSeconds: 600,
        comparison: "gt",
        threshold: 20,
        unit: "percent",
      }),
    ).toBe("avg(10m) > 20.0%");
  });
});

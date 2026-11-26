import { describe, expect, test } from "bun:test";
import { signalSchema, workspaceSchema, type Signal } from "./models";
import {
  applyRun,
  blankRuntime,
  interpret,
  isDue,
  maxConsecutiveErrors,
  runtimeOf,
  withRuntime,
  type SignalRun,
} from "./signals";

const make = (patch: Partial<Signal> = {}): Signal =>
  signalSchema.parse({
    id: crypto.randomUUID(),
    name: "Breadth below 40%",
    code: "return false;",
    enabled: true,
    ...patch,
  });

const hit = (value: number | null = 31): SignalRun => ({
  ok: true,
  reading: { trigger: true, value, message: "Breadth is weak" },
});
const miss: SignalRun = {
  ok: true,
  reading: { trigger: false, value: 55, message: null },
};
const failed: SignalRun = { ok: false, error: "ReferenceError: x is not defined" };
const at = (iso: string) => new Date(iso);

describe("interpret", () => {
  test("accepts booleans and the object form", () => {
    expect(interpret(true)).toEqual({
      ok: true,
      reading: { trigger: true, value: null, message: null },
    });
    expect(interpret({ trigger: false, value: 42.5, message: " calm " })).toEqual({
      ok: true,
      reading: { trigger: false, value: 42.5, message: "calm" },
    });
  });
  test("drops non-finite values and rejects other shapes", () => {
    expect(interpret({ trigger: true, value: null })).toMatchObject({
      reading: { value: null },
    });
    expect(interpret(1).ok).toBe(false);
    expect(interpret({ trigger: "yes" }).ok).toBe(false);
    expect(interpret(null).ok).toBe(false);
  });
});

describe("applyRun", () => {
  test("a once signal fires, records the reading and turns itself off", () => {
    const signal = make();
    const step = applyRun(signal, hit(), at("2026-03-02T21:00:00Z"));
    expect(step).toEqual({ fired: true, disabled: false, owned: true });
    expect(signal).toMatchObject({
      enabled: false,
      lastValue: 31,
      lastMessage: "Breadth is weak",
      triggerCount: 1,
      lastTriggered: "2026-03-02T21:00:00.000Z",
    });
  });

  test("a rearm signal waits for the condition to clear before firing again", () => {
    const signal = make({ repeat: "rearm" });
    expect(applyRun(signal, hit()).fired).toBe(true);
    expect(signal.primed).toBe(false);
    expect(applyRun(signal, hit()).fired).toBe(false);
    expect(applyRun(signal, miss).fired).toBe(false);
    expect(signal.primed).toBe(true);
    expect(applyRun(signal, hit()).fired).toBe(true);
    expect(signal).toMatchObject({ enabled: true, triggerCount: 2 });
  });

  test("an unprimed signal does not fire while its condition is still true", () => {
    const signal = make({ primed: false });
    expect(applyRun(signal, hit()).fired).toBe(false);
    expect(signal.primed).toBe(false);
  });

  test("errors accumulate, then disable once, and success resets the count", () => {
    const signal = make();
    for (let run = 1; run < maxConsecutiveErrors; run++)
      expect(applyRun(signal, failed)).toEqual({ fired: false, disabled: false, owned: false });
    applyRun(signal, miss);
    expect(signal).toMatchObject({ errorCount: 0, lastError: null });
    for (let run = 1; run < maxConsecutiveErrors; run++) applyRun(signal, failed);
    expect(signal.enabled).toBe(true);
    expect(applyRun(signal, failed)).toEqual({ fired: false, disabled: true, owned: true });
    expect(signal).toMatchObject({
      enabled: false,
      lastError: failed.error,
    });
  });
});

describe("runtime state", () => {
  test("a plain check only changes runtime fields, not user-owned ones", () => {
    const signal = make();
    expect(applyRun(signal, miss, at("2026-03-02T21:00:00Z"))).toEqual({
      fired: false,
      disabled: false,
      owned: false,
    });
    expect(runtimeOf(signal)).toEqual({
      lastValue: 55,
      lastMessage: null,
      lastChecked: "2026-03-02T21:00:00.000Z",
      lastError: null,
      errorCount: 0,
    });
  });

  test("priming a fresh unprimed signal is a user-owned change", () => {
    expect(applyRun(make({ primed: false }), miss).owned).toBe(true);
  });

  test("an error below the limit is not owned, the disabling one is", () => {
    const signal = make();
    expect(applyRun(signal, failed).owned).toBe(false);
    for (let run = 2; run < maxConsecutiveErrors; run++) applyRun(signal, failed);
    expect(applyRun(signal, failed).owned).toBe(true);
  });

  test("merging overlays the stored runtime and falls back to blank", () => {
    const [a, b] = [make(), make()];
    const merged = withRuntime(
      [a, b],
      new Map([[a.id, { ...blankRuntime, lastValue: 7, lastChecked: "2026-03-02T21:00:00.000Z" }]]),
    );
    expect(merged[0]).toMatchObject({ lastValue: 7, lastChecked: "2026-03-02T21:00:00.000Z" });
    expect(merged[1]).toMatchObject({ lastValue: null, lastChecked: null });
    expect(isDue({ ...merged[0], cadence: "hourly" }, at("2026-03-02T21:30:00Z"))).toBe(false);
  });
});

describe("isDue", () => {
  test("never-checked and disabled signals", () => {
    expect(isDue(make({ cadence: "daily" }))).toBe(true);
    expect(isDue(make({ enabled: false }))).toBe(false);
  });

  test("tick is always due, hourly waits an hour", () => {
    const now = at("2026-03-03T15:00:00Z");
    expect(isDue(make({ cadence: "tick", lastChecked: "2026-03-03T14:59:30.000Z" }), now)).toBe(true);
    expect(isDue(make({ cadence: "hourly", lastChecked: "2026-03-03T14:30:00.000Z" }), now)).toBe(false);
    expect(isDue(make({ cadence: "hourly", lastChecked: "2026-03-03T13:59:00.000Z" }), now)).toBe(true);
  });

  test("daily runs once after the 16:30 New York close, across DST", () => {
    // 2026-03-03 is EST (close 21:30 UTC); 2026-06-03 is EDT (close 20:30 UTC).
    const winter = (now: string, last: string) =>
      isDue(make({ cadence: "daily", lastChecked: last }), at(now));
    expect(winter("2026-03-03T20:00:00Z", "2026-03-02T22:00:00.000Z")).toBe(false);
    expect(winter("2026-03-03T21:45:00Z", "2026-03-02T22:00:00.000Z")).toBe(true);
    expect(winter("2026-03-03T23:00:00Z", "2026-03-03T21:45:00.000Z")).toBe(false);
    expect(winter("2026-06-03T20:45:00Z", "2026-06-02T21:00:00.000Z")).toBe(true);
    expect(winter("2026-06-03T20:15:00Z", "2026-06-02T21:00:00.000Z")).toBe(false);
  });

  test("daily stays quiet over the weekend after Friday's run", () => {
    const friday = "2026-03-06T21:45:00.000Z";
    expect(isDue(make({ cadence: "daily", lastChecked: friday }), at("2026-03-08T18:00:00Z"))).toBe(false);
    expect(isDue(make({ cadence: "daily", lastChecked: friday }), at("2026-03-09T21:45:00Z"))).toBe(true);
  });
});

describe("storage", () => {
  test("existing workspaces without signals still parse", () => {
    expect(workspaceSchema.shape.signals.parse(undefined)).toEqual([]);
  });

  test("signals default to a daily, once, primed rule", () => {
    expect(make()).toMatchObject({
      cadence: "daily",
      repeat: "once",
      primed: true,
      errorCount: 0,
      lastChecked: null,
    });
  });
});

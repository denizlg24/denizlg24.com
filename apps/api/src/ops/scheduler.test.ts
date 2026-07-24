import { afterEach, describe, expect, it, jest } from "bun:test";

import { ActiveRuns, validateCronExpression } from "./scheduler";

afterEach(() => {
  jest.useRealTimers();
});

describe("ops scheduler", () => {
  it("validates cron expressions", () => {
    expect(validateCronExpression("*/5 * * * *")).toBe("*/5 * * * *");
    expect(() => validateCronExpression("not a cron")).toThrow();
  });

  it("suppresses overlapping executions until the active run releases", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-24T12:00:00Z"));
    const activeRuns = new ActiveRuns();

    expect(activeRuns.acquire("task-1")).toBe(true);
    expect(activeRuns.acquire("task-1")).toBe(false);
    jest.setSystemTime(new Date("2026-07-24T12:00:30Z"));
    expect(activeRuns.has("task-1")).toBe(true);
    activeRuns.release("task-1");
    expect(activeRuns.acquire("task-1")).toBe(true);
  });
});

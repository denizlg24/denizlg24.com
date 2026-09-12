import { describe, expect, test } from "bun:test";
import { catalog } from "./catalog";
import { backupReportSchema } from "./contracts";
import {
  availability,
  combineHealth,
  dailyHealth,
  fallbackExplanation,
  freshStatus,
  summarizeService,
} from "./health";
import { backupCommandInput, maintenanceInput } from "./input";

describe("health accuracy", () => {
  test("a passing HTTP probe cannot hide a failed dependency", () => {
    const at = new Date().toISOString();
    const result = summarizeService(
      catalog[0]!,
      [
        {
          source: "http",
          status: "operational",
          at,
          latencyMs: 12,
          detail: null,
        },
        {
          source: "transaction",
          status: "down",
          at,
          latencyMs: 5000,
          detail: "Database unavailable",
        },
      ],
      Date.now(),
    );
    expect(result.status).toBe("down");
    expect(result.evidence).toHaveLength(2);
  });
  test("missing, stale, and future-dated observations cannot become healthy", () => {
    const now = Date.now();
    expect(combineHealth([])).toBe("unknown");
    expect(combineHealth(["operational", "unknown"])).toBe("unknown");
    expect(
      freshStatus("operational", new Date(now - 181000).toISOString(), now),
    ).toBe("unknown");
    expect(
      freshStatus("operational", new Date(now + 60000).toISOString(), now),
    ).toBe("unknown");
    expect(freshStatus("operational", "bad-date", now)).toBe("unknown");
  });
  test("unmeasured minutes do not inflate uptime", () => {
    expect(
      availability([
        {
          serviceId: "api",
          day: "2026-09-01",
          operational: 9,
          down: 1,
          degraded: 0,
          unknown: 1430,
        },
      ]),
    ).toEqual({ percent: 90, measured: 10 });
    expect(availability([])).toEqual({ percent: null, measured: 0 });
  });
  test("a day is ranked by minutes lost, not by whether any were", () => {
    const day = (down: number, degraded = 0) =>
      dailyHealth({
        serviceId: "api",
        day: "2026-09-01",
        operational: 1440 - down - degraded,
        down,
        degraded,
        unknown: 0,
      });
    expect(dailyHealth()).toBe("unknown");
    expect(day(0)).toBe("operational");
    expect(day(0, 1)).toBe("degraded");
    expect(day(1)).toBe("degraded");
    expect(day(14)).toBe("degraded");
    expect(day(15)).toBe("partial");
    expect(day(119)).toBe("partial");
    expect(day(120)).toBe("down");
    expect(day(1440)).toBe("down");
  });
  test("public fallbacks never echo credentials or internal URLs", () => {
    const secret = "https://user:password@internal/private?token=secret";
    for (const cause of [
      `HTTP 503 ${secret}`,
      `timeout ${secret}`,
      `DNS ${secret}`,
      secret,
    ]) {
      expect(fallbackExplanation(cause)).not.toContain(secret);
      expect(fallbackExplanation(cause)).not.toContain("password");
    }
  });
});
describe("operational inputs", () => {
  test("calendar injection and cross-host jobs are rejected", () => {
    expect(
      backupCommandInput.safeParse({
        profile: "pi",
        job: "backup",
        action: "schedule",
        schedule: "daily\n[Service]\nExecStart=/bin/false",
        enabled: true,
      }).success,
    ).toBe(false);
    expect(
      backupCommandInput.safeParse({
        profile: "mac",
        job: "backup",
        action: "run",
        schedule: null,
        enabled: null,
      }).success,
    ).toBe(false);
    expect(
      backupCommandInput.safeParse({
        profile: "pi",
        job: "backup",
        action: "schedule",
        schedule: "*-*-* 05:17:00 UTC",
        enabled: false,
      }).success,
    ).toBe(true);
  });
  test("maintenance cannot end before it begins", () => {
    expect(
      maintenanceInput.safeParse({
        id: "",
        title: "Planned work",
        description: "Impact",
        serviceIds: ["api"],
        startsAt: "2026-09-06T10:00:00.000Z",
        endsAt: "2026-09-06T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
  test("a running backup cannot claim a completion timestamp", () => {
    expect(
      backupReportSchema.safeParse({
        job: "backup",
        runId: "run",
        status: "running",
        startedAt: "2026-09-06T10:00:00.000Z",
        completedAt: "2026-09-06T11:00:00.000Z",
        lastSuccessAt: null,
        nextRunAt: null,
        durationMs: null,
        sizeBytes: null,
        enabled: true,
        schedule: null,
        detail: null,
        verification: null,
      }).success,
    ).toBe(false);
  });
});

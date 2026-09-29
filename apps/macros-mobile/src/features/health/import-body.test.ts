import { describe, expect, test } from "bun:test";
import { buildImportBody, FIRST_SYNC_DAYS, importWindow } from "./import-body";

describe("importWindow", () => {
  test("a first sync reaches back the full window", () => {
    expect(importWindow("2026-09-29", null)).toEqual({
      start: "2026-08-31",
      end: "2026-09-29",
    });
  });

  test("resumes from the last imported day, re-reading it", () => {
    expect(importWindow("2026-09-29", "2026-09-27")).toEqual({
      start: "2026-09-27",
      end: "2026-09-29",
    });
  });

  test("a long gap is capped at the first-sync window", () => {
    const { start } = importWindow("2026-09-29", "2026-01-01");
    expect(start).toBe(importWindow("2026-09-29", null).start);
    expect(FIRST_SYNC_DAYS).toBe(30);
  });

  test("a stored day ahead of today (zone change) resumes at today", () => {
    expect(importWindow("2026-09-29", "2026-09-30").start).toBe("2026-09-29");
  });
});

describe("buildImportBody", () => {
  test("drops weights and nulls values the server would refuse", () => {
    const body = buildImportBody(
      [
        { date: "2026-09-28", weightKg: 0 },
        { date: "2026-09-29", weightKg: 81.23456, bodyFatPct: 90 },
      ],
      [{ date: "2026-09-29", steps: 250_000, activeEnergyKcal: 512.345 }],
    );
    expect(body.weighIns).toEqual([
      { logDate: "2026-09-29", weightKg: 81.235, bodyFatPct: null },
    ]);
    expect(body.activity).toEqual([
      {
        logDate: "2026-09-29",
        steps: null,
        activeEnergyKcal: 512.35,
        sourceId: "healthkit",
      },
    ]);
  });
});

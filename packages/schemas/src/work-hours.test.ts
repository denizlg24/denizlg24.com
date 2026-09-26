import { describe, expect, test } from "bun:test";
import {
  workJobInputSchema,
  workJobUpdateSchema,
  workSessionInputSchema,
} from "./work-hours";

describe("work hours schemas", () => {
  test("a partial job update adds no defaults", () => {
    expect(workJobUpdateSchema.parse({ status: "archived" })).toEqual({
      status: "archived",
    });
  });

  test("an unknown timezone is refused", () => {
    const base = { name: "Job", hourlyRateMinor: 100, currency: "DKK" };
    expect(
      workJobInputSchema.safeParse({ ...base, timezone: "Europe/Copenhagn" })
        .success,
    ).toBe(false);
    expect(workJobInputSchema.parse(base).timezone).toBe("Europe/Copenhagen");
  });

  test("shift order compares instants, not strings", () => {
    const parse = (start: string, end: string) =>
      workSessionInputSchema.safeParse({ jobId: "j", start, end }).success;
    // 10:00+05:00 is 05:00Z — before the start.
    expect(parse("2026-09-21T09:00:00Z", "2026-09-21T10:00:00+05:00")).toBe(
      false,
    );
    // 09:30Z is 11:30+02:00 — after the start.
    expect(parse("2026-09-21T10:00:00+02:00", "2026-09-21T09:30:00Z")).toBe(
      true,
    );
  });
});

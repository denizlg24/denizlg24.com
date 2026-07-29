import { describe, expect, test } from "bun:test";
import { overlapDate } from "./sync";

const now = new Date("2026-07-29T10:00:00.000Z");

describe("finance sync window", () => {
  test("overlaps the last booked day to catch late-settling rows", () => {
    expect(overlapDate("2026-07-20", now)).toBe("2026-07-15");
  });

  test("falls back to a bounded window before the first booked row", () => {
    // Enable Banking rejects date_to without date_from, so this must never be
    // undefined while a date_to is being sent alongside it.
    expect(overlapDate(undefined, now)).toBe("2026-06-29");
  });
});

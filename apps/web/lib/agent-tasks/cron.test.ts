import { describe, expect, test } from "bun:test";
import {
  InvalidCronExpressionError,
  nextCronOccurrence,
  previewCronOccurrences,
} from "./cron";

describe("agent task cron", () => {
  test("resolves the next firing in the task's own time zone", () => {
    const next = nextCronOccurrence({
      cron: "30 9 * * *",
      timeZone: "America/New_York",
      after: new Date("2026-08-03T00:00:00Z"),
    });
    // 09:30 EDT is 13:30 UTC in August.
    expect(next.toISOString()).toBe("2026-08-03T13:30:00.000Z");
  });

  test("skips to the next day once today's slot has passed", () => {
    const next = nextCronOccurrence({
      cron: "0 6 * * *",
      timeZone: "UTC",
      after: new Date("2026-08-03T06:00:01Z"),
    });
    expect(next.toISOString()).toBe("2026-08-04T06:00:00.000Z");
  });

  test("honours weekday restrictions", () => {
    // 2026-08-08 is a Saturday; the next weekday firing is Monday the 10th.
    const next = nextCronOccurrence({
      cron: "0 12 * * 1-5",
      timeZone: "UTC",
      after: new Date("2026-08-08T00:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  test("rejects a malformed expression", () => {
    expect(() =>
      nextCronOccurrence({ cron: "not a cron", timeZone: "UTC" }),
    ).toThrow(InvalidCronExpressionError);
  });

  test("rejects a pattern that can never fire", () => {
    expect(() =>
      nextCronOccurrence({ cron: "0 0 31 2 *", timeZone: "UTC" }),
    ).toThrow(InvalidCronExpressionError);
  });

  test("previews consecutive occurrences", () => {
    const preview = previewCronOccurrences({
      cron: "0 */6 * * *",
      timeZone: "UTC",
      count: 3,
      after: new Date("2026-08-03T00:00:00Z"),
    });
    expect(preview.map((date) => date.toISOString())).toEqual([
      "2026-08-03T06:00:00.000Z",
      "2026-08-03T12:00:00.000Z",
      "2026-08-03T18:00:00.000Z",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { nextDailyOccurrence } from "./scheduling";

describe("agent training scheduling", () => {
  test("returns today's local occurrence when it is still ahead", () => {
    const next = nextDailyOccurrence({
      timeOfDay: "09:30",
      timeZone: "Europe/Lisbon",
      after: new Date("2026-07-20T07:00:00.000Z"),
    });
    expect(next.toISOString()).toBe("2026-07-20T08:30:00.000Z");
  });

  test("rolls to the following local day after the scheduled time", () => {
    const next = nextDailyOccurrence({
      timeOfDay: "09:30",
      timeZone: "Europe/Lisbon",
      after: new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(next.toISOString()).toBe("2026-07-21T08:30:00.000Z");
  });

  test("preserves wall-clock time across daylight-saving changes", () => {
    const next = nextDailyOccurrence({
      timeOfDay: "09:30",
      timeZone: "Europe/Lisbon",
      after: new Date("2026-10-24T12:00:00.000Z"),
    });
    expect(next.toISOString()).toBe("2026-10-25T09:30:00.000Z");
  });
});

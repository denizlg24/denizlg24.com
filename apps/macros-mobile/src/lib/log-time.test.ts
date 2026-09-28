import { describe, expect, test } from "bun:test";
import {
  eatenAtFor,
  entryLogTime,
  followsClock,
  hourOf,
  logPlacement,
  logTimeOf,
  logTimeParams,
  pinnedAt,
  readLogTime,
  sameTimeOn,
} from "./log-time";

const LISBON = "Europe/Lisbon";
const TOKYO = "Asia/Tokyo";
// 14:41 in Lisbon (UTC+1 in summer) on 6 October 2026.
const NOW = new Date("2026-10-06T13:41:27.000Z");

describe("eatenAtFor", () => {
  test("today following the clock is the moment of logging", () => {
    expect(
      eatenAtFor({ date: "2026-10-06", clock: null }, LISBON, NOW),
    ).toEqual(NOW);
  });

  test("another day following the clock keeps the current time of day", () => {
    expect(
      eatenAtFor(
        { date: "2026-10-04", clock: null },
        LISBON,
        NOW,
      ).toISOString(),
    ).toBe("2026-10-04T13:41:00.000Z");
  });

  test("a pinned time is that wall-clock time in the profile's zone", () => {
    expect(
      eatenAtFor(
        { date: "2026-10-06", clock: "08:15" },
        TOKYO,
        NOW,
      ).toISOString(),
    ).toBe("2026-10-05T23:15:00.000Z");
  });

  test("today in the profile's zone, not the device's", () => {
    // Already 02:41 on 7 October in Auckland, so a 6 October log is another
    // day there and takes that time of day.
    expect(
      eatenAtFor(
        { date: "2026-10-06", clock: null },
        "Pacific/Auckland",
        NOW,
      ).toISOString(),
    ).toBe("2026-10-05T13:41:00.000Z");
  });
});

describe("logPlacement", () => {
  test("carries the day and the instant, and nothing else", () => {
    expect(
      logPlacement({ date: "2026-10-05", clock: "19:30" }, LISBON, NOW),
    ).toEqual({ logDate: "2026-10-05", eatenAt: "2026-10-05T18:30:00.000Z" });
  });
});

describe("pinnedAt", () => {
  test("reads the picked instant back in the zone", () => {
    expect(pinnedAt(new Date("2026-10-05T23:15:00.000Z"), TOKYO)).toEqual({
      date: "2026-10-06",
      clock: "08:15",
    });
  });
});

describe("followsClock", () => {
  test("only an unpinned today follows the clock", () => {
    expect(
      followsClock({ date: "2026-10-06", clock: null }, "2026-10-06"),
    ).toBe(true);
    expect(
      followsClock({ date: "2026-10-05", clock: null }, "2026-10-06"),
    ).toBe(false);
    expect(
      followsClock({ date: "2026-10-06", clock: "12:00" }, "2026-10-06"),
    ).toBe(false);
  });
});

describe("hourOf", () => {
  test("uses the pinned hour, else the current one", () => {
    expect(hourOf({ date: "2026-10-06", clock: "07:59" }, LISBON, NOW)).toBe(7);
    expect(hourOf({ date: "2026-10-06", clock: null }, LISBON, NOW)).toBe(14);
  });
});

describe("sameTimeOn", () => {
  test("moves an entry's time of day onto another date", () => {
    expect(sameTimeOn("2026-10-05T06:45:10.000Z", "2026-10-06", LISBON)).toBe(
      "2026-10-06T06:45:00.000Z",
    );
  });

  test("keeps the wall-clock time across a daylight-saving change", () => {
    // 07:45 in Lisbon on 24 October (UTC+1) is 07:45 on 25 October (UTC+0).
    expect(sameTimeOn("2026-10-24T06:45:00.000Z", "2026-10-25", LISBON)).toBe(
      "2026-10-25T07:45:00.000Z",
    );
  });

  test("an entry without a time goes to noon", () => {
    expect(sameTimeOn(null, "2026-10-06", LISBON)).toBe(
      "2026-10-06T11:00:00.000Z",
    );
  });
});

describe("entryLogTime", () => {
  test("is the log day at the entry's time of day there", () => {
    expect(
      entryLogTime("2026-10-05", "2026-10-05T18:30:00.000Z", LISBON),
    ).toEqual({ date: "2026-10-05", clock: "19:30" });
    expect(entryLogTime("2026-10-05", null, LISBON)).toEqual({
      date: "2026-10-05",
      clock: "12:00",
    });
  });
});

describe("logTimeOf", () => {
  test("reads a staged body back, defaulting to today", () => {
    expect(
      logTimeOf("2026-10-05", "2026-10-05T18:30:00.000Z", LISBON, "2026-10-06"),
    ).toEqual({ date: "2026-10-05", clock: "19:30" });
    expect(logTimeOf(undefined, undefined, LISBON, "2026-10-06")).toEqual({
      date: "2026-10-06",
      clock: null,
    });
  });
});

describe("route params", () => {
  test("nothing to pass when the log simply follows today's clock", () => {
    expect(
      logTimeParams({ date: "2026-10-06", clock: null }, "2026-10-06"),
    ).toEqual({});
  });

  test("a day, and a time when one was chosen", () => {
    expect(
      logTimeParams({ date: "2026-10-04", clock: null }, "2026-10-06"),
    ).toEqual({ date: "2026-10-04" });
    expect(
      logTimeParams({ date: "2026-10-06", clock: "08:00" }, "2026-10-06"),
    ).toEqual({ date: "2026-10-06", time: "08:00" });
  });

  test("reading trusts only real dates up to today and real times", () => {
    const today = "2026-10-06";
    expect(readLogTime({ date: "2026-10-04", time: "08:30" }, today)).toEqual({
      date: "2026-10-04",
      clock: "08:30",
    });
    expect(readLogTime({ date: "2026-10-07" }, today).date).toBe(today);
    expect(readLogTime({ date: "2026-02-30" }, today).date).toBe(today);
    expect(readLogTime({ date: ["2026-10-04"] }, today).date).toBe(today);
    expect(readLogTime({ time: "24:00" }, today).clock).toBeNull();
    expect(readLogTime({ time: "8:30" }, today).clock).toBeNull();
  });
});

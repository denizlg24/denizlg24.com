import { describe, expect, test } from "bun:test";
import {
  isEarlyClose,
  isTradingDay,
  lastSessionClose,
  marketHolidays,
  marketSession,
} from "./session";

/** 09:30 New York is 13:30 UTC in summer, 14:30 UTC in winter. */
const at = (iso: string) => new Date(iso);

describe("marketHolidays", () => {
  test("derives the 2026 NYSE calendar", () => {
    const holidays = marketHolidays(2026);
    expect([...holidays].sort()).toEqual([
      "2026-01-01", // New Year's Day
      "2026-01-19", // MLK Day
      "2026-02-16", // Washington's Birthday
      "2026-04-03", // Good Friday
      "2026-05-25", // Memorial Day
      "2026-06-19", // Juneteenth
      "2026-07-03", // Independence Day, observed (4th is a Saturday)
      "2026-09-07", // Labor Day
      "2026-11-26", // Thanksgiving
      "2026-12-25", // Christmas
    ]);
  });

  test("a Sunday holiday rolls forward to the Monday", () => {
    // 2027-12-25 is a Saturday, so Christmas is observed on the Friday.
    expect(marketHolidays(2027).has("2027-12-24")).toBe(true);
    // 2022-12-25 was a Sunday, observed on the Monday.
    expect(marketHolidays(2022).has("2022-12-26")).toBe(true);
  });

  test("New Year's Day on a Saturday is not observed", () => {
    // 2022-01-01 was a Saturday; the NYSE did not close on 2021-12-31.
    expect(marketHolidays(2021).has("2021-12-31")).toBe(false);
    expect(marketHolidays(2022).has("2022-01-01")).toBe(false);
  });
});

describe("isTradingDay", () => {
  test("weekends and holidays are not trading days", () => {
    expect(isTradingDay("2026-08-03")).toBe(true); // Monday
    expect(isTradingDay("2026-08-08")).toBe(false); // Saturday
    expect(isTradingDay("2026-11-26")).toBe(false); // Thanksgiving
  });
});

describe("isEarlyClose", () => {
  test("the Friday after Thanksgiving closes at 13:00", () => {
    expect(isEarlyClose("2026-11-27")).toBe(true);
  });

  test("Christmas Eve on a weekday closes early", () => {
    expect(isEarlyClose("2026-12-24")).toBe(true);
  });

  test("an ordinary session is a full day", () => {
    expect(isEarlyClose("2026-08-03")).toBe(false);
  });
});

describe("marketSession", () => {
  test("regular hours read as open", () => {
    const session = marketSession(at("2026-08-03T15:00:00.000Z")); // 11:00 ET
    expect(session.state).toBe("open");
    expect(session.date).toBe("2026-08-03");
    expect(session.opensAt).toBe("2026-08-03T13:30:00.000Z");
    expect(session.closesAt).toBe("2026-08-03T20:00:00.000Z");
    expect(session.nextChangeAt).toBe("2026-08-03T20:00:00.000Z");
  });

  test("before the bell is pre-market", () => {
    const session = marketSession(at("2026-08-03T12:00:00.000Z")); // 08:00 ET
    expect(session.state).toBe("pre");
    expect(session.nextChangeAt).toBe("2026-08-03T13:30:00.000Z");
  });

  test("after the bell is after-hours until 20:00", () => {
    const session = marketSession(at("2026-08-03T22:00:00.000Z")); // 18:00 ET
    expect(session.state).toBe("after");
    expect(session.nextChangeAt).toBe("2026-08-04T00:00:00.000Z");
  });

  test("a weekend points at the next session", () => {
    const session = marketSession(at("2026-08-09T15:00:00.000Z")); // Sunday
    expect(session.state).toBe("closed");
    expect(session.opensAt).toBeNull();
    expect(session.nextChangeAt).toBe("2026-08-10T08:00:00.000Z");
  });

  test("a holiday skips to the following trading day", () => {
    const session = marketSession(at("2026-11-26T15:00:00.000Z")); // Thanksgiving
    expect(session.state).toBe("closed");
    expect(session.nextChangeAt).toBe("2026-11-27T09:00:00.000Z");
  });

  test("a half day closes at 13:00", () => {
    const session = marketSession(at("2026-11-27T17:00:00.000Z")); // 12:00 ET
    expect(session.state).toBe("open");
    expect(session.earlyClose).toBe(true);
    expect(session.closesAt).toBe("2026-11-27T18:00:00.000Z");
  });

  test("winter time shifts the bell against UTC", () => {
    const session = marketSession(at("2026-01-05T15:00:00.000Z")); // 10:00 ET
    expect(session.state).toBe("open");
    expect(session.opensAt).toBe("2026-01-05T14:30:00.000Z");
    expect(session.closesAt).toBe("2026-01-05T21:00:00.000Z");
  });
});

describe("lastSessionClose", () => {
  test("mid-session it is the previous day's close", () => {
    expect(lastSessionClose(at("2026-08-03T15:00:00.000Z")).toISOString()).toBe(
      "2026-07-31T20:00:00.000Z",
    );
  });

  test("after the bell it is today's close", () => {
    expect(lastSessionClose(at("2026-08-03T22:00:00.000Z")).toISOString()).toBe(
      "2026-08-03T20:00:00.000Z",
    );
  });

  test("a weekend reaches back to Friday", () => {
    expect(lastSessionClose(at("2026-08-09T15:00:00.000Z")).toISOString()).toBe(
      "2026-08-07T20:00:00.000Z",
    );
  });

  test("a half day closed at 13:00", () => {
    // The Friday after Thanksgiving; the following Monday looks back at 18:00Z.
    expect(lastSessionClose(at("2026-11-30T12:00:00.000Z")).toISOString()).toBe(
      "2026-11-27T18:00:00.000Z",
    );
  });
});

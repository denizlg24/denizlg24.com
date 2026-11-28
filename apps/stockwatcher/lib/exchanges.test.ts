import { describe, expect, test } from "bun:test";
import {
  countdown,
  exchangeStatus,
  localClock,
  sessionSpans,
} from "./exchanges";

const at = (iso: string) => new Date(iso).getTime();

describe("exchangeStatus", () => {
  test("NYSE is open mid-session and closes at 16:00 New York", () => {
    const status = exchangeStatus("NYSE", at("2026-11-25T15:00:00Z"));
    expect(status.state).toBe("open");
    expect(status.localTime).toBe("10:00");
    expect(status.next).toBe(at("2026-11-25T21:00:00Z"));
  });

  test("NYSE before the bell opens the same morning", () => {
    const status = exchangeStatus("NYSE", at("2026-11-25T13:00:00Z"));
    expect(status.state).toBe("closed");
    expect(status.next).toBe(at("2026-11-25T14:30:00Z"));
  });

  test("a Friday close rolls over the weekend to Monday", () => {
    const status = exchangeStatus("LSE", at("2026-11-27T17:00:00Z"));
    expect(status.state).toBe("closed");
    expect(status.next).toBe(at("2026-11-30T08:00:00Z"));
  });

  test("Saturday points to Monday's open", () => {
    const status = exchangeStatus("XETRA", at("2026-11-28T10:00:00Z"));
    expect(status.state).toBe("closed");
    expect(status.next).toBe(at("2026-11-30T08:00:00Z"));
  });

  test("TSE lunch is a break that reopens at 12:30 Tokyo", () => {
    const status = exchangeStatus("TSE", at("2026-11-25T03:00:00Z"));
    expect(status.state).toBe("break");
    expect(status.localTime).toBe("12:00");
    expect(status.next).toBe(at("2026-11-25T03:30:00Z"));
  });

  test("HKEX afternoon session closes at 16:00", () => {
    const status = exchangeStatus("HKEX", at("2026-11-25T06:00:00Z"));
    expect(status.state).toBe("open");
    expect(status.next).toBe(at("2026-11-25T08:00:00Z"));
  });

  test("the open across a DST change uses the new offset", () => {
    const status = exchangeStatus("NYSE", at("2026-03-07T12:00:00Z"));
    expect(status.next).toBe(at("2026-03-09T13:30:00Z"));
  });

  test("ASX opens at 10:00 Sydney summer time", () => {
    const status = exchangeStatus("ASX", at("2026-11-24T22:00:00Z"));
    expect(status.state).toBe("closed");
    expect(status.next).toBe(at("2026-11-24T23:00:00Z"));
  });
});

describe("countdown", () => {
  test("formats minutes, hours and days", () => {
    expect(countdown(5 * 60_000)).toBe("5m");
    expect(countdown(125 * 60_000)).toBe("2h 05m");
    expect(countdown(26 * 3_600_000)).toBe("1d 2h");
  });
});

describe("sessionSpans", () => {
  const day = (iso: string) => at(`${iso}T00:00:00Z`);

  test("NYSE trades one session inside the UTC day", () => {
    expect(sessionSpans("NYSE", day("2026-11-25"))).toEqual([
      {
        kind: "session",
        start: at("2026-11-25T14:30:00Z"),
        end: at("2026-11-25T21:00:00Z"),
      },
    ]);
  });

  test("TSE has a lunch break between its two sessions", () => {
    expect(sessionSpans("TSE", day("2026-11-25"))).toEqual([
      {
        kind: "session",
        start: at("2026-11-25T00:00:00Z"),
        end: at("2026-11-25T02:30:00Z"),
      },
      {
        kind: "break",
        start: at("2026-11-25T02:30:00Z"),
        end: at("2026-11-25T03:30:00Z"),
      },
      {
        kind: "session",
        start: at("2026-11-25T03:30:00Z"),
        end: at("2026-11-25T06:30:00Z"),
      },
    ]);
  });

  test("ASX sessions straddle the UTC midnight and are clipped", () => {
    expect(sessionSpans("ASX", day("2026-11-25"))).toEqual([
      {
        kind: "session",
        start: at("2026-11-25T00:00:00Z"),
        end: at("2026-11-25T05:00:00Z"),
      },
      {
        kind: "session",
        start: at("2026-11-25T23:00:00Z"),
        end: at("2026-11-26T00:00:00Z"),
      },
    ]);
  });

  test("a Saturday has no sessions", () => {
    expect(sessionSpans("XETRA", day("2026-11-28"))).toEqual([]);
  });

  test("ASX Monday open shows late on the Sunday UTC day", () => {
    expect(sessionSpans("ASX", day("2026-11-29"))).toEqual([
      {
        kind: "session",
        start: at("2026-11-29T23:00:00Z"),
        end: at("2026-11-30T00:00:00Z"),
      },
    ]);
  });
});

describe("localClock", () => {
  test("reads the exchange's wall clock", () => {
    expect(localClock("TSE", at("2026-11-25T03:05:00Z"))).toEqual({
      hour: 12,
      minute: 5,
    });
  });
});

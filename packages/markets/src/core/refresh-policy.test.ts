import { describe, expect, it } from "bun:test";
import type { ProviderBudget } from "../schemas";
import {
  BACKGROUND_BUDGET_RESERVE,
  backgroundQuoteMaxAgeMs,
  dailyBarsAvailableThrough,
  hasBackgroundHeadroom,
  shouldRefreshQuotes,
} from "./refresh-policy";

function budget(partial: Partial<ProviderBudget> = {}): ProviderBudget {
  return {
    provider: "tiingo",
    hourUsed: 0,
    hourLimit: 50,
    dayUsed: 0,
    dayLimit: 1000,
    hourResetsAt: "2026-08-10T15:00:00.000Z",
    dayResetsAt: "2026-08-11T00:00:00.000Z",
    ...partial,
  };
}

describe("hasBackgroundHeadroom", () => {
  it("allows background work while both windows are below the reserve", () => {
    expect(hasBackgroundHeadroom(budget({ hourUsed: 10, dayUsed: 100 }))).toBe(
      true,
    );
  });

  it("stops background work on the hourly reserve alone", () => {
    // 50 * (1 - 0.3) = 35
    expect(hasBackgroundHeadroom(budget({ hourUsed: 35 }))).toBe(false);
    expect(hasBackgroundHeadroom(budget({ hourUsed: 34 }))).toBe(true);
  });

  it("stops background work on the daily reserve alone", () => {
    expect(hasBackgroundHeadroom(budget({ dayUsed: 700 }))).toBe(false);
    expect(hasBackgroundHeadroom(budget({ dayUsed: 699 }))).toBe(true);
  });

  it("leaves the reserve untouched for the interactive path", () => {
    const spent = budget({ hourUsed: 35, dayUsed: 700 });
    expect(hasBackgroundHeadroom(spent)).toBe(false);
    expect(spent.hourLimit - spent.hourUsed).toBe(
      spent.hourLimit * BACKGROUND_BUDGET_RESERVE,
    );
  });
});

describe("dailyBarsAvailableThrough", () => {
  it("holds back the session that has only just closed", () => {
    // 2026-08-10 is a Monday; 16:00 ET is 20:00 UTC.
    const justClosed = new Date("2026-08-10T20:30:00.000Z");
    expect(dailyBarsAvailableThrough(justClosed)).toBe("2026-08-07");
  });

  it("releases the session once the settle margin has passed", () => {
    const settled = new Date("2026-08-10T23:30:00.000Z");
    expect(dailyBarsAvailableThrough(settled)).toBe("2026-08-10");
  });

  it("never reaches today during the session itself", () => {
    const midSession = new Date("2026-08-10T17:00:00.000Z");
    expect(dailyBarsAvailableThrough(midSession)).toBe("2026-08-07");
  });

  it("stays on Friday's bar across the weekend", () => {
    const sunday = new Date("2026-08-09T12:00:00.000Z");
    expect(dailyBarsAvailableThrough(sunday)).toBe("2026-08-07");
  });
});

describe("backgroundQuoteMaxAgeMs", () => {
  it("polls at the live cadence in regular hours", () => {
    expect(backgroundQuoteMaxAgeMs("open")).toBe(120_000);
  });

  it("backs off through extended hours", () => {
    expect(backgroundQuoteMaxAgeMs("pre")).toBe(900_000);
    expect(backgroundQuoteMaxAgeMs("after")).toBe(900_000);
  });

  it("declines to poll a closed market", () => {
    expect(backgroundQuoteMaxAgeMs("closed")).toBeNull();
  });
});

describe("shouldRefreshQuotes", () => {
  const now = new Date("2026-08-10T17:00:00.000Z");

  it("fetches when any requested ticker has no cached quote", () => {
    expect(
      shouldRefreshQuotes({ now, state: "open", oldestQuoteAt: null }),
    ).toBe(true);
  });

  it("holds inside the session cadence", () => {
    expect(
      shouldRefreshQuotes({
        now,
        state: "open",
        oldestQuoteAt: "2026-08-10T16:59:00.000Z",
      }),
    ).toBe(false);
  });

  it("refreshes once the session cadence has elapsed", () => {
    expect(
      shouldRefreshQuotes({
        now,
        state: "open",
        oldestQuoteAt: "2026-08-10T16:55:00.000Z",
      }),
    ).toBe(true);
  });

  it("never re-polls a closed market whose quotes postdate the close", () => {
    const overnight = new Date("2026-08-11T04:00:00.000Z");
    expect(
      shouldRefreshQuotes({
        now: overnight,
        state: "closed",
        oldestQuoteAt: "2026-08-10T20:05:00.000Z",
      }),
    ).toBe(false);
  });

  it("still prices a symbol whose quote predates the close", () => {
    const overnight = new Date("2026-08-11T04:00:00.000Z");
    expect(
      shouldRefreshQuotes({
        now: overnight,
        state: "closed",
        oldestQuoteAt: "2026-08-10T14:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("treats an unparseable timestamp as needing a refresh", () => {
    expect(
      shouldRefreshQuotes({ now, state: "open", oldestQuoteAt: "not a date" }),
    ).toBe(true);
  });
});

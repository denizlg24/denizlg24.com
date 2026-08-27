import { describe, expect, test } from "bun:test";
import mongoose from "mongoose";
import {
  FinanceBudgetReservation,
  nextFinanceBudgetWindow,
  nextFinanceSyncTime,
  requestedFinanceReservation,
} from "./fetch-budget";

describe("finance budget planning", () => {
  test("reserves both balance and transaction calls before starting", () => {
    expect(
      requestedFinanceReservation({
        mode: "cron",
        initialBackfill: false,
        dailyFetchLimit: 4,
        fetchesUsed: 0,
        reservedManualFetches: 1,
        attendedCallsExempt: false,
      }),
    ).toBe(2);
  });

  test("never lets cron consume the held manual call", () => {
    expect(
      requestedFinanceReservation({
        mode: "cron",
        initialBackfill: false,
        dailyFetchLimit: 4,
        fetchesUsed: 2,
        reservedManualFetches: 1,
        attendedCallsExempt: false,
      }),
    ).toBe(0);
    expect(
      requestedFinanceReservation({
        mode: "manual",
        initialBackfill: false,
        dailyFetchLimit: 4,
        fetchesUsed: 2,
        reservedManualFetches: 1,
        attendedCallsExempt: false,
      }),
    ).toBe(2);
  });

  test("refuses a fifth provider call in a four-call reservation", async () => {
    const reservation = new FinanceBudgetReservation(
      new mongoose.Types.ObjectId(),
      4,
      false,
      true,
    );
    expect(
      await Promise.all([
        reservation.consume(),
        reservation.consume(),
        reservation.consume(),
        reservation.consume(),
      ]),
    ).toEqual([true, true, true, true]);
    expect(await reservation.consume()).toBe(false);
  });

  test("resets at the account's local midnight", () => {
    const next = nextFinanceBudgetWindow(
      new Date("2026-07-29T22:30:00.000Z"),
      "Europe/Lisbon",
    );
    expect(next.toISOString()).toBe("2026-07-29T23:00:00.000Z");
  });

  test("plans routine syncs across the day", () => {
    expect(
      nextFinanceSyncTime({
        now: new Date("2026-07-29T08:00:00.000Z"),
        timezone: "UTC",
        dailyFetchLimit: 5,
        fetchesUsed: 0,
        reservedManualFetches: 1,
      }).toISOString(),
    ).toBe("2026-07-29T18:00:00.000Z");
  });
});

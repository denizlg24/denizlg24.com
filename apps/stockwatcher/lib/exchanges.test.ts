import { describe, expect, test } from "bun:test";
import { countdown, exchangeStatus } from "./exchanges";

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

import { describe, expect, test } from "bun:test";
import type { Progress } from "@repo/schemas/stream";
import {
  formatClock,
  formatRemaining,
  PROGRESS_INTERVAL_MS,
  progressFraction,
  resumePosition,
  shouldReportProgress,
} from "./time";

const progress = (patch: Partial<Progress>): Progress => ({
  titleId: "tt0111161",
  episodeId: null,
  positionS: 600,
  durationS: 7200,
  completed: false,
  updatedAt: "2026-10-23T12:00:00.000Z",
  ...patch,
});

describe("formatClock", () => {
  test("minutes and seconds under an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9.9)).toBe("0:09");
    expect(formatClock(123)).toBe("2:03");
  });

  test("hours with padded minutes", () => {
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(36000)).toBe("10:00:00");
  });

  test("reads nonsense as zero", () => {
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatRemaining", () => {
  test("rounds to minutes", () => {
    expect(formatRemaining(0, 4320)).toBe("1h 12m left");
    expect(formatRemaining(0, 3600)).toBe("1h left");
    expect(formatRemaining(100, 580)).toBe("8m left");
    expect(formatRemaining(570, 580)).toBe("Less than a minute left");
  });
});

describe("progressFraction", () => {
  test("is clamped and safe on a zero duration", () => {
    expect(progressFraction(30, 60)).toBe(0.5);
    expect(progressFraction(90, 60)).toBe(1);
    expect(progressFraction(10, 0)).toBe(0);
  });
});

describe("resumePosition", () => {
  test("resumes from a real position", () => {
    expect(resumePosition(progress({}))).toBe(600);
  });

  test("starts over when there is nothing worth resuming", () => {
    expect(resumePosition(null)).toBeNull();
    expect(resumePosition(progress({ positionS: 12 }))).toBeNull();
    expect(resumePosition(progress({ completed: true }))).toBeNull();
    expect(resumePosition(progress({ positionS: 7000 }))).toBeNull();
  });
});

describe("shouldReportProgress", () => {
  test("reports the first real position", () => {
    expect(
      shouldReportProgress({
        now: 0,
        lastSentAt: null,
        lastSentPosition: null,
        position: 4,
      }),
    ).toBe(true);
  });

  test("waits out the interval", () => {
    const base = { lastSentAt: 1000, lastSentPosition: 10, position: 20 };
    expect(shouldReportProgress({ ...base, now: 1000 + 5000 })).toBe(false);
    expect(
      shouldReportProgress({ ...base, now: 1000 + PROGRESS_INTERVAL_MS }),
    ).toBe(true);
  });

  test("a pause or close reports at once", () => {
    expect(
      shouldReportProgress({
        now: 1500,
        force: true,
        lastSentAt: 1000,
        lastSentPosition: 10,
        position: 14,
      }),
    ).toBe(true);
  });

  test("skips when paused in place", () => {
    expect(
      shouldReportProgress({
        now: 60_000,
        lastSentAt: 0,
        lastSentPosition: 20,
        position: 20.4,
      }),
    ).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  formatInterval,
  isDue,
  newCardState,
  previewReview,
  scheduleReview,
} from "./study";

const t0 = new Date("2026-11-12T08:00:00.000Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);
const days = (n: number) => minutes(n * 1440);

describe("fsrs", () => {
  test("a new card is due immediately and new", () => {
    const card = newCardState(t0);
    expect(card.state).toBe("new");
    expect(card.reps).toBe(0);
    expect(isDue(card, t0)).toBe(true);
  });

  test("preview equals the booked schedule for every rating", () => {
    const card = newCardState(t0);
    const preview = previewReview(card, t0);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const booked = scheduleReview(card, rating, t0);
      expect(booked.due).toBe(preview[rating].due);
      expect(booked.scheduledDays).toBe(preview[rating].scheduledDays);
    }
  });

  test("state survives a JSON round trip between reviews", () => {
    let card = newCardState(t0);
    card = scheduleReview(card, "good", t0);
    const restored = JSON.parse(JSON.stringify(card));
    expect(scheduleReview(restored, "good", days(1))).toEqual(
      scheduleReview(card, "good", days(1)),
    );
  });

  test("graduating to review and lapsing counts", () => {
    let card = newCardState(t0);
    let now = t0;
    for (let i = 0; i < 4; i++) {
      card = scheduleReview(card, "easy", now);
      now = new Date(card.due);
    }
    expect(card.state).toBe("review");
    expect(card.reps).toBe(4);
    const lapsed = scheduleReview(card, "again", now);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.state).toBe("relearning");
    expect(lapsed.elapsedDays).toBeGreaterThanOrEqual(0);
  });

  test("a card is not due before its date", () => {
    const card = scheduleReview(newCardState(t0), "easy", t0);
    expect(isDue(card, t0)).toBe(false);
    expect(isDue(card, new Date(card.due))).toBe(true);
  });
});

describe("formatInterval", () => {
  test("picks the unit by magnitude", () => {
    expect(formatInterval(t0, minutes(10))).toBe("10m");
    expect(formatInterval(t0, minutes(300))).toBe("5h");
    expect(formatInterval(t0, days(3))).toBe("3d");
    expect(formatInterval(t0, days(120))).toBe("4mo");
    expect(formatInterval(t0, days(438))).toBe("1.2y");
  });

  test("never reads below a minute or negative", () => {
    expect(formatInterval(t0, t0)).toBe("1m");
    expect(formatInterval(t0, new Date(t0.getTime() - 5000))).toBe("1m");
  });
});

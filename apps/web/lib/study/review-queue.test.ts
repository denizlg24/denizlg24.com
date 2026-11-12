import { describe, expect, test } from "bun:test";
import { newCardAllowance, planReviewQueue } from "./review-queue";

const now = new Date("2026-11-12T12:00:00.000Z");
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

function card(
  name: string,
  state: string,
  dueHours: number,
  createdHours = 0,
  suspended = false,
) {
  return {
    name,
    suspended,
    createdAt: at(createdHours),
    fsrs: { state, due: at(dueHours) },
  };
}

describe("planReviewQueue", () => {
  test("due cards oldest first, then new cards in creation order", () => {
    const { due, fresh } = planReviewQueue(
      [
        card("new-late", "new", 0, 2),
        card("due-recent", "review", -1),
        card("new-early", "new", 0, 1),
        card("due-old", "learning", -30),
        card("future", "review", 5),
      ],
      now,
      10,
    );
    expect(due.map((c) => c.name)).toEqual(["due-old", "due-recent"]);
    expect(fresh.map((c) => c.name)).toEqual(["new-early", "new-late"]);
  });

  test("suspended cards never appear", () => {
    const { due, fresh } = planReviewQueue(
      [card("a", "review", -1, 0, true), card("b", "new", 0, 0, true)],
      now,
      10,
    );
    expect(due).toEqual([]);
    expect(fresh).toEqual([]);
  });

  test("the allowance caps new cards but never due ones", () => {
    const { due, fresh } = planReviewQueue(
      [
        card("d1", "review", -1),
        card("d2", "review", -2),
        card("n1", "new", 0, 1),
        card("n2", "new", 0, 2),
      ],
      now,
      1,
    );
    expect(due).toHaveLength(2);
    expect(fresh.map((c) => c.name)).toEqual(["n1"]);
  });
});

describe("newCardAllowance", () => {
  test("counts today's first reviews against the cap", () => {
    expect(newCardAllowance(20, 5)).toBe(15);
    expect(newCardAllowance(20, 25)).toBe(0);
  });
});

import { describe, expect, it } from "bun:test";
import type { IPaper } from "@repo/schemas";
import {
  byReadingRecency,
  isOverdue,
  pagesRemaining,
  readingPercent,
  requiredPace,
} from "./reading";

const DAY_MS = 86_400_000;

function paper(overrides: Partial<IPaper> = {}): IPaper {
  return {
    _id: "1",
    title: "A reading",
    authors: [],
    type: "other",
    readingStatus: "reading",
    isbn: [],
    issn: [],
    citationKey: "reading",
    citable: false,
    courseIds: [],
    tags: [],
    noteIds: [],
    highlights: [],
    metadataSource: "manual",
    bibtex: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function progress(currentPage: number, totalPages?: number) {
  return { currentPage, totalPages, updatedAt: "2026-01-01T00:00:00.000Z" };
}

describe("reading progress", () => {
  it("derives a percentage from the page pair", () => {
    expect(readingPercent(paper({ progress: progress(50, 200) }))).toBe(25);
    expect(pagesRemaining(paper({ progress: progress(50, 200) }))).toBe(150);
  });

  it("reports a completed reading as finished without a page count", () => {
    expect(readingPercent(paper({ readingStatus: "read" }))).toBe(100);
  });

  it("reports nothing when the total page count is unknown", () => {
    expect(readingPercent(paper({ progress: progress(50) }))).toBeUndefined();
    expect(requiredPace(paper({ progress: progress(50) }))).toBeUndefined();
  });
});

describe("pacing", () => {
  it("spreads the remaining pages over the days left", () => {
    const due = new Date(Date.now() + 10 * DAY_MS).toISOString();
    expect(
      requiredPace(paper({ progress: progress(1, 101), dueAt: due })),
    ).toBe(10);
  });

  it("never divides by zero on the due date itself", () => {
    const due = new Date(Date.now() + 1000).toISOString();
    expect(requiredPace(paper({ progress: progress(1, 41), dueAt: due }))).toBe(
      40,
    );
  });

  it("has no pace once there is nothing left to read", () => {
    const due = new Date(Date.now() + 5 * DAY_MS).toISOString();
    expect(
      requiredPace(paper({ progress: progress(100, 100), dueAt: due })),
    ).toBeUndefined();
  });
});

describe("overdue", () => {
  it("flags a past deadline on an unfinished reading", () => {
    const due = new Date(Date.now() - DAY_MS).toISOString();
    expect(isOverdue({ dueAt: due, readingStatus: "reading" })).toBe(true);
  });

  it("does not flag a completed reading", () => {
    const due = new Date(Date.now() - DAY_MS).toISOString();
    expect(isOverdue({ dueAt: due, readingStatus: "read" })).toBe(false);
  });

  it("does not flag a reading with no deadline", () => {
    expect(isOverdue({ readingStatus: "reading" })).toBe(false);
  });
});

describe("continue-reading order", () => {
  it("puts the nearest deadline first and undated readings last", () => {
    const soon = paper({
      _id: "soon",
      dueAt: new Date(Date.now() + DAY_MS).toISOString(),
    });
    const later = paper({
      _id: "later",
      dueAt: new Date(Date.now() + 9 * DAY_MS).toISOString(),
    });
    const undated = paper({ _id: "undated" });

    expect(
      [undated, later, soon].sort(byReadingRecency).map((p) => p._id),
    ).toEqual(["soon", "later", "undated"]);
  });

  it("breaks a tie on the most recently read", () => {
    const stale = paper({
      _id: "stale",
      progress: { ...progress(2, 10), updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    const fresh = paper({
      _id: "fresh",
      progress: { ...progress(2, 10), updatedAt: "2026-06-01T00:00:00.000Z" },
    });

    expect([stale, fresh].sort(byReadingRecency).map((p) => p._id)).toEqual([
      "fresh",
      "stale",
    ]);
  });
});

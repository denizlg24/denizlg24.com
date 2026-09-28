import { describe, expect, test } from "bun:test";
import { groupByHour, sumEntries } from "./timeline";

function entry(id: string, eatenAt: string | null, calories = 100) {
  return { id, eatenAt, calories, protein: 10, carbs: 20, fat: 5 };
}

describe("groupByHour", () => {
  test("groups by the hour in the profile's zone, earliest first", () => {
    const entries = [
      entry("oats", "2026-10-06T06:45:00.000Z"),
      entry("coffee", "2026-10-06T07:10:00.000Z"),
      entry("banana", "2026-10-06T06:59:00.000Z"),
      entry("bowl", "2026-10-06T11:40:00.000Z"),
    ];
    const groups = groupByHour(entries, "Europe/Lisbon");
    expect(groups.map((group) => group.hour)).toEqual([7, 8, 12]);
    expect(groups[0]?.entries.map((item) => item.id)).toEqual([
      "oats",
      "banana",
    ]);
  });

  test("an entry with no time sits at noon", () => {
    const groups = groupByHour(
      [entry("old", null), entry("late", "2026-10-06T20:00:00.000Z")],
      "UTC",
    );
    expect(groups.map((group) => group.hour)).toEqual([12, 20]);
  });

  test("an empty day has no groups", () => {
    expect(groupByHour([], "UTC")).toEqual([]);
  });
});

describe("sumEntries", () => {
  test("adds energy and macros", () => {
    expect(sumEntries([entry("a", null, 120), entry("b", null, 80)])).toEqual({
      calories: 200,
      protein: 20,
      carbs: 40,
      fat: 10,
    });
  });
});

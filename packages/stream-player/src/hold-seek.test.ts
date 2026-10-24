import { expect, test } from "bun:test";
import { holdStep } from "./hold-seek";

test("holding a skip moves one step at first, then twice and four times as far", () => {
  expect(holdStep(0, 30)).toBe(30);
  expect(holdStep(1499, 30)).toBe(30);
  expect(holdStep(1500, 30)).toBe(60);
  expect(holdStep(3999, 30)).toBe(60);
  expect(holdStep(4000, 30)).toBe(120);
  expect(holdStep(60_000, 10)).toBe(40);
});

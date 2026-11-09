import { expect, test } from "bun:test";
import { releaseNote } from "./release";

const today = new Date(2026, 10, 9);

test("upcoming and recent titles get a date", () => {
  expect(releaseNote("2026-11-14", today)).toEqual({
    month: "Nov",
    day: "14",
    text: "Coming 14 November",
  });
  expect(releaseNote("2026-11-09", today)?.text).toBe("Out today");
  expect(releaseNote("2026-10-03", today)?.text).toBe("Out since 3 October");
  expect(releaseNote("2027-01-02", today)?.text).toBe("Coming 2 January 2027");
});

test("old or missing dates get nothing", () => {
  expect(releaseNote("1994-09-23", today)).toBeNull();
  expect(releaseNote(null, today)).toBeNull();
  expect(releaseNote("soon", today)).toBeNull();
});

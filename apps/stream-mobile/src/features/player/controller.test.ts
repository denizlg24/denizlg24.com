import { describe, expect, test } from "bun:test";
import { clampSeek, rateLabel } from "./controller";

describe("clampSeek", () => {
  test("stays inside the runtime", () => {
    expect(clampSeek(-4, 100)).toBe(0);
    expect(clampSeek(140, 100)).toBe(100);
    expect(clampSeek(40, 100)).toBe(40);
  });

  test("only floors while the duration is unknown", () => {
    expect(clampSeek(500, 0)).toBe(500);
  });
});

test("rateLabel", () => {
  expect(rateLabel(1)).toBe("Normal");
  expect(rateLabel(1.5)).toBe("1.5x");
});

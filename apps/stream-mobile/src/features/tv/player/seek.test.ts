import { describe, expect, test } from "bun:test";
import { SEEK_STEP_S, SKIP_STEP_S, seekStep, seekTarget } from "./seek";

describe("remote seeking", () => {
  test("steps grow once a held arrow has repeated", () => {
    expect(seekStep(0)).toBe(SEEK_STEP_S);
    expect(seekStep(3)).toBe(SEEK_STEP_S);
    expect(seekStep(4)).toBe(SKIP_STEP_S);
  });

  test("a run of presses builds on the pending target, not the clock", () => {
    const first = seekTarget(null, 100, 10, 600);
    expect(first).toBe(110);
    expect(seekTarget(first, 101, 10, 600)).toBe(120);
  });

  test("stays inside the runtime", () => {
    expect(seekTarget(null, 5, -10, 600)).toBe(0);
    expect(seekTarget(null, 595, 10, 600)).toBe(600);
    expect(seekTarget(null, 5, 10, 0)).toBe(15);
  });
});

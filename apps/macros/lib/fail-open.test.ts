import { afterEach, describe, expect, it } from "bun:test";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { failOpenAtBuild } from "./fail-open";

const phase = process.env.NEXT_PHASE;
afterEach(() => {
  process.env.NEXT_PHASE = phase;
});

const unreachable = () => Promise.reject(new Error("connect ECONNREFUSED"));

describe("failOpenAtBuild", () => {
  it("returns the value when the load succeeds", async () => {
    expect(await failOpenAtBuild("x", async () => 3, 0)).toBe(3);
  });

  it("falls back during a production build", async () => {
    process.env.NEXT_PHASE = PHASE_PRODUCTION_BUILD;
    expect(await failOpenAtBuild("x", unreachable, [])).toEqual([]);
  });

  it("rethrows at runtime so the last good render stays cached", async () => {
    delete process.env.NEXT_PHASE;
    await expect(failOpenAtBuild("x", unreachable, [])).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

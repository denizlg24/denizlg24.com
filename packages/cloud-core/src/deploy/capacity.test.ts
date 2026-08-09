import { describe, expect, it } from "bun:test";

import { deriveMemoryCeilingMb, MAX_MEMORY_MB } from "@repo/schemas/cloud";

import {
  assertMemoryCapacity,
  CapacityExceededError,
  memoryCeilingMb,
} from "./capacity";

describe("memoryCeilingMb", () => {
  it("derives a generous ceiling from the one configured reservation", () => {
    expect(
      memoryCeilingMb({ memoryReservationMb: 256, memoryLimitMb: null }),
    ).toBe(1_024);
    expect(deriveMemoryCeilingMb(MAX_MEMORY_MB)).toBe(MAX_MEMORY_MB);
  });

  it("honours a stored ceiling override", () => {
    expect(
      memoryCeilingMb({ memoryReservationMb: 256, memoryLimitMb: 2_048 }),
    ).toBe(2_048);
  });
});

describe("assertMemoryCapacity", () => {
  it("allows a reservation that exactly fills the host budget", () => {
    expect(() =>
      assertMemoryCapacity({
        committedMb: 768,
        requestedMb: 256,
        allocatableMb: 1_024,
      }),
    ).not.toThrow();
  });

  it("refuses an overcommit with the useful capacity figures", () => {
    try {
      assertMemoryCapacity({
        committedMb: 768,
        requestedMb: 512,
        allocatableMb: 1_024,
      });
      throw new Error("Expected capacity check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapacityExceededError);
      expect(error).toMatchObject({
        code: "CAPACITY_EXCEEDED",
        committedMb: 768,
        requestedMb: 512,
        allocatableMb: 1_024,
      });
      expect((error as Error).message).toContain("exceeds 1024 MB");
    }
  });
});

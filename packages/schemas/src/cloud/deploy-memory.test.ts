import { describe, expect, it } from "bun:test";

import {
  deploymentRuntimeSpecSchema,
  deriveMemoryCeilingMb,
  MAX_MEMORY_MB,
} from "./deploy";

describe("deploy memory", () => {
  it("derives the burst ceiling and caps it at the platform maximum", () => {
    expect(deriveMemoryCeilingMb(256)).toBe(1_024);
    expect(deriveMemoryCeilingMb(16_384)).toBe(MAX_MEMORY_MB);
  });

  it("defaults a runtime to a 256 MB reservation and 1 GB ceiling", () => {
    const runtime = deploymentRuntimeSpecSchema.parse({});
    expect(runtime.memoryReservationMb).toBe(256);
    expect(runtime.memoryLimitMb).toBe(1_024);
  });

  it("refuses a ceiling below the reservation", () => {
    expect(
      deploymentRuntimeSpecSchema.safeParse({
        memoryReservationMb: 1_024,
        memoryLimitMb: 512,
      }).success,
    ).toBe(false);
  });
});

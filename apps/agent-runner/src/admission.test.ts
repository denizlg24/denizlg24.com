import { describe, expect, test } from "bun:test";
import {
  type AdmissionSample,
  decideAdmission,
  parseForgeBuilding,
  parseMemAvailable,
  sampleAdmission,
} from "./admission";

const GIB = 1024 ** 3;

const MEMINFO = `MemTotal:       32768000 kB
MemFree:         1048576 kB
MemAvailable:   21286912 kB
Buffers:          123456 kB
SwapTotal:       8388604 kB
`;

const limits = {
  maxConcurrent: 2,
  minMemAvailableBytes: 10 * GIB,
  minFreeDiskBytes: 50 * GIB,
};

const quiet: AdmissionSample = {
  memAvailableBytes: 20 * GIB,
  forgeBuilding: 0,
  freeDiskBytes: 900 * GIB,
  live: 0,
  egressReady: true,
};

describe("parseMemAvailable", () => {
  test("reads kB as bytes", () => {
    expect(parseMemAvailable(MEMINFO)).toBe(21_286_912 * 1024);
  });

  test("is null without the line", () => {
    expect(parseMemAvailable("MemTotal: 1 kB\n")).toBeNull();
  });
});

describe("parseForgeBuilding", () => {
  test("prefers building over running", () => {
    expect(
      parseForgeBuilding({ status: "ok", queue: { running: 2, building: 0 } }),
    ).toBe(0);
  });

  test("falls back to running on an older agent", () => {
    expect(parseForgeBuilding({ queue: { running: 1 } })).toBe(1);
  });

  test("is null on anything else", () => {
    expect(parseForgeBuilding({ status: "ok" })).toBeNull();
    expect(parseForgeBuilding("nope")).toBeNull();
  });
});

describe("decideAdmission", () => {
  test("admits on a quiet box", () => {
    expect(decideAdmission(quiet, limits)).toEqual({
      capacity: 2,
      admissible: true,
      reasons: [],
    });
  });

  test("refuses under 10 GB available", () => {
    const decision = decideAdmission(
      { ...quiet, memAvailableBytes: 9.5 * GIB },
      limits,
    );
    expect(decision.admissible).toBe(false);
    expect(decision.capacity).toBe(2);
    expect(decision.reasons[0]).toContain("MemAvailable");
  });

  test("refuses while Forge builds", () => {
    expect(
      decideAdmission({ ...quiet, forgeBuilding: 1 }, limits).admissible,
    ).toBe(false);
  });

  test("refuses when the agent cannot be read", () => {
    expect(
      decideAdmission({ ...quiet, forgeBuilding: null }, limits).admissible,
    ).toBe(false);
  });

  test("refuses under 50 GB free", () => {
    expect(
      decideAdmission({ ...quiet, freeDiskBytes: 49 * GIB }, limits).admissible,
    ).toBe(false);
  });

  test("has no capacity at the concurrency limit", () => {
    const decision = decideAdmission({ ...quiet, live: 2 }, limits);
    expect(decision.capacity).toBe(0);
    expect(decision.admissible).toBe(false);
  });

  test("one live run leaves one slot", () => {
    expect(decideAdmission({ ...quiet, live: 1 }, limits).capacity).toBe(1);
  });

  test("refuses without verified egress rules", () => {
    expect(
      decideAdmission({ ...quiet, egressReady: false }, limits).reasons,
    ).toEqual(["egress rules not verified"]);
  });
});

describe("sampleAdmission", () => {
  test("a failing probe reads as unknown, not as zero", async () => {
    const sample = await sampleAdmission(
      {
        meminfo: async () => MEMINFO,
        forgeHealth: async () => {
          throw new Error("connection refused");
        },
        freeDiskBytes: async () => 100 * GIB,
      },
      1,
      true,
    );
    expect(sample.forgeBuilding).toBeNull();
    expect(sample.memAvailableBytes).toBe(21_286_912 * 1024);
    expect(decideAdmission(sample, limits).admissible).toBe(false);
  });
});

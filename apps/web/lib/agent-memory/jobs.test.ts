import { describe, expect, test } from "bun:test";
import type { AgentReleaseGates } from "@repo/schemas";
import { operationIsEnabled, retryDelayMs } from "./jobs";

const gates: AgentReleaseGates = {
  evidenceLedger: true,
  formation: false,
  shadowRetrieval: false,
  chatMemory: false,
  reflection: false,
  proactivity: false,
};

describe("agent memory jobs", () => {
  test("uses bounded exponential backoff", () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(100)).toBe(3_600_000);
  });

  test("does not lease formation before Gate B", () => {
    expect(operationIsEnabled("formation", gates)).toBe(false);
    expect(operationIsEnabled("backfill", gates)).toBe(true);
    expect(operationIsEnabled("training", gates)).toBe(true);
  });
});

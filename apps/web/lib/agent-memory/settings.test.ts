import { describe, expect, test } from "bun:test";
import type { AgentReleaseGates } from "@repo/schemas";
import { planGateTransition } from "./settings";

const disabled: AgentReleaseGates = {
  evidenceLedger: false,
  formation: false,
  shadowRetrieval: false,
  chatMemory: false,
  reflection: false,
  proactivity: false,
};

const verification = {
  verifiedAt: "2026-07-13T10:00:00.000Z",
  verifiedBy: "owner" as const,
  sampleSize: 50,
  hardGatesPassed: true,
  notes: "Synthetic and owner activity sample passed review.",
  metrics: {},
};

describe("agent release gates", () => {
  test("allows Gate A deployment before its release sample exists", () => {
    expect(
      planGateTransition(
        disabled,
        {
          gate: "A",
          enabled: true,
          verification: { ...verification, sampleSize: 0 },
        },
        { vectorBackendReady: false },
      ).evidenceLedger,
    ).toBe(true);
  });

  test("enables Gate A after verification", () => {
    expect(
      planGateTransition(
        disabled,
        { gate: "A", enabled: true, verification },
        { vectorBackendReady: false },
      ).evidenceLedger,
    ).toBe(true);
  });

  test("refuses a gate when its prerequisite is disabled", () => {
    expect(() =>
      planGateTransition(
        disabled,
        { gate: "B", enabled: true, verification },
        { vectorBackendReady: false },
      ),
    ).toThrow("requires Gate A");
  });

  test("refuses Gate B until Gate A has its 50-event release sample", () => {
    expect(() =>
      planGateTransition(
        { ...disabled, evidenceLedger: true },
        { gate: "B", enabled: true, verification },
        {
          vectorBackendReady: false,
          priorVerifications: {
            A: { ...verification, sampleSize: 49 },
          },
        },
      ),
    ).toThrow("sample of at least 50");
  });

  test("refuses Gate C without a bounded vector backend", () => {
    const current = {
      ...disabled,
      evidenceLedger: true,
      formation: true,
    };
    expect(() =>
      planGateTransition(
        current,
        {
          gate: "C",
          enabled: true,
          verification: {
            ...verification,
            metrics: {
              provenanceCoverage: 1,
              exclusionCoverage: 1,
              maliciousPromotions: 0,
              budgetViolations: 0,
              recallAt10: 0.9,
              temporalAccuracy: 0.95,
            },
          },
        },
        {
          vectorBackendReady: false,
          priorVerifications: { A: verification, B: verification },
        },
      ),
    ).toThrow("bounded vector backend");
  });

  test("disabling a gate also disables every dependent gate", () => {
    const enabled: AgentReleaseGates = {
      evidenceLedger: true,
      formation: true,
      shadowRetrieval: true,
      chatMemory: true,
      reflection: true,
      proactivity: true,
    };
    expect(
      planGateTransition(
        enabled,
        { gate: "C", enabled: false },
        { vectorBackendReady: true },
      ),
    ).toEqual({
      evidenceLedger: true,
      formation: true,
      shadowRetrieval: false,
      chatMemory: false,
      reflection: false,
      proactivity: false,
    });
  });
});

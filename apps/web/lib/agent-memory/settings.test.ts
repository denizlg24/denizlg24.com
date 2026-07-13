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

  test("allows Gate B deployment before its formation release sample exists", () => {
    expect(
      planGateTransition(
        { ...disabled, evidenceLedger: true },
        {
          gate: "B",
          enabled: true,
          verification: { ...verification, sampleSize: 0 },
        },
        {
          vectorBackendReady: false,
          priorVerifications: { A: verification },
        },
      ).formation,
    ).toBe(true);
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

  test("refuses Gate C until Gate B has a labelled release sample", () => {
    expect(() =>
      planGateTransition(
        { ...disabled, evidenceLedger: true, formation: true },
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
              recallAt10: 1,
              temporalAccuracy: 1,
            },
          },
        },
        {
          vectorBackendReady: true,
          priorVerifications: {
            A: verification,
            B: { ...verification, sampleSize: 0 },
          },
        },
      ),
    ).toThrow("sample of at least 1");
  });

  test("enables Gate D only after an owner-labelled baseline improvement", () => {
    const current = {
      ...disabled,
      evidenceLedger: true,
      formation: true,
      shadowRetrieval: true,
    };
    const priorVerifications = {
      A: verification,
      B: verification,
      C: verification,
    };
    expect(() =>
      planGateTransition(
        current,
        { gate: "D", enabled: true, verification },
        { vectorBackendReady: true, priorVerifications },
      ),
    ).toThrow("improve the labelled baseline");
    expect(
      planGateTransition(
        current,
        {
          gate: "D",
          enabled: true,
          verification: {
            ...verification,
            sampleSize: 1,
            metrics: { baselineImproved: 1 },
          },
        },
        { vectorBackendReady: true, priorVerifications },
      ).chatMemory,
    ).toBe(true);
  });

  test("enables Gate E only after reversible reflection verification", () => {
    const current = {
      ...disabled,
      evidenceLedger: true,
      formation: true,
      shadowRetrieval: true,
      chatMemory: true,
    };
    const priorVerifications = {
      A: verification,
      B: verification,
      C: verification,
      D: { ...verification, metrics: { baselineImproved: 1 } },
    };
    expect(() =>
      planGateTransition(
        current,
        { gate: "E", enabled: true, verification },
        { vectorBackendReady: true, priorVerifications },
      ),
    ).toThrow("provenance, idempotency, rollback, and safety");
    expect(
      planGateTransition(
        current,
        {
          gate: "E",
          enabled: true,
          verification: {
            ...verification,
            sampleSize: 1,
            metrics: {
              provenanceCoverage: 1,
              idempotentReplay: 1,
              rollbackRestored: 1,
              unsafeAutomaticChanges: 0,
            },
          },
        },
        { vectorBackendReady: true, priorVerifications },
      ).reflection,
    ).toBe(true);
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

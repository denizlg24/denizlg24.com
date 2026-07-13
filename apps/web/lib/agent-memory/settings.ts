import { randomUUID } from "node:crypto";
import type {
  AgentGateVerification,
  AgentReleaseGateName,
  AgentReleaseGates,
  SetAgentReleaseGate,
  UpdateAgentMemorySettings,
} from "@repo/schemas";
import {
  agentGateVerificationSchema,
  updateAgentMemorySettingsSchema,
} from "@repo/schemas";
import type { ClientSession } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import {
  AgentMemorySettings,
  DEFAULT_AGENT_MEMORY_SETTINGS,
  type IAgentMemorySettings,
} from "@/models/AgentMemorySettings";
import { AgentMemoryPolicyError } from "./policy";
import {
  AGENT_MEMORY_VECTOR_CONFIG,
  vectorIndexMatchesContract,
} from "./vector-config";

const GATE_FIELDS: Record<AgentReleaseGateName, keyof AgentReleaseGates> = {
  A: "evidenceLedger",
  B: "formation",
  C: "shadowRetrieval",
  D: "chatMemory",
  E: "reflection",
  F: "proactivity",
};

const GATE_ORDER: AgentReleaseGateName[] = ["A", "B", "C", "D", "E", "F"];

type InternalSettings = Omit<IAgentMemorySettings, keyof Document>;

function defaultSettings(): typeof DEFAULT_AGENT_MEMORY_SETTINGS & {
  createdAt: Date;
  updatedAt: Date;
} {
  const now = new Date();
  return {
    ...structuredClone(DEFAULT_AGENT_MEMORY_SETTINGS),
    createdAt: now,
    updatedAt: now,
  };
}

export async function getAgentMemorySettings(): Promise<InternalSettings> {
  await connectDB();
  const settings = await AgentMemorySettings.findById("singleton").lean();
  return (settings ?? defaultSettings()) as InternalSettings;
}

function assertVerification(
  gate: AgentReleaseGateName,
  verification: AgentGateVerification | undefined,
  vectorBackendReady: boolean,
) {
  if (!verification) {
    throw new AgentMemoryPolicyError(
      `Gate ${gate} requires recorded verification evidence`,
      "gate-disabled",
    );
  }
  agentGateVerificationSchema.parse(verification);
  if (!verification.hardGatesPassed) {
    throw new AgentMemoryPolicyError(
      `Gate ${gate} hard verification gates did not pass`,
      "gate-disabled",
    );
  }
  if (gate !== "A" && verification.sampleSize < 1) {
    throw new AgentMemoryPolicyError(
      `Gate ${gate} requires a labelled verification sample`,
      "gate-disabled",
    );
  }

  if (gate === "C") {
    const metrics = verification.metrics;
    if (
      !vectorBackendReady ||
      metrics.provenanceCoverage !== 1 ||
      metrics.exclusionCoverage !== 1 ||
      metrics.maliciousPromotions !== 0 ||
      metrics.budgetViolations !== 0 ||
      (metrics.recallAt10 ?? 0) < 0.8 ||
      (metrics.temporalAccuracy ?? 0) < 0.9
    ) {
      throw new AgentMemoryPolicyError(
        "Gate C requires a bounded vector backend and all retrieval thresholds",
        "gate-disabled",
      );
    }
  }

  if (gate === "D" && verification.metrics.baselineImproved !== 1) {
    throw new AgentMemoryPolicyError(
      "Gate D requires memory to improve the labelled baseline",
      "gate-disabled",
    );
  }
}

function assertPrerequisiteRelease(
  gate: AgentReleaseGateName,
  verification: AgentGateVerification | undefined,
) {
  if (!verification?.hardGatesPassed) {
    throw new AgentMemoryPolicyError(
      `Gate ${gate} release verification has not passed`,
      "gate-disabled",
    );
  }
  const minimumSample = gate === "A" ? 50 : 1;
  if (verification.sampleSize < minimumSample) {
    throw new AgentMemoryPolicyError(
      `Gate ${gate} release requires a labelled sample of at least ${minimumSample}`,
      "gate-disabled",
    );
  }
}

export function planGateTransition(
  current: AgentReleaseGates,
  input: SetAgentReleaseGate,
  options: {
    vectorBackendReady: boolean;
    priorVerifications?: Partial<
      Record<AgentReleaseGateName, AgentGateVerification>
    >;
  },
): AgentReleaseGates {
  const next = { ...current };
  const index = GATE_ORDER.indexOf(input.gate);

  if (!input.enabled) {
    for (const gate of GATE_ORDER.slice(index)) next[GATE_FIELDS[gate]] = false;
    return next;
  }

  for (const prerequisite of GATE_ORDER.slice(0, index)) {
    if (!current[GATE_FIELDS[prerequisite]]) {
      throw new AgentMemoryPolicyError(
        `Gate ${input.gate} requires Gate ${prerequisite}`,
        "gate-disabled",
      );
    }
    assertPrerequisiteRelease(
      prerequisite,
      options.priorVerifications?.[prerequisite],
    );
  }
  assertVerification(
    input.gate,
    input.verification,
    options.vectorBackendReady,
  );
  next[GATE_FIELDS[input.gate]] = true;
  return next;
}

export async function probeAgentMemoryVectorBackend(): Promise<boolean> {
  await connectDB();
  try {
    const indexes = await AgentMemorySettings.db
      .collection(AGENT_MEMORY_VECTOR_CONFIG.collection)
      .listSearchIndexes()
      .toArray();
    return indexes.some(vectorIndexMatchesContract);
  } catch {
    return false;
  }
}

async function auditSettings(
  action: string,
  revision: number,
  reason: string,
  metadata: Record<string, unknown>,
  session: ClientSession,
) {
  await AgentAuditEvent.create(
    [
      {
        auditId: randomUUID(),
        action,
        actor: "user",
        targetType: "settings",
        targetId: "singleton",
        targetRevision: revision,
        reason,
        metadata,
        contentRedacted: false,
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

export async function updateAgentMemorySettings(
  input: UpdateAgentMemorySettings,
  reason: string,
): Promise<IAgentMemorySettings> {
  const parsed = updateAgentMemorySettingsSchema.parse(input);
  await connectDB();
  const session = await AgentMemorySettings.startSession();
  let result: IAgentMemorySettings | null = null;

  try {
    await session.withTransaction(async () => {
      const current =
        (await AgentMemorySettings.findById("singleton").session(session)) ??
        new AgentMemorySettings(DEFAULT_AGENT_MEMORY_SETTINGS);
      const nextRevision = current.revision + (current.isNew ? 0 : 1);
      current.set(parsed);
      current.revision = nextRevision;
      await current.save({ session });
      await auditSettings(
        "settings.update",
        nextRevision,
        reason,
        { fields: Object.keys(parsed) },
        session,
      );
      result = current;
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new Error("Settings transaction did not complete");
  return result;
}

export async function setAgentReleaseGate(
  input: SetAgentReleaseGate,
): Promise<IAgentMemorySettings> {
  await connectDB();
  const vectorBackendReady =
    input.gate === "C" && input.enabled
      ? await probeAgentMemoryVectorBackend()
      : false;
  const session = await AgentMemorySettings.startSession();
  let result: IAgentMemorySettings | null = null;

  try {
    await session.withTransaction(async () => {
      const current =
        (await AgentMemorySettings.findById("singleton").session(session)) ??
        new AgentMemorySettings(DEFAULT_AGENT_MEMORY_SETTINGS);
      const nextGates = planGateTransition(current.releaseGates, input, {
        vectorBackendReady,
        priorVerifications: current.gateVerifications,
      });
      const nextRevision = current.revision + (current.isNew ? 0 : 1);
      current.releaseGates = nextGates;
      if (input.enabled && input.verification) {
        current.gateVerifications = {
          ...current.gateVerifications,
          [input.gate]: {
            ...input.verification,
            verifiedAt: new Date(input.verification.verifiedAt),
          },
        };
      }
      current.revision = nextRevision;
      await current.save({ session });
      await auditSettings(
        input.enabled ? "gate.enable" : "gate.disable",
        nextRevision,
        input.enabled
          ? (input.verification?.notes ?? `Enable Gate ${input.gate}`)
          : `Disable Gate ${input.gate} and dependent gates`,
        { gate: input.gate, enabled: input.enabled },
        session,
      );
      result = current;
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new Error("Gate transaction did not complete");
  return result;
}

import { describe, expect, test } from "bun:test";
import { AgentEvidenceEvent } from "./AgentEvidenceEvent";
import { AgentMemory } from "./AgentMemory";
import { AgentMemoryCandidate } from "./AgentMemoryCandidate";
import { AgentMemoryJob } from "./AgentMemoryJob";
import { AgentMemoryRevision } from "./AgentMemoryRevision";
import { Conversation } from "./Conversation";

function indexIsUnique(
  model: {
    schema: { indexes(): [Record<string, unknown>, { unique?: boolean }][] };
  },
  key: string,
) {
  return model.schema
    .indexes()
    .some(([fields, options]) => key in fields && options.unique === true);
}

describe("agent memory models", () => {
  test("defaults new conversations to memory enabled with immutable event ids", () => {
    const conversation = new Conversation({
      title: "Memory test",
      llmModel: "anthropic/claude-haiku-4.5",
      messages: [
        {
          role: "user",
          content: "Remember this.",
          createdAt: new Date("2026-07-13T10:00:00.000Z"),
        },
      ],
    });
    expect(conversation.memoryMode).toBe("enabled");
    expect(conversation.messages[0]?.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  test("declare unique idempotency and revision indexes", () => {
    expect(indexIsUnique(AgentEvidenceEvent, "idempotencyKey")).toBe(true);
    expect(indexIsUnique(AgentMemoryJob, "idempotencyKey")).toBe(true);

    const revisionIndexes = AgentMemoryRevision.schema.indexes() as unknown as [
      Record<string, unknown>,
      { unique?: boolean },
    ][];
    const revisionIndex = revisionIndexes.find(
      ([fields]) => "memoryId" in fields && "revision" in fields,
    );
    expect(revisionIndex?.[1].unique).toBe(true);
  });

  test("rejects an active memory without evidence", async () => {
    const memory = new AgentMemory({
      currentRevisionId: "507f1f77bcf86cd799439011",
      revision: 1,
      statement: "The user prefers concise answers.",
      memoryType: "semantic",
      status: "active",
      explicitness: "explicit",
      confidence: 0.95,
      importance: 0.7,
      trust: "high",
      sensitivity: "personal",
      temporal: { precision: "unknown" },
      evidenceIds: [],
    });

    await expect(memory.validate()).rejects.toThrow();
  });

  test("rejects inverted temporal ranges", async () => {
    const candidate = new AgentMemoryCandidate({
      statement: "The user is temporarily in Lisbon.",
      memoryType: "semantic",
      explicitness: "explicit",
      confidence: 0.9,
      importance: 0.5,
      trust: "high",
      sensitivity: "personal",
      temporal: {
        validFrom: new Date("2026-07-14T00:00:00.000Z"),
        validUntil: new Date("2026-07-13T00:00:00.000Z"),
        precision: "range",
      },
      evidenceIds: ["9fa3e791-b155-4719-bda8-f6542ea421f3"],
      extraction: {
        model: "anthropic/claude-haiku-4.5",
        promptVersion: "formation-v1",
        schemaVersion: "1",
        inputHash: "a".repeat(64),
        runId: "507f1f77bcf86cd799439012",
      },
      reason: "Explicit temporary statement",
    });

    await expect(candidate.validate()).rejects.toThrow(
      "validUntil must be after validFrom",
    );
  });
});

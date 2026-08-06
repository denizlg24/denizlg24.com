import { describe, expect, test } from "bun:test";
import type { IndexDefinition, IndexOptions } from "mongoose";
import { AgentEvidenceEvent } from "./AgentEvidenceEvent";
import { AgentMemory } from "./AgentMemory";
import { AgentMemoryCandidate } from "./AgentMemoryCandidate";
import { AgentMemoryJob } from "./AgentMemoryJob";
import { AgentMemoryRevision } from "./AgentMemoryRevision";
import { AgentResourceSuggestion } from "./AgentResourceSuggestion";
import { BackgroundAgentRun } from "./BackgroundAgentRun";
import { Conversation } from "./Conversation";

/**
 * Mongoose's own index types rather than a hand-rolled structural match: the
 * shape has moved under us before, and `unique` is `boolean | [true, string]`
 * since 9.9 — the tuple form carries a duplicate-key message and still means
 * unique.
 */
function isUnique(options: IndexOptions): boolean {
  return Array.isArray(options.unique)
    ? options.unique[0] === true
    : options.unique === true;
}

function indexIsUnique(
  model: { schema: { indexes(): [IndexDefinition, IndexOptions][] } },
  key: string,
) {
  return model.schema
    .indexes()
    .some(([fields, options]) => key in fields && isUnique(options));
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

  test("persists memory disclosure metadata on assistant messages", async () => {
    const traceId = "9fa3e791-b155-4719-bda8-f6542ea421f3";
    const conversation = new Conversation({
      title: "Memory trace test",
      llmModel: "anthropic/claude-haiku-4.5",
      messages: [
        {
          role: "assistant",
          content: "A memory-grounded response.",
          retrievalTraceId: traceId,
          memoryInjected: true,
          createdAt: new Date("2026-07-13T10:00:00.000Z"),
        },
      ],
    });

    await conversation.validate();
    expect(conversation.messages[0]?.retrievalTraceId).toBe(traceId);
    expect(conversation.messages[0]?.memoryInjected).toBe(true);
  });

  test("declare unique idempotency and revision indexes", () => {
    expect(indexIsUnique(AgentEvidenceEvent, "idempotencyKey")).toBe(true);
    expect(indexIsUnique(AgentMemoryJob, "idempotencyKey")).toBe(true);

    const revisionIndex = AgentMemoryRevision.schema
      .indexes()
      .find(([fields]) => "memoryId" in fields && "revision" in fields);
    expect(revisionIndex && isUnique(revisionIndex[1])).toBe(true);
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

  test("accepts empty enrichment fields in deterministic person suggestions", async () => {
    const suggestion = new AgentResourceSuggestion({
      resourceType: "person",
      entityKey: "person:sereffatin-gunes",
      entityLabel: "Sereffatin Gunes",
      draft: {
        name: "Sereffatin Gunes",
        relationToOwner: "",
        notes: "",
      },
      memoryIds: ["507f1f77bcf86cd799439011"],
      confidence: 1,
      reason: "Person entity has no attached directory record.",
      existingResourceMatches: [],
      status: "pending",
      model: "deterministic",
    });

    await expect(suggestion.validate()).resolves.toBeUndefined();
  });

  test("accepts attachment-only background runs and rejects unknown statuses", async () => {
    const run = new BackgroundAgentRun({
      conversationId: "507f1f77bcf86cd799439011",
      prompt: "",
      llmModel: "anthropic/claude-sonnet-4.6",
      attachments: [
        {
          type: "image",
          url: "https://storage.example/photo.jpg",
          name: "photo.jpg",
        },
      ],
      maxRounds: 10,
      status: "queued",
    });
    await expect(run.validate()).resolves.toBeUndefined();

    run.set("status", "unknown");
    await expect(run.validate()).rejects.toThrow();
  });

  test("persists a person resource attachment on entity refs", async () => {
    const memory = new AgentMemory({
      currentRevisionId: "507f1f77bcf86cd799439011",
      revision: 1,
      statement: "Sereffatin Gunes is the owner's father.",
      memoryType: "semantic",
      status: "active",
      explicitness: "explicit",
      confidence: 0.95,
      importance: 0.8,
      trust: "high",
      sensitivity: "personal",
      temporal: { precision: "unknown" },
      entityRefs: [
        {
          entityType: "person",
          entityId: "sereffatin-gunes",
          label: "Sereffatin Gunes",
          resourceId: "507f1f77bcf86cd799439012",
        },
      ],
      evidenceIds: ["9fa3e791-b155-4719-bda8-f6542ea421f3"],
    });

    await memory.validate();
    expect(memory.entityRefs[0]?.resourceId).toBe("507f1f77bcf86cd799439012");
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

import { describe, expect, test } from "bun:test";
import {
  buildEvidenceInput,
  observeConversationMessages,
  stableContentHash,
} from "./evidence";

describe("agent evidence helpers", () => {
  test("hashes objects independently of key order", () => {
    expect(stableContentHash({ a: 1, b: 2 })).toBe(
      stableContentHash({ b: 2, a: 1 }),
    );
  });

  test("builds bounded canonical evidence", () => {
    const evidence = buildEvidenceInput({
      idempotencyKey: "conversation:1:message:1",
      sourceType: "conversation",
      sourceRef: { entityType: "conversation", entityId: "1", revision: "1" },
      content: { text: "I live in Lisbon." },
      snapshot: `  ${"x".repeat(9_000)}  `,
      occurredAt: new Date("2026-07-13T10:00:00.000Z"),
      actor: "user",
      trust: "high",
      sensitivity: "personal",
    });
    expect(evidence.snapshot?.length).toBe(8_192);
    expect(evidence.contentHash).toHaveLength(64);
  });

  test("incognito conversation messages short-circuit without persistence", async () => {
    const result = await observeConversationMessages({
      conversationId: "507f1f77bcf86cd799439011",
      memoryMode: "incognito",
      messages: [
        {
          eventId: "9fa3e791-b155-4719-bda8-f6542ea421f3",
          role: "user",
          content: "This must not enter agent memory.",
          createdAt: new Date("2026-07-13T10:00:00.000Z"),
        },
      ],
    });
    expect(result).toEqual({
      created: 0,
      duplicate: 0,
      skipped: 1,
      rejected: 0,
    });
  });
});

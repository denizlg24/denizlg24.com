import { describe, expect, test } from "bun:test";
import type { IChatMessage } from "@repo/schemas";
import { toStoredMessage } from "./message-storage";

describe("conversation message persistence", () => {
  test("preserves memory disclosure metadata", () => {
    const traceId = "1e8da684-1857-469f-a9ea-353b3652cdac";
    const message: IChatMessage = {
      eventId: "ccc3b2fe-a355-4467-b3da-9f1d472f866b",
      role: "assistant",
      content: "A response grounded in memory.",
      retrievalTraceId: traceId,
      memoryInjected: true,
      createdAt: "2026-07-13T17:00:42.238Z",
    };

    expect(toStoredMessage(message)).toMatchObject({
      retrievalTraceId: traceId,
      memoryInjected: true,
    });
  });
});

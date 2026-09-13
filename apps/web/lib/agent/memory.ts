import { randomUUID } from "node:crypto";
import type { AgentMemoryMode, AgentUIMessage } from "@repo/schemas";
import { buildRetrievalQuery } from "@/lib/agent-memory/query-context";
import {
  loadInjectedMemoryContext,
  loadInjectedMemoryImages,
  type RetrievedMemoryImage,
  retrieveMemoriesForChat,
} from "@/lib/agent-memory/retrieval";

export interface TurnMemory {
  context: string | null;
  images: RetrievedMemoryImage[];
  traceId?: string;
  injected: boolean;
}

const NO_MEMORY: TurnMemory = { context: null, images: [], injected: false };

function lastTrace(
  messages: readonly AgentUIMessage[],
): { traceId: string; injected: boolean } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const metadata = messages[index]?.metadata;
    if (metadata?.retrievalTraceId) {
      return {
        traceId: metadata.retrievalTraceId,
        injected: metadata.memoryInjected === true,
      };
    }
  }
  return null;
}

/**
 * A new user message retrieves afresh. A continuation — approvals answered,
 * a page tool's result returned — reuses what the turn was given, so the
 * model does not lose its context halfway through the same request.
 */
export async function recallForTurn(options: {
  conversationId?: string;
  memoryMode: AgentMemoryMode;
  latestText: string | null;
  rollingSummary: string | null;
  history: readonly AgentUIMessage[];
}): Promise<TurnMemory> {
  try {
    if (options.latestText !== null) {
      const retrieval = await retrieveMemoriesForChat({
        conversationId: options.conversationId,
        requestId: randomUUID(),
        query: buildRetrievalQuery({
          latestMessage: options.latestText,
          rollingSummary: options.rollingSummary,
        }),
        memoryMode: options.memoryMode,
      });
      if (!retrieval) return NO_MEMORY;
      return {
        context: retrieval.context,
        images: retrieval.images,
        traceId: retrieval.traceId,
        injected: retrieval.injected,
      };
    }
    const trace = lastTrace(options.history);
    if (!trace?.injected) return NO_MEMORY;
    const [context, images] = await Promise.all([
      loadInjectedMemoryContext(trace.traceId),
      loadInjectedMemoryImages(trace.traceId),
    ]);
    return {
      context,
      images,
      traceId: trace.traceId,
      injected: context !== null,
    };
  } catch (error) {
    console.error("Agent memory recall failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NO_MEMORY;
  }
}

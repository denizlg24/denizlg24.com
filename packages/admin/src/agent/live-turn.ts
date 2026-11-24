import { type AgentLiveEvent, agentLiveEventSchema } from "@repo/schemas";
import { createSseParser } from "@repo/utils/agent-live";

/**
 * Reads `GET chat/{id}/stream` to its end. Resolves `true` when the server
 * said the turn ended, `false` when the connection dropped first — the caller
 * reconnects then, and the first patch of the new connection (a full
 * snapshot) puts the message right whatever was missed.
 */
export async function readLiveEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentLiveEvent) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let ended = false;
  const parse = createSseParser((data) => {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = agentLiveEventSchema.safeParse(json);
    if (!parsed.success) return;
    if (parsed.data.type === "end") ended = true;
    onEvent(parsed.data);
  });
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort);
  try {
    while (!ended) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
  } catch {
    // A dropped connection reads as not ended.
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (ended) void reader.cancel().catch(() => {});
  }
  return ended;
}

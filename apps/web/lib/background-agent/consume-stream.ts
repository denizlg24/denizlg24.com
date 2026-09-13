import type { UIMessageChunk } from "ai";

/**
 * Drains an unattended turn's stream so its `onEnd` runs, surfacing a stream
 * error as a thrown one. An approval request means the policy asked a
 * question nobody can answer; that is a bug in the caller's setup, not a
 * pause to wait on.
 */
export async function consumeUIMessageStream(
  stream: ReadableStream<UIMessageChunk>,
) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.type === "error") throw new Error(value.errorText);
      if (value.type === "tool-approval-request" && !value.isAutomatic) {
        throw new Error("Unattended run asked for approval");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

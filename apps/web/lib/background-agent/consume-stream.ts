export async function consumeAgentStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((candidate) => candidate.startsWith("data: "));
      if (!line) continue;
      let event: { type?: string; error?: string };
      try {
        event = JSON.parse(line.slice(6)) as typeof event;
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        throw error;
      }
      if (event.type === "error") {
        const error = new Error(event.error ?? "Background agent run failed");
        await reader.cancel(error).catch(() => {});
        throw error;
      }
      if (event.type === "paused") {
        const error = new Error("Background agent run paused unexpectedly");
        await reader.cancel(error).catch(() => {});
        throw error;
      }
    }
  }
}

import { createRuntimeApp } from "../src/runtime";

interface SmokeRuntime {
  stop(): Promise<void>;
}

export async function ensureLocalSmokeRuntime(
  targetUrl: string,
): Promise<SmokeRuntime | null> {
  const url = new URL(targetUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return null;
  }
  try {
    const response = await fetch(`${url.origin}/healthz`);
    if (response.ok) return null;
  } catch {
    // Start the real runtime in-process when the local dev API is not already up.
  }
  const app = await createRuntimeApp();
  const server = Bun.serve({
    hostname: url.hostname,
    port: Number(url.port || 80),
    idleTimeout: 0,
    fetch: app.fetch,
  });
  return {
    async stop() {
      server.stop(true);
      await app.closeRuntime();
    },
  };
}

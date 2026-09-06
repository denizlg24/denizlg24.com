import { describe, expect, it } from "bun:test";
import { runCommandSchema, SANDBOX_PROTOCOL_VERSION } from "./contract";
import app from "./index";

const call = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://sandbox.test${path}`, init));

describe("the sandbox scaffold", () => {
  /**
   * Forge probes `/` and `/healthz` to decide a deployment is serving. It has to
   * answer while the app does nothing else, or the scaffold cannot be deployed
   * at all — and deploying it is the point of landing it before it works.
   */
  it("reports healthy so a deploy can go ready", async () => {
    const response = await call("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      protocolVersion: SANDBOX_PROTOCOL_VERSION,
    });
  });

  /**
   * 501, never a plausible-looking empty success. A stub that answered a command
   * with `{ exitCode: 0, stdout: "" }` would be read as code that ran and
   * produced nothing, which is worse than the error it replaced.
   */
  it("refuses every operation it cannot perform", async () => {
    const routes: [string, RequestInit][] = [
      ["/sessions", { method: "POST" }],
      ["/sessions/abc", { method: "DELETE" }],
      ["/sessions/abc/commands", { method: "POST" }],
      ["/sessions/abc/files", { method: "POST" }],
      ["/sessions/abc/files", {}],
      ["/sessions/abc/ports/3000", {}],
    ];

    for (const [path, init] of routes) {
      const response = await call(path, init);
      expect(response.status).toBe(501);
      const body = (await response.json()) as { error: string };
      // The message has to say where the decision is written down, or the next
      // person to hit it re-derives why the sandbox is gone.
      expect(body.error).toContain("019-ui-ux-fixes-sep5");
    }
  });
});

describe("the wire contract", () => {
  it("bounds a command's runtime rather than letting it hold a slot forever", () => {
    expect(runCommandSchema.parse({ command: "ls" }).timeoutMs).toBe(120_000);
    expect(
      runCommandSchema.safeParse({ command: "ls", timeoutMs: 999_999 }).success,
    ).toBe(false);
  });

  it("requires a command, since an empty one has no meaning", () => {
    expect(runCommandSchema.safeParse({ command: "" }).success).toBe(false);
  });
});

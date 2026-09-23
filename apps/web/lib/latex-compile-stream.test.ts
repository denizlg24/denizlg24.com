import { describe, expect, it, mock } from "bun:test";
import { latexCompileEventSchema } from "@repo/schemas";

mock.module("server-only", () => ({}));

const { latexCompileEventResponse } = await import("./latex-compile-stream");

async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) =>
      latexCompileEventSchema.parse(JSON.parse(frame.slice(5).trim())),
    );
}

describe("latexCompileEventResponse", () => {
  it("emits every log chunk and then the done event", async () => {
    const response = latexCompileEventResponse(
      async (onOutput) => {
        onOutput("note: Running TeX ...\n");
        await Promise.resolve();
        onOutput("note: Writing `./main.pdf`\n");
        return { log: "final", payload: { ok: true } };
      },
      () => ({
        type: "error",
        status: 500,
        error: "unreachable",
        log: "",
        diagnostics: [],
      }),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await events(response)).toEqual([
      { type: "log", text: "note: Running TeX ...\n" },
      { type: "log", text: "note: Writing `./main.pdf`\n" },
      { type: "done", log: "final", payload: { ok: true } },
    ]);
  });

  it("maps a rejection through onError and still closes the stream", async () => {
    const response = latexCompileEventResponse(
      () => Promise.reject(new Error("busy")),
      (error) => ({
        type: "error",
        status: 409,
        error: error instanceof Error ? error.message : "?",
        log: "",
        diagnostics: [],
      }),
    );
    expect(await events(response)).toEqual([
      { type: "error", status: 409, error: "busy", log: "", diagnostics: [] },
    ]);
  });

  it("stops the keepalive when the consumer cancels", async () => {
    const cleared: unknown[] = [];
    const realClear = globalThis.clearInterval;
    globalThis.clearInterval = ((handle: unknown) => {
      cleared.push(handle);
      return realClear(handle as Parameters<typeof realClear>[0]);
    }) as typeof realClear;
    let release: (() => void) | undefined;
    try {
      const response = latexCompileEventResponse(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ log: "", payload: null });
          }),
        () => ({
          type: "error",
          status: 500,
          error: "unreachable",
          log: "",
          diagnostics: [],
        }),
      );
      await response.body?.cancel();
      expect(cleared.length).toBe(1);
    } finally {
      globalThis.clearInterval = realClear;
      release?.();
    }
  });
});

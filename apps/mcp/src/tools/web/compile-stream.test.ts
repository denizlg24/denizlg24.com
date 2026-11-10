import { describe, expect, test } from "bun:test";
import type { LatexCompileEvent } from "@repo/schemas";
import type { ToolRegistrar } from "../../server";
import { createUpstream, ServiceTokens } from "../../upstream";
import { createApi } from "../define";
import { createClient, testConfig } from "../harness.test-util";
import { registerWebCv } from "./cv";
import { registerWebLatex } from "./latex";

// Scaled down: the default upstream deadline stands in for the old 30 s one,
// the compile deadline for the 12 min one.
const DEFAULT_DEADLINE_MS = 50;
const COMPILE_DEADLINE_MS = 400;

const latexProject = {
  version: 1,
  name: "CV",
  mainFile: "main.tex",
  entries: [
    {
      id: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a",
      kind: "file",
      path: "main.tex",
      encoding: "utf8",
      content: "\\documentclass{article}\\begin{document}x\\end{document}",
    },
  ],
};

type Step = { afterMs: number; event: LatexCompileEvent };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An SSE body that honours the request's abort the way fetch's does. */
function sseResponse(steps: Step[], signal: AbortSignal | null | undefined) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const aborted = () =>
        controller.error(new DOMException("", "AbortError"));
      signal?.addEventListener("abort", aborted, { once: true });
      for (const step of steps) {
        await sleep(step.afterMs);
        if (signal?.aborted) return;
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(step.event)}\n\n`),
        );
      }
      signal?.removeEventListener("abort", aborted);
      if (steps.at(-1)?.event.type !== "log") controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

/** A body written as exactly these byte chunks, then closed. */
function chunkedResponse(chunks: Uint8Array[]) {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await sleep(5);
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

/** Cuts bytes at each offset, wherever that lands. */
function cutAt(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
  const edges = [0, ...offsets, bytes.length];
  return edges.slice(1).map((end, index) => bytes.slice(edges[index], end));
}

function compileClient(
  steps: Step[],
  respond: (signal: AbortSignal | null | undefined) => Response = (signal) =>
    sseResponse(steps, signal),
) {
  const paths: string[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "t", expires_in: 300 });
    }
    paths.push(url.pathname);
    return respond(init?.signal);
  };
  const fakeFetch = Object.assign(fetchImpl, {
    preconnect: () => {},
  }) satisfies typeof fetch;
  const upstream = createUpstream(
    testConfig,
    new ServiceTokens(testConfig, fakeFetch),
    fakeFetch,
    DEFAULT_DEADLINE_MS,
  );
  const register: ToolRegistrar = (server) => {
    const api = createApi(upstream);
    const options = { compileDeadlineMs: COMPILE_DEADLINE_MS };
    registerWebCv(server, api, options);
    registerWebLatex(server, api, options);
  };
  return { client: createClient(upstream, register), paths };
}

const draft = {
  url: "https://example.test/cv.pdf",
  filename: "DenizGunesCV.pdf",
  size: 1234,
  updatedAt: "2026-11-09T12:00:00.000Z",
};

describe("compile over the event stream", () => {
  test("a compile slower than the default deadline still succeeds", async () => {
    const { client, paths } = compileClient([
      { afterMs: 30, event: { type: "log", text: "downloading bundle\n" } },
      { afterMs: 30, event: { type: "log", text: "downloading fonts\n" } },
      {
        afterMs: 60,
        event: {
          type: "done",
          log: "Writing main.pdf",
          payload: { cv: null, draft, project: latexProject },
        },
      },
    ]);
    const result = await client.call("web_cv", {
      action: "compile",
      project: latexProject,
    });
    expect(paths).toEqual(["/api/admin/cv/compile"]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      outcome: "compiled",
      cv: null,
      draft,
      logTail: "Writing main.pdf",
    });
    expect(result.structuredContent?.project).toBeUndefined();
  });

  test("a compiler error comes back with its diagnostics", async () => {
    const diagnostics = [
      {
        file: "main.tex",
        line: 12,
        message: "Undefined control sequence",
        context: "l.12 \\titleformat",
      },
    ];
    const { client } = compileClient([
      { afterMs: 5, event: { type: "log", text: "running TeX\n" } },
      {
        afterMs: 5,
        event: {
          type: "error",
          status: 422,
          error: "LaTeX compilation failed",
          log: "! Undefined control sequence.",
          diagnostics,
        },
      },
    ]);
    const result = await client.call("web_cv", {
      action: "compile",
      project: latexProject,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 422,
      error: {
        outcome: "compile_failed",
        pdfUpdated: false,
        diagnostics,
        logTail: "! Undefined control sequence.",
      },
    });
  });

  test("an exceeded deadline says the PDF is not updated", async () => {
    const { client } = compileClient([
      { afterMs: 5, event: { type: "log", text: "downloading bundle\n" } },
      {
        afterMs: COMPILE_DEADLINE_MS * 3,
        event: { type: "done", log: "", payload: {} },
      },
    ]);
    const result = await client.call("web_latex_projects", {
      action: "compile",
      projectId: "l1",
      baseRevision: 3,
      project: latexProject,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: null,
      error: {
        outcome: "deadline_exceeded",
        pdfUpdated: false,
        logTail: "downloading bundle\n",
      },
    });
    const error = result.structuredContent?.error as { note: string };
    expect(error.note).toContain("may still finish");
  });

  test("a project compile drops the echoed source", async () => {
    const { client, paths } = compileClient([
      {
        afterMs: 80,
        event: {
          type: "done",
          log: "",
          payload: {
            project: {
              _id: "l1",
              revision: 4,
              compileStatus: "compiled",
              compiledPdf: { url: "https://example.test/l1.pdf" },
              project: latexProject,
            },
          },
        },
      },
    ]);
    const result = await client.call("web_latex_projects", {
      action: "compile",
      projectId: "l1",
      baseRevision: 3,
      project: latexProject,
    });
    expect(paths).toEqual(["/api/admin/latex/projects/l1/compile"]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      outcome: "compiled",
      project: { _id: "l1", revision: 4, compileStatus: "compiled" },
    });
    const project = result.structuredContent?.project as Record<
      string,
      unknown
    >;
    expect(project.project).toBeUndefined();
  });
  test("a done frame split mid-line and inside a character, with CRLF, still compiles", async () => {
    const done: LatexCompileEvent = {
      type: "done",
      log: "Writing main.pdf ✓ — Günes",
      payload: { cv: null, draft, project: latexProject },
    };
    const frame = new TextEncoder().encode(
      `: keepalive\r\n\r\ndata: ${JSON.stringify({ type: "log", text: "bundle\n" })}\r\n\r\ndata: ${JSON.stringify(done)}\r\n\r\n`,
    );
    const check = new TextEncoder().encode("✓");
    const at = frame.indexOf(check[0] ?? 0);
    expect(at).toBeGreaterThan(0);
    const { client } = compileClient([], () =>
      chunkedResponse(cutAt(frame, [7, 40, at + 1, at + 2, frame.length - 3])),
    );
    const result = await client.call("web_cv", {
      action: "compile",
      project: latexProject,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      outcome: "compiled",
      draft,
      logTail: "Writing main.pdf ✓ — Günes",
    });
  });

  test("a stream that closes without done or error says so", async () => {
    const frame = new TextEncoder().encode(
      `data: ${JSON.stringify({ type: "log", text: "halfway\n" })}\n\n`,
    );
    const { client } = compileClient([], () => chunkedResponse([frame]));
    const result = await client.call("web_cv", {
      action: "compile",
      project: latexProject,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: null,
      error: { outcome: "stream_ended", pdfUpdated: false },
    });
  });
});

import { describe, expect, it } from "bun:test";
import type { LatexCompileEvent } from "@repo/schemas";
import { AdminApiError, type AdminClient } from "../client";
import { compileOverStream, LatexCompileRequestError } from "./compile-stream";

function frames(events: LatexCompileEvent[], chunkSize = 7): Response {
  const text = `: keepalive\n\n${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}`;
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  // Small chunks so a frame regularly straddles two reads.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

function clientAnswering(response: Response): AdminClient {
  const unused = () => Promise.reject(new Error("not used"));
  return {
    get: unused,
    post: unused,
    put: unused,
    patch: unused,
    del: unused,
    upload: unused,
    uploadFile: unused,
    raw: () => Promise.resolve(response),
  };
}

describe("compileOverStream", () => {
  it("forwards log chunks in order and resolves with the done payload", async () => {
    const logs: string[] = [];
    const result = await compileOverStream<{ project: { id: string } }>(
      clientAnswering(
        frames([
          { type: "log", text: "note: Running TeX ...\n" },
          { type: "log", text: "note: Writing `./main.pdf`\n" },
          {
            type: "done",
            log: "note: Running TeX ...\nnote: Writing `./main.pdf`",
            payload: { project: { id: "p1" } },
          },
        ]),
      ),
      "latex/projects/p1/compile",
      {},
      { onLog: (chunk) => logs.push(chunk) },
    );
    expect(logs).toEqual([
      "note: Running TeX ...\n",
      "note: Writing `./main.pdf`\n",
    ]);
    expect(result.payload.project.id).toBe("p1");
  });

  it("throws the error event with its status, diagnostics and payload", async () => {
    const attempt = compileOverStream(
      clientAnswering(
        frames([
          { type: "log", text: "note: Running TeX ...\n" },
          {
            type: "error",
            status: 422,
            error:
              "LaTeX compilation failed: main.tex:3: Undefined control sequence",
            log: "error: main.tex:3: Undefined control sequence",
            diagnostics: [
              {
                file: "main.tex",
                line: 3,
                message: "Undefined control sequence",
                context: "! Undefined control sequence.\nl.3 Hello \\x",
              },
            ],
            payload: { project: { id: "p1" } },
          },
        ]),
      ),
      "latex/projects/p1/compile",
      {},
      { onLog: () => undefined },
    );
    const error = await attempt.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(LatexCompileRequestError);
    if (!(error instanceof LatexCompileRequestError)) return;
    expect(error.status).toBe(422);
    expect(error.diagnostics).toHaveLength(1);
    expect(error.payload).toEqual({ project: { id: "p1" } });
  });

  it("reports a stream that closes without an outcome", async () => {
    const attempt = compileOverStream(
      clientAnswering(frames([{ type: "log", text: "note: Running TeX" }])),
      "cv/compile",
      {},
      { onLog: () => undefined },
    );
    await expect(attempt).rejects.toBeInstanceOf(AdminApiError);
  });
});

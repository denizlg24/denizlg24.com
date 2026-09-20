import "server-only";

import type { LatexCompileEvent } from "@repo/schemas";

export type LatexCompileErrorEvent = Extract<
  LatexCompileEvent,
  { type: "error" }
>;

// Tectonic is silent for as long as a bundle download or a slow TeX run takes,
// and an idle stream is what a proxy in front of the app times out.
const KEEPALIVE_MS = 15_000;

function encode(event: LatexCompileEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Runs a compilation and answers it as server-sent events: every chunk of
 * console output as a `log` event while the engine runs, then one `done` or
 * `error`. The HTTP status is 200 whatever happens, since the headers left
 * before the outcome was known; `error.status` carries what it would have
 * been. A client that goes away stops the writes, not the compile — the
 * project row still records the outcome.
 */
export function latexCompileEventResponse(
  run: (
    onOutput: (text: string) => void,
  ) => Promise<{ log: string; payload: unknown }>,
  onError: (
    error: unknown,
  ) => LatexCompileErrorEvent | Promise<LatexCompileErrorEvent>,
): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const keepalive = setInterval(
        () => write(": keepalive\n\n"),
        KEEPALIVE_MS,
      );
      const finish = (event: LatexCompileEvent) => {
        clearInterval(keepalive);
        write(encode(event));
        if (open) {
          open = false;
          controller.close();
        }
      };
      run((text) => write(encode({ type: "log", text }))).then(
        ({ log, payload }) => finish({ type: "done", log, payload }),
        (error: unknown) =>
          Promise.resolve(onError(error)).then(finish, (mappingError) => {
            console.error("LaTeX compile error mapping failed", mappingError);
            finish({
              type: "error",
              status: 500,
              error: "Failed to compile",
              log: "",
              diagnostics: [],
            });
          }),
      );
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

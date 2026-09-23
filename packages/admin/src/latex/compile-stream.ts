import { LatexCompileFailure } from "@repo/latex-editor/compile-failure";
import {
  type LatexCompileDiagnostic,
  type LatexCompileEvent,
  latexCompileEventSchema,
} from "@repo/schemas";
import { AdminApiError, type AdminClient } from "../client";

/**
 * A compile the server answered with an `error` event. Extends the editor's
 * failure so the output pane renders the diagnostics; `status` and `payload`
 * are what the same failure used to carry as an HTTP status and JSON body
 * (the project row after a 422, the current row after a 409 conflict).
 */
export class LatexCompileRequestError extends LatexCompileFailure {
  constructor(
    message: string,
    log: string,
    diagnostics: LatexCompileDiagnostic[],
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message, log, diagnostics);
    this.name = "LatexCompileRequestError";
  }
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<LatexCompileEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield latexCompileEventSchema.parse(JSON.parse(data));
        separator = buffer.indexOf("\n\n");
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * POSTs a compile request and follows its event stream: `onLog` for each
 * chunk of console output, the `done` payload as the result. An `error`
 * event throws `LatexCompileRequestError`; a refusal before the stream
 * opened (auth, validation, size) still surfaces as the transport's own
 * `AdminApiError`.
 */
export async function compileOverStream<TPayload>(
  client: AdminClient,
  endpoint: string,
  body: unknown,
  handlers: { onLog: (chunk: string) => void; signal?: AbortSignal },
): Promise<{ log: string; payload: TPayload }> {
  const response = await client.raw(endpoint, {
    method: "POST",
    body,
    signal: handlers.signal,
  });
  if (!response.body) {
    throw new AdminApiError("Empty compile response", response.status);
  }
  for await (const event of readEvents(response.body)) {
    if (event.type === "log") {
      handlers.onLog(event.text);
      continue;
    }
    if (event.type === "done") {
      return { log: event.log, payload: event.payload as TPayload };
    }
    throw new LatexCompileRequestError(
      event.error,
      event.log,
      event.diagnostics,
      event.status,
      event.payload,
    );
  }
  throw new AdminApiError("The compile stream ended early", 502);
}

import { type LatexCompileEvent, latexCompileEventSchema } from "@repo/schemas";
import { type Api, fail, fromResponse, ok, type ToolResult } from "../define";

/**
 * Web kills Tectonic at 90 s (`COMPILE_TIMEOUT_MS` in
 * apps/web/lib/latex-compiler.ts); the PDF upload and the database writes come
 * after that. A cold Tectonic cache spends most of that budget downloading the
 * bundle, so the default 30 s upstream deadline failed valid compiles.
 */
export const COMPILE_DEADLINE_MS = 150_000;

const LOG_TAIL_CHARS = 4_000;

function tail(text: string): string {
  return text.length > LOG_TAIL_CHARS ? text.slice(-LOG_TAIL_CHARS) : text;
}

export interface CompileStreamOptions {
  path: string;
  body: unknown;
  deadlineMs: number;
  /** Shapes the `done` payload into the result; the full source stays out. */
  summarize: (payload: unknown) => Record<string, unknown>;
  /** What the owner should check after a deadline, for this route. */
  afterDeadline: string;
}

/**
 * The compile routes answer as `latexCompileEventSchema` server-sent events
 * and only the terminal `done` or `error` says what happened, so the stream is
 * read to its end rather than returned as text.
 */
export async function compileThroughStream(
  api: Api,
  options: CompileStreamOptions,
): Promise<ToolResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.deadlineMs);
  let log = "";
  let started = false;

  const deadlineExceeded = () =>
    fail(null, {
      outcome: "deadline_exceeded",
      error: `No compile outcome within ${options.deadlineMs / 1000}s`,
      pdfUpdated: false,
      note: started
        ? `The source was saved before compiling began; the PDF is not confirmed updated. Web keeps compiling after this disconnect, so the compile may still finish. ${options.afterDeadline}`
        : `The request got no answer, so the source may or may not be saved and the PDF is not updated. ${options.afterDeadline}`,
      logTail: tail(log),
    });

  try {
    const response = await api.web.raw("POST", options.path, {
      body: options.body,
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !/text\/event-stream/.test(response.headers.get("content-type") ?? "")
    ) {
      return await fromResponse(response);
    }
    started = true;
    const terminal = await readTerminalEvent(
      response,
      controller.signal,
      (text) => {
        log = tail(log + text);
      },
    );
    if (!terminal) {
      if (timedOut) return deadlineExceeded();
      return fail(null, {
        outcome: "stream_ended",
        error: "The compile stream ended without an outcome",
        pdfUpdated: false,
        note: options.afterDeadline,
        logTail: tail(log),
      });
    }
    if (terminal.type === "done") {
      return ok({
        outcome: "compiled",
        ...options.summarize(terminal.payload),
        logTail: tail(terminal.log),
      });
    }
    return fail(terminal.status, {
      outcome: terminal.status === 422 ? "compile_failed" : "error",
      error: terminal.error,
      pdfUpdated: false,
      diagnostics: terminal.diagnostics,
      logTail: tail(terminal.log || log),
    });
  } catch (error) {
    if (timedOut) return deadlineExceeded();
    return fail(null, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

type TerminalEvent = Exclude<LatexCompileEvent, { type: "log" }>;

async function readTerminalEvent(
  response: Response,
  signal: AbortSignal,
  onLog: (text: string) => void,
): Promise<TerminalEvent | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  // A body that ignores the fetch's abort would otherwise hold the read open
  // past the deadline.
  const stop = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  const dispatch = (): TerminalEvent | null => {
    if (data.length === 0) return null;
    const raw = data.join("\n");
    data = [];
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    const parsed = latexCompileEventSchema.safeParse(json);
    if (!parsed.success) return null;
    if (parsed.data.type === "log") {
      onLog(parsed.data.text);
      return null;
    }
    return parsed.data;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        pending += decoder.decode();
        if (pending) pending += "\n";
      } else {
        pending += decoder.decode(value, { stream: true });
      }
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
        if (line === "") {
          const event = dispatch();
          if (event) return event;
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) return dispatch();
    }
  } finally {
    signal.removeEventListener("abort", stop);
    await reader.cancel().catch(() => {});
  }
}

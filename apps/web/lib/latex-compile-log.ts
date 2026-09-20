import type { LatexCompileDiagnostic } from "@repo/schemas";

// Tectonic prints `error: <file>:<line>: <message>` for a TeX error and then
// one of these, which say nothing the first line did not.
const CONSOLE_ERROR = /^error: (?:(\S+?):(\d+): )?(.*)$/;
const CONSOLE_NOISE = new Set([
  "halted on potentially-recoverable error as specified",
  "something bad happened inside TeX; its output follows:",
]);
const ENGINE_LINE_MARKER = /^l\.(\d+)(?: |$)/;
const MAX_CONTEXT_LINES = 24;

/**
 * The same error reads three ways: the engine writes `! Undefined control
 * sequence.`, the console `Undefined control sequence`, and Tectonic doubles
 * the bang and the period on LaTeX's own errors (`! ! LaTeX Error: ... not
 * found..`). Bangs and the trailing period go so the two sides compare.
 */
function normalizeMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:!\s*)+/, "")
    .replace(/\.+$/, "")
    .trim();
}

function parseConsole(consoleLog: string): LatexCompileDiagnostic[] {
  const found: LatexCompileDiagnostic[] = [];
  for (const line of consoleLog.split(/\r?\n/)) {
    const match = CONSOLE_ERROR.exec(line);
    if (!match) continue;
    const [, file, lineNumber, rawMessage] = match;
    const message = normalizeMessage(rawMessage ?? "");
    if (!message || CONSOLE_NOISE.has(message)) continue;
    found.push({
      file: file ?? null,
      line: lineNumber ? Number(lineNumber) : null,
      message,
      context: "",
    });
  }
  return found;
}

/**
 * A TeX error in the engine log is a `!` line, help text, then `l.<n>` with
 * the source split at the point of failure across that line and the next.
 * The block ends there; anything after is the next error or the wrap-up.
 */
function parseEngine(engineLog: string): LatexCompileDiagnostic[] {
  const lines = engineLog.split(/\r?\n/);
  const found: LatexCompileDiagnostic[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("!")) continue;
    const message = normalizeMessage(line);
    if (!message) continue;
    const context = [line];
    let sourceLine: number | null = null;
    let cursor = index + 1;
    while (cursor < lines.length && context.length < MAX_CONTEXT_LINES) {
      const next = lines[cursor] ?? "";
      if (next.startsWith("!")) break;
      context.push(next);
      const marker = ENGINE_LINE_MARKER.exec(next);
      if (marker) {
        sourceLine = Number(marker[1]);
        const continuation = lines[cursor + 1];
        if (continuation?.trim()) {
          context.push(continuation);
          cursor += 1;
        }
        break;
      }
      cursor += 1;
    }
    found.push({
      file: null,
      line: sourceLine,
      message,
      context: context.join("\n").trimEnd(),
    });
    index = cursor;
  }
  return found;
}

/**
 * Tectonic's console names the file and line; only the engine log quotes the
 * source. The engine halts at the first error under `--untrusted`, so the two
 * lists almost always have one entry each and pairing by position is exact.
 * When they disagree in length, every console error is kept — it is the one
 * with a location — and any engine block past the console list is appended.
 */
export function parseLatexDiagnostics(
  consoleLog: string,
  engineLog: string,
): LatexCompileDiagnostic[] {
  const fromConsole = parseConsole(consoleLog);
  const fromEngine = parseEngine(engineLog);
  const merged = fromConsole.map((entry, index) => {
    const engine = fromEngine[index];
    if (!engine) return entry;
    return {
      ...entry,
      line: entry.line ?? engine.line,
      context: engine.context,
    };
  });
  return merged.concat(fromEngine.slice(fromConsole.length));
}

export function formatDiagnosticLocation(
  diagnostic: Pick<LatexCompileDiagnostic, "file" | "line">,
): string | null {
  if (!diagnostic.file) {
    return diagnostic.line === null ? null : `line ${diagnostic.line}`;
  }
  return diagnostic.line === null
    ? diagnostic.file
    : `${diagnostic.file}:${diagnostic.line}`;
}

/** `LaTeX compilation failed: main.tex:3: Undefined control sequence (+2 more)`. */
export function describeLatexFailure(
  base: string,
  diagnostics: LatexCompileDiagnostic[],
): string {
  const [first] = diagnostics;
  if (!first) return base;
  const location = formatDiagnosticLocation(first);
  const rest = diagnostics.length - 1;
  return `${base}: ${location ? `${location}: ` : ""}${first.message}${
    rest > 0 ? ` (+${rest} more)` : ""
  }`;
}

/**
 * What the project row keeps of a failure. The errors sit at the *end* of a
 * TeX log, so a head slice of message-plus-log kept the engine banner and the
 * package list and dropped the one block that said what went wrong. The
 * message and the diagnostics go first; the log's tail fills what is left.
 */
export function boundedCompileError(
  message: string,
  log: string,
  diagnostics: LatexCompileDiagnostic[],
  limit = 20_000,
): string {
  const head = [
    message,
    ...diagnostics.map((diagnostic) => diagnostic.context).filter(Boolean),
  ].join("\n\n");
  if (head.length >= limit) return head.slice(0, limit);
  const remaining = limit - head.length - 2;
  const tail = log.length > remaining ? `…${log.slice(-(remaining - 1))}` : log;
  return tail ? `${head}\n\n${tail}` : head;
}

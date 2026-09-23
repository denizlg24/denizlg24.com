import { describe, expect, it } from "bun:test";
import {
  boundedCompileError,
  describeLatexFailure,
  parseLatexDiagnostics,
} from "./latex-compile-log";

// Verbatim from Tectonic 0.15 (`--untrusted --keep-logs --color never`).
const UNDEFINED_CONSOLE = [
  "note: Running TeX ...",
  "note: Writing `./main.log` (2.0859375 KiB)",
  "error: main.tex:3: Undefined control sequence",
  "error: halted on potentially-recoverable error as specified",
].join("\n");

const UNDEFINED_ENGINE = [
  "LaTeX2e <2024-11-01> patch level 2",
  "! Undefined control sequence.",
  "l.3 Hello \\undefinedcommandhere",
  "                               ",
  "No pages of output.",
].join("\n");

const MISSING_FILE_CONSOLE = [
  "note: Running TeX ...",
  "error: main.tex:3: ! LaTeX Error: File `nosuchpackagexyz.sty' not found.",
  "error: halted on potentially-recoverable error as specified",
].join("\n");

const MISSING_FILE_ENGINE = [
  "! ! LaTeX Error: File `nosuchpackagexyz.sty' not found..",
  "\\@missingfileerror ...or: File `#1.#2' not found.}",
  "                                                  ",
  "l.3 \\begin",
  "          {document}",
  "No pages of output.",
].join("\n");

describe("parseLatexDiagnostics", () => {
  it("pairs the console location with the engine transcript", () => {
    const [only, ...rest] = parseLatexDiagnostics(
      UNDEFINED_CONSOLE,
      UNDEFINED_ENGINE,
    );
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({
      file: "main.tex",
      line: 3,
      message: "Undefined control sequence",
    });
    expect(only?.context).toBe(
      "! Undefined control sequence.\nl.3 Hello \\undefinedcommandhere",
    );
  });

  it("normalizes Tectonic's doubled bang and period on LaTeX errors", () => {
    const [only] = parseLatexDiagnostics(
      MISSING_FILE_CONSOLE,
      MISSING_FILE_ENGINE,
    );
    expect(only?.message).toBe(
      "LaTeX Error: File `nosuchpackagexyz.sty' not found",
    );
    expect(only?.context).toContain("l.3 \\begin\n          {document}");
    expect(only?.context).not.toContain("No pages of output");
  });

  it("falls back to the engine log when the console carried no error", () => {
    const [only] = parseLatexDiagnostics(
      "note: Running TeX ...",
      UNDEFINED_ENGINE,
    );
    expect(only).toMatchObject({
      file: null,
      line: 3,
      message: "Undefined control sequence",
    });
  });

  it("keeps a console error that has no engine block", () => {
    const diagnostics = parseLatexDiagnostics(UNDEFINED_CONSOLE, "");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.context).toBe("");
  });

  it("reports nothing for a clean log", () => {
    expect(
      parseLatexDiagnostics(
        "note: Running TeX ...\nnote: Writing `./main.pdf` (2 KiB)",
        "Output written on main.pdf (1 page).",
      ),
    ).toHaveLength(0);
  });
});

describe("describeLatexFailure", () => {
  it("names the first error and counts the rest", () => {
    const diagnostics = parseLatexDiagnostics(
      `${UNDEFINED_CONSOLE}\nerror: other.tex:9: Missing $ inserted`,
      UNDEFINED_ENGINE,
    );
    expect(describeLatexFailure("LaTeX compilation failed", diagnostics)).toBe(
      "LaTeX compilation failed: main.tex:3: Undefined control sequence (+1 more)",
    );
  });

  it("leaves the base message alone without diagnostics", () => {
    expect(describeLatexFailure("Compilation timed out", [])).toBe(
      "Compilation timed out",
    );
  });
});

describe("boundedCompileError", () => {
  it("keeps the diagnostics and the tail of the log inside the bound", () => {
    const diagnostics = parseLatexDiagnostics(
      UNDEFINED_CONSOLE,
      UNDEFINED_ENGINE,
    );
    const banner = "x".repeat(500);
    const stored = boundedCompileError(
      "LaTeX compilation failed: main.tex:3: Undefined control sequence",
      `${banner}\n--- main.log ---\n${UNDEFINED_ENGINE}`,
      diagnostics,
      300,
    );
    expect(stored.length).toBeLessThanOrEqual(300);
    expect(stored.startsWith("LaTeX compilation failed")).toBe(true);
    expect(stored).toContain("l.3 Hello \\undefinedcommandhere");
    expect(stored).toContain("No pages of output.");
    expect(stored).not.toContain(banner);
  });

  it("drops the log when the head leaves no room for a tail", () => {
    const message = "x".repeat(299);
    expect(boundedCompileError(message, "y".repeat(500), [], 300)).toBe(
      message,
    );
    expect(boundedCompileError("x".repeat(298), "y".repeat(500), [], 300)).toBe(
      "x".repeat(298),
    );
  });

  it("keeps only the truncation marker on a one-character budget", () => {
    const stored = boundedCompileError(
      "x".repeat(297),
      "y".repeat(500),
      [],
      300,
    );
    expect(stored).toBe(`${"x".repeat(297)}\n\n…`);
    expect(stored.length).toBe(300);
  });

  it("appends a short log whole", () => {
    expect(boundedCompileError("head", "tail", [], 300)).toBe("head\n\ntail");
  });
});

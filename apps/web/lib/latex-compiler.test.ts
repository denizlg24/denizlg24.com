import { describe, expect, it, mock } from "bun:test";
import { createDefaultLatexProject } from "../../../packages/latex-editor/src/project";

mock.module("server-only", () => ({}));

const {
  compileLatexProject,
  LatexCompilationError,
  sliceUtf8,
  tryAcquireLatexCompileLock,
} = await import("./latex-compiler");

describe("sliceUtf8", () => {
  it("cuts on a character when the budget lands inside one", () => {
    // "é" is two bytes, so a 3-byte budget can only hold one of them.
    expect(sliceUtf8("aéb", 3)).toBe("aé");
    expect(sliceUtf8("aéb", 2)).toBe("a");
    expect(sliceUtf8("🙂", 3)).toBe("");
    expect(sliceUtf8("🙂", 4)).toBe("🙂");
  });

  it("returns the whole string when it fits", () => {
    expect(sliceUtf8("hello", 64)).toBe("hello");
  });
});

describe("compileLatexProject", () => {
  it("allows different project keys while rejecting duplicate concurrent work", () => {
    const releaseFirst = tryAcquireLatexCompileLock("project-a");
    const releaseSecond = tryAcquireLatexCompileLock("project-b");
    expect(releaseFirst).toBeFunction();
    expect(releaseSecond).toBeFunction();
    expect(tryAcquireLatexCompileLock("project-a")).toBeNull();
    releaseFirst?.();
    const releaseRetry = tryAcquireLatexCompileLock("project-a");
    expect(releaseRetry).toBeFunction();
    releaseFirst?.();
    releaseRetry?.();
    releaseSecond?.();
  });

  it("compiles a multi-file project into a PDF", async () => {
    const result = await compileLatexProject({
      version: 1,
      name: "test",
      mainFile: "main.tex",
      entries: [
        {
          id: "13eb006e-f975-48f9-9e83-db81f57a870a",
          path: "main.tex",
          kind: "file",
          encoding: "utf8",
          content:
            "\\documentclass{article}\\begin{document}\\input{sections/body}\\end{document}",
        },
        {
          id: "23c3e249-cf21-4f03-a469-2bdb2d658db0",
          path: "sections",
          kind: "folder",
        },
        {
          id: "de6ef5d8-7611-4651-a510-5d30c9f17ba8",
          path: "sections/body.tex",
          kind: "file",
          encoding: "utf8",
          content: "Compiled safely.",
        },
      ],
    });

    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("prepares SVG includes without shell escape", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#0f766e"/><text x="8" y="26" fill="white">SVG</text></svg>`;
    const result = await compileLatexProject({
      version: 1,
      name: "svg test",
      mainFile: "main.tex",
      entries: [
        {
          id: "8d052020-861a-4aa2-a185-23d2942a1ab9",
          path: "main.tex",
          kind: "file",
          encoding: "utf8",
          content:
            "\\documentclass{article}\\usepackage{svg}\\begin{document}\\includesvg[width=0.5\\textwidth,inkscapelatex=false]{figure.svg}\\end{document}",
        },
        {
          id: "90260b37-10fb-4b5d-9789-0d66f522407a",
          path: "figure.svg",
          kind: "file",
          encoding: "base64",
          content: Buffer.from(svg).toString("base64"),
        },
      ],
    });

    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("compiles the default CV template", async () => {
    const result = await compileLatexProject(createDefaultLatexProject());
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  // Tectonic's console output names the first failing line and nothing else;
  // the context that makes a failure fixable is only ever in main.log, which
  // lives in the workspace this module deletes on the way out.
  it("attaches the engine log to a failed compilation", async () => {
    const compile = compileLatexProject({
      version: 1,
      name: "failing",
      mainFile: "main.tex",
      entries: [
        {
          id: "f0f6e1d0-2c2c-4a0e-9b2f-7cbb0f2f9a11",
          path: "main.tex",
          kind: "file",
          encoding: "utf8",
          content:
            "\\documentclass{article}\n\\begin{document}\nHello \\undefinedcommandhere\n\\end{document}\n",
        },
      ],
    });

    await expect(compile).rejects.toThrow(
      "LaTeX compilation failed: main.tex:3: Undefined control sequence",
    );
    const failure = await compile.then(
      () => null,
      (error: unknown) =>
        error instanceof LatexCompilationError ? error : null,
    );
    expect(failure?.log).toContain("Undefined control sequence");
    expect(failure?.log).toContain("--- main.log ---");
    // The engine log, unlike the console output, quotes the offending source.
    expect(failure?.log).toContain("undefinedcommandhere");
    expect(failure?.diagnostics).toEqual([
      {
        file: "main.tex",
        line: 3,
        message: "Undefined control sequence",
        context: expect.stringContaining("l.3 Hello \\undefinedcommandhere"),
      },
    ]);
  }, 60_000);

  it("streams the console output while the engine runs", async () => {
    const chunks: string[] = [];
    const result = await compileLatexProject(createDefaultLatexProject(), {
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("Running TeX");
    expect(result.log).toBe(chunks.join("").trim());
  }, 60_000);
});

import { describe, expect, it, mock } from "bun:test";
import { createDefaultLatexProject } from "../../../packages/latex-editor/src/project";

mock.module("server-only", () => ({}));

const { compileLatexProject, tryAcquireLatexCompileLock } = await import(
  "./latex-compiler"
);

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
});

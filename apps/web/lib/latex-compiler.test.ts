import { describe, expect, it, mock } from "bun:test";
import { createDefaultLatexProject } from "../../../packages/latex-editor/src/project";

mock.module("server-only", () => ({}));

const { compileLatexProject } = await import("./latex-compiler");

describe("compileLatexProject", () => {
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

  it("compiles the default CV template", async () => {
    const result = await compileLatexProject(createDefaultLatexProject());
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});

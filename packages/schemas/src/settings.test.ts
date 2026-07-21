import { describe, expect, it } from "bun:test";
import { latexProjectSchema } from "./settings";

const validProject = {
  version: 1 as const,
  name: "CV",
  mainFile: "main.tex",
  entries: [
    {
      id: "d47a2f02-8392-4879-8fa5-1c883c7061db",
      path: "main.tex",
      kind: "file" as const,
      encoding: "utf8" as const,
      content: "\\documentclass{article}",
    },
  ],
};

describe("latexProjectSchema", () => {
  it("accepts a bounded multi-file project", () => {
    expect(latexProjectSchema.safeParse(validProject).success).toBe(true);
  });

  it("rejects traversal paths", () => {
    const project = structuredClone(validProject);
    project.entries[0]!.path = "../main.tex";
    project.mainFile = "../main.tex";
    expect(latexProjectSchema.safeParse(project).success).toBe(false);
  });

  it("requires the main file to exist as UTF-8 TeX", () => {
    expect(
      latexProjectSchema.safeParse({ ...validProject, mainFile: "missing.tex" })
        .success,
    ).toBe(false);
  });
});

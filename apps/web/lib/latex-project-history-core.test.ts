import { describe, expect, it } from "bun:test";
import type { ILatexProject } from "@repo/schemas";
import {
  changedLatexFiles,
  mergeLatexChangedFiles,
} from "./latex-project-history-core";

function project(entries: Array<[string, string]>, mainFile = "main.tex") {
  return {
    version: 1,
    name: "Paper",
    mainFile,
    entries: entries.map(([path, content], index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      path,
      kind: "file" as const,
      encoding: "utf8" as const,
      content,
    })),
  } satisfies ILatexProject;
}

describe("LaTeX project history file summaries", () => {
  it("detects added, modified, and deleted files", () => {
    const before = project([
      ["main.tex", "Before"],
      ["old.sty", "Old"],
    ]);
    const after = project([
      ["main.tex", "After"],
      ["figure.tex", "New"],
    ]);
    expect(changedLatexFiles(before, after)).toEqual([
      { path: "figure.tex", status: "added" },
      { path: "main.tex", status: "modified" },
      { path: "old.sty", status: "deleted" },
    ]);
  });

  it("coalesces edit-session summaries by file", () => {
    expect(
      mergeLatexChangedFiles(
        [{ path: "main.tex", status: "modified" }],
        [
          { path: "main.tex", status: "modified" },
          { path: "paper.bib", status: "added" },
        ],
      ),
    ).toEqual([
      { path: "main.tex", status: "modified" },
      { path: "paper.bib", status: "added" },
    ]);
  });
});

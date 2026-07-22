import { describe, expect, it } from "bun:test";
import { buildLatexContextPack, mapLatexProse } from "./context";
import type { LatexProject } from "./types";

describe("mapLatexProse", () => {
  it("preserves offsets while masking commands, citations, comments, and math", () => {
    const source = String.raw`A \textbf{clear sentence} cites \cite{smith2024} and $x = 2$. % hidden
Next line.`;
    const result = mapLatexProse(source);
    expect(result.masked.length).toBe(source.length);
    expect(
      result.masked.slice(
        source.indexOf("clear"),
        source.indexOf("sentence") + 8,
      ),
    ).toBe("clear sentence");
    expect(result.masked.includes("smith2024")).toBe(false);
    expect(result.masked.includes("x = 2")).toBe(false);
    expect(result.masked.includes("hidden")).toBe(false);
    expect(result.masked.includes("Next line.")).toBe(true);
  });

  it("keeps prose inside nested formatting braces", () => {
    const source = String.raw`\emph{A \textbf{nested} phrase}.`;
    const result = mapLatexProse(source);
    expect(result.masked.includes("nested")).toBe(true);
    expect(result.masked.includes("phrase")).toBe(true);
  });
});

describe("buildLatexContextPack", () => {
  const project: LatexProject = {
    version: 1,
    name: "Paper",
    mainFile: "main.tex",
    entries: [
      {
        id: "main",
        path: "main.tex",
        kind: "file",
        encoding: "utf8",
        content: String.raw`\section{Results}
Climate adaptation reduces coastal risk.

More text.`,
      },
      {
        id: "related",
        path: "notes.tex",
        kind: "file",
        encoding: "utf8",
        content: "Coastal adaptation evidence from Portugal.",
      },
      {
        id: "bib",
        path: "references.bib",
        kind: "file",
        encoding: "utf8",
        content: "@article{smith2024, title={Example}}",
      },
    ],
  };

  it("bounds cursor context and extracts a compact outline", () => {
    const cursor =
      project.entries[0]?.kind === "file"
        ? project.entries[0].content.indexOf("risk")
        : 0;
    const pack = buildLatexContextPack({
      project,
      revision: 4,
      filePath: "main.tex",
      cursor,
      personalPreferences: ["Prefer concise prose"],
      maxPrefixChars: 20,
    });
    expect(pack.prefix.length).toBeLessThanOrEqual(20);
    expect(pack.outline.headings[0]?.title).toBe("Results");
    expect(pack.outline.bibliographyKeys).toEqual(["smith2024"]);
    expect(pack.relatedChunks[0]?.file).toBe("notes.tex");
    expect(pack.personalPreferences[0]?.trust).toBe("untrusted");
  });
});

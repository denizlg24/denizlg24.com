import { describe, expect, it, mock } from "bun:test";
import { importOverleafTemplateResponseSchema } from "@repo/schemas";
import { strToU8, zipSync } from "fflate";

mock.module("server-only", () => ({}));

const {
  importLatexSourceArchive,
  importOverleafTemplate,
  importOverleafTemplateArchive,
} = await import("./latex-overleaf");

const PAGE = `
  <div class="gallery-item-title"><h1 class="h2">Research &amp; Results</h1></div>
  <a href="/project/new/template/42?mainFile=paper.tex&amp;templateName=Research">Open as Template</a>
  <div id="modalViewSource"><pre><code>\\documentclass{article}
\\begin{document}
A &lt; B &amp; C.
\\end{document}</code></pre></div>
`;

describe("Overleaf template import", () => {
  it("imports the public source, name, and declared main file", async () => {
    const imported = await importOverleafTemplate(
      "https://www.overleaf.com/latex/templates/research/exampleid",
      async () => new Response(PAGE, { status: 200 }),
    );

    expect(imported.name).toBe("Research & Results");
    expect(imported.sourceKind).toBe("page");
    expect(imported.missingSupportFiles).toEqual([]);
    expect(imported.project.mainFile).toBe("paper.tex");
    expect(imported.project.entries[0]).toMatchObject({
      path: "paper.tex",
      kind: "file",
      content:
        "\\documentclass{article}\n\\begin{document}\nA < B & C.\n\\end{document}",
    });
  });

  it("flags a custom document class missing from the public preview", async () => {
    const trrPage = PAGE.replace(
      "\\documentclass{article}",
      "\\documentclass[times]{TRR}",
    ).replaceAll("paper.tex", "TRR_LaTeX_Guidelines.tex");
    const imported = await importOverleafTemplate(
      "https://www.overleaf.com/latex/templates/trr/exampleid",
      async () => new Response(trrPage, { status: 200 }),
    );

    expect(imported.missingSupportFiles).toEqual(["TRR.cls"]);
  });

  it("imports all files from an Overleaf source ZIP", async () => {
    const trrPage = PAGE.replace(
      "\\documentclass{article}",
      "\\documentclass[times]{TRR}",
    ).replaceAll("paper.tex", "TRR_LaTeX_Guidelines.tex");
    const preview = await importOverleafTemplate(
      "https://www.overleaf.com/latex/templates/trr/exampleid",
      async () => new Response(trrPage, { status: 200 }),
    );
    const archive = zipSync({
      "trr/TRR_LaTeX_Guidelines.tex": strToU8(
        "\\documentclass[times]{TRR}\n\\begin{document}Text\\end{document}",
      ),
      "trr/TRR.cls": strToU8("\\NeedsTeXFormat{LaTeX2e}"),
      "trr/TRR.bst": strToU8("ENTRY{}{}{}"),
      "trr/figures/diagram.png": new Uint8Array([137, 80, 78, 71]),
    });

    const imported = importOverleafTemplateArchive(preview, archive);
    expect(() =>
      importOverleafTemplateResponseSchema.parse(imported),
    ).not.toThrow();
    expect(imported.sourceKind).toBe("archive");
    expect(imported.project.mainFile).toBe("TRR_LaTeX_Guidelines.tex");
    expect(imported.missingSupportFiles).toEqual([]);
    expect(imported.project.entries.map((entry) => entry.path).sort()).toEqual([
      "TRR.bst",
      "TRR.cls",
      "TRR_LaTeX_Guidelines.tex",
      "figures",
      "figures/diagram.png",
    ]);
    expect(
      imported.project.entries.find(
        (entry) => entry.path === "figures/diagram.png",
      ),
    ).toMatchObject({ encoding: "base64", content: "iVBORw==" });
  });

  it("imports a standalone LaTeX source ZIP without a template", () => {
    const archive = zipSync({
      "article/sections/introduction.tex": strToU8("Introduction"),
      "article/main.tex": strToU8(
        "\\documentclass{article}\n\\begin{document}Text\\end{document}",
      ),
      "article/references.bib": strToU8("@article{example}"),
      "article/figures/chart.png": new Uint8Array([137, 80, 78, 71]),
      "article/figures/diagram.svg": strToU8("<svg></svg>"),
      "article/figures/appendix.pdf": strToU8("%PDF-1.7"),
      "article/main.aux": strToU8("\\relax"),
      "article/empty/": new Uint8Array(),
    });

    const imported = importLatexSourceArchive(archive, {
      name: "Existing article",
    });
    expect(imported.name).toBe("Existing article");
    expect(imported.project.mainFile).toBe("main.tex");
    expect(imported.missingSupportFiles).toEqual([]);
    expect(imported.project.entries.map((entry) => entry.path).sort()).toEqual([
      "empty",
      "figures",
      "figures/appendix.pdf",
      "figures/chart.png",
      "figures/diagram.svg",
      "main.aux",
      "main.tex",
      "references.bib",
      "sections",
      "sections/introduction.tex",
    ]);
    for (const path of [
      "figures/appendix.pdf",
      "figures/chart.png",
      "figures/diagram.svg",
      "main.aux",
    ]) {
      expect(
        imported.project.entries.find((entry) => entry.path === path),
      ).toMatchObject({ kind: "file", encoding: "base64" });
    }
  });

  it("rejects traversal paths in source ZIPs", async () => {
    const preview = await importOverleafTemplate(
      "https://www.overleaf.com/latex/templates/research/exampleid",
      async () => new Response(PAGE, { status: 200 }),
    );
    const archive = zipSync({
      "../paper.tex": strToU8("\\documentclass{article}"),
    });

    expect(() => importOverleafTemplateArchive(preview, archive)).toThrow(
      "unsafe file path",
    );
  });

  it("rejects private projects and non-Overleaf URLs before fetching", async () => {
    let requests = 0;
    const fetcher = async () => {
      requests += 1;
      return new Response(PAGE);
    };

    await expect(
      importOverleafTemplate(
        "https://www.overleaf.com/project/secret",
        fetcher,
      ),
    ).rejects.toThrow("public Overleaf Gallery");
    await expect(
      importOverleafTemplate(
        "https://example.com/latex/templates/x/y",
        fetcher,
      ),
    ).rejects.toThrow("public Overleaf Gallery");
    expect(requests).toBe(0);
  });
});

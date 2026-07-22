import { describe, expect, it } from "bun:test";
import {
  createLatexProjectFromTemplate,
  LATEX_PROJECT_TEMPLATES,
} from "./templates";

describe("LaTeX project templates", () => {
  it("creates a valid project for every template", () => {
    for (const template of LATEX_PROJECT_TEMPLATES) {
      const project = createLatexProjectFromTemplate(
        template.id,
        template.name,
      );
      const main = project.entries.find(
        (entry) => entry.kind === "file" && entry.path === project.mainFile,
      );
      expect(main?.kind).toBe("file");
      expect(project.entries.map((entry) => entry.path).length).toBe(
        new Set(project.entries.map((entry) => entry.path)).size,
      );
    }
  });

  it("creates bibliography and chapter files for writing templates", () => {
    const paper = createLatexProjectFromTemplate("ieee-conference", "Paper");
    const thesis = createLatexProjectFromTemplate("thesis", "Thesis");

    expect(paper.entries.some((entry) => entry.path === "references.bib")).toBe(
      true,
    );
    expect(
      thesis.entries.some(
        (entry) => entry.path === "chapters/introduction.tex",
      ),
    ).toBe(true);
  });

  it.each([
    ["ieee-conference", "\\documentclass[conference]{IEEEtran}"],
    ["springer-lncs", "\\documentclass[runningheads]{llncs}"],
    ["acm-sigconf", "\\documentclass[sigconf,review,anonymous]{acmart}"],
    ["elsevier-article", "\\documentclass[preprint,12pt]{elsarticle}"],
  ] as const)("%s uses its publisher class", (template, documentClass) => {
    const project = createLatexProjectFromTemplate(template, "Paper");
    const main = project.entries.find(
      (entry) => entry.kind === "file" && entry.path === "main.tex",
    );
    expect(main?.kind === "file" ? main.content : "").toContain(documentClass);
  });
});

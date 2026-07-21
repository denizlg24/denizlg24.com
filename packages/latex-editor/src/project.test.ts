import { describe, expect, it } from "bun:test";
import {
  addProjectEntry,
  createDefaultLatexProject,
  createFileEntry,
  createFolderEntry,
  removeProjectEntry,
  renameProjectEntry,
  sortProjectEntries,
} from "./project";

describe("LaTeX project operations", () => {
  it("renames folders and every descendant path", () => {
    let project = createDefaultLatexProject();
    const folder = createFolderEntry("sections");
    project = addProjectEntry(project, folder);
    project = addProjectEntry(project, createFileEntry("sections/work.tex"));

    const renamed = renameProjectEntry(project, folder.id, "content");

    expect(renamed.entries.map((entry) => entry.path)).toContain(
      "content/work.tex",
    );
    expect(renamed.entries.map((entry) => entry.path)).not.toContain(
      "sections/work.tex",
    );
  });

  it("selects another tex file when the main file is removed", () => {
    let project = createDefaultLatexProject();
    const alternate = createFileEntry("alternate.tex");
    project = addProjectEntry(project, alternate);
    const main = project.entries.find((entry) => entry.path === "main.tex");

    const updated = removeProjectEntry(project, main?.id ?? "missing");

    expect(updated.mainFile).toBe("alternate.tex");
  });

  it("rejects duplicate paths", () => {
    const project = createDefaultLatexProject();
    expect(() => addProjectEntry(project, createFileEntry("main.tex"))).toThrow(
      "already exists",
    );
  });

  it("keeps descendants beside their parent folder", () => {
    const entries = [
      createFileEntry("main.tex"),
      createFileEntry("sections/work.tex"),
      createFolderEntry("sections"),
      createFileEntry("assets/photo.png"),
      createFolderEntry("assets"),
    ];

    expect(sortProjectEntries(entries).map((entry) => entry.path)).toEqual([
      "assets",
      "assets/photo.png",
      "sections",
      "sections/work.tex",
      "main.tex",
    ]);
  });
});

import { describe, expect, it, mock } from "bun:test";
import type { ILatexProject } from "@repo/schemas";

mock.module("server-only", () => ({}));

const { buildLatexSourceZip, safeLatexArchivePath } = await import(
  "./latex-source-zip"
);

const project: ILatexProject = {
  version: 1,
  name: "Test",
  mainFile: "main.tex",
  entries: [
    {
      id: "2fa89d7b-957c-4d1e-a54b-58cddb94b23c",
      path: "main.tex",
      kind: "file",
      encoding: "utf8",
      content: "hello",
    },
  ],
};

describe("LaTeX source ZIP", () => {
  it("writes a valid empty-compression ZIP envelope", () => {
    const zip = buildLatexSourceZip(project, new Date("2026-01-01T00:00:00Z"));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.includes(Buffer.from("main.tex"))).toBe(true);
    expect(zip.includes(Buffer.from("hello"))).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    for (const path of [
      "../secret",
      "folder/../../secret",
      "/tmp/file",
      "a\\b",
    ]) {
      expect(() => safeLatexArchivePath(path)).toThrow("Invalid archive path");
    }
  });
});

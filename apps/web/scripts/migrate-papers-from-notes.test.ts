import { describe, expect, it } from "bun:test";
import { isAcademicPaperProviderUrl } from "@/lib/paper-metadata";
import {
  detectLegacyPaperNote,
  parsePaperMigrationOptions,
} from "./migrate-papers-from-notes";

describe("paper-note migrator", () => {
  it("is dry-run by default and validates limits", () => {
    expect(parsePaperMigrationOptions([])).toEqual({
      apply: false,
      limit: Number.POSITIVE_INFINITY,
      skipMetadata: false,
    });
    expect(parsePaperMigrationOptions(["--apply", "--limit=5"])).toMatchObject({
      apply: true,
      limit: 5,
    });
    expect(() => parsePaperMigrationOptions(["--limit=0"])).toThrow();
  });

  it("detects DOI, arXiv, and explicitly classified legacy notes", () => {
    expect(
      detectLegacyPaperNote({
        title: "DOI paper",
        content: "",
        url: "https://doi.org/10.1000/example",
      }),
    ).toEqual({ doi: "10.1000/example", reason: "doi" });
    expect(
      detectLegacyPaperNote({
        title: "Preprint",
        content: "arXiv: 2401.12345v2",
      }),
    ).toEqual({ arxivId: "2401.12345", reason: "arxiv" });
    expect(
      detectLegacyPaperNote({ title: "Manual", content: "", class: "Paper" }),
    ).toEqual({ reason: "class" });
  });

  it("detects known publisher and academic index URLs", () => {
    expect(
      isAcademicPaperProviderUrl(
        "https://ieeexplore.ieee.org/document/1234567",
      ),
    ).toBe(true);
    expect(
      detectLegacyPaperNote({
        title: "IEEE paper",
        content: "",
        url: "https://ieeexplore.ieee.org/document/11310964",
      }),
    ).toEqual({ reason: "provider" });
    expect(
      detectLegacyPaperNote({
        title: "Indexed paper",
        content: "",
        url: "https://www.semanticscholar.org/paper/example/abcdef",
      }),
    ).toEqual({ reason: "provider" });
  });
});

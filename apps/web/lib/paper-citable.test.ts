import { describe, expect, it } from "bun:test";
import { hasBibliographicIdentity } from "./paper-route-utils";

describe("citable defaults", () => {
  it("treats a resolvable identifier as citable", () => {
    expect(hasBibliographicIdentity({ doi: "10.1000/example" })).toBe(true);
    expect(hasBibliographicIdentity({ arxivId: "2501.01234" })).toBe(true);
    expect(hasBibliographicIdentity({ openAlexId: "W123" })).toBe(true);
    expect(hasBibliographicIdentity({ isbn: ["9780262035613"] })).toBe(true);
  });

  it("treats a resolved metadata source as citable", () => {
    expect(hasBibliographicIdentity({ metadataSource: "crossref" })).toBe(true);
    expect(hasBibliographicIdentity({ metadataSource: "openalex" })).toBe(true);
    expect(hasBibliographicIdentity({ metadataSource: "google_books" })).toBe(
      true,
    );
  });

  it("leaves a bare uploaded PDF out of the bibliography", () => {
    expect(hasBibliographicIdentity({})).toBe(false);
    expect(hasBibliographicIdentity({ metadataSource: "manual" })).toBe(false);
    expect(hasBibliographicIdentity({ isbn: [] })).toBe(false);
  });
});

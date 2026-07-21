import { describe, expect, it } from "bun:test";
import { remotePdfFromUrl } from "./paper-files";

describe("paper note helpers", () => {
  it("recognizes direct PDF and arXiv PDF URLs", () => {
    expect(
      remotePdfFromUrl("https://example.com/files/paper.pdf"),
    ).toMatchObject({
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 0,
    });
    expect(remotePdfFromUrl("https://arxiv.org/pdf/2401.12345")).toMatchObject({
      fileName: "2401.12345.pdf",
    });
  });

  it("leaves metadata-only papers without a PDF", () => {
    expect(remotePdfFromUrl("https://doi.org/10.1000/example")).toBeUndefined();
    expect(
      remotePdfFromUrl("https://arxiv.org/abs/2401.12345"),
    ).toBeUndefined();
  });
});

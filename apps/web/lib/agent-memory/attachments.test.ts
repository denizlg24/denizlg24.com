import { describe, expect, test } from "bun:test";
import { chunkDocumentText } from "./attachments";

describe("chunkDocumentText", () => {
  test("drops content below the minimum chunk size", () => {
    expect(chunkDocumentText("too short")).toEqual([]);
  });

  test("keeps a single chunk for a short document", () => {
    const text = "Sentence about the study. ".repeat(6);
    const parts = chunkDocumentText(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toContain("Sentence about the study.");
  });

  test("splits long text into overlapping chunks with rising indexes", () => {
    const text = `${"Paragraph body text. ".repeat(400)}`;
    const parts = chunkDocumentText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.index)).toEqual(
      parts.map((_, index) => index),
    );
  });

  test("continues numbering from the supplied start index", () => {
    const parts = chunkDocumentText("Body sentence here. ".repeat(300), 3, 10);
    expect(parts[0]?.index).toBe(10);
    expect(parts[0]?.page).toBe(3);
  });

  test("prefers paragraph boundaries over hard slicing", () => {
    const first = "First section sentence. ".repeat(40);
    const second = "Second section sentence. ".repeat(40);
    const parts = chunkDocumentText(`${first}\n\n${second}`);
    expect(parts.length).toBeGreaterThan(1);
    // A boundary split means no chunk straddles both sections mid-sentence.
    expect(parts[0]?.text?.endsWith("Second section sentence.")).toBe(false);
  });

  test("normalizes whitespace so chunking is not skewed by layout", () => {
    const parts = chunkDocumentText(
      `Text   with\r\n\r\n\r\n\r\nodd    spacing. ${"filler words here. ".repeat(10)}`,
    );
    expect(parts[0]?.text).toContain("Text with");
    expect(parts[0]?.text).not.toContain("\n\n\n");
  });
});

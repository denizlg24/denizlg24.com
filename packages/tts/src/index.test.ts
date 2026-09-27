import { describe, expect, test } from "bun:test";
import { splitSpeechText } from "./index";

describe("splitSpeechText", () => {
  test("keeps a long reading within the speech request limit without dropping words", () => {
    const reading = Array.from(
      { length: 800 },
      (_, index) => `Sentence ${index}.`,
    ).join(" ");
    const chunks = splitSpeechText(reading);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 2_000)).toBe(true);
    expect(chunks.join(" ")).toBe(reading);
  });

  test("handles empty and unbroken input", () => {
    expect(splitSpeechText(" \n ")).toEqual([]);
    expect(
      splitSpeechText("x".repeat(4_500)).map((part) => part.length),
    ).toEqual([2_000, 2_000, 500]);
  });
});

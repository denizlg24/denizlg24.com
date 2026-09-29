import { describe, expect, test } from "bun:test";
import { speechChunks, splitSpeechText } from "./index";

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

async function collect(parts: Iterable<string>, targets?: readonly number[]) {
  const chunks: string[] = [];
  for await (const chunk of speechChunks(parts, targets)) chunks.push(chunk);
  return chunks;
}

describe("speechChunks", () => {
  const sentences = Array.from(
    { length: 200 },
    (_, index) => `This is sentence number ${index}, which says a little.`,
  );

  test("starts with about one sentence and grows without losing words", async () => {
    const reading = sentences.join(" ");
    const chunks = await collect([reading]);
    expect(chunks[0]?.length).toBeLessThanOrEqual(160);
    expect(chunks[0]?.endsWith(".")).toBe(true);
    expect(chunks[1]?.length).toBeGreaterThan(chunks[0]?.length ?? 0);
    expect(chunks.every((chunk) => chunk.length <= 2_000)).toBe(true);
    expect(chunks.join(" ")).toBe(reading);
  });

  test("a short note is a single request", async () => {
    expect(await collect(["Buy milk.\n\nCall the bank."])).toEqual([
      "Buy milk. Call the bank.",
    ]);
  });

  test("treats a line break as a boundary so headings are not glued mid-chunk", async () => {
    const chunks = await collect(
      [`Heading without a stop\n${"word ".repeat(40)}`],
      [30, 2_000],
    );
    expect(chunks[0]).toBe("Heading without a stop");
  });

  test("text arriving in parts is re-cut across part boundaries", async () => {
    const pages = [
      `${sentences.slice(0, 7).join(" ")}\n\n`,
      sentences.slice(7, 30).join(" "),
    ];
    const chunks = await collect(pages);
    expect(chunks.join(" ")).toBe(sentences.slice(0, 30).join(" "));
    expect(chunks[0]?.length).toBeLessThanOrEqual(160);
  });

  test("joins streamed parts without inventing a break", async () => {
    expect(await collect(["Hel", "lo there.", " How are", " you?"])).toEqual([
      "Hello there. How are you?",
    ]);
  });

  test("falls back to a clause, then a word, when a sentence is too long", async () => {
    const [first] = await collect([
      `${"alpha ".repeat(20)}beta, ${"gamma ".repeat(40)}`,
    ]);
    expect(first?.endsWith("beta,")).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { type SpeechSegment, speakableSegments } from "./narrate";

async function segments(source: string | string[]): Promise<SpeechSegment[]> {
  const out: SpeechSegment[] = [];
  for await (const segment of speakableSegments(
    typeof source === "string" ? [source] : source,
  )) {
    out.push(segment);
  }
  return out;
}

const kinds = (list: SpeechSegment[]) => list.map((segment) => segment.kind);

describe("speakableSegments", () => {
  test("passes plain prose through untouched", async () => {
    const result = await segments(
      "First paragraph.\n\nSecond one costs $5 and $10.",
    );
    expect(kinds(result)).toEqual(["text", "text"]);
    expect(result.map((segment) => segment.text).join("")).toBe(
      "First paragraph.\n\nSecond one costs $5 and $10.\n\n",
    );
  });

  test("lifts a fenced code block whole, blank lines included", async () => {
    const result = await segments(
      "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nAfter.",
    );
    expect(kinds(result)).toEqual(["text", "code", "text"]);
    expect(result[1]).toEqual({
      kind: "code",
      text: "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      before: "Intro.",
    });
  });

  test("does not close a fence on a shorter one", async () => {
    const result = await segments("````md\n```\ninner\n```\n````\nDone.");
    expect(kinds(result)).toEqual(["code", "text"]);
  });

  test("separates a table from the prose around it in one paragraph", async () => {
    const result = await segments(
      "Results below:\n| a | b |\n|---|:-:|\n| 1 | 2 |\nThat is all.",
    );
    expect(kinds(result)).toEqual(["text", "table", "text"]);
    expect(result[1]?.text).toBe("| a | b |\n|---|:-:|\n| 1 | 2 |");
  });

  test("reads display math as one block in each notation", async () => {
    const result = await segments(
      "$$\nx^2\n$$\n\n\\[ y \\]\n\n\\begin{align*}\na &= b\n\\end{align*}\n\n\\begin{equation} z \\end{equation}\nTail.",
    );
    expect(kinds(result)).toEqual(["math", "math", "math", "math", "text"]);
  });

  test("narrates a paragraph with inline math as a whole", async () => {
    const result = await segments("Let $x^2 + 1$ be positive.\n\nPlain.");
    expect(kinds(result)).toEqual(["math", "text"]);
    expect(result[0]?.text).toBe("Let $x^2 + 1$ be positive.");
  });

  test("buffers a block split across streamed parts", async () => {
    const result = await segments([
      "Hello.\n\n```",
      "py\nprint(1)\n`",
      "``\nBye.",
    ]);
    expect(kinds(result)).toEqual(["text", "code", "text"]);
    expect(result[1]?.text).toBe("```py\nprint(1)\n```");
  });

  test("an unclosed fence still yields its contents at the end", async () => {
    const result = await segments("```\nnever closed");
    expect(kinds(result)).toEqual(["code"]);
  });
});

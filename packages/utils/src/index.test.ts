import { describe, expect, it } from "bun:test";
import { calculateReadingTime, getAge, string_to_slug } from "./index";

describe("string_to_slug", () => {
  it("lowercases, trims, and hyphenates whitespace", () => {
    expect(string_to_slug("  Hello World  ")).toBe("hello-world");
  });

  it("transliterates accented characters", () => {
    expect(string_to_slug("Crème Brûlée à la Niño")).toBe(
      "creme-brulee-a-la-nino",
    );
  });

  it("maps slash, underscore, comma, colon, semicolon to hyphens", () => {
    expect(string_to_slug("a/b_c,d:e;f")).toBe("a-b-c-d-e-f");
  });

  it("strips other special characters and collapses hyphens", () => {
    expect(string_to_slug("hello!!  --  world??")).toBe("hello-world");
  });
});

describe("calculateReadingTime", () => {
  it("returns 1 for empty content", () => {
    expect(calculateReadingTime("")).toBe(1);
    expect(calculateReadingTime("   ")).toBe(1);
  });

  it("returns 1 for short content (under 200 words)", () => {
    expect(calculateReadingTime("just a few words here")).toBe(1);
  });

  it("rounds up by 200 words per minute", () => {
    const words = Array.from({ length: 401 }, (_, i) => `word${i}`).join(" ");
    expect(calculateReadingTime(words)).toBe(3);
  });

  it("ignores fenced code blocks", () => {
    const code = `\`\`\`\n${Array.from({ length: 400 }, () => "code").join(" ")}\n\`\`\``;
    expect(calculateReadingTime(`${code} one two three`)).toBe(1);
  });
});

describe("getAge", () => {
  it("computes age for a birthday that already passed this year", () => {
    const today = new Date();
    const birth = new Date(today);
    birth.setFullYear(today.getFullYear() - 30);
    birth.setDate(birth.getDate() - 1);
    expect(getAge(birth.toISOString())).toBe(30);
  });

  it("computes age for a birthday still ahead this year", () => {
    const today = new Date();
    const birth = new Date(today);
    birth.setFullYear(today.getFullYear() - 30);
    birth.setDate(birth.getDate() + 2);
    expect(getAge(birth.toISOString())).toBe(29);
  });
});

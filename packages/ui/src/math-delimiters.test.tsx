import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "./math-delimiters";

function render(markdown: string) {
  const html = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {normalizeMathDelimiters(markdown)}
    </ReactMarkdown>,
  );
  const count = (pattern: RegExp) => (html.match(pattern) ?? []).length;
  return {
    html,
    math: count(/class="katex"/g),
    display: count(/class="katex-display"/g),
  };
}

describe("normalizeMathDelimiters", () => {
  it("turns \\( \\) into inline math", () => {
    expect(normalizeMathDelimiters("area \\(\\pi r^2\\) here")).toBe(
      "area $\\pi r^2$ here",
    );
    expect(render("area \\(\\pi r^2\\) here")).toMatchObject({
      math: 1,
      display: 0,
    });
  });

  it("turns a \\[ \\] line into a display block", () => {
    expect(normalizeMathDelimiters("\\[ E = mc^2 \\]")).toBe(
      "$$\nE = mc^2\n$$",
    );
    expect(normalizeMathDelimiters("\\[\nE = mc^2\n\\]")).toBe(
      "$$\nE = mc^2\n$$",
    );
    expect(render("before\n\\[\nE = mc^2\n\\]\nafter")).toMatchObject({
      math: 1,
      display: 1,
    });
  });

  it("keeps display blocks inside their list item or quote", () => {
    const list = render("- step\n  \\[\n  a = b\n  \\]\n- next");
    expect(list).toMatchObject({ math: 1, display: 1 });
    expect(list.html.match(/<li>/g)).toHaveLength(2);

    const marker = render("1. \\[ a = b \\]\n2. next");
    expect(marker).toMatchObject({ math: 1, display: 1 });
    expect(marker.html.match(/<li>/g)).toHaveLength(2);

    const quote = render("> \\[\n> a = b\n> \\]");
    expect(quote).toMatchObject({ math: 1, display: 1 });
    expect(quote.html).toStartWith("<blockquote>");
  });

  it("keeps display math that shares a line with text inline", () => {
    expect(normalizeMathDelimiters("so \\[\\sum x\\] holds")).toBe(
      "so $\\displaystyle \\sum x$ holds",
    );
    const table = render("| a | b |\n|---|---|\n| \\[x\\] | \\(y\\) |");
    expect(table).toMatchObject({ math: 2, display: 0 });
    expect(table.html.match(/<td>/g)).toHaveLength(2);
  });

  it("preserves LaTeX line breaks inside display math", () => {
    const source =
      "\\[\n\\begin{aligned} a &= b \\\\[4pt] c &= d \\end{aligned}\n\\]";
    expect(normalizeMathDelimiters(source)).toBe(
      "$$\n\\begin{aligned} a &= b \\\\[4pt] c &= d \\end{aligned}\n$$",
    );
    expect(render(source)).toMatchObject({ math: 1, display: 1 });
  });

  it("lengthens the fence around a dollar sign", () => {
    expect(normalizeMathDelimiters("\\(\\$5\\)")).toBe("$$\\$5$$");
  });

  it("leaves code untouched", () => {
    for (const source of [
      "```\n\\[ x \\]\n```",
      "~~~tex\n\\(x\\)\n~~~",
      "- item\n  ```\n  \\[ x \\]\n  ```",
      "use `\\(x\\)` literally",
      "use ``a ` \\(x\\)`` literally",
    ]) {
      expect(normalizeMathDelimiters(source)).toBe(source);
    }
    expect(normalizeMathDelimiters("```\n\\(a\\)\n```\n\\(b\\)")).toBe(
      "```\n\\(a\\)\n```\n$b$",
    );
  });

  it("leaves escapes and unmatched delimiters alone", () => {
    for (const source of [
      "\\\\[x\\\\]",
      "a \\[ b",
      "a \\( b\n\nc \\) d",
      "empty \\(\\) and \\[ \\]",
      "\\[x and [link](url)",
    ]) {
      expect(normalizeMathDelimiters(source)).toBe(source);
    }
  });

  it("returns markdown without LaTeX delimiters as is", () => {
    const source = "# note\n\n$x$ and $$\ny\n$$\n";
    expect(normalizeMathDelimiters(source)).toBe(source);
  });
});

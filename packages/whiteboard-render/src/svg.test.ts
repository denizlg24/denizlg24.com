import { describe, expect, it } from "bun:test";
import type { IWhiteboardElement } from "@repo/schemas";
import {
  elementBounds,
  whiteboardContentBounds,
  whiteboardToSvg,
  wrapText,
} from "./svg";

function el(partial: Partial<IWhiteboardElement>): IWhiteboardElement {
  return {
    id: "e1",
    type: "drawing",
    x: 0,
    y: 0,
    data: {},
    zIndex: 0,
    ...partial,
  };
}

const pen = el({
  id: "pen1",
  data: {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ],
    color: "#18181b",
    thickness: 4,
  },
});

const highlighter = el({
  id: "hl1",
  data: {
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
    color: "#ca8a04",
    thickness: 12,
    brush: "highlighter",
  },
});

const text = el({
  id: "t1",
  x: 100,
  y: 100,
  width: 200,
  height: 60,
  data: { text: "hello world", color: "#18181b", fontSize: 16 },
});

const todo = el({
  id: "c1",
  type: "component",
  componentType: "todo-list",
  x: 300,
  y: 0,
  width: 280,
  height: 320,
  data: {
    title: "Today",
    items: [
      { id: "i1", text: "write tests", completed: true },
      { id: "i2", text: "ship < & > safely", completed: false },
    ],
  },
});

describe("wrapText", () => {
  it("wraps on width and keeps explicit newlines", () => {
    const lines = wrapText("one two three\nfour", 60, 16, "sans", 400);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.at(-1)).toBe("four");
  });

  it("never drops words", () => {
    const lines = wrapText("alpha beta gamma delta", 1, 16, "sans", 400);
    expect(lines.join(" ")).toBe("alpha beta gamma delta");
  });
});

describe("elementBounds", () => {
  it("includes stroke margin for pen", () => {
    const b = elementBounds(pen);
    expect(b.x).toBe(-2);
    expect(b.width).toBe(24);
  });

  it("expands bounds under rotation", () => {
    const plain = elementBounds(
      el({
        width: 100,
        height: 20,
        data: { text: "x", color: "#000", fontSize: 16 },
      }),
    );
    const rotated = elementBounds(
      el({
        width: 100,
        height: 20,
        rotation: 45,
        data: { text: "x", color: "#000", fontSize: 16 },
      }),
    );
    expect(rotated.width).toBeLessThan(plain.width);
    expect(rotated.height).toBeGreaterThan(plain.height);
  });

  it("unions content bounds", () => {
    const b = whiteboardContentBounds([pen, todo]);
    expect(b).not.toBeNull();
    expect(b?.x).toBe(-2);
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBe(580);
  });
});

describe("whiteboardToSvg", () => {
  it("renders every element kind including components", () => {
    const { svg } = whiteboardToSvg([pen, highlighter, text, todo]);
    expect(svg).toContain("<path");
    expect(svg).toContain('stroke-opacity="0.45"');
    expect(svg).toContain("hello world");
    expect(svg).toContain("Today");
    expect(svg).toContain("write tests");
    expect(svg).toContain("Excalifont");
  });

  it("escapes XML-unsafe text", () => {
    const { svg } = whiteboardToSvg([todo]);
    expect(svg).toContain("ship &lt; &amp; &gt; safely");
    expect(svg).not.toContain("ship < & > safely");
  });

  it("renders background color and pattern", () => {
    const { svg } = whiteboardToSvg([pen], {
      background: { color: "#1e1e20", pattern: "dots" },
    });
    expect(svg).toContain('fill="#1e1e20"');
    expect(svg).toContain("board-pattern");
    expect(svg).toContain("rgba(255,255,255,0.12)");
  });

  it("caps output size while preserving viewBox", () => {
    const wide = el({
      id: "w1",
      width: 4000,
      height: 100,
      data: { shapeType: "rectangle", color: "#000", thickness: 2 },
    });
    const result = whiteboardToSvg([wide], { maxDimension: 1000 });
    expect(result.width).toBeLessThanOrEqual(1000);
    expect(result.viewBox.width).toBeGreaterThan(4000);
  });

  it("renders placeholders for unresolved images when asked", () => {
    const image = el({
      id: "img1",
      width: 100,
      height: 100,
      data: { src: "https://example.com/a.png" },
    });
    const kept = whiteboardToSvg([image]).svg;
    expect(kept).toContain("https://example.com/a.png");
    const placeholder = whiteboardToSvg([image], {
      unresolvedImages: "placeholder",
    }).svg;
    expect(placeholder).not.toContain("https://example.com/a.png");
  });
});

import {
  type IDrawingData,
  type IImageData,
  type IMarkdownNoteData,
  type IPdfViewerData,
  type IQuickLinksData,
  type IShapeData,
  type IStickyNoteData,
  type ITextData,
  type ITodoListData,
  type IWhiteboardBackground,
  type IWhiteboardElement,
  type TextFontFamily,
  whiteboardElementKind,
} from "@repo/schemas";
import {
  ARROW_HEAD_LENGTH_RATIO,
  ARROW_HEAD_MAX_LENGTH,
  DEFAULT_BOARD_BACKGROUND,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_WEIGHT,
  HIGHLIGHTER_OPACITY,
  STICKY_COLORS,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  WHITEBOARD_FONT_FAMILIES,
} from "./constants";
import { normalizeWhiteboardText } from "./text";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MeasureText = (
  text: string,
  fontSize: number,
  family: TextFontFamily,
  weight: number,
) => number;

export interface WhiteboardRenderOptions {
  background?: IWhiteboardBackground;
  /** Region of the board to render; defaults to the content bounding box. */
  bounds?: Bounds;
  /** Canvas-space padding added around fitted bounds. */
  padding?: number;
  /** Cap on the longest output dimension; the viewBox is preserved. */
  maxDimension?: number;
  /** Pixel-accurate text measurement (e.g. canvas measureText on the client). */
  measureText?: MeasureText;
  /** Replacement hrefs (e.g. data URIs) keyed by original image src. */
  imageHrefs?: Record<string, string>;
  /** How to draw images whose src has no imageHrefs entry. */
  unresolvedImages?: "keep" | "placeholder";
}

export interface WhiteboardSvgResult {
  svg: string;
  width: number;
  height: number;
  viewBox: Bounds;
}

const UI = {
  cardBg: "#ffffff",
  cardBorder: "#e4e4e7",
  text: "#18181b",
  muted: "#71717a",
  faint: "#a1a1aa",
  accent: "#2563eb",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function heuristicMeasure(
  text: string,
  fontSize: number,
  family: TextFontFamily,
  weight: number,
): number {
  const factor = WHITEBOARD_FONT_FAMILIES[family].widthFactor;
  const weightFactor = weight >= 600 ? 1.04 : 1;
  return text.length * fontSize * factor * weightFactor;
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  family: TextFontFamily,
  weight: number,
  measure: MeasureText = heuristicMeasure,
): string[] {
  const lines: string[] = [];
  for (const paragraph of normalizeWhiteboardText(text).split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (
        measure(candidate, fontSize, family, weight) <= maxWidth ||
        current === ""
      ) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

interface TextBlockOptions {
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  family?: TextFontFamily;
  weight?: number;
  align?: "left" | "center" | "right";
  maxLines?: number;
  measure?: MeasureText;
}

function textBlockSvg(text: string, opts: TextBlockOptions): string {
  const family = opts.family ?? DEFAULT_FONT_FAMILY;
  const weight = opts.weight ?? DEFAULT_FONT_WEIGHT;
  const measure = opts.measure ?? heuristicMeasure;
  let lines = wrapText(
    text,
    opts.width,
    opts.fontSize,
    family,
    weight,
    measure,
  );
  if (opts.maxLines !== undefined && lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${(lines[lastIndex] ?? "").replace(/\s+$/, "")}…`;
  }
  const lineHeight = opts.fontSize * TEXT_LINE_HEIGHT;
  const anchor =
    opts.align === "center"
      ? "middle"
      : opts.align === "right"
        ? "end"
        : "start";
  const anchorX =
    opts.align === "center"
      ? opts.x + opts.width / 2
      : opts.align === "right"
        ? opts.x + opts.width
        : opts.x;

  const spans = lines
    .map((line, i) => {
      const baseline = opts.y + i * lineHeight + opts.fontSize * 0.8;
      if (line === "") return "";
      return `<tspan x="${num(anchorX)}" y="${num(baseline)}">${esc(line)}</tspan>`;
    })
    .join("");
  const fontFamily = WHITEBOARD_FONT_FAMILIES[family].svg;
  return `<text font-family="${esc(fontFamily)}" font-size="${num(opts.fontSize)}" font-weight="${weight}" fill="${esc(opts.color)}" text-anchor="${anchor}">${spans}</text>`;
}

function rotationTransform(element: IWhiteboardElement): string {
  if (!element.rotation) return "";
  const bounds = elementBounds(element, false);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return ` transform="rotate(${num(element.rotation)} ${num(cx)} ${num(cy)})"`;
}

function penSvg(element: IWhiteboardElement, d: IDrawingData): string {
  if (d.points.length < 2) return "";
  const first = d.points[0];
  if (!first) return "";
  let pathD = `M ${num(first.x)} ${num(first.y)}`;
  for (let i = 1; i < d.points.length; i++) {
    const prev = d.points[i - 1];
    const curr = d.points[i];
    if (!prev || !curr) continue;
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    pathD += ` Q ${num(prev.x)} ${num(prev.y)} ${num(mx)} ${num(my)}`;
  }
  const last = d.points[d.points.length - 1];
  if (last) pathD += ` L ${num(last.x)} ${num(last.y)}`;

  const opacity =
    d.brush === "highlighter" ? ` stroke-opacity="${HIGHLIGHTER_OPACITY}"` : "";
  const path = `<g transform="translate(${num(element.x)}, ${num(element.y)})"><path d="${pathD}" fill="none" stroke="${esc(d.color)}" stroke-width="${num(d.thickness)}" stroke-linecap="round" stroke-linejoin="round"${opacity}/></g>`;
  const rotate = rotationTransform(element);
  return rotate ? `<g${rotate}>${path}</g>` : path;
}

function shapeSvg(element: IWhiteboardElement, d: IShapeData): string {
  const w = element.width ?? 0;
  const h = element.height ?? 0;
  const rotate = rotationTransform(element);
  const fill = d.fill && d.fill !== "none" ? esc(d.fill) : "none";

  if (d.shapeType === "arrow" || d.shapeType === "line") {
    const x2 = d.x2 ?? 0;
    const y2 = d.y2 ?? 0;
    const line = `<line x1="0" y1="0" x2="${num(x2)}" y2="${num(y2)}" stroke="${esc(d.color)}" stroke-width="${num(d.thickness)}" stroke-linecap="round"/>`;
    let head = "";
    if (d.shapeType === "arrow") {
      const angle = Math.atan2(y2, x2);
      const headLen = Math.min(
        ARROW_HEAD_MAX_LENGTH,
        Math.sqrt(x2 * x2 + y2 * y2) * ARROW_HEAD_LENGTH_RATIO,
      );
      const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      head = `<polygon points="${num(x2)},${num(y2)} ${num(a1x)},${num(a1y)} ${num(a2x)},${num(a2y)}" fill="${esc(d.color)}"/>`;
    }
    return `<g transform="translate(${num(element.x)}, ${num(element.y)})">${line}${head}</g>`;
  }

  if (d.shapeType === "circle") {
    const rx = w / 2;
    const ry = h / 2;
    return `<ellipse cx="${num(element.x + rx)}" cy="${num(element.y + ry)}" rx="${num(rx)}" ry="${num(ry)}" fill="${fill}" stroke="${esc(d.color)}" stroke-width="${num(d.thickness)}"${rotate}/>`;
  }

  const rx = d.shapeType === "square" ? 0 : 2;
  return `<rect x="${num(element.x)}" y="${num(element.y)}" width="${num(w)}" height="${num(h)}" fill="${fill}" stroke="${esc(d.color)}" stroke-width="${num(d.thickness)}" rx="${rx}"${rotate}/>`;
}

function textSvg(
  element: IWhiteboardElement,
  d: ITextData,
  measure?: MeasureText,
): string {
  const w = element.width ?? 100;
  const rotate = rotationTransform(element);
  const block = textBlockSvg(d.text, {
    x: element.x + TEXT_PADDING,
    y: element.y + TEXT_PADDING,
    width: Math.max(4, w - TEXT_PADDING * 2),
    fontSize: d.fontSize,
    color: d.color,
    family: d.fontFamily ?? DEFAULT_FONT_FAMILY,
    weight: d.fontWeight ?? DEFAULT_FONT_WEIGHT,
    align: d.align,
    measure,
  });
  return rotate ? `<g${rotate}>${block}</g>` : block;
}

function imageSvg(
  element: IWhiteboardElement,
  d: IImageData,
  options: WhiteboardRenderOptions,
): string {
  const w = element.width ?? 200;
  const h = element.height ?? 200;
  const rotate = rotationTransform(element);
  const resolved = options.imageHrefs?.[d.src];
  if (!resolved && options.unresolvedImages === "placeholder") {
    const label = textBlockSvg("image", {
      x: element.x,
      y: element.y + h / 2 - 8,
      width: w,
      fontSize: 12,
      color: UI.muted,
      family: "sans",
      align: "center",
      maxLines: 1,
    });
    return `<g${rotate}><rect x="${num(element.x)}" y="${num(element.y)}" width="${num(w)}" height="${num(h)}" fill="#f4f4f5" stroke="${UI.cardBorder}" rx="4"/>${label}</g>`;
  }
  return `<image href="${esc(resolved ?? d.src)}" x="${num(element.x)}" y="${num(element.y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"${rotate}/>`;
}

interface ComponentFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  clipId: string;
}

function componentFrameSvg(
  frame: ComponentFrame,
  bg: string,
  border: string,
): string {
  return `<clipPath id="${frame.clipId}"><rect x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.w)}" height="${num(frame.h)}" rx="8"/></clipPath><rect x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.w)}" height="${num(frame.h)}" rx="8" fill="${bg}" stroke="${border}"/>`;
}

function todoListSvg(frame: ComponentFrame, data: ITodoListData): string {
  const pad = 14;
  let body = componentFrameSvg(frame, UI.cardBg, UI.cardBorder);
  let cursor = frame.y + pad;
  let inner = textBlockSvg(data.title, {
    x: frame.x + pad,
    y: cursor,
    width: frame.w - pad * 2,
    fontSize: 13,
    color: UI.text,
    family: "sans",
    weight: 600,
    maxLines: 1,
  });
  cursor += 26;
  for (const item of data.items) {
    if (cursor + 18 > frame.y + frame.h - pad) break;
    const boxY = cursor + 1;
    inner += `<rect x="${num(frame.x + pad)}" y="${num(boxY)}" width="11" height="11" rx="3" fill="${item.completed ? UI.text : "none"}" stroke="${item.completed ? UI.text : UI.faint}"/>`;
    if (item.completed) {
      inner += `<path d="M ${num(frame.x + pad + 2.5)} ${num(boxY + 5.5)} l 2.5 2.5 l 4 -4.5" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    inner += textBlockSvg(item.text, {
      x: frame.x + pad + 19,
      y: cursor,
      width: frame.w - pad * 2 - 19,
      fontSize: 12,
      color: item.completed ? UI.muted : UI.text,
      family: "sans",
      maxLines: 1,
    });
    cursor += 21;
  }
  body += `<g clip-path="url(#${frame.clipId})">${inner}</g>`;
  return body;
}

function stickyNoteSvg(frame: ComponentFrame, data: IStickyNoteData): string {
  const color = STICKY_COLORS[data.colorIndex % STICKY_COLORS.length];
  if (!color) return componentFrameSvg(frame, UI.cardBg, UI.cardBorder);
  const pad = 14;
  let body = componentFrameSvg(frame, color.bg, color.border);
  const inner = textBlockSvg(data.content, {
    x: frame.x + pad,
    y: frame.y + pad,
    width: frame.w - pad * 2,
    fontSize: 13,
    color: color.text,
    family: "handwriting",
    maxLines: Math.max(1, Math.floor((frame.h - pad * 2) / (13 * 1.3))),
  });
  body += `<g clip-path="url(#${frame.clipId})">${inner}</g>`;
  return body;
}

function quickLinksSvg(frame: ComponentFrame, data: IQuickLinksData): string {
  const pad = 14;
  let body = componentFrameSvg(frame, UI.cardBg, UI.cardBorder);
  let cursor = frame.y + pad;
  let inner = textBlockSvg(data.title, {
    x: frame.x + pad,
    y: cursor,
    width: frame.w - pad * 2,
    fontSize: 13,
    color: UI.text,
    family: "sans",
    weight: 600,
    maxLines: 1,
  });
  cursor += 26;
  for (const link of data.links) {
    if (cursor + 16 > frame.y + frame.h - pad) break;
    inner += `<circle cx="${num(frame.x + pad + 3)}" cy="${num(cursor + 7)}" r="2" fill="${UI.accent}"/>`;
    inner += textBlockSvg(link.label || link.url, {
      x: frame.x + pad + 12,
      y: cursor,
      width: frame.w - pad * 2 - 12,
      fontSize: 12,
      color: UI.accent,
      family: "sans",
      maxLines: 1,
    });
    cursor += 20;
  }
  body += `<g clip-path="url(#${frame.clipId})">${inner}</g>`;
  return body;
}

function markdownNoteSvg(
  frame: ComponentFrame,
  data: IMarkdownNoteData,
): string {
  const pad = 14;
  let body = componentFrameSvg(frame, UI.cardBg, UI.cardBorder);
  const plain = data.content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
  const inner = textBlockSvg(plain, {
    x: frame.x + pad,
    y: frame.y + pad,
    width: frame.w - pad * 2,
    fontSize: 12,
    color: UI.text,
    family: "sans",
    maxLines: Math.max(1, Math.floor((frame.h - pad * 2) / (12 * 1.3))),
  });
  body += `<g clip-path="url(#${frame.clipId})">${inner}</g>`;
  return body;
}

function pdfViewerSvg(frame: ComponentFrame, data: IPdfViewerData): string {
  let body = componentFrameSvg(frame, "#fafafa", UI.cardBorder);
  const label = data.fileName || "PDF";
  const inner =
    textBlockSvg("PDF", {
      x: frame.x,
      y: frame.y + frame.h / 2 - 22,
      width: frame.w,
      fontSize: 16,
      color: UI.faint,
      family: "sans",
      weight: 600,
      align: "center",
      maxLines: 1,
    }) +
    textBlockSvg(label, {
      x: frame.x + 10,
      y: frame.y + frame.h / 2 + 2,
      width: frame.w - 20,
      fontSize: 11,
      color: UI.muted,
      family: "sans",
      align: "center",
      maxLines: 1,
    });
  body += `<g clip-path="url(#${frame.clipId})">${inner}</g>`;
  return body;
}

function componentSvg(element: IWhiteboardElement): string {
  const frame: ComponentFrame = {
    x: element.x,
    y: element.y,
    w: element.width ?? 100,
    h: element.height ?? 60,
    clipId: `clip-${element.id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
  };
  const rotate = rotationTransform(element);
  const data = element.data;
  let body: string;
  switch (element.componentType) {
    case "todo-list":
      body = todoListSvg(frame, data as unknown as ITodoListData);
      break;
    case "sticky-note":
      body = stickyNoteSvg(frame, data as unknown as IStickyNoteData);
      break;
    case "quick-links":
      body = quickLinksSvg(frame, data as unknown as IQuickLinksData);
      break;
    case "markdown-note":
      body = markdownNoteSvg(frame, data as unknown as IMarkdownNoteData);
      break;
    case "pdf-viewer":
      body = pdfViewerSvg(frame, data as unknown as IPdfViewerData);
      break;
    default:
      body = componentFrameSvg(frame, UI.cardBg, UI.cardBorder);
  }
  return rotate ? `<g${rotate}>${body}</g>` : body;
}

function rotatedBounds(bounds: Bounds, rotation: number): Bounds {
  const rad = (rotation * Math.PI) / 180;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  });
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function elementBounds(
  element: IWhiteboardElement,
  includeRotation = true,
): Bounds {
  const kind = whiteboardElementKind(element);
  let bounds: Bounds;
  if (kind === "pen") {
    const d = element.data as unknown as IDrawingData;
    const xs = d.points.map((p) => p.x);
    const ys = d.points.map((p) => p.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const margin = d.thickness / 2;
    bounds = {
      x: element.x + minX - margin,
      y: element.y + minY - margin,
      width: maxX - minX + d.thickness,
      height: maxY - minY + d.thickness,
    };
  } else if (kind === "shape") {
    const d = element.data as unknown as IShapeData;
    if (d.shapeType === "arrow" || d.shapeType === "line") {
      const x2 = d.x2 ?? 0;
      const y2 = d.y2 ?? 0;
      const margin = d.thickness / 2 + ARROW_HEAD_MAX_LENGTH / 2;
      bounds = {
        x: element.x + Math.min(0, x2) - margin,
        y: element.y + Math.min(0, y2) - margin,
        width: Math.abs(x2) + margin * 2,
        height: Math.abs(y2) + margin * 2,
      };
    } else {
      const margin = d.thickness / 2;
      bounds = {
        x: element.x - margin,
        y: element.y - margin,
        width: (element.width ?? 0) + d.thickness,
        height: (element.height ?? 0) + d.thickness,
      };
    }
  } else {
    bounds = {
      x: element.x,
      y: element.y,
      width: element.width ?? 100,
      height: element.height ?? (kind === "text" ? 40 : 60),
    };
  }
  if (includeRotation && element.rotation) {
    return rotatedBounds(bounds, element.rotation);
  }
  return bounds;
}

export function whiteboardContentBounds(
  elements: IWhiteboardElement[],
): Bounds | null {
  if (elements.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const b = elementBounds(element);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) return 1;
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function backgroundSvg(
  background: IWhiteboardBackground | undefined,
  viewBox: Bounds,
): string {
  const color = background?.color ?? DEFAULT_BOARD_BACKGROUND;
  const pattern = background?.pattern ?? "none";
  let svg = `<rect x="${num(viewBox.x)}" y="${num(viewBox.y)}" width="${num(viewBox.width)}" height="${num(viewBox.height)}" fill="${esc(color)}"/>`;
  if (pattern === "none") return svg;

  const dark = relativeLuminance(color) < 0.45;
  const stroke = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const size = pattern === "lines" ? 32 : 24;
  let content: string;
  if (pattern === "dots") {
    content = `<circle cx="1.5" cy="1.5" r="1.2" fill="${stroke}"/>`;
  } else if (pattern === "grid") {
    content = `<path d="M ${size} 0 L 0 0 0 ${size}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
  } else {
    content = `<line x1="0" y1="0.5" x2="${size}" y2="0.5" stroke="${stroke}" stroke-width="1"/>`;
  }
  svg += `<defs><pattern id="board-pattern" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${content}</pattern></defs>`;
  svg += `<rect x="${num(viewBox.x)}" y="${num(viewBox.y)}" width="${num(viewBox.width)}" height="${num(viewBox.height)}" fill="url(#board-pattern)"/>`;
  return svg;
}

export function whiteboardToSvg(
  elements: IWhiteboardElement[],
  options: WhiteboardRenderOptions = {},
): WhiteboardSvgResult {
  const padding = options.padding ?? 24;
  const fitted = options.bounds ?? whiteboardContentBounds(elements);
  const viewBox: Bounds = fitted
    ? {
        x: fitted.x - padding,
        y: fitted.y - padding,
        width: Math.max(1, fitted.width + padding * 2),
        height: Math.max(1, fitted.height + padding * 2),
      }
    : { x: 0, y: 0, width: 800, height: 600 };

  let width = viewBox.width;
  let height = viewBox.height;
  if (options.maxDimension) {
    const longest = Math.max(width, height);
    if (longest > options.maxDimension) {
      const scale = options.maxDimension / longest;
      width *= scale;
      height *= scale;
    }
  }

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  let content = "";
  for (const element of sorted) {
    const kind = whiteboardElementKind(element);
    switch (kind) {
      case "pen":
        content += penSvg(element, element.data as unknown as IDrawingData);
        break;
      case "shape":
        content += shapeSvg(element, element.data as unknown as IShapeData);
        break;
      case "text":
        content += textSvg(
          element,
          element.data as unknown as ITextData,
          options.measureText,
        );
        break;
      case "image":
        content += imageSvg(
          element,
          element.data as unknown as IImageData,
          options,
        );
        break;
      case "component":
        content += componentSvg(element);
        break;
      default:
        break;
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="${num(viewBox.x)} ${num(viewBox.y)} ${num(viewBox.width)} ${num(viewBox.height)}">`,
    backgroundSvg(options.background, viewBox),
    content,
    "</svg>",
  ].join("");

  return { svg, width: Math.round(width), height: Math.round(height), viewBox };
}

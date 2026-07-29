import type { AgentMemoryGraphNode } from "@repo/schemas";

/**
 * Node cards are drawn to an offscreen canvas and uploaded as a sprite
 * texture. Pixel dimensions are deliberately modest: a detail card is only
 * legible within a short distance of the camera, and the graph keeps a few
 * hundred of them live at once.
 */
export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 208;

const PADDING = 16;
const BODY_TOP = 46;
const BODY_BOTTOM = CARD_HEIGHT - 34;
const BRACKET = 30;
const BRACKET_WIDTH = 7;

/**
 * The one place colour survives. Type is legible from the corner brackets at a
 * distance where the tag text is not, so the hue carries the classification
 * and the card body stays monochrome.
 */
const TYPE_ACCENTS: Record<string, { dark: string; light: string }> = {
  core: { dark: "#b79bff", light: "#6d3fd4" },
  semantic: { dark: "#6cb4ff", light: "#1a63c4" },
  episodic: { dark: "#59dc95", light: "#12784a" },
  reflection: { dark: "#ffc247", light: "#9a6300" },
};
const ENTITY_ACCENT = { dark: "#9aa6b4", light: "#4a5563" };
const OWNER_ACCENT = { dark: "#ffb01f", light: "#a35c00" };

export function accentFor(
  node: AgentMemoryGraphNode,
  scheme: "dark" | "light",
): string {
  const pair = node.isOwner
    ? OWNER_ACCENT
    : node.kind === "entity"
      ? ENTITY_ACCENT
      : (TYPE_ACCENTS[node.memoryType ?? "semantic"] ?? ENTITY_ACCENT);
  return pair[scheme];
}

export interface CardTheme {
  background: string;
  foreground: string;
  mutedForeground: string;
  scheme: "dark" | "light";
}

/**
 * Theme values arrive as CSS colors of unknown notation — under Tailwind v4
 * `--background`/`--foreground` resolve to OKLCH — so alpha is applied around
 * the draw call rather than by parsing the color.
 */
function withAlpha(
  context: CanvasRenderingContext2D,
  alpha: number,
  draw: () => void,
): void {
  const previous = context.globalAlpha;
  context.globalAlpha = previous * alpha;
  draw();
  context.globalAlpha = previous;
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "12 Mar 2026" for an instant, "Mar 2026 → Aug 2026" for a stated range. */
export function cardDate(node: AgentMemoryGraphNode): string {
  if (!node.occurredAt) return "";
  if (!node.occurredUntil) return formatDay(node.occurredAt);
  const from = new Date(node.occurredAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
  const until = new Date(node.occurredUntil).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
  return `${from} → ${until}`;
}

function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const fits = (value: string) => context.measureText(value).width <= maxWidth;
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A token wider than the card — a URL or a hash — offers no break
    // opportunity of its own, so it is split by character rather than painted
    // past the frame.
    let rest = word;
    while (!fits(rest)) {
      let head = rest;
      while (head.length > 1 && !fits(head)) head = head.slice(0, -1);
      lines.push(head);
      rest = rest.slice(head.length);
    }
    line = rest;
  }
  if (line) lines.push(line);

  if (lines.length <= maxLines) return lines;
  // Trim the last kept line until the ellipsis fits rather than letting it spill.
  let last = lines[maxLines - 1] ?? "";
  while (last && !fits(`${last}…`)) last = last.slice(0, -1);
  return [...lines.slice(0, maxLines - 1), `${last}…`];
}

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const WAVEFORM_BARS = 44;
const WAVEFORM_HEIGHT = 34;

/**
 * A recording, drawn rather than described. The bars are the stored envelope,
 * evenly resampled to the card's fixed count so a two-second note and a
 * ten-minute one occupy the same strip.
 */
function drawWaveform(
  context: CanvasRenderingContext2D,
  samples: number[],
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  const gap = 2;
  const barWidth = (width - gap * (WAVEFORM_BARS - 1)) / WAVEFORM_BARS;
  context.fillStyle = color;
  for (let index = 0; index < WAVEFORM_BARS; index += 1) {
    const level =
      samples.length === 0
        ? 0.3
        : (samples[Math.floor((index / WAVEFORM_BARS) * samples.length)] ??
          0.3);
    const height = Math.max(2, level * WAVEFORM_HEIGHT);
    context.fillRect(
      x + index * (barWidth + gap),
      y + (WAVEFORM_HEIGHT - height) / 2,
      barWidth,
      height,
    );
  }
}

function drawBrackets(
  context: CanvasRenderingContext2D,
  color: string,
  scale: number,
): void {
  context.strokeStyle = color;
  context.lineWidth = BRACKET_WIDTH * scale;
  const inset = context.lineWidth / 2;
  const length = BRACKET * scale;
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [CARD_WIDTH - inset, inset, -1, 1],
    [inset, CARD_HEIGHT - inset, 1, -1],
    [CARD_WIDTH - inset, CARD_HEIGHT - inset, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    context.beginPath();
    context.moveTo(x + dx * length, y);
    context.lineTo(x, y);
    context.lineTo(x, y + dy * length);
    context.stroke();
  }
}

/**
 * The Machine's readout, not a UI card: a solid panel with heavy corner
 * brackets carrying the type colour, the type as a letter-spaced tag, the
 * statement or its source image, and the date it is about.
 *
 * `emphasis` marks a probe hit — the brackets thicken and the frame takes the
 * accent, so a result is findable across the lattice.
 */
export function drawMemoryCard(
  node: AgentMemoryGraphNode,
  theme: CardTheme,
  image: ImageBitmap | null,
  emphasis = false,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  // Fully opaque: a card sits in front of the lattice and must not let edges
  // and far nodes bleed through its text.
  context.fillStyle = theme.background;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const accent = accentFor(node, theme.scheme);
  context.strokeStyle = emphasis ? accent : theme.foreground;
  context.lineWidth = emphasis ? 3 : 1.5;
  const frameInset = context.lineWidth / 2;
  const strokeFrame = () =>
    context.strokeRect(
      frameInset,
      frameInset,
      CARD_WIDTH - context.lineWidth,
      CARD_HEIGHT - context.lineWidth,
    );
  if (emphasis) strokeFrame();
  else withAlpha(context, 0.4, strokeFrame);
  drawBrackets(context, accent, emphasis ? 1.5 : 1);

  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

  context.font = `700 13px ${mono}`;
  context.fillStyle = accent;
  context.textBaseline = "middle";
  const tag = (
    node.kind === "entity"
      ? (node.entityType ?? "entity")
      : (node.memoryType ?? "memory")
  ).toUpperCase();
  // Manual letter-spacing: canvas `letterSpacing` is not universally supported.
  let tagX = PADDING;
  for (const character of tag) {
    context.fillText(character, tagX, 26);
    tagX += context.measureText(character).width + 1.6;
  }

  if (node.status && node.status !== "active") {
    context.font = `400 11px ${mono}`;
    const status = node.status.toUpperCase();
    context.fillStyle = theme.mutedForeground;
    context.textAlign = "right";
    withAlpha(context, 0.85, () => {
      context.fillText(status, CARD_WIDTH - PADDING, 26);
    });
    context.textAlign = "left";
  }

  context.beginPath();
  context.moveTo(PADDING, 36.5);
  context.lineTo(CARD_WIDTH - PADDING, 36.5);
  context.strokeStyle = theme.foreground;
  context.lineWidth = 1;
  withAlpha(context, 0.3, () => context.stroke());

  const bodyHeight = BODY_BOTTOM - BODY_TOP;
  if (image) {
    // Cover-fit into the body box, cropping the overflowing axis.
    const boxWidth = CARD_WIDTH - PADDING * 2;
    const scale = Math.max(boxWidth / image.width, bodyHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(PADDING, BODY_TOP, boxWidth, bodyHeight);
    context.clip();
    context.drawImage(
      image,
      PADDING + (boxWidth - drawWidth) / 2,
      BODY_TOP + (bodyHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    context.restore();
  } else if (node.voiceNote) {
    // Statement first — it is why the memory exists — then the recording it
    // came from, so the node is recognisable as audio before it is read.
    context.font = `500 15px ${mono}`;
    context.fillStyle = theme.foreground;
    const lines = wrap(context, node.label, CARD_WIDTH - PADDING * 2, 3);
    lines.forEach((line, index) => {
      context.fillText(line, PADDING, BODY_TOP + 10 + index * 20);
    });

    const waveformTop = BODY_BOTTOM - WAVEFORM_HEIGHT;
    withAlpha(context, 0.55, () =>
      drawWaveform(
        context,
        node.voiceNote?.waveform ?? [],
        PADDING,
        waveformTop,
        CARD_WIDTH - PADDING * 2,
        accent,
      ),
    );
  } else {
    context.font = `500 15px ${mono}`;
    context.fillStyle = theme.foreground;
    const lines = wrap(context, node.label, CARD_WIDTH - PADDING * 2, 5);
    lines.forEach((line, index) => {
      context.fillText(line, PADDING, BODY_TOP + 10 + index * 20);
    });
  }

  const date = cardDate(node);
  if (date) {
    context.font = `500 12px ${mono}`;
    context.fillStyle = theme.mutedForeground;
    context.fillText(date, PADDING, CARD_HEIGHT - 18);
  }
  const footerRight =
    node.kind === "entity" && node.count !== undefined
      ? `${node.count}`
      : node.voiceNote?.durationMs !== undefined
        ? formatClock(node.voiceNote.durationMs)
        : null;
  if (footerRight) {
    context.font = `500 12px ${mono}`;
    context.fillStyle = theme.mutedForeground;
    context.textAlign = "right";
    context.fillText(footerRight, CARD_WIDTH - PADDING, CARD_HEIGHT - 18);
    context.textAlign = "left";
  }

  return canvas;
}

/**
 * The far-field representation, shared by every node: a faint panel with the
 * same corner brackets as a card. Drawn white throughout so that tinting the
 * sprite material by the type accent carries the classification at distances
 * where no text is legible.
 */
export function drawOutlineCard(theme: CardTheme): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const width = 64;
  const height = Math.round(width / (CARD_WIDTH / CARD_HEIGHT));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.fillStyle = theme.background;
  withAlpha(context, 0.55, () => context.fillRect(0, 0, width, height));

  context.strokeStyle = "rgba(255, 255, 255, 0.35)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);

  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  const length = 9;
  const corners: [number, number, number, number][] = [
    [1.5, 1.5, 1, 1],
    [width - 1.5, 1.5, -1, 1],
    [1.5, height - 1.5, 1, -1],
    [width - 1.5, height - 1.5, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    context.beginPath();
    context.moveTo(x + dx * length, y);
    context.lineTo(x, y);
    context.lineTo(x, y + dy * length);
    context.stroke();
  }
  return canvas;
}

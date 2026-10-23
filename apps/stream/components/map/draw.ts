import type { MapHighlight, MapPoint } from "@repo/schemas/stream";

import { type Camera, toScreen, type Viewport } from "./camera";
import { type Anchor, nearestAnchor } from "./layout";

const AMBER = "#f2b54a";
const INK = "#0c0b0a";

export interface DotBatch {
  fill: string;
  alpha: number;
  xs: Float64Array;
  ys: Float64Array;
  radii: Float64Array;
}

/** Groups dots by tint and brightness so a frame costs one fill per group, not per dot. */
export function batchDots(
  points: readonly MapPoint[],
  anchors: readonly Anchor[],
  tints: readonly string[],
): DotBatch[] {
  const groups = new Map<
    string,
    { fill: string; alpha: number; items: MapPoint[] }
  >();
  for (const point of points) {
    const tint = nearestAnchor(anchors, point.x, point.y);
    const bright = point.weight >= 0.55;
    const key = `${tint}:${bright}`;
    const group = groups.get(key);
    if (group) group.items.push(point);
    else
      groups.set(key, {
        fill: tints[tint] ?? "#8e877c",
        alpha: bright ? 0.95 : 0.55,
        items: [point],
      });
  }
  return [...groups.values()].map(({ fill, alpha, items }) => ({
    fill,
    alpha,
    xs: Float64Array.from(items, (p) => p.x),
    ys: Float64Array.from(items, (p) => p.y),
    radii: Float64Array.from(items, (p) => 1.1 + 3.1 * p.weight ** 1.3),
  }));
}

export function prepareCanvas(
  canvas: HTMLCanvasElement,
  viewport: Viewport,
): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(viewport.width * ratio);
  const height = Math.round(viewport.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

export function drawField(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  camera: Camera,
  batches: readonly DotBatch[],
  opacity: number,
  boost: number,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
  if (opacity <= 0.01) return;
  const margin = 8;
  for (const batch of batches) {
    context.globalAlpha = batch.alpha * opacity;
    context.fillStyle = batch.fill;
    context.beginPath();
    for (let i = 0; i < batch.xs.length; i++) {
      const [sx, sy] = toScreen(camera, viewport, batch.xs[i], batch.ys[i]);
      if (
        sx < -margin ||
        sy < -margin ||
        sx > viewport.width + margin ||
        sy > viewport.height + margin
      ) {
        continue;
      }
      const radius = batch.radii[i] * boost;
      context.moveTo(sx + radius, sy);
      context.arc(sx, sy, radius, 0, Math.PI * 2);
    }
    context.fill();
  }
  context.globalAlpha = 1;
}

function starPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  const inner = radius * 0.45;
  context.moveTo(x, y - radius);
  for (let i = 1; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : inner;
    context.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  context.closePath();
}

export function drawConstellation(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  camera: Camera,
  highlights: readonly MapHighlight[],
  anchorFor: (highlight: MapHighlight) => readonly [number, number],
  posterBlend: number,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
  const watched = highlights.filter((h) => h.kind === "watched");
  const saved = highlights.filter((h) => h.kind === "saved");
  const at = (h: MapHighlight) => {
    const [x, y] = anchorFor(h);
    return toScreen(camera, viewport, x, y);
  };

  if (watched.length > 1) {
    context.strokeStyle = AMBER;
    context.globalAlpha = 0.28 * (1 - 0.6 * posterBlend);
    context.lineWidth = 1;
    context.beginPath();
    watched.forEach((h, index) => {
      const [sx, sy] = at(h);
      if (index === 0) context.moveTo(sx, sy);
      else context.lineTo(sx, sy);
    });
    context.stroke();
  }

  const radius = 4.5 + 2.5 * posterBlend;
  context.globalAlpha = 1;
  if (posterBlend > 0) {
    context.fillStyle = INK;
    context.globalAlpha = 0.7 * posterBlend;
    context.beginPath();
    for (const h of [...watched, ...saved]) {
      const [sx, sy] = at(h);
      context.moveTo(sx + radius + 3, sy);
      context.arc(sx, sy, radius + 3, 0, Math.PI * 2);
    }
    context.fill();
    context.globalAlpha = 1;
  }

  context.fillStyle = AMBER;
  context.beginPath();
  for (const h of watched) {
    const [sx, sy] = at(h);
    starPath(context, sx, sy, radius);
  }
  context.fill();

  context.strokeStyle = AMBER;
  context.lineWidth = 1.25;
  context.beginPath();
  for (const h of saved) {
    const [sx, sy] = at(h);
    starPath(context, sx, sy, radius);
  }
  context.stroke();
}

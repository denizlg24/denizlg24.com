import type { ChunkDraft, TranscriptSource } from "../knowledge-chunk";
import { splitRanges, withUrlAtoms } from "./text-split";
import type { ChunkContext } from "./types";

interface Span {
  start: number;
  end: number;
  startMs: number;
  endMs: number;
}

function recordingDate(recordedAt: string | undefined): string | undefined {
  if (!recordedAt) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(recordedAt)?.[0];
  if (iso) return iso;
  const parsed = new Date(recordedAt);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function interpolate(span: Span, position: number): number {
  const length = span.end - span.start;
  const fraction = Math.min(1, Math.max(0, (position - span.start) / length));
  return Math.round(span.startMs + fraction * (span.endMs - span.startMs));
}

export function chunkTranscriptText(
  source: TranscriptSource,
  ctx: ChunkContext,
): ChunkDraft[] {
  const { budget, count } = ctx;
  let text = "";
  const spans: Span[] = [];
  for (const segment of source.segments) {
    const part = segment.text.trim();
    if (part.length === 0) continue;
    if (text.length > 0) text += " ";
    spans.push({
      start: text.length,
      end: text.length + part.length,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
    text += part;
  }
  if (spans.length === 0) return [];

  const headerLines = [
    ctx.title.trim(),
    recordingDate(source.recordedAt),
  ].filter((line): line is string => !!line);
  const header = headerLines.length > 0 ? `${headerLines.join("\n")}\n\n` : "";
  const headerTokens = count(header);
  const hard = Math.max(Math.ceil(budget.max / 4), budget.max - headerTokens);
  const fill = Math.min(
    hard,
    Math.max(Math.ceil(budget.target / 4), budget.target - headerTokens),
  );

  const ranges = splitRanges(text, withUrlAtoms(text, []), {
    fill,
    hard,
    count,
  });
  while (ranges.length > 1) {
    const last = ranges[ranges.length - 1];
    const previous = ranges[ranges.length - 2];
    if (!last || !previous) break;
    if (count(header + text.slice(last.start, last.end)) >= budget.min) break;
    const merged = { start: previous.start, end: last.end };
    if (count(header + text.slice(merged.start, merged.end)) > budget.max)
      break;
    ranges.splice(ranges.length - 2, 2, merged);
  }

  return ranges.map((range, ordinal): ChunkDraft => {
    const body = text.slice(range.start, range.end);
    const first =
      spans.find((span) => range.start < span.end) ?? (spans[0] as Span);
    const last =
      spans.find((span) => range.end <= span.end) ??
      (spans[spans.length - 1] as Span);
    const startMs =
      range.start <= first.start
        ? first.startMs
        : interpolate(first, range.start);
    const endMs =
      range.end >= last.end ? last.endMs : interpolate(last, range.end);
    const full = header + body;
    return {
      ordinal,
      headingPath: [],
      body,
      text: full,
      tokenCount: count(full),
      startMs,
      endMs: Math.max(startMs, endMs),
    };
  });
}

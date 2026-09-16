"use client";

import type { IVoiceNote, VoiceNoteTranscriptSegment } from "@repo/schemas";
import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/components/voice-notes/format";
import { cn } from "@/lib/utils";
import { HighlightedText } from "./voice-notes-primitives";

/** The last block starting at or before `second`. */
function blockIndexAt(blocks: VoiceNoteTranscriptSegment[], second: number) {
  let found = -1;
  for (const [index, block] of blocks.entries()) {
    if (block.startSecond > second) break;
    found = index;
  }
  return found;
}

export function VoiceNoteTranscript({
  transcription,
  durationMs,
  currentMs,
  terms,
  matchStartSecond,
  onSeek,
}: {
  transcription: IVoiceNote["transcription"];
  durationMs: number;
  currentMs: number;
  terms: readonly string[];
  matchStartSecond?: number;
  onSeek: (milliseconds: number) => void;
}) {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const segments = transcription.segments ?? [];
  const blocks: VoiceNoteTranscriptSegment[] =
    segments.length > 0
      ? segments
      : transcription.text
        ? [
            {
              text: transcription.text,
              startSecond: 0,
              endSecond: durationMs / 1_000,
            },
          ]
        : [];
  const withHours =
    durationMs >= 3_600_000 || (blocks.at(-1)?.startSecond ?? 0) >= 3_600;
  const activeIndex =
    currentMs > 0 ? blockIndexAt(blocks, currentMs / 1_000) : -1;
  const hasBlocks = blocks.length > 0;

  useEffect(() => {
    if (matchStartSecond === undefined || !hasBlocks) return;
    const index = blockIndexAt(blocks, matchStartSecond);
    const element = containerRef.current?.querySelector<HTMLElement>(
      `[data-block-index="${Math.max(0, index)}"]`,
    );
    element?.scrollIntoView({ block: "center" });
    setFlashIndex(Math.max(0, index));
    const timer = setTimeout(() => setFlashIndex(null), 1_600);
    return () => clearTimeout(timer);
    // Once per opened match, not on every progress poll that grows the list.
  }, [matchStartSecond, hasBlocks]);

  if (!hasBlocks) return null;

  return (
    <ol ref={containerRef} className="flex flex-col">
      {blocks.map((block, index) => (
        <li
          key={`${block.startSecond}-${index}`}
          data-block-index={index}
          className={cn(
            "-mx-2 flex gap-3 rounded-md px-2 py-1.5 transition-colors duration-700",
            flashIndex === index
              ? "bg-amber-400/15"
              : index === activeIndex && "bg-muted/50",
          )}
        >
          <button
            type="button"
            onClick={() => onSeek(block.startSecond * 1_000)}
            className={cn(
              "h-5 shrink-0 rounded-sm px-1 font-mono text-[10px] tabular-nums hover:bg-muted hover:text-foreground",
              index === activeIndex ? "text-red-500" : "text-muted-foreground",
            )}
            aria-label={`Play from ${formatClock(block.startSecond, withHours)}`}
          >
            {formatClock(block.startSecond, withHours)}
          </button>
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed">
            <HighlightedText text={block.text} terms={terms} />
          </p>
        </li>
      ))}
    </ol>
  );
}

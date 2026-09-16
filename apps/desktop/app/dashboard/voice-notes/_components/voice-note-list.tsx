"use client";

import type { IVoiceNoteSummary } from "@repo/schemas";
import { Checkbox } from "@repo/ui/checkbox";
import { Loader2, RotateCw } from "lucide-react";
import { type Ref, useState } from "react";
import {
  formatDayHeading,
  formatShortDate,
  formatSpan,
  formatTimeOfDay,
  localDayKey,
} from "@/components/voice-notes/format";
import { formatDuration } from "@/components/voice-notes/voice-recorder-provider";
import { cn } from "@/lib/utils";
import {
  ContextDot,
  HighlightedText,
  SectionHeading,
} from "./voice-notes-primitives";
import { VoiceNoteListSkeleton } from "./voice-notes-skeletons";

export interface RowModifiers {
  shift: boolean;
  toggle: boolean;
}

interface DayGroup {
  key: string;
  rows: IVoiceNoteSummary[];
}

/**
 * Consecutive runs rather than a map, so the rendered order is always the
 * server's order — which is what ↑/↓ walks.
 */
function groupByDay(rows: IVoiceNoteSummary[]) {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const key = localDayKey(row.recordedAt);
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

function TranscriptionMarker({
  voiceNote,
  onRetry,
}: {
  voiceNote: IVoiceNoteSummary;
  onRetry: (id: string) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const { status, progress } = voiceNote.transcription;

  if (status === "failed") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        failed
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await onRetry(voiceNote._id);
            setRetrying(false);
          }}
          className="pointer-events-auto relative z-10 flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={`Retry transcription of ${voiceNote.title}`}
        >
          {retrying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCw className="size-3" />
          )}
        </button>
      </span>
    );
  }

  if (status === "queued" || status === "transcribing") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {progress && progress.total > 0
          ? `${progress.completed}/${progress.total}`
          : status === "queued"
            ? "queued"
            : null}
      </span>
    );
  }

  if (status === "untranscribed") {
    return (
      <span className="flex shrink-0 items-center">
        <span className="size-1.5 rounded-full border border-muted-foreground/60" />
        <span className="sr-only">untranscribed</span>
      </span>
    );
  }

  return null;
}

function VoiceNoteRow({
  voiceNote,
  selected,
  checked,
  showCheckbox,
  showDate,
  terms,
  onActivate,
  onCheck,
  onRetry,
}: {
  voiceNote: IVoiceNoteSummary;
  selected: boolean;
  checked: boolean;
  showCheckbox: boolean;
  showDate: boolean;
  terms: readonly string[];
  onActivate: (id: string, modifiers: RowModifiers) => void;
  onCheck: (id: string, modifiers: RowModifiers) => void;
  onRetry: (id: string) => Promise<void>;
}) {
  const snippet = terms.length > 0 ? voiceNote.match?.snippet : undefined;
  const hasMeta = Boolean(voiceNote.context) || voiceNote.tags.length > 0;

  return (
    <li
      data-voice-note-id={voiceNote._id}
      className={cn(
        "group/row relative flex gap-2 rounded-md py-1.5 pr-2 pl-1.5 transition-colors",
        !showDate && "scroll-mt-9",
        selected ? "bg-accent" : checked ? "bg-accent/50" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={(event) =>
          onActivate(voiceNote._id, {
            shift: event.shiftKey,
            toggle: event.metaKey || event.ctrlKey,
          })
        }
        aria-label={voiceNote.title}
        aria-current={selected ? "true" : undefined}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <span className="relative z-10 flex h-4 w-3.5 shrink-0 items-center">
        <Checkbox
          checked={checked}
          onClick={(event) => {
            event.preventDefault();
            onCheck(voiceNote._id, {
              shift: event.shiftKey,
              toggle: true,
            });
          }}
          aria-label={`Select ${voiceNote.title}`}
          className={cn(
            "size-3.5 rounded-[3px] transition-opacity focus-visible:opacity-100",
            showCheckbox || checked
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100",
          )}
        />
      </span>

      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-4 items-center gap-2">
          <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {showDate
              ? formatShortDate(voiceNote.recordedAt)
              : formatTimeOfDay(voiceNote.recordedAt)}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              selected && "font-medium",
            )}
          >
            <HighlightedText text={voiceNote.title} terms={terms} />
          </span>
          <TranscriptionMarker voiceNote={voiceNote} onRetry={onRetry} />
          <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {voiceNote.durationMs ? formatDuration(voiceNote.durationMs) : "—"}
          </span>
        </div>

        {snippet && (
          <p className="line-clamp-2 pl-12 text-[11px] leading-snug text-muted-foreground">
            <HighlightedText text={snippet} terms={terms} />
          </p>
        )}

        {hasMeta && (
          <div className="flex min-w-0 items-center gap-2 pl-12 text-[10px] text-muted-foreground">
            {voiceNote.context && (
              <span className="flex min-w-0 items-center gap-1">
                <ContextDot color={voiceNote.context.color} />
                <span className="truncate">{voiceNote.context.title}</span>
              </span>
            )}
            {voiceNote.tags.length > 0 && (
              <span className="min-w-0 truncate">
                {voiceNote.tags.map((tag) => `#${tag}`).join(" ")}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function VoiceNoteList({
  listRef,
  rows,
  status,
  grouped,
  selectedId,
  checkedIds,
  terms,
  hasMore,
  loadingMore,
  total,
  onLoadMore,
  onActivate,
  onCheck,
  onRetry,
}: {
  listRef: Ref<HTMLDivElement>;
  rows: IVoiceNoteSummary[];
  status: "loading" | "ready" | "error";
  grouped: boolean;
  selectedId: string | null;
  checkedIds: ReadonlySet<string>;
  terms: readonly string[];
  hasMore: boolean;
  loadingMore: boolean;
  total: number;
  onLoadMore: () => void;
  onActivate: (id: string, modifiers: RowModifiers) => void;
  onCheck: (id: string, modifiers: RowModifiers) => void;
  onRetry: (id: string) => Promise<void>;
}) {
  if (status === "loading") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <VoiceNoteListSkeleton />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
        —
      </div>
    );
  }

  const renderRow = (voiceNote: IVoiceNoteSummary) => (
    <VoiceNoteRow
      key={voiceNote._id}
      voiceNote={voiceNote}
      selected={voiceNote._id === selectedId}
      checked={checkedIds.has(voiceNote._id)}
      showCheckbox={checkedIds.size > 0}
      showDate={!grouped}
      terms={terms}
      onActivate={onActivate}
      onCheck={onCheck}
      onRetry={onRetry}
    />
  );

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {grouped ? (
        groupByDay(rows).map((group) => (
          <section key={group.key}>
            <SectionHeading
              className="sticky top-0 z-20 bg-background px-1.5 pt-3 pb-1.5"
              title={formatDayHeading(group.key)}
              meta={`${group.rows.length} · ${formatSpan(
                group.rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0),
              )}`}
            />
            <ul className="flex flex-col">{group.rows.map(renderRow)}</ul>
          </section>
        ))
      ) : (
        <ul className="flex flex-col pt-2">{rows.map(renderRow)}</ul>
      )}

      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md font-mono text-[10px] tabular-nums text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {loadingMore && <Loader2 className="size-3 animate-spin" />}
          more · {rows.length} / {total}
        </button>
      )}
    </div>
  );
}

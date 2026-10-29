"use client";

import type { IVoiceNoteSummary } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { Loader2, Mic, RotateCw } from "lucide-react";
import { type Ref, useState } from "react";
import {
  formatDayHeading,
  formatRelative,
  formatSpan,
  formatTimeOfDay,
  localDayKey,
} from "@/components/voice-notes/format";
import { formatDuration } from "@/components/voice-notes/voice-recorder-provider";
import { cn } from "@/lib/utils";
import { ContextDot, HighlightedText } from "./voice-notes-primitives";
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
      <span className="flex items-center gap-1 text-destructive">
        failed
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={retrying}
          onClick={async (event) => {
            event.stopPropagation();
            setRetrying(true);
            await onRetry(voiceNote._id);
            setRetrying(false);
          }}
          aria-label={`Retry transcription of ${voiceNote.title}`}
        >
          {retrying ? <Loader2 className="animate-spin" /> : <RotateCw />}
        </Button>
      </span>
    );
  }

  if (status === "queued" || status === "transcribing") {
    return (
      <span className="flex items-center gap-1">
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
      <span className="flex items-center">
        <span className="size-1.5 rounded-full border border-muted-foreground/60" />
        <span className="sr-only">untranscribed</span>
      </span>
    );
  }

  return null;
}

function RowDescription({
  voiceNote,
  terms,
}: {
  voiceNote: IVoiceNoteSummary;
  terms: readonly string[];
}) {
  const snippet = terms.length > 0 ? voiceNote.match?.snippet : undefined;
  if (snippet) return <HighlightedText text={snippet} terms={terms} />;
  if (!voiceNote.context && voiceNote.tags.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-2">
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
    </span>
  );
}

function VoiceNoteRow({
  voiceNote,
  selected,
  checked,
  showCheckbox,
  grouped,
  terms,
  onActivate,
  onCheck,
  onRetry,
}: {
  voiceNote: IVoiceNoteSummary;
  selected: boolean;
  checked: boolean;
  showCheckbox: boolean;
  grouped: boolean;
  terms: readonly string[];
  onActivate: (id: string, modifiers: RowModifiers) => void;
  onCheck: (id: string, modifiers: RowModifiers) => void;
  onRetry: (id: string) => Promise<void>;
}) {
  return (
    <ListRow
      data-voice-note-id={voiceNote._id}
      aria-current={selected ? "true" : undefined}
      selected={selected}
      onClick={(event) =>
        onActivate(voiceNote._id, {
          shift: event.shiftKey,
          toggle: event.metaKey || event.ctrlKey,
        })
      }
      className={cn(
        "mx-0 items-start",
        grouped && "scroll-mt-8",
        checked && !selected && "bg-surface/50",
      )}
      leading={
        <Checkbox
          checked={checked}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCheck(voiceNote._id, { shift: event.shiftKey, toggle: true });
          }}
          aria-label={`Select ${voiceNote.title}`}
          className={cn(
            "size-3.5 rounded-[3px] transition-opacity focus-visible:opacity-100",
            showCheckbox || checked
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100",
          )}
        />
      }
      title={<HighlightedText text={voiceNote.title} terms={terms} />}
      description={<RowDescription voiceNote={voiceNote} terms={terms} />}
      meta={
        <>
          <TranscriptionMarker voiceNote={voiceNote} onRetry={onRetry} />
          <span className="w-11 text-right">
            {voiceNote.durationMs ? formatDuration(voiceNote.durationMs) : "—"}
          </span>
          <span className="w-14 text-right">
            {grouped
              ? formatTimeOfDay(voiceNote.recordedAt)
              : formatRelative(voiceNote.recordedAt)}
          </span>
        </>
      }
    />
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
      <EmptyState
        icon={<Mic />}
        label={status === "error" ? "Failed to load" : "No voice notes"}
      />
    );
  }

  const renderRow = (voiceNote: IVoiceNoteSummary) => (
    <VoiceNoteRow
      key={voiceNote._id}
      voiceNote={voiceNote}
      selected={voiceNote._id === selectedId}
      checked={checkedIds.has(voiceNote._id)}
      showCheckbox={checkedIds.size > 0}
      grouped={grouped}
      terms={terms}
      onActivate={onActivate}
      onCheck={onCheck}
      onRetry={onRetry}
    />
  );

  return (
    <div
      ref={listRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
    >
      {grouped ? (
        groupByDay(rows).map((group) => (
          <section key={group.key}>
            <ListGroupLabel className="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 pt-3 first:pt-3">
              {formatDayHeading(group.key)}
              <span className="ml-auto tabular-nums normal-case tracking-normal text-muted-foreground/70">
                {group.rows.length} ·{" "}
                {formatSpan(
                  group.rows.reduce(
                    (sum, row) => sum + (row.durationMs ?? 0),
                    0,
                  ),
                )}
              </span>
            </ListGroupLabel>
            <List>{group.rows.map(renderRow)}</List>
          </section>
        ))
      ) : (
        <List className="pt-2">{rows.map(renderRow)}</List>
      )}

      {hasMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="mt-2 w-full text-muted-foreground tabular-nums"
        >
          {loadingMore && <Loader2 className="animate-spin" />}
          More · {rows.length} / {total}
        </Button>
      )}
    </div>
  );
}

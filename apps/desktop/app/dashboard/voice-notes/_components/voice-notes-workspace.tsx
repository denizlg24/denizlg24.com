"use client";

import {
  type IVoiceNote,
  type IVoiceNoteSummary,
  VOICE_NOTE_MAX_TAGS,
} from "@repo/schemas";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/sheet";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { searchTerms } from "@/components/voice-notes/format";
import { denizApi } from "@/lib/api-wrapper";
import {
  announceVoiceNotesChanged,
  useVoiceNoteFacets,
  useVoiceNoteList,
} from "./use-voice-note-list";
import { VoiceNoteDetail } from "./voice-note-detail";
import {
  DEFAULT_FILTERS,
  isChronological,
  serializeListQuery,
  toListQuery,
  type VoiceNoteFilters,
} from "./voice-note-filters";
import { type RowModifiers, VoiceNoteList } from "./voice-note-list";
import { type BulkAction, VoiceNotesBulkBar } from "./voice-notes-bulk-bar";
import { VoiceNotesFilterBar } from "./voice-notes-filter-bar";
import {
  RecordingStrip,
  UnsavedRecordingStrip,
  VoiceNotesHeader,
} from "./voice-notes-header";

const SEARCH_DEBOUNCE_MS = 250;
const BULK_CONCURRENCY = 3;

const NAVIGATION_EXCLUDED =
  "input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox'], [role='dialog'], [role='alertdialog'], [role='slider'], [cmdk-root]";

function isKeyboardOwnedElsewhere(target: EventTarget | null) {
  return (
    target instanceof Element && target.closest(NAVIGATION_EXCLUDED) !== null
  );
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function reportBulk(verb: string, outcomes: boolean[], skipped = 0) {
  const done = outcomes.filter(Boolean).length;
  const failed = outcomes.length - done;
  const parts = [`${verb} ${done}`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) {
    parts.push(`${failed} failed`);
    toast.error(parts.join(" · "));
  } else {
    toast.success(parts.join(" · "));
  }
}

function without(ids: ReadonlySet<string>, removed: ReadonlySet<string>) {
  return new Set([...ids].filter((id) => !removed.has(id)));
}

export function VoiceNotesWorkspace() {
  const api = useMemo(() => new denizApi(), []);
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const isMobile = useIsMobile();
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<VoiceNoteFilters>(DEFAULT_FILTERS);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const queryString = serializeListQuery(
    toListQuery(filters, debouncedQuery),
  ).toString();
  const list = useVoiceNoteList(api, queryString);
  const { facets, reload: reloadFacets } = useVoiceNoteFacets(api);
  const terms = useMemo(() => searchTerms(debouncedQuery), [debouncedQuery]);
  const tagSuggestions = useMemo(
    () => facets?.tags.map((tag) => tag.name) ?? [],
    [facets],
  );

  useEffect(() => {
    setCheckedIds(new Set());
    setAnchorId(null);
  }, [queryString]);

  const select = useCallback((id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("id", id);
    else params.delete("id");
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      search ? `?${search}` : window.location.pathname,
    );
  }, []);

  const rowIds = list.rows.map((row) => row._id);
  const checkedRows = list.rows.filter((row) => checkedIds.has(row._id));
  const selectedSummary = list.rows.find((row) => row._id === selectedId);

  const toggleChecked = (id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
  };

  const checkRange = (id: string) => {
    const anchor = anchorId ?? selectedId;
    const from = anchor ? rowIds.indexOf(anchor) : -1;
    const to = rowIds.indexOf(id);
    if (from === -1 || to === -1) {
      toggleChecked(id);
      return;
    }
    const range = rowIds.slice(Math.min(from, to), Math.max(from, to) + 1);
    setCheckedIds((current) => new Set([...current, ...range]));
  };

  const activateRow = (id: string, modifiers: RowModifiers) => {
    if (modifiers.shift) checkRange(id);
    else if (modifiers.toggle) toggleChecked(id);
    else {
      select(id);
      setAnchorId(id);
    }
  };

  const checkRow = (id: string, modifiers: RowModifiers) => {
    if (modifiers.shift) checkRange(id);
    else toggleChecked(id);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey || isKeyboardOwnedElsewhere(event.target)) return;
      if (event.key === "Escape" && checkedIds.size > 0) {
        setCheckedIds(new Set());
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (rowIds.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = selectedId ? rowIds.indexOf(selectedId) : -1;
      const nextIndex =
        index === -1
          ? step > 0
            ? 0
            : rowIds.length - 1
          : Math.min(rowIds.length - 1, Math.max(0, index + step));
      const nextId = rowIds[nextIndex];
      select(nextId);
      setAnchorId(nextId);
      listRef.current
        ?.querySelector(`[data-voice-note-id="${nextId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkedIds.size, rowIds, select, selectedId]);

  const retryRow = async (id: string) => {
    const result = await api.POST<{ queued: boolean; voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${id}/transcribe`,
      body: { force: true },
    });
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    list.updateRow(result.voiceNote);
  };

  const bulkRetry = async () => {
    const targets = checkedRows.filter(
      (row) =>
        row.transcription.status === "failed" ||
        row.transcription.status === "untranscribed",
    );
    setBulkBusy("retry");
    const outcomes = await runWithConcurrency(
      targets,
      BULK_CONCURRENCY,
      async (row) => {
        const result = await api.POST<{
          queued: boolean;
          voiceNote: IVoiceNote;
        }>({
          endpoint: `voice-notes/${row._id}/transcribe`,
          body: { force: true },
        });
        if ("code" in result) return false;
        list.updateRow(result.voiceNote);
        return true;
      },
    );
    setBulkBusy(null);
    reportBulk("Queued", outcomes, checkedRows.length - targets.length);
  };

  const bulkTag = async (tag: string) => {
    const untagged = checkedRows.filter((row) => !row.tags.includes(tag));
    const targets = untagged.filter(
      (row) => row.tags.length < VOICE_NOTE_MAX_TAGS,
    );
    setBulkBusy("tag");
    const outcomes = await runWithConcurrency(
      targets,
      BULK_CONCURRENCY,
      async (row: IVoiceNoteSummary) => {
        const result = await api.PATCH<{ voiceNote: IVoiceNote }>({
          endpoint: `voice-notes/${row._id}`,
          body: { tags: [...row.tags, tag] },
        });
        if ("code" in result) return false;
        list.updateRow(result.voiceNote);
        return true;
      },
    );
    setBulkBusy(null);
    reloadFacets();
    reportBulk(`Tagged #${tag}`, outcomes, checkedRows.length - targets.length);
  };

  const bulkDelete = async () => {
    const targets = checkedRows;
    setBulkBusy("delete");
    const outcomes = await runWithConcurrency(
      targets,
      BULK_CONCURRENCY,
      async (row) => {
        const result = await api.DELETE<{ success: true }>({
          endpoint: `voice-notes/${row._id}`,
        });
        return !("code" in result);
      },
    );
    setBulkBusy(null);
    const deleted = new Set(
      targets.filter((_, index) => outcomes[index]).map((row) => row._id),
    );
    list.removeRows(deleted);
    setCheckedIds((current) => without(current, deleted));
    if (selectedId && deleted.has(selectedId)) select(null);
    reloadFacets();
    reportBulk("Deleted", outcomes);
  };

  const handleDeleted = (id: string) => {
    const index = rowIds.indexOf(id);
    const neighbour =
      index === -1 ? undefined : (rowIds[index + 1] ?? rowIds[index - 1]);
    const removed = new Set([id]);
    list.removeRows(removed);
    setCheckedIds((current) => without(current, removed));
    select(isMobile ? null : (neighbour ?? null));
    reloadFacets();
  };

  const handleUploaded = (voiceNote: IVoiceNote) => {
    announceVoiceNotesChanged();
    select(voiceNote._id);
  };

  const renderDetail = (id: string, onClose?: () => void) => (
    <VoiceNoteDetail
      key={id}
      api={api}
      voiceNoteId={id}
      summary={selectedSummary}
      terms={terms}
      matchStartSecond={
        terms.length > 0 ? selectedSummary?.match?.startSecond : undefined
      }
      tagSuggestions={tagSuggestions}
      onChanged={list.updateRow}
      onTaxonomyChanged={reloadFacets}
      onDeleted={handleDeleted}
      onClose={onClose}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <VoiceNotesHeader
        api={api}
        counts={
          list.status === "ready"
            ? {
                shown: list.rows.length,
                total: list.total,
                totalDurationMs: list.totalDurationMs,
              }
            : undefined
        }
        query={query}
        onQueryChange={setQuery}
        refreshing={list.refreshing && list.status === "ready"}
        onRefresh={() => {
          void list.refresh();
          reloadFacets();
        }}
        onUploaded={handleUploaded}
      />
      <RecordingStrip />
      <UnsavedRecordingStrip />
      <VoiceNotesFilterBar
        filters={filters}
        facets={facets}
        onChange={setFilters}
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-h-0 w-full flex-col select-none md:w-[22rem] md:shrink-0 md:border-r lg:w-[26rem]">
          {checkedRows.length > 0 && (
            <VoiceNotesBulkBar
              count={checkedRows.length}
              loadedCount={list.rows.length}
              retryableCount={
                checkedRows.filter(
                  (row) =>
                    row.transcription.status === "failed" ||
                    row.transcription.status === "untranscribed",
                ).length
              }
              totalDurationMs={checkedRows.reduce(
                (sum, row) => sum + (row.durationMs ?? 0),
                0,
              )}
              totalBytes={checkedRows.reduce(
                (sum, row) => sum + row.sizeBytes,
                0,
              )}
              busy={bulkBusy}
              tagSuggestions={tagSuggestions}
              onToggleAll={() =>
                setCheckedIds(
                  checkedRows.length === list.rows.length
                    ? new Set()
                    : new Set(rowIds),
                )
              }
              onRetry={() => void bulkRetry()}
              onAddTag={(tag) => void bulkTag(tag)}
              onDelete={() => void bulkDelete()}
              onClear={() => setCheckedIds(new Set())}
            />
          )}
          <VoiceNoteList
            listRef={listRef}
            rows={list.rows}
            status={list.status}
            grouped={isChronological(filters.sort)}
            selectedId={selectedId}
            checkedIds={checkedIds}
            terms={terms}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            total={list.total}
            onLoadMore={() => void list.loadMore()}
            onActivate={activateRow}
            onCheck={checkRow}
            onRetry={retryRow}
          />
        </section>

        {!isMobile && (
          <section className="hidden min-h-0 min-w-0 flex-1 flex-col md:flex">
            {selectedId ? (
              renderDetail(selectedId)
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                —
              </div>
            )}
          </section>
        )}
      </div>

      {isMobile && (
        <Sheet
          open={Boolean(selectedId)}
          onOpenChange={(open) => {
            if (!open) select(null);
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-full gap-0 p-0 sm:max-w-none"
          >
            <SheetTitle className="sr-only">
              {selectedSummary?.title ?? "Voice note"}
            </SheetTitle>
            {selectedId && renderDetail(selectedId, () => select(null))}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

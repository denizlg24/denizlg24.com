"use client";

import type {
  IVoiceNote,
  IVoiceNoteSummary,
  VoiceNoteFacetsResponse,
  VoiceNotesResponse,
} from "@repo/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import { PENDING_STATUSES } from "./voice-note-filters";

const PAGE_SIZE = 100;
const POLL_INTERVAL_MS = 5_000;

export const VOICE_NOTES_CHANGED = "voice-notes:changed";

export function announceVoiceNotesChanged() {
  window.dispatchEvent(new CustomEvent(VOICE_NOTES_CHANGED));
}

export function isPending(voiceNote: Pick<IVoiceNoteSummary, "transcription">) {
  return PENDING_STATUSES.has(voiceNote.transcription.status);
}

/**
 * Drops the transcript body a full note carries so list state stays summary
 * sized, and keeps the downsampled waveform and search match, which only a
 * list response has.
 */
export function toSummary(
  voiceNote: IVoiceNote,
  previous?: IVoiceNoteSummary,
): IVoiceNoteSummary {
  const { filename, linkedNotes, transcription, ...rest } = voiceNote;
  const { text, segments, ...state } = transcription;
  return {
    ...rest,
    transcription: state,
    waveform: previous?.waveform ?? rest.waveform,
    match: previous?.match,
  };
}

interface ListState {
  /** The query these rows answer; a different one means start over. */
  queryString: string | null;
  rows: IVoiceNoteSummary[];
  total: number;
  totalDurationMs: number;
  status: "loading" | "ready" | "error";
}

export function useVoiceNoteList(api: denizApi, queryString: string) {
  const [state, setState] = useState<ListState>({
    queryString: null,
    rows: [],
    total: 0,
    totalDurationMs: 0,
    status: "loading",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sequenceRef = useRef(0);

  const fetchPage = useCallback(
    (offset: number) => {
      const params = new URLSearchParams(queryString);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return api.GET<VoiceNotesResponse>({
        endpoint: `voice-notes?${params.toString()}`,
      });
    },
    [api, queryString],
  );

  /**
   * Re-reads the first page. For the same query, rows past it (loaded by
   * "more") are kept unless the fresh page now holds them. Newest request
   * wins, so a slow response for a filter already changed is discarded.
   */
  const refresh = useCallback(async () => {
    const request = ++sequenceRef.current;
    setRefreshing(true);
    const result = await fetchPage(0);
    if (request !== sequenceRef.current) return;
    setRefreshing(false);
    if ("code" in result) {
      toast.error(result.message);
      setState((current) =>
        current.status === "loading"
          ? { ...current, status: "error" }
          : current,
      );
      return;
    }
    setState((current) => {
      const freshIds = new Set(result.voiceNotes.map((row) => row._id));
      const tail =
        current.queryString === queryString
          ? current.rows
              .slice(PAGE_SIZE)
              .filter((row) => !freshIds.has(row._id))
          : [];
      return {
        queryString,
        rows: [...result.voiceNotes, ...tail],
        total: result.total,
        totalDurationMs: result.totalDurationMs,
        status: "ready",
      };
    });
  }, [fetchPage, queryString]);

  const loadMore = useCallback(async () => {
    const request = sequenceRef.current;
    setLoadingMore(true);
    const result = await fetchPage(state.rows.length);
    setLoadingMore(false);
    if (request !== sequenceRef.current) return;
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setState((current) => {
      const known = new Set(current.rows.map((row) => row._id));
      return {
        ...current,
        rows: [
          ...current.rows,
          ...result.voiceNotes.filter((row) => !known.has(row._id)),
        ],
        total: result.total,
        totalDurationMs: result.totalDurationMs,
      };
    });
  }, [fetchPage, state.rows.length]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleChanged = () => void refresh();
    window.addEventListener(VOICE_NOTES_CHANGED, handleChanged);
    return () => window.removeEventListener(VOICE_NOTES_CHANGED, handleChanged);
  }, [refresh]);

  const hasPending = state.rows.some(isPending);
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasPending, refresh]);

  const updateRow = useCallback((voiceNote: IVoiceNote) => {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row._id === voiceNote._id ? toSummary(voiceNote, row) : row,
      ),
    }));
  }, []);

  const removeRows = useCallback((ids: ReadonlySet<string>) => {
    setState((current) => {
      const removed = current.rows.filter((row) => ids.has(row._id));
      if (removed.length === 0) return current;
      const removedMs = removed.reduce(
        (sum, row) => sum + (row.durationMs ?? 0),
        0,
      );
      return {
        ...current,
        rows: current.rows.filter((row) => !ids.has(row._id)),
        total: Math.max(0, current.total - removed.length),
        totalDurationMs: Math.max(0, current.totalDurationMs - removedMs),
      };
    });
  }, []);

  return {
    rows: state.rows,
    total: state.total,
    totalDurationMs: state.totalDurationMs,
    status: state.status,
    refreshing,
    loadingMore,
    hasMore: state.status === "ready" && state.rows.length < state.total,
    refresh,
    loadMore,
    updateRow,
    removeRows,
  };
}

export function useVoiceNoteFacets(api: denizApi) {
  const [facets, setFacets] = useState<VoiceNoteFacetsResponse | null>(null);

  const load = useCallback(async () => {
    const result = await api.GET<VoiceNoteFacetsResponse>({
      endpoint: "voice-notes/facets",
    });
    if (!("code" in result)) setFacets(result);
  }, [api]);

  useEffect(() => {
    void load();
    const handleChanged = () => void load();
    window.addEventListener(VOICE_NOTES_CHANGED, handleChanged);
    return () => window.removeEventListener(VOICE_NOTES_CHANGED, handleChanged);
  }, [load]);

  return { facets, reload: load };
}

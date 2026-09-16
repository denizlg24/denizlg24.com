import {
  type VoiceNoteListQuery,
  type VoiceNoteSort,
  type VoiceNoteSource,
  type VoiceNoteTranscriptionStatus,
  voiceNoteSortSchema,
} from "@repo/schemas";
import { isoToDate } from "@repo/ui/date-picker";

export type LinkedFilter = "all" | "linked" | "unlinked";

export type ContextFilter =
  | { mode: "all" }
  | { mode: "any" }
  | { mode: "none" }
  | { mode: "ids"; ids: string[] };

export interface VoiceNoteFilters {
  statuses: VoiceNoteTranscriptionStatus[];
  sources: VoiceNoteSource[];
  tags: string[];
  groupIds: string[];
  context: ContextFilter;
  linked: LinkedFilter;
  /** Local calendar days, `yyyy-MM-dd`, both inclusive. */
  from?: string;
  to?: string;
  sort: VoiceNoteSort;
}

export const DEFAULT_FILTERS: VoiceNoteFilters = {
  statuses: [],
  sources: [],
  tags: [],
  groupIds: [],
  context: { mode: "all" },
  linked: "all",
  sort: "newest",
};

export const STATUS_OPTIONS: VoiceNoteTranscriptionStatus[] = [
  "failed",
  "queued",
  "transcribing",
  "untranscribed",
  "transcribed",
];

export const SOURCE_OPTIONS: VoiceNoteSource[] = [
  "recording",
  "upload",
  "agent",
];

export const SORT_OPTIONS = voiceNoteSortSchema.options;

export const SORT_LABELS: Record<VoiceNoteSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  longest: "Longest",
  shortest: "Shortest",
};

export const PENDING_STATUSES: ReadonlySet<VoiceNoteTranscriptionStatus> =
  new Set(["queued", "transcribing"]);

export function isChronological(sort: VoiceNoteSort) {
  return sort === "newest" || sort === "oldest";
}

export function hasActiveFilters(filters: VoiceNoteFilters) {
  return (
    filters.statuses.length > 0 ||
    filters.sources.length > 0 ||
    filters.tags.length > 0 ||
    filters.groupIds.length > 0 ||
    filters.context.mode !== "all" ||
    filters.linked !== "all" ||
    Boolean(filters.from) ||
    Boolean(filters.to)
  );
}

function startOfDayIso(day: string) {
  return isoToDate(day)?.toISOString();
}

function endOfDayIso(day: string) {
  const date = isoToDate(day);
  if (!date) return undefined;
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function nonEmpty<T>(values: T[]) {
  return values.length > 0 ? values : undefined;
}

export function toListQuery(
  filters: VoiceNoteFilters,
  q: string,
): VoiceNoteListQuery {
  const { context } = filters;
  return {
    q: q || undefined,
    status: nonEmpty(filters.statuses),
    source: nonEmpty(filters.sources),
    tag: nonEmpty(filters.tags),
    groupId: nonEmpty(filters.groupIds),
    contextId: context.mode === "ids" ? nonEmpty(context.ids) : undefined,
    context:
      context.mode === "any" || context.mode === "none"
        ? context.mode
        : undefined,
    linked: filters.linked === "all" ? undefined : filters.linked === "linked",
    from: filters.from ? startOfDayIso(filters.from) : undefined,
    to: filters.to ? endOfDayIso(filters.to) : undefined,
    sort: filters.sort,
  };
}

/** Array filters are repeated params: `status=failed&status=queued`. */
export function serializeListQuery(query: VoiceNoteListQuery) {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value !== undefined) params.set(key, String(value));
  };
  const append = (key: string, values: readonly string[] | undefined) => {
    for (const value of values ?? []) params.append(key, value);
  };

  set("q", query.q);
  append("status", query.status);
  append("source", query.source);
  append("tag", query.tag);
  append("groupId", query.groupId);
  append("contextId", query.contextId);
  set("context", query.context);
  set("linked", query.linked);
  set("from", query.from);
  set("to", query.to);
  set("sort", query.sort);
  set("limit", query.limit);
  set("offset", query.offset);
  return params;
}

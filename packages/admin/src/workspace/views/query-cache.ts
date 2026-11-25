import type { ViewQueryResult, ViewRow } from "@repo/schemas";
import { valueKeys } from "@repo/utils/workspace-views";

export type ViewQueryState = {
  result: ViewQueryResult | null;
  rows: ViewRow[];
  error: string | null;
  loading: boolean;
};

export type ViewQueryEntry = {
  state: ViewQueryState;
  /** Unfiltered server result; `rows` is the accumulated page set. */
  result: ViewQueryResult | null;
  rows: ViewRow[];
  at: number;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
  hiddenRows: Set<string>;
  groupField: string | null;
  error: string | null;
  loading: boolean;
};

const FRESH_MS = 30_000;
const cache = new Map<string, ViewQueryEntry>();

export function getViewQueryEntry(key: string, groupField: string | null) {
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      state: { result: null, rows: [], error: null, loading: true },
      result: null,
      rows: [],
      at: 0,
      inflight: null,
      listeners: new Set(),
      hiddenRows: new Set(),
      groupField,
      error: null,
      loading: true,
    };
    cache.set(key, entry);
  }
  return entry;
}

export function subscribeViewQuery(
  entry: ViewQueryEntry,
  listener: () => void,
) {
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

function publish(entry: ViewQueryEntry) {
  const hidden = entry.rows.filter((row) => entry.hiddenRows.has(row.id));
  const rows = entry.rows.filter((row) => !entry.hiddenRows.has(row.id));
  let groups = entry.result?.groups;
  const groupField = entry.groupField;
  if (groups && groupField && hidden.length > 0) {
    const removedByGroup = new Map<string, number>();
    for (const row of hidden) {
      const values = valueKeys(row.values[groupField]);
      for (const key of values.length > 0 ? values : [""]) {
        removedByGroup.set(key, (removedByGroup.get(key) ?? 0) + 1);
      }
    }
    groups = groups.map((group) => ({
      ...group,
      count: Math.max(0, group.count - (removedByGroup.get(group.key) ?? 0)),
    }));
  }
  const result = entry.result
    ? {
        ...entry.result,
        rows,
        total: Math.max(0, entry.result.total - hidden.length),
        ...(groups ? { groups } : {}),
      }
    : null;
  entry.state = {
    result,
    rows,
    error: entry.error,
    loading: entry.loading,
  };
  for (const listener of entry.listeners) listener();
}

export function viewQueryIsFresh(entry: ViewQueryEntry) {
  return entry.result !== null && Date.now() - entry.at < FRESH_MS;
}

export function setViewQueryLoading(entry: ViewQueryEntry, loading: boolean) {
  entry.loading = loading;
  entry.error = null;
  publish(entry);
}

export function setViewQueryResult(
  entry: ViewQueryEntry,
  result: ViewQueryResult,
  append = false,
) {
  if (append && entry.result) {
    entry.rows = [...entry.rows, ...result.rows];
    entry.result = { ...entry.result, nextCursor: result.nextCursor };
  } else {
    entry.result = result;
    entry.rows = result.rows;
    // Once the server confirms a hidden row is gone from the result, the
    // optimistic overlay is no longer needed.
    const present = new Set(result.rows.map((row) => row.id));
    for (const id of entry.hiddenRows) {
      if (!present.has(id)) entry.hiddenRows.delete(id);
    }
  }
  entry.at = Date.now();
  entry.error = null;
  entry.loading = false;
  publish(entry);
}

export function setViewQueryError(entry: ViewQueryEntry, error: unknown) {
  entry.loading = false;
  // Keep cached rows silently visible on a background refresh failure.
  if (entry.result) {
    entry.error = null;
  } else if (error instanceof Error) {
    entry.error = error.message;
  } else {
    entry.error = "Failed to load view";
  }
  publish(entry);
}

/** Hide a row instantly; return a rollback for a refused mutation. */
export function optimisticallyRemoveViewRow(
  entry: ViewQueryEntry,
  rowId: string,
) {
  const alreadyHidden = entry.hiddenRows.has(rowId);
  entry.hiddenRows.add(rowId);
  publish(entry);
  return () => {
    if (!alreadyHidden) {
      entry.hiddenRows.delete(rowId);
      publish(entry);
    }
  };
}

export function clearViewQueryCache() {
  cache.clear();
}

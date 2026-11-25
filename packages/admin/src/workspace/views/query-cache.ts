import type { ViewQueryResult, ViewRow } from "@repo/schemas";
import { valueKeys } from "@repo/utils/workspace-views";

export type ViewQueryState = {
  result: ViewQueryResult | null;
  rows: ViewRow[];
  error: string | null;
  loading: boolean;
};

export type OptimisticRemoval = {
  commit: () => void;
  rollback: () => void;
};

export type ViewQueryEntry = {
  state: ViewQueryState;
  /** Unfiltered server result; `rows` is the accumulated page set. */
  result: ViewQueryResult | null;
  rows: ViewRow[];
  at: number;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
  hiddenRows: Map<string, ViewRow>;
  pendingRows: Set<string>;
  groupField: string | null;
  error: string | null;
  loading: boolean;
};

const FRESH_MS = 30_000;
let cache = new WeakMap<object, Map<string, ViewQueryEntry>>();

export function getViewQueryEntry(
  session: object,
  key: string,
  groupField: string | null,
) {
  let scoped = cache.get(session);
  if (!scoped) {
    scoped = new Map();
    cache.set(session, scoped);
  }
  let entry = scoped.get(key);
  if (!entry) {
    entry = {
      state: { result: null, rows: [], error: null, loading: true },
      result: null,
      rows: [],
      at: 0,
      inflight: null,
      listeners: new Set(),
      hiddenRows: new Map(),
      pendingRows: new Set(),
      groupField,
      error: null,
      loading: true,
    };
    scoped.set(key, entry);
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
  const loadedIds = new Set(entry.rows.map((row) => row.id));
  const hidden = [...entry.hiddenRows.values()].filter(
    (row) => entry.pendingRows.has(row.id) || loadedIds.has(row.id),
  );
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

function reconcileHiddenRows(entry: ViewQueryEntry, complete: boolean) {
  const present = new Map(entry.rows.map((row) => [row.id, row]));
  for (const [id, row] of entry.hiddenRows) {
    if (entry.pendingRows.has(id)) continue;
    const current = present.get(id);
    // A settled row returned by the server still matches this view; display
    // the server's updated version. If a complete result omits it, it is gone.
    if (current) {
      entry.hiddenRows.delete(id);
      continue;
    }
    if (complete) entry.hiddenRows.delete(id);
    else if (!entry.rows.some((item) => item.id === id)) {
      // Keep the original row as a hidden placeholder until the remaining
      // pages are read; an offset-based page replacement is not authoritative.
      entry.hiddenRows.set(id, row);
    }
  }
}

export function setViewQueryResult(
  entry: ViewQueryEntry,
  result: ViewQueryResult,
  append = false,
) {
  if (append && entry.result) {
    const seen = new Set(entry.rows.map((row) => row.id));
    entry.rows = [
      ...entry.rows,
      ...result.rows.filter((row) => !seen.has(row.id)),
    ];
    entry.result = { ...entry.result, nextCursor: result.nextCursor };
    reconcileHiddenRows(entry, result.nextCursor === null);
  } else {
    entry.result = result;
    entry.rows = result.rows;
    reconcileHiddenRows(entry, result.nextCursor === null);
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

/** Hide a row instantly; commit it after a write or restore it on failure. */
export function optimisticallyRemoveViewRow(
  entry: ViewQueryEntry,
  row: ViewRow,
): OptimisticRemoval | null {
  if (entry.pendingRows.has(row.id)) return null;
  const previous = entry.hiddenRows.get(row.id);
  entry.hiddenRows.set(row.id, row);
  entry.pendingRows.add(row.id);
  publish(entry);
  return {
    commit: () => {
      entry.pendingRows.delete(row.id);
      publish(entry);
    },
    rollback: () => {
      entry.pendingRows.delete(row.id);
      if (previous) entry.hiddenRows.set(row.id, previous);
      else entry.hiddenRows.delete(row.id);
      // A page replacement may have omitted this row while the request ran.
      if (!entry.rows.some((item) => item.id === row.id)) {
        entry.rows = [...entry.rows, row];
      }
      publish(entry);
    },
  };
}

export function clearViewQueryCache() {
  cache = new WeakMap();
}

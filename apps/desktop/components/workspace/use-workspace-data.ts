"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { type ApiError, type AuthError, denizApi } from "@/lib/api-wrapper";
import {
  dashboardStatsSchema,
  dashboardTodaySchema,
  financeBudgetAlertSchema,
  semesterOverviewSchema,
  upcomingKanbanResultSchema,
} from "@/lib/data-types";

/** Data is reused across blocks and pages for this long before a refetch. */
const FRESH_MS = 60_000;

type Loaded<T> = T | AuthError | ApiError;

type Source<T> = {
  load: () => Promise<Loaded<T>>;
  data: T | null;
  error: string | null;
  at: number;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
};

function source<T>(load: () => Promise<Loaded<T>>): Source<T> {
  return {
    load,
    data: null,
    error: null,
    at: 0,
    inflight: null,
    listeners: new Set(),
  };
}

function isFailure<T extends object>(
  result: Loaded<T>,
): result is AuthError | ApiError {
  return (
    "code" in result && "message" in result && typeof result.code === "number"
  );
}

function refresh<T extends object>(
  src: Source<T>,
  force = false,
): Promise<void> {
  if (src.inflight) return src.inflight;
  if (!force && src.data !== null && Date.now() - src.at < FRESH_MS) {
    return Promise.resolve();
  }
  src.inflight = src
    .load()
    .then((result) => {
      if (isFailure(result)) {
        src.error = result.message;
      } else {
        src.data = result;
        src.error = null;
        src.at = Date.now();
      }
    })
    .catch((error: Error) => {
      src.error = error.message;
    })
    .finally(() => {
      src.inflight = null;
      for (const listener of src.listeners) listener();
    });
  return src.inflight;
}

/**
 * One API source shared by every block that shows it: the first block to
 * mount fetches, the rest subscribe. Stale data shows while a refetch runs.
 */
function useSource<T extends object>(src: Source<T>) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    src.listeners.add(listener);
    void refresh(src);
    const onFocus = () => void refresh(src);
    window.addEventListener("focus", onFocus);
    return () => {
      src.listeners.delete(listener);
      window.removeEventListener("focus", onFocus);
    };
  }, [src]);

  const reload = useCallback(() => refresh(src, true), [src]);

  return {
    data: src.data,
    error: src.data === null ? src.error : null,
    loading: src.data === null && src.error === null,
    reload,
  };
}

const api = new denizApi();

const unwrap =
  <T, K extends string>(key: K) =>
  (result: Loaded<Record<K, T>>): Loaded<T> =>
    "code" in result && "message" in result ? result : result[key];

const stats = source(() =>
  api.GET({ endpoint: "dashboard/stats", schema: dashboardStatsSchema }),
);
const today = source(() =>
  api.GET({ endpoint: "dashboard/today", schema: dashboardTodaySchema }),
);
const upcoming = source(() =>
  api.GET({
    endpoint: "kanban/upcoming?days=7",
    schema: upcomingKanbanResultSchema,
  }),
);
const semester = source(() =>
  api
    .GET({
      endpoint: "courses/overview",
      schema: z.object({ overview: semesterOverviewSchema }),
    })
    .then(unwrap("overview")),
);
const alerts = source(() =>
  api
    .GET({
      endpoint: "finance/budget/alerts?status=open",
      schema: z.object({ alerts: z.array(financeBudgetAlertSchema) }),
    })
    .then(unwrap("alerts")),
);

export const useDashboardStats = () => useSource(stats);
export const useDashboardToday = () => useSource(today);
export const useUpcomingTasks = () => useSource(upcoming);
export const useSemesterOverview = () => useSource(semester);
export const useBudgetAlerts = () => useSource(alerts);

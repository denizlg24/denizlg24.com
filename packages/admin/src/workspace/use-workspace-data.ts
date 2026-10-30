"use client";

import {
  dashboardStatsSchema,
  dashboardTodaySchema,
  financeBudgetAlertSchema,
  semesterOverviewSchema,
  upcomingKanbanResultSchema,
} from "@repo/schemas";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { AdminClient } from "../client";
import { useAdmin } from "../provider";

/** Data is reused across blocks and pages for this long before a refetch. */
const FRESH_MS = 60_000;

type Source<T> = {
  load: (client: AdminClient) => Promise<T>;
  data: T | null;
  error: string | null;
  at: number;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
};

function source<T>(load: (client: AdminClient) => Promise<T>): Source<T> {
  return {
    load,
    data: null,
    error: null,
    at: 0,
    inflight: null,
    listeners: new Set(),
  };
}

function refresh<T>(
  src: Source<T>,
  client: AdminClient,
  force = false,
): Promise<void> {
  if (src.inflight) return src.inflight;
  if (!force && src.data !== null && Date.now() - src.at < FRESH_MS) {
    return Promise.resolve();
  }
  src.inflight = src
    .load(client)
    .then((data) => {
      src.data = data;
      src.error = null;
      src.at = Date.now();
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
function useSource<T>(src: Source<T>) {
  const { client } = useAdmin();
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    src.listeners.add(listener);
    void refresh(src, client);
    const onFocus = () => void refresh(src, client);
    window.addEventListener("focus", onFocus);
    return () => {
      src.listeners.delete(listener);
      window.removeEventListener("focus", onFocus);
    };
  }, [src, client]);

  const reload = useCallback(() => refresh(src, client, true), [src, client]);

  return {
    data: src.data,
    error: src.data === null ? src.error : null,
    loading: src.data === null && src.error === null,
    reload,
  };
}

const getParsed =
  <S extends z.ZodType>(endpoint: string, schema: S) =>
  async (client: AdminClient): Promise<z.output<S>> =>
    schema.parse(await client.get(endpoint));

const stats = source(getParsed("dashboard/stats", dashboardStatsSchema));
const today = source(getParsed("dashboard/today", dashboardTodaySchema));
const upcoming = source(
  getParsed("kanban/upcoming?days=7", upcomingKanbanResultSchema),
);
const semester = source(async (client) => {
  const { overview } = await getParsed(
    "courses/overview",
    z.object({ overview: semesterOverviewSchema }),
  )(client);
  return overview;
});
const alerts = source(async (client) => {
  const result = await getParsed(
    "finance/budget/alerts?status=open",
    z.object({ alerts: z.array(financeBudgetAlertSchema) }),
  )(client);
  return result.alerts;
});

export const useDashboardStats = () => useSource(stats);
export const useDashboardToday = () => useSource(today);
export const useUpcomingTasks = () => useSource(upcoming);
export const useSemesterOverview = () => useSource(semester);
export const useBudgetAlerts = () => useSource(alerts);

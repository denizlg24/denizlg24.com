import type {
  MacrosCalorieSummaryResponse,
  MacrosDailyCalorieSummary,
  MacrosDashboard,
  MacrosDashboardResponse,
} from "@repo/schemas/macros";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "./keys";
import {
  fetchStamped,
  usePendingLogs,
  withPendingDashboard,
  withPendingSummary,
} from "./pending-logs";

export function fetchDashboard(signal?: AbortSignal) {
  return fetchStamped(() =>
    api<MacrosDashboardResponse>("/api/app/dashboard", { signal }).then(
      (body) => body.dashboard,
    ),
  );
}

/**
 * The server decides "today" from the profile's timezone; `day` only keys the
 * cache so yesterday's dashboard is never shown as today's after midnight.
 */
export function useDashboard(day: string) {
  const pending = usePendingLogs();
  return useQuery({
    queryKey: queryKeys.dashboard(day),
    queryFn: ({ signal }) => fetchDashboard(signal),
    select: useCallback(
      (dashboard: MacrosDashboard) => withPendingDashboard(dashboard, pending),
      [pending],
    ),
  });
}

export function useCalorieSummary(day: string) {
  const pending = usePendingLogs();
  return useQuery({
    queryKey: queryKeys.calorieSummary(day),
    queryFn: ({ signal }) =>
      fetchStamped(() =>
        api<MacrosCalorieSummaryResponse>("/api/app/calorie-summary", {
          signal,
        }).then((body) => body.calorieSummary),
      ),
    select: useCallback(
      (summary: MacrosDailyCalorieSummary) =>
        withPendingSummary(summary, pending),
      [pending],
    ),
  });
}

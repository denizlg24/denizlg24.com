import type {
  MacrosCalorieSummaryResponse,
  MacrosDashboardResponse,
} from "@repo/schemas/macros";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "./keys";

export function fetchDashboard(signal?: AbortSignal) {
  return api<MacrosDashboardResponse>("/api/app/dashboard", { signal }).then(
    (body) => body.dashboard,
  );
}

/**
 * The server decides "today" from the profile's timezone; `day` only keys the
 * cache so yesterday's dashboard is never shown as today's after midnight.
 */
export function useDashboard(day: string) {
  return useQuery({
    queryKey: queryKeys.dashboard(day),
    queryFn: ({ signal }) => fetchDashboard(signal),
  });
}

export function useCalorieSummary(day: string) {
  return useQuery({
    queryKey: queryKeys.calorieSummary(day),
    queryFn: ({ signal }) =>
      api<MacrosCalorieSummaryResponse>("/api/app/calorie-summary", {
        signal,
      }).then((body) => body.calorieSummary),
  });
}

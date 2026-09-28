import type {
  MacrosStatistics,
  MacrosStatisticsPeriod,
  MacrosStatisticsResponse,
} from "@repo/schemas/macros";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, apiText } from "@/lib/api";
import { queryKeys } from "./keys";

export type StatisticsExportFormat = "csv" | "json";

export const statisticsKeys = {
  period: (period: MacrosStatisticsPeriod) =>
    [...queryKeys.statistics, period] as const,
};

/** The previous period stays on screen while the next one loads, so switching never blanks the charts. */
export function useStatistics(period: MacrosStatisticsPeriod) {
  return useQuery({
    queryKey: statisticsKeys.period(period),
    queryFn: ({ signal }): Promise<MacrosStatistics> =>
      api<MacrosStatisticsResponse>("/api/statistics", {
        query: { period },
        signal,
      }).then((body) => body.statistics),
    placeholderData: keepPreviousData,
  });
}

/** The raw export body: CSV text, or the statistics object as JSON text. */
export function fetchStatisticsExport(
  period: MacrosStatisticsPeriod,
  format: StatisticsExportFormat,
) {
  return apiText("/api/statistics/export", { query: { period, format } });
}

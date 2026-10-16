import type { LocationCurrent, LocationVisitsResponse } from "@repo/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useCurrentLocation() {
  return useQuery({
    queryKey: ["location", "current"],
    queryFn: () => api.request<LocationCurrent>("location"),
    refetchInterval: 30_000,
  });
}

/** Visits since local midnight. */
export function useTodayVisits() {
  return useQuery({
    queryKey: ["location", "visits", "today"],
    queryFn: () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      return api.request<LocationVisitsResponse>("location/visits", {
        query: { from: from.toISOString(), to: new Date().toISOString() },
      });
    },
    refetchInterval: 60_000,
  });
}

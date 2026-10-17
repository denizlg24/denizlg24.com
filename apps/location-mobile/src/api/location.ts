import type { LocationExplored, LocationVisitsResponse } from "@repo/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Every street walked, simplified on the server: the desktop's explored map. */
export function useExplored() {
  return useQuery({
    queryKey: ["location", "explored"],
    queryFn: () => api.request<LocationExplored>("location/explored"),
    staleTime: 5 * 60_000,
  });
}

/** Arrivals since local midnight, with the server's verdict on each. */
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

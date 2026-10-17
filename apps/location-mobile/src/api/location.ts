import type { LocationExplored } from "@repo/schemas";
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

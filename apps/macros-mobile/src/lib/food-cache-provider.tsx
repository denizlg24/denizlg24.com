import {
  MACROS_CACHE_VERSIONS,
  type MacrosCacheVersions,
  macrosCacheVersionsSchema,
} from "@repo/schemas/macros";
import {
  useIsRestoring,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { buildUrl } from "./api";
import { revalidateFoodCaches } from "./food-cache";

const FoodCacheVersions = createContext<MacrosCacheVersions>(
  MACROS_CACHE_VERSIONS,
);

/** Last known server policy works offline; a failed check never clears data. */
export function FoodCacheProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const policy = useQuery({
    queryKey: ["cache-versions", "server"],
    queryFn: async ({ signal }) => {
      const response = await fetch(buildUrl("/api/cache-versions"), {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Cache policy unavailable");
      return macrosCacheVersionsSchema.parse(await response.json());
    },
    enabled: !restoring,
    networkMode: "online",
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const versions = policy.data ?? MACROS_CACHE_VERSIONS;

  useEffect(() => {
    if (!restoring) void revalidateFoodCaches(client, versions);
  }, [client, restoring, versions]);

  return (
    <FoodCacheVersions.Provider value={versions}>
      {children}
    </FoodCacheVersions.Provider>
  );
}

export function useFoodCacheVersions() {
  return useContext(FoodCacheVersions);
}

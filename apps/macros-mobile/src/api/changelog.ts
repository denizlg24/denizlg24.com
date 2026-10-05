import type { ChangelogResponse } from "@repo/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Served from the site, so it lists releases newer than this build too. */
export function useChangelog() {
  return useQuery({
    queryKey: ["changelog"],
    queryFn: ({ signal }) =>
      api<ChangelogResponse>("/api/changelog", { signal }).then(
        (body) => body.releases,
      ),
    staleTime: 60 * 60_000,
  });
}

"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { ForgeContainer } from "@repo/schemas/cloud";
import { useMemo } from "react";
import { api } from "@/lib/api";

/**
 * The containers the host is currently running for one project.
 *
 * Read off the agent snapshot rather than from `deployments`, because a row can
 * be `ready` while its container is gone — the snapshot is what is actually
 * running, which is the only useful basis for "whose logs am I reading".
 *
 * Production first, so the default selection is the one serving the hostname.
 */
export function useProjectContainers(projectSlug: string): {
  containers: ForgeContainer[];
  live: ForgeContainer | null;
  loading: boolean;
} {
  const { data, loading } = usePoll(api.forge.overview, 30_000);
  const containers = useMemo(() => {
    const matched = (data?.agent?.containers ?? []).filter(
      (container) => container.projectSlug === projectSlug,
    );
    return matched.sort((left, right) => {
      if (left.kind === right.kind) {
        return right.createdAt.localeCompare(left.createdAt);
      }
      return left.kind === "production" ? -1 : 1;
    });
  }, [data, projectSlug]);

  return { containers, live: containers[0] ?? null, loading };
}

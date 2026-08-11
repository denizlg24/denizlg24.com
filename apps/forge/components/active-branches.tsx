"use client";

import { deploymentLabel, deploymentTone } from "@repo/cloud-ui/deploy-status";
import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";

const POLL_MS = 30_000;

/**
 * The branches this project has previews for, latest deployment each.
 *
 * Derived from deployments rather than the git remote: a branch nobody deployed
 * has nothing here, and one deleted upstream still has a container worth
 * finding. Production is not in this list — the overview names it above.
 */
export function ActiveBranches({ targetId }: { targetId: string }) {
  const fetchBranches = useCallback(
    () => api.deploy.branches(targetId, { limit: 12 }),
    [targetId],
  );
  const { data, error, loading } = usePoll(fetchBranches, POLL_MS);

  if (error) return null;
  if (!data && loading) return <Skeleton className="h-24 w-full" />;

  const branches = data ?? [];
  if (branches.length === 0) return null;

  return (
    <Section title="active branches" count={branches.length}>
      <ul className="divide-y">
        {branches.map((branch) => (
          <li
            key={branch.gitRef}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
          >
            <StatusDot
              tone={deploymentTone(branch.latest.status)}
              label={branch.latest.status}
            />
            <Link
              href={`/deployments/${branch.latest.id}`}
              className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
            >
              {branch.gitRef}
            </Link>
            {branch.prNumber === null ? null : (
              <span className="font-mono text-[11px] text-muted-foreground">
                #{branch.prNumber}
              </span>
            )}
            {/* Every row here is a preview, so a kind badge would say the same
                thing on all of them. The status is what varies. */}
            <span className="text-[11px] text-muted-foreground">
              {deploymentLabel(branch.latest.status, branch.latest.phase)}
            </span>
            <a
              className="text-muted-foreground hover:text-foreground"
              href={`https://${branch.latest.hostname}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open ${branch.gitRef}`}
            >
              <ExternalLink className="size-3" />
            </a>
            <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatRelative(branch.latest.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

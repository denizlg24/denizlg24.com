"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { projectServiceHref } from "@/lib/project-routes";
import {
  DeploymentRows,
  ProductionSummary,
} from "./_components/deployment-rows";
import { useTarget } from "./_components/target-context";

const POLL_MS = 5_000;
const RECENT = 6;

export default function DeployTargetOverviewPage() {
  const { target } = useTarget();
  const fetchDeployments = useCallback(
    () => api.deploy.deployments(target.id, { limit: 25 }),
    [target.id],
  );
  const { data, error, loading } = usePoll(fetchDeployments, POLL_MS);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-48 w-full" />;

  const rows = data?.items ?? [];
  // The live one, not merely the newest: a failed build after a good one
  // leaves the previous container serving, and that is what the hostname
  // resolves to.
  const production =
    rows.find((row) => row.kind === "production" && row.status === "ready") ??
    null;

  return (
    <div className="flex flex-col gap-8">
      <Section title="Production">
        <ProductionSummary
          deployment={production}
          projectId={target.projectId}
          targetId={target.id}
        />
      </Section>
      <Section
        title="Recent deployments"
        actions={
          rows.length > RECENT && (
            <Link
              href={projectServiceHref(
                target.projectId,
                target.id,
                "deployments",
              )}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              All {data?.pagination.total ?? rows.length}
            </Link>
          )
        }
      >
        <DeploymentRows
          deployments={rows.slice(0, RECENT)}
          projectId={target.projectId}
          targetId={target.id}
        />
      </Section>
    </div>
  );
}

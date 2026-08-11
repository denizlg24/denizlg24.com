"use client";

import {
  DeploymentRows,
  ProductionSummary,
} from "@repo/cloud-ui/deploy/deployment-rows";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import Link from "next/link";
import { useCallback } from "react";
import { ActiveBranches } from "@/components/active-branches";
import { LiveStrip } from "@/components/live-strip";
import { ProductionActions } from "@/components/production-actions";
import { projectHref, useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

const POLL_MS = 5_000;
const RECENT = 6;

/**
 * A deployment's detail page is one route for the whole box rather than one per
 * project — it is reachable from `/deployments` too, and duplicating it under
 * every project would mean two pages rendering the same build log.
 */
function deploymentHref(deployment: { id: string }): string {
  return `/deployments/${deployment.id}`;
}

export default function ProjectOverviewPage() {
  const { target } = useTarget();
  const fetchDeployments = useCallback(
    () => api.deploy.deployments(target.id, { limit: 25 }),
    [target.id],
  );
  const { data, error, loading, reload } = usePoll(fetchDeployments, POLL_MS);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-48 w-full" />;

  const rows = data?.items ?? [];
  // The live one, not merely the newest: a failed build after a good one
  // leaves the previous container serving, and that is what the hostname
  // resolves to.
  const ready = rows.filter(
    (row) => row.kind === "production" && row.status === "ready",
  );
  const production = ready[0] ?? null;
  // What a rollback goes back to. Absent on a project that has shipped once,
  // which is why the button is conditional rather than disabled.
  const previous = ready[1] ?? null;

  return (
    <div className="flex flex-col gap-8">
      <Section
        title={target.pausedAt ? "production · paused" : "production"}
        actions={
          <ProductionActions
            production={production}
            previous={previous}
            paused={target.pausedAt !== null}
            onDone={reload}
          />
        }
      >
        <ProductionSummary
          deployment={production}
          deploymentHref={deploymentHref}
        />
      </Section>
      <LiveStrip projectSlug={target.projectSlug} />
      <ActiveBranches targetId={target.id} />
      <Section
        title="recent deployments"
        actions={
          rows.length > RECENT && (
            <Link
              href={projectHref(target.projectSlug, "deployments")}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              All {data?.pagination.total ?? rows.length}
            </Link>
          )
        }
      >
        <DeploymentRows
          deployments={rows.slice(0, RECENT)}
          deploymentHref={deploymentHref}
        />
      </Section>
    </div>
  );
}

"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { ProjectCharts } from "@/components/project-charts";
import { RequestTable } from "@/components/request-table";
import { useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

/**
 * The resource and request history of one project across every deployment it
 * has had, plus the requests its live release is serving now.
 *
 * Container metrics are keyed per deployment, so a chart built from one key
 * restarts at the last deploy — the project route on the API aggregates them.
 */
export default function ProjectAnalyticsPage() {
  const { target } = useTarget();
  const { data } = usePoll(api.forge.overview, 30_000);

  const containers = (data?.agent?.containers ?? []).filter(
    (container) => container.projectSlug === target.projectSlug,
  );
  // The live production container is what the request list should follow; a
  // preview is a branch nobody is watching for traffic.
  const live =
    containers.find((container) => container.kind === "production") ??
    containers[0] ??
    null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectCharts projectSlug={target.projectSlug} />

      {live?.deploymentId ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            recent requests
          </h2>
          {/* The scroll belongs to the table inside, not to this box —
              scrolling here would carry the filter bar off the top. */}
          <div className="flex max-h-96 min-h-0 flex-col border-t pt-2">
            <RequestTable deploymentId={live.deploymentId} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

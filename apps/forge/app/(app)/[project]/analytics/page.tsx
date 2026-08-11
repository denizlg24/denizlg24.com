"use client";

import { useState } from "react";
import { ContainerSelect } from "@/components/container-select";
import { ProjectCharts } from "@/components/project-charts";
import { useProjectContainers } from "@/components/project-containers";
import { RequestTable } from "@/components/request-table";
import { useTarget } from "@/components/target-context";

/**
 * The resource and request history of one project, plus the requests its live
 * release is serving now.
 *
 * Container metrics are keyed per deployment, so the project route on the API
 * aggregates them — which is right for a history and wrong for one container.
 * The picker narrows to a single deployment; without it every chart shows the
 * mean of however many containers the project is running, and it does so
 * quietly, because the graph still renders.
 */
export default function ProjectAnalyticsPage() {
  const { target } = useTarget();
  const { containers, live } = useProjectContainers(target.projectSlug);
  const [containerId, setContainerId] = useState<string | null>(null);

  const selected =
    containers.find((container) => container.id === containerId) ?? null;
  // The request list follows the selected container, falling back to the live
  // production one — a preview is a branch nobody is watching for traffic.
  const requestSource = selected ?? live;

  return (
    <div className="flex flex-col gap-6">
      <ProjectCharts
        projectSlug={target.projectSlug}
        deploymentId={selected?.deploymentId ?? null}
        selector={
          containers.length > 1 ? (
            <ContainerSelect
              containers={containers}
              selected={containerId}
              onSelect={setContainerId}
              allLabel={`all ${containers.length} containers`}
            />
          ) : null
        }
      />

      {requestSource?.deploymentId ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            recent requests
          </h2>
          {/* The scroll belongs to the table inside, not to this box —
              scrolling here would carry the filter bar off the top. */}
          <div className="flex max-h-96 min-h-0 flex-col border-t pt-2">
            <RequestTable deploymentId={requestSource.deploymentId} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

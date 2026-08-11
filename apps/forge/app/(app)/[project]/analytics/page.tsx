"use client";

import { useState } from "react";
import { ContainerSelect } from "@/components/container-select";
import { ProjectCharts } from "@/components/project-charts";
import { useProjectContainers } from "@/components/project-containers";
import { useTarget } from "@/components/target-context";

/**
 * What one project's containers are consuming.
 *
 * Machine stats only — CPU, memory, network. Traffic lives on the logs page
 * with the requests it describes; this page used to carry both, which made it
 * the answer to two unrelated questions and a good answer to neither.
 *
 * Container metrics are keyed per deployment, so the project route on the API
 * aggregates them — which is right for a history and wrong for one container.
 * The picker narrows to a single deployment; without it every chart shows the
 * mean of however many containers the project is running, and it does so
 * quietly, because the graph still renders.
 */
export default function ProjectAnalyticsPage() {
  const { target } = useTarget();
  const { containers } = useProjectContainers(target.projectSlug);
  const [containerId, setContainerId] = useState<string | null>(null);

  const selected =
    containers.find((container) => container.id === containerId) ?? null;

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
    </div>
  );
}

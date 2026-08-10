"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { useMemo, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api";
import { ProjectCharts } from "../_components/project-charts";
import { groupByProject } from "../_components/project-groups";
import { RequestTable } from "../_components/request-table";

/**
 * Per-project observability: the resource and request history of one project
 * across every deployment it has had, plus the requests its live release is
 * serving now.
 *
 * Scoped to a project rather than a deployment because that is the unit anyone
 * actually asks about. Container metrics are keyed per deployment, so a chart
 * built from one key restarts at the last deploy — the project route on the API
 * aggregates them.
 */
export default function ProjectsPage() {
  const { data, error } = usePoll(api.forge.overview, 30_000);
  const [selected, setSelected] = useState<string | null>(null);

  const containers = data?.agent?.containers ?? [];
  const groups = useMemo(
    () =>
      groupByProject(containers, (container) => ({
        projectSlug: container.projectSlug,
        kind: container.kind,
      })).filter((group) => group.projectSlug !== "—"),
    [containers],
  );
  const project = selected ?? groups[0]?.projectSlug ?? null;
  const group = groups.find((entry) => entry.projectSlug === project);
  // The live production container is what the request list should follow; a
  // preview is a branch nobody is watching for traffic.
  const live = group?.production[0] ?? group?.previews[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="projects" detail="resource and request history" />
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {data ? (
        groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {groups.map((entry) => (
                <button
                  key={entry.projectSlug}
                  type="button"
                  aria-pressed={entry.projectSlug === project}
                  onClick={() => setSelected(entry.projectSlug)}
                  className={
                    entry.projectSlug === project
                      ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background transition-colors"
                      : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {entry.projectSlug}
                </button>
              ))}
            </div>

            {project ? <ProjectCharts projectSlug={project} /> : null}

            {live?.deploymentId ? (
              <section className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  recent requests
                </h2>
                <div className="max-h-96 overflow-auto border-t pt-2">
                  <RequestTable deploymentId={live.deploymentId} />
                </div>
              </section>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}

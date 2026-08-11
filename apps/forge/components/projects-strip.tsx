"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";

const RECENT = 5;
const POLL_MS = 30_000;

/**
 * Recents, usage and alerts across the whole box, above the projects grid.
 *
 * All three come off requests the page would make anyway — the deployments
 * feed, the capacity row and the agent snapshot — so this is a re-read of what
 * is already known rather than three new endpoints.
 */
export function ProjectsStrip() {
  const fetchRecent = useCallback(
    () => api.forge.deployments({ limit: RECENT }),
    [],
  );
  const { data: recent } = usePoll(fetchRecent, POLL_MS);
  const { data: capacity } = usePoll(api.deploy.capacity, POLL_MS);
  const { data: overview } = usePoll(api.forge.overview, POLL_MS);

  const containers = overview?.agent?.containers ?? [];
  // A container the daemon reports as unhealthy is the alert; `health` is null
  // for an image that declares no healthcheck, which is not a failure.
  const unhealthy = containers.filter(
    (container) => container.health !== null && container.health !== "healthy",
  );
  const failed = (recent?.deployments ?? []).filter(
    (deployment) => deployment.status === "failed",
  );

  return (
    <div className="grid gap-6 border-b pb-6 md:grid-cols-3">
      <section className="min-w-0">
        <Heading>recents</Heading>
        {!recent ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="mt-1 space-y-1">
            {recent.deployments.slice(0, RECENT).map((deployment) => (
              <li key={deployment.id} className="flex items-baseline gap-2">
                <Link
                  href={`/deployments/${deployment.id}`}
                  className="min-w-0 flex-1 truncate text-xs hover:underline"
                >
                  <span className="text-muted-foreground">
                    {deployment.projectSlug}
                  </span>{" "}
                  {deployment.gitMessage ?? deployment.gitSha.slice(0, 7)}
                </Link>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatRelative(deployment.createdAt)}
                </span>
              </li>
            ))}
            {recent.deployments.length === 0 ? <Dash /> : null}
          </ul>
        )}
      </section>

      <section className="min-w-0">
        <Heading>usage</Heading>
        {!capacity ? (
          <Skeleton className="h-16" />
        ) : (
          <dl className="mt-1 space-y-1 text-xs">
            <Row
              label="committed"
              value={`${capacity.committedMb} MB across ${capacity.targets}`}
            />
            {/* Null is "the agent did not answer", which is not zero — showing
                0 MB free would read as a full box. */}
            <Row
              label="available"
              value={
                capacity.availableMb === null
                  ? "unknown"
                  : `${capacity.availableMb} MB`
              }
            />
            <Row
              label="allocatable"
              value={
                capacity.allocatableMb === null
                  ? "unknown"
                  : `${capacity.allocatableMb} MB`
              }
            />
            <Row label="containers" value={String(containers.length)} />
          </dl>
        )}
      </section>

      <section className="min-w-0">
        <Heading>alerts</Heading>
        <ul className="mt-1 space-y-1">
          {/* The agent being unreachable is critical: nothing can deploy. An
              unhealthy container or a failed build is serious — the previous
              release is still serving in both cases. */}
          {overview?.errors.agent ? (
            <li className="flex items-baseline gap-2 text-xs">
              <StatusDot tone="critical" label="agent unreachable" />
              <span className="min-w-0 flex-1 truncate">
                agent: {overview.errors.agent}
              </span>
            </li>
          ) : null}
          {unhealthy.map((container) => (
            <li
              key={container.id}
              className="flex items-baseline gap-2 text-xs"
            >
              <StatusDot tone="serious" label="unhealthy" />
              <span className="min-w-0 flex-1 truncate">
                {container.projectSlug ?? container.name} · {container.health}
              </span>
            </li>
          ))}
          {failed.map((deployment) => (
            <li
              key={deployment.id}
              className="flex items-baseline gap-2 text-xs"
            >
              <StatusDot tone="serious" label="build failed" />
              <Link
                href={`/deployments/${deployment.id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {deployment.projectSlug} · build failed
              </Link>
            </li>
          ))}
          {!overview?.errors.agent &&
          unhealthy.length === 0 &&
          failed.length === 0 ? (
            <Dash />
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Dash() {
  return <li className="text-xs text-muted-foreground">—</li>;
}

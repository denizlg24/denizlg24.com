"use client";

import { deploymentLabel, deploymentTone } from "@repo/cloud-ui/deploy-status";
import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { DeployTargetListEntry, SafeProject } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { ArrowUpRight, GitBranch, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";
import {
  newProjectServiceHref,
  projectServiceHref,
} from "@/lib/project-routes";

function ServiceSummary({ target }: { target: DeployTargetListEntry }) {
  const latest = target.latestDeployment;
  const hostname = target.primaryHostname ?? latest?.hostname ?? null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2.5 text-xs">
      <Link
        href={projectServiceHref(target.projectId, target.id)}
        className="w-24 shrink-0 font-medium hover:underline"
      >
        {target.name}
      </Link>
      {latest ? (
        <>
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={deploymentTone(latest.status)}
              label={latest.status}
            />
            {deploymentLabel(latest.status, latest.phase)}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="size-3" />
            {latest.gitRef}
          </span>
          <span className="font-mono text-muted-foreground">
            {latest.gitSha.slice(0, 7)}
          </span>
          <span className="ml-auto text-muted-foreground tabular-nums">
            {formatRelative(latest.readyAt ?? latest.createdAt)}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">Waiting for first deploy</span>
      )}
      {hostname && (
        <a
          href={`https://${hostname}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${hostname}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  targets,
}: {
  project: SafeProject;
  targets: readonly DeployTargetListEntry[];
}) {
  const first = targets[0];

  return (
    <article className="flex flex-col rounded-lg border px-4 transition-colors hover:border-foreground/20">
      <div className="flex min-h-24 items-start gap-4 py-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${project.id}`}
            className="text-sm font-semibold hover:underline"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {project.slug}
          </p>
          <p className="mt-3 truncate text-xs text-muted-foreground">
            {first
              ? `${first.repoOwner}/${first.repoName}`
              : project.description || "No repository connected"}
          </p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatRelative(project.createdAt)}
        </span>
      </div>
      {targets.length > 0 ? (
        targets.map((target) => (
          <ServiceSummary key={target.id} target={target} />
        ))
      ) : (
        <div className="flex items-center justify-between border-t py-2.5 text-xs text-muted-foreground">
          <span>Not deployed</span>
          <Link
            href={newProjectServiceHref(project.id)}
            className="hover:text-foreground hover:underline"
          >
            Set up deployment
          </Link>
        </div>
      )}
    </article>
  );
}

export default function ProjectsPage() {
  const fetchProjects = useCallback(async () => {
    const [projects, targets] = await Promise.all([
      api.projects.list({ limit: 100 }),
      api.deploy.targets(),
    ]);
    return { projects, targets };
  }, []);
  const { data, error } = usePoll(fetchProjects, null);

  const targetsByProject = new Map<string, DeployTargetListEntry[]>();
  for (const target of data?.targets ?? []) {
    const targets = targetsByProject.get(target.projectId) ?? [];
    targets.push(target);
    targetsByProject.set(target.projectId, targets);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold leading-tight">Projects</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Import, deploy, and manage each application in one place.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/projects/new">
            <Plus className="size-3.5" />
            Add project
          </Link>
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36 w-full" />
          ))}
        </div>
      ) : data.projects.items.length > 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {data.projects.items.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              targets={targetsByProject.get(project.id) ?? []}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <p className="text-sm font-medium">Import your first project</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Connect a GitHub repository, review the detected build settings, and
            deploy it.
          </p>
          <Button asChild size="sm">
            <Link href="/projects/new">Import repository</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

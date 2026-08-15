"use client";

import type { Deployment } from "@repo/schemas/cloud";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
  DeploymentBadges,
  deploymentLabel,
  deploymentTone,
} from "../deploy-status";
import { formatRelative } from "../format";

/**
 * The two apps nest a deployment at different depths — Cloud under
 * `/projects/[id]/services/[serviceId]`, Forge under `/[project]` — so the link
 * is injected rather than built from ids the component would have to be handed
 * for no other reason.
 */
export type DeploymentHref = (deployment: Deployment) => string;

/**
 * One deployment as a row of hairline-separated text. Everything actionable
 * lives on the deployment's own page — a list that carries six buttons per row
 * spends its width on controls for the deployment you are not looking at.
 */
export function DeploymentRow({
  deployment,
  deploymentHref,
}: {
  deployment: Deployment;
  deploymentHref: DeploymentHref;
}) {
  return (
    <Link
      href={deploymentHref(deployment)}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b py-2.5 text-xs transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <span className="flex w-32 shrink-0 items-center gap-1.5">
        <StatusDot
          tone={deploymentTone(deployment.status)}
          label={deployment.status}
        />
        {deploymentLabel(deployment.status, deployment.phase)}
      </span>
      <span className="w-16 shrink-0 font-mono">
        {deployment.gitSha.slice(0, 7)}
      </span>
      {/* A commit message is the one field with no bound — a squash carries
          every message it swallowed. One line, and the rest on hover. */}
      <span
        className="min-w-0 flex-1 truncate"
        title={deployment.gitMessage ?? deployment.gitRef}
      >
        {deployment.gitMessage?.split("\n")[0] ?? deployment.gitRef}
      </span>
      <DeploymentBadges
        kind={deployment.kind}
        status={deployment.status}
        className="w-36 shrink-0 justify-start"
      />
      <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
        {formatRelative(deployment.createdAt)}
      </span>
    </Link>
  );
}

export function DeploymentRows({
  deployments,
  deploymentHref,
}: {
  deployments: readonly Deployment[];
  deploymentHref: DeploymentHref;
}) {
  if (deployments.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">—</p>;
  }
  return (
    <div className="flex flex-col">
      {deployments.map((deployment) => (
        <DeploymentRow
          key={deployment.id}
          deployment={deployment}
          deploymentHref={deploymentHref}
        />
      ))}
    </div>
  );
}

/** The live production deployment, rendered as the thing the page is about. */
export function ProductionSummary({
  deployment,
  deploymentHref,
}: {
  deployment: Deployment | null;
  deploymentHref: DeploymentHref;
}) {
  if (!deployment) {
    return <p className="py-2 text-xs text-muted-foreground">—</p>;
  }
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot
            tone={deploymentTone(deployment.status)}
            label={deployment.status}
          />
          {deploymentLabel(deployment.status, deployment.phase)}
        </span>
        <DeploymentBadges kind={deployment.kind} status={deployment.status} />
        <a
          href={deployment.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-sm hover:underline"
        >
          {deployment.hostname}
          <ArrowUpRight className="size-3" />
        </a>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <Fact label="commit" value={deployment.gitSha.slice(0, 7)} mono />
        <Fact label="branch" value={deployment.gitRef} />
        <Fact
          label="build"
          value={
            deployment.buildDurationMs === null
              ? "—"
              : `${Math.round(deployment.buildDurationMs / 1000)}s`
          }
        />
        <Fact label="deployed" value={formatRelative(deployment.createdAt)} />
      </dl>
      <Link
        href={deploymentHref(deployment)}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Build logs
      </Link>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")} title={value}>
        {value}
      </dd>
    </div>
  );
}

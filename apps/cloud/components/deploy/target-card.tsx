"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { DeployTargetListEntry } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { StatusDot } from "@repo/ui/status-dot";
import { ArrowUpRight, GitBranch } from "lucide-react";
import Link from "next/link";
import { deploymentLabel, deploymentTone } from "./status";

/**
 * The card is the whole surface: name, where it answers, and what the last
 * build did. Everything else is one click away on the target page — a card
 * carrying eight fields stops being scannable, which is the only thing a list
 * of them is for.
 */
export function TargetCard({ target }: { target: DeployTargetListEntry }) {
  const latest = target.latestDeployment;
  const hostname = target.primaryHostname ?? latest?.hostname ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/deployments/${target.id}`}
            className="text-sm font-medium hover:underline"
          >
            {target.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {target.projectSlug}
          </p>
        </div>
        {hostname && (
          <Button asChild variant="outline" size="sm">
            <a
              href={`https://${hostname}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Visit
              <ArrowUpRight className="size-3" />
            </a>
          </Button>
        )}
      </div>

      {hostname && (
        <p className="truncate font-mono text-xs text-muted-foreground">
          {hostname}
        </p>
      )}

      {latest ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={deploymentTone(latest.status)}
              label={latest.status}
            />
            <span className="text-foreground">
              {deploymentLabel(latest.status, latest.phase)}
            </span>
          </span>
          <span>{formatRelative(latest.readyAt ?? latest.createdAt)}</span>
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" />
            {latest.gitRef}
          </span>
          <span className="font-mono">{latest.gitSha.slice(0, 7)}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">—</p>
      )}
    </div>
  );
}

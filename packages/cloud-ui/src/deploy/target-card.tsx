"use client";

import type { DeployTargetListEntry } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { StatusDot } from "@repo/ui/status-dot";
import { ArrowUpRight, GitBranch } from "lucide-react";
import Link from "next/link";
import { deploymentLabel, deploymentTone } from "../deploy-status";
import { formatRelative } from "../format";
import { FrameworkIcon } from "../tech-icon";

/**
 * The card is the whole surface: name, where it answers, and what the last
 * build did. Everything else is one click away on the target page — a card
 * carrying eight fields stops being scannable, which is the only thing a list
 * of them is for.
 *
 * `href` is supplied rather than derived: the two apps that render this nest
 * a deployable at different depths.
 */
export function TargetCard({
  target,
  href,
}: {
  target: DeployTargetListEntry;
  href: string;
}) {
  const latest = target.latestDeployment;
  const hostname = target.primaryHostname ?? latest?.hostname ?? null;

  return (
    // `min-w-0` because a grid item defaults to `min-width: auto`, which is the
    // width of its widest unbreakable content — a long hostname then widens the
    // whole track and `truncate` inside never gets a chance to fire.
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="min-w-0">
            <Link href={href} className="text-sm font-medium hover:underline">
              {target.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {target.projectSlug}
            </p>
          </div>
          {/* Labelled, because the card never writes the framework out — this
              mark is the only place it appears. */}
          <FrameworkIcon
            framework={target.framework}
            className="mt-1 size-4 text-muted-foreground"
            label={target.framework ?? "no preset"}
          />
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
          {/* A paused target's last deployment is still `ready` — the row
              records what production was, and nothing rewrote it. Reading the
              status alone would show a live site that is not running. */}
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={target.pausedAt ? "muted" : deploymentTone(latest.status)}
              label={target.pausedAt ? "paused" : latest.status}
            />
            <span className="text-foreground">
              {target.pausedAt
                ? "Paused"
                : deploymentLabel(latest.status, latest.phase)}
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

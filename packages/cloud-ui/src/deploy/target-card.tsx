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
  // Production, not the newest of any kind. A repository with preview builds
  // running produces a preview as its newest deployment nearly always, so a
  // failed dependabot branch would otherwise paint the card red while the
  // domain is serving fine. The fallback covers a target whose first
  // production build has not landed yet.
  const latest = target.latestProduction ?? target.latestDeployment;
  const hostname = target.primaryHostname ?? latest?.hostname ?? null;

  return (
    // `min-w-0` because a grid item defaults to `min-width: auto`, which is the
    // width of its widest unbreakable content — a long hostname then widens the
    // whole track and `truncate` inside never gets a chance to fire.
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <FrameworkIcon
            framework={target.framework}
            className="mt-1 size-4 text-muted-foreground"
            label={target.framework ?? "no preset"}
          />
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

      {/* One line, never wrapped. Wrapping made a card with a long branch name
          two rows taller than the one beside it, so a grid of them had ragged
          heights; the branch takes the slack and truncates instead. `mt-auto`
          pins it to the bottom so the cards still line up when the rows above
          differ. */}
      {latest ? (
        <div className="mt-auto flex items-center gap-3 overflow-hidden text-xs text-muted-foreground">
          {/* A paused target's last deployment is still `ready` — the row
              records what production was, and nothing rewrote it. Reading the
              status alone would show a live site that is not running. */}
          <span className="flex shrink-0 items-center gap-1.5">
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
          <span className="shrink-0">
            {formatRelative(latest.readyAt ?? latest.createdAt)}
          </span>
          <span
            className="flex min-w-0 flex-1 items-center gap-1"
            title={latest.gitRef}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{latest.gitRef}</span>
          </span>
          <span className="shrink-0 font-mono">
            {latest.gitSha.slice(0, 7)}
          </span>
        </div>
      ) : (
        <p className="mt-auto text-xs text-muted-foreground">—</p>
      )}
    </div>
  );
}

"use client";

import type { PiCronJob } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { ListRow } from "@repo/ui/list";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { RowActions } from "@repo/ui/toolbar";
import { Copy, History, Pause, Pencil, Play, Trash2 } from "lucide-react";

function jobTone(job: PiCronJob): StatusTone {
  if (!job.enabled) return "muted";
  if (job.last_status === null) return "warning";
  if (job.last_status >= 200 && job.last_status < 300) return "good";
  return "critical";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function jobUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

export function PiCronJobRow({
  job,
  onEdit,
  onDuplicate,
  onToggleEnabled,
  onDelete,
  onTrigger,
  onHistory,
}: {
  job: PiCronJob;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onTrigger: () => void;
  onHistory: () => void;
}) {
  const nextRun = job.next_run
    ? new Date(job.next_run).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <ListRow
      onClick={onHistory}
      leading={
        <StatusDot
          tone={jobTone(job)}
          label={
            job.last_status === null ? "never run" : String(job.last_status)
          }
        />
      }
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{job.name}</span>
          {!job.enabled && <Badge variant="secondary">paused</Badge>}
        </span>
      }
      description={
        <span className="font-mono">
          {job.expression} · {job.method.toUpperCase()} · {jobUrlPath(job.url)}
        </span>
      }
      meta={
        <span className="hidden items-center gap-4 font-mono sm:flex">
          <span className="w-8 text-right" title="Last status">
            {job.last_status ?? "—"}
          </span>
          <span className="w-16 text-right" title="Last run">
            {formatRelative(job.last_run)}
          </span>
          <span className="w-12 text-right" title="Next run">
            {nextRun}
          </span>
        </span>
      }
      trailing={
        // Menu items portal out, but React still bubbles their clicks to the row.
        <span onClick={(event) => event.stopPropagation()}>
          <RowActions>
            <DropdownMenuItem onClick={onTrigger}>
              <Play /> Trigger now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleEnabled}>
              {job.enabled ? (
                <>
                  <Pause /> Pause
                </>
              ) : (
                <>
                  <Play /> Resume
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>
              <History /> History
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </RowActions>
        </span>
      }
    />
  );
}

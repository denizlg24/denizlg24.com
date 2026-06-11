"use client";

import { History, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PiCronJob } from "@/lib/data-types";

function JobStatusDot({ job }: { job: PiCronJob }) {
  if (!job.enabled) {
    return (
      <span className="size-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
    );
  }
  if (job.last_status === null) {
    return <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />;
  }
  if (job.last_status >= 200 && job.last_status < 300) {
    return (
      <span className="relative flex size-1.5 shrink-0">
        <span className="absolute inline-flex size-full rounded-full bg-accent opacity-40 animate-ping" />
        <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
      </span>
    );
  }
  return (
    <span className="relative flex size-1.5 shrink-0">
      <span className="absolute inline-flex size-full rounded-full bg-red-400 opacity-40 animate-ping" />
      <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
    </span>
  );
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

export function PiCronJobRow({
  job,
  onEdit,
  onDelete,
  onTrigger,
  onHistory,
}: {
  job: PiCronJob;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="group flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors">
      <JobStatusDot job={job} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{job.name}</span>
          {!job.enabled && (
            <span className="text-[9px] font-mono uppercase text-muted-foreground">
              paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] font-mono text-muted-foreground/70">
            {job.expression}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-[11px] font-mono text-muted-foreground uppercase">
            {job.method}
          </span>
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-4 shrink-0 text-right">
        <div className="w-16">
          <p className="text-xs font-mono text-muted-foreground tabular-nums">
            {job.last_status ?? "—"}
          </p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            status
          </p>
        </div>
        <div className="w-16">
          <p className="text-xs font-mono text-muted-foreground tabular-nums">
            {formatRelative(job.last_run)}
          </p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            last run
          </p>
        </div>
        <div className="w-20">
          <p className="text-xs font-mono text-muted-foreground tabular-nums truncate">
            {job.next_run
              ? new Date(job.next_run).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            next
          </p>
        </div>
      </div>

      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded hover:bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onTrigger}>
              <Play className="size-3.5 mr-2" /> Trigger now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>
              <History className="size-3.5 mr-2" /> History
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="size-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

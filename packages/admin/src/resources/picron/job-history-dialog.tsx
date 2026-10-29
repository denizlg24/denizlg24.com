"use client";

import type { PiCronHistoryEntry } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { tryFormatJson } from "@repo/utils";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { useEffect, useState } from "react";
import { useAdmin } from "../../provider";

function HistoryEntry({ entry }: { entry: PiCronHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const detail = entry.error || entry.response;
  const toggleLabel = expanded ? "Collapse log" : "Show full log";
  return (
    <div className="flex items-start gap-3 py-2.5">
      <StatusBadge status={entry.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="font-mono">{entry.duration_ms}ms</span>
          <span>·</span>
          <span>
            {new Date(entry.started_at).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
        {expanded ? (
          <pre
            className={cn(
              "mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 font-mono text-[11px]",
              entry.error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {tryFormatJson(detail)}
          </pre>
        ) : (
          <>
            {entry.error && (
              <p className="mt-1 truncate font-mono text-[11px] text-destructive">
                {entry.error}
              </p>
            )}
            {entry.response && !entry.error && (
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {entry.response.slice(0, 120)}
              </p>
            )}
          </>
        )}
      </div>
      {detail && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  return (
    <Badge variant={ok ? "good" : "critical"} className="font-mono">
      {status}
    </Badge>
  );
}

export function JobHistoryDialog({
  open,
  onOpenChange,
  jobId,
  jobName,
  resourceId,
  capId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobName: string;
  resourceId: string;
  capId: string;
}) {
  const { client } = useAdmin();
  const [entries, setEntries] = useState<PiCronHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    client
      .get<PiCronHistoryEntry[]>(
        `resources/${resourceId}/capabilities/${capId}/picron/jobs/${jobId}/history`,
      )
      .then((result) => {
        if (active) setEntries(result);
      })
      .catch(() => {
        if (active) setEntries([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, client, resourceId, capId, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="shrink-0 border-b px-5 pt-4 pb-3 pr-12">
          <DialogTitle>
            History{" "}
            <span className="font-mono text-muted-foreground">{jobName}</span>
          </DialogTitle>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {loading ? (
            <div className="flex flex-col gap-3 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState compact icon={<History />} label="No runs" />
          ) : (
            <div className="flex flex-col divide-y divide-border/70">
              {entries.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

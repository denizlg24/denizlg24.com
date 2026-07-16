"use client";

import type { PiCronHistoryEntry } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { tryFormatJson } from "../../lib/format";
import { useAdmin } from "../../provider";

function HistoryEntry({ entry }: { entry: PiCronHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const detail = entry.error || entry.response;
  const toggleLabel = expanded ? "Collapse log" : "Show full log";
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <StatusBadge status={entry.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground/60 tabular-nums">
            {entry.duration_ms}ms
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-[11px] text-muted-foreground/70">
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
            className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[11px] ${
              entry.error ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {tryFormatJson(detail)}
          </pre>
        ) : (
          <>
            {entry.error && (
              <p className="text-[11px] text-destructive font-mono mt-1 truncate">
                {entry.error}
              </p>
            )}
            {entry.response && !entry.error && (
              <p className="text-[11px] text-muted-foreground/60 font-mono mt-1 truncate max-w-full">
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
          size="icon"
          className="size-6 shrink-0"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  return (
    <span
      className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
        ok ? "text-accent bg-accent/10" : "text-red-500 bg-red-500/10"
      }`}
    >
      {status}
    </span>
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
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">
            History —{" "}
            <span className="font-mono text-muted-foreground">{jobName}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground/70 text-center py-12">
            No execution history yet
          </p>
        ) : (
          <div className="overflow-auto flex-1 -mx-6 px-6">
            <div className="flex flex-col">
              {entries.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

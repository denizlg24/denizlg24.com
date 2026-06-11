"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { denizApi } from "@/lib/api-wrapper";
import type { PiCronHistoryEntry } from "@/lib/data-types";

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
  API,
  resourceId,
  capId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobName: string;
  API: denizApi;
  resourceId: string;
  capId: string;
}) {
  const [entries, setEntries] = useState<PiCronHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    API.GET<PiCronHistoryEntry[]>({
      endpoint: `resources/${resourceId}/capabilities/${capId}/picron/jobs/${jobId}/history`,
    })
      .then((result) => {
        if (!("code" in result)) setEntries(result);
      })
      .finally(() => setLoading(false));
  }, [open, API, resourceId, capId, jobId]);

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
                <div
                  key={entry.id}
                  className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0"
                >
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
                    {entry.error && (
                      <p className="text-[11px] text-red-400/80 font-mono mt-1 truncate">
                        {entry.error}
                      </p>
                    )}
                    {entry.response && !entry.error && (
                      <p className="text-[11px] text-muted-foreground/60 font-mono mt-1 truncate max-w-full">
                        {entry.response.slice(0, 120)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

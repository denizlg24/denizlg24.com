"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { formatBytes } from "@repo/cloud-ui/format";
import type {
  ForgeRequestLogRecord,
  ForgeRequestLogs,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { cn } from "@repo/ui/utils";
import { Globe, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { statusTone } from "./request-explorer";

/**
 * How much slack to give the log window on either side of the request.
 *
 * A container writes its first line before the response is finished and often
 * its last one after — a framework's completion log lands once the handler has
 * returned. Clipping exactly to the request's own duration reliably cuts both
 * ends off, and this window is only a candidate set: when the app echoes the
 * request id, the id is what actually selects the lines.
 */
const WINDOW_PADDING_MS = 2_000;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right font-mono">{children}</span>
    </div>
  );
}

function geoLine(record: ForgeRequestLogRecord): string | null {
  const { city, region, country, continent, colo } = record.geo;
  const place = [city, region, country].filter(Boolean).join(", ");
  const edge = colo ? `via ${colo}` : null;
  const parts = [place || continent, edge].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * One request, and the container output it produced.
 *
 * The logs are fetched per open rather than with the list: a page holds 200
 * requests and nobody reads 200 sets of output, so pulling them eagerly would be
 * 200 Docker reads for the one or two anyone clicks.
 */
export function RequestDetail({
  deploymentId,
  record,
  onClose,
}: {
  deploymentId: string;
  record: ForgeRequestLogRecord;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<ForgeRequestLogs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = `${record.ts}-${record.uri}-${record.requestId ?? ""}`;
  useEffect(() => {
    let live = true;
    setLogs(null);
    setError(null);
    const started = new Date(record.ts).getTime();
    void api.forge
      .requestLogs(deploymentId, {
        from: new Date(started - WINDOW_PADDING_MS).toISOString(),
        to: new Date(
          started + record.durationMs + WINDOW_PADDING_MS,
        ).toISOString(),
        requestId: record.requestId,
        limit: 200,
      })
      .then((result) => {
        if (live) setLogs(result);
      })
      .catch((logError: unknown) => {
        if (live) setError(errorMessage(logError));
      });
    return () => {
      live = false;
    };
    // The record identity, not the object: the poll replaces the array every ten
    // seconds and re-fetching the same request's logs on each one is waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId, key]);

  const geo = geoLine(record);
  const errorCount =
    logs?.lines.filter((line) => line.stream === "stderr").length ?? 0;

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-auto rounded-md border">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {record.method}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={record.uri}
        >
          {record.uri}
        </span>
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            statusTone(record.status),
          )}
        >
          {record.status}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>

      <div className="flex flex-col gap-4 p-3">
        <section className="flex flex-col divide-y">
          <Row label="Time">{new Date(record.ts).toLocaleString()}</Row>
          <Row label="Duration">{record.durationMs.toFixed(0)}ms</Row>
          <Row label="Size">{formatBytes(record.bytesOut)}</Row>
          <Row label="Host">{record.host}</Row>
          <Row label="Protocol">{record.proto || "—"}</Row>
          <Row label="Client">{record.clientIp || "—"}</Row>
          <Row label="User agent">{record.userAgent ?? "—"}</Row>
          <Row label="Referer">{record.referer ?? "—"}</Row>
          {record.rayId ? <Row label="Ray">{record.rayId}</Row> : null}
          {record.requestId ? (
            <div className="flex items-center justify-between gap-2 py-1 text-[11px]">
              <span className="shrink-0 text-muted-foreground">Request id</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono">{record.requestId}</span>
                <CopyButton value={record.requestId} label="request id" />
              </span>
            </div>
          ) : null}
        </section>

        {geo ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Globe className="size-3 shrink-0" />
            {geo}
          </p>
        ) : null}

        <section className="flex min-h-0 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Logs
            </h3>
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {errorCount > 0 ? (
                <span className="text-destructive">
                  {errorCount} {errorCount === 1 ? "error" : "errors"}
                </span>
              ) : null}
              {/* The distinction is the whole point of the panel. Lines matched
                  by id are this request's and nobody else's; a window is every
                  line the container wrote while it was open, which under
                  concurrency includes other requests' output. */}
              {logs ? (
                <span
                  title={
                    logs.correlation === "request-id"
                      ? "matched on the X-Request-Id this app logged"
                      : "the app does not log X-Request-Id — these are all lines from the request's time window"
                  }
                >
                  {logs.correlation === "request-id" ? "exact" : "time window"}
                </span>
              ) : null}
            </span>
          </div>

          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
          {!logs && !error ? (
            <p className="text-[11px] text-muted-foreground">loading…</p>
          ) : null}

          {logs ? (
            logs.lines.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                no output in this window
              </p>
            ) : (
              <div className="max-h-80 overflow-auto rounded-md border bg-zinc-950 p-2">
                {logs.lines.map((line, index) => (
                  <div
                    key={index}
                    className={cn(
                      "whitespace-pre-wrap break-all font-mono text-[10px] leading-4",
                      line.stream === "stderr"
                        ? "text-red-400"
                        : "text-zinc-300",
                    )}
                  >
                    {line.ts ? (
                      <span className="text-zinc-500">
                        {new Date(line.ts).toLocaleTimeString()}{" "}
                      </span>
                    ) : null}
                    {line.message}
                  </div>
                ))}
              </div>
            )
          ) : null}
        </section>
      </div>
    </aside>
  );
}

"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { formatBytes } from "@repo/cloud-ui/format";
import {
  FORGE_REQUEST_METHODS,
  FORGE_REQUEST_STATUS_CLASSES,
  type ForgeRequestLogPage,
  type ForgeRequestLogRecord,
  type ForgeRequestStatusClass,
} from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { cn } from "@repo/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RequestDetail } from "./request-detail";

export function statusTone(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-amber-600 dark:text-amber-500";
  if (status >= 300) return "text-muted-foreground";
  return "text-emerald-600 dark:text-emerald-500";
}

const SLOW_THRESHOLDS = [
  { value: "100", label: "≥100ms" },
  { value: "500", label: "≥500ms" },
  { value: "1000", label: "≥1s" },
];

const METHOD_OPTIONS = FORGE_REQUEST_METHODS.map((method) => ({
  value: method,
  label: method,
}));

const LIMIT = 200;
const BUCKETS = 60;

interface Filter {
  status: ForgeRequestStatusClass[];
  method: string | null;
  search: string;
  minDurationMs: number | null;
}

const EMPTY: Filter = {
  status: [],
  method: null,
  search: "",
  minDurationMs: null,
};

/**
 * A count-per-bucket histogram over whatever the page happens to hold.
 *
 * Deliberately computed from the returned records rather than fetched as its own
 * series: it describes *this* list, so a filter narrowing the rows narrows the
 * bars with them. The stored `requests.count` series answers a different
 * question — traffic over time regardless of what is on screen — and lives on
 * the analytics page.
 */
function Timeline({ records }: { records: readonly ForgeRequestLogRecord[] }) {
  const bars = useMemo(() => {
    if (records.length === 0) return [];
    const times = records.map((record) => new Date(record.ts).getTime());
    const first = Math.min(...times);
    const last = Math.max(...times);
    // A page whose requests all landed in the same millisecond has no span to
    // divide; one full bar is the honest rendering of that.
    const span = Math.max(last - first, 1);
    const counts = new Array<number>(BUCKETS).fill(0);
    let errors = new Array<number>(BUCKETS).fill(0);
    for (const record of records) {
      const index = Math.min(
        BUCKETS - 1,
        Math.floor(((new Date(record.ts).getTime() - first) / span) * BUCKETS),
      );
      counts[index] = (counts[index] ?? 0) + 1;
      if (record.status >= 400) errors[index] = (errors[index] ?? 0) + 1;
    }
    const peak = Math.max(...counts, 1);
    errors = errors.map((value, index) => (counts[index] ? value : 0));
    return counts.map((count, index) => ({
      count,
      failed: (errors[index] ?? 0) > 0,
      height: (count / peak) * 100,
    }));
  }, [records]);

  if (bars.length === 0) return null;

  const first = new Date(
    Math.min(...records.map((record) => new Date(record.ts).getTime())),
  );
  const last = new Date(
    Math.max(...records.map((record) => new Date(record.ts).getTime())),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-12 items-end gap-px">
        {bars.map((bar, index) => (
          <div
            key={index}
            title={`${bar.count}`}
            className={cn(
              "min-h-px flex-1 rounded-t-[1px]",
              bar.failed ? "bg-destructive/70" : "bg-muted-foreground/40",
            )}
            style={{ height: `${bar.height}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{first.toLocaleTimeString()}</span>
        <span>{last.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

/**
 * The requests a deployment recently served, with the container output each one
 * produced behind a click.
 *
 * Polled rather than streamed: the access log is a file Caddy appends to, and
 * tailing it as a stream would mean holding a descriptor open per viewer for a
 * list nobody watches line by line. Ten seconds is well inside how long anyone
 * looks at it.
 *
 * Every filter is a query parameter, never a `.filter()` on what came back. The
 * agent reads the log backwards and stops at `limit`, so narrowing on this side
 * would search only the newest 200 lines — asking for 5xx on a mostly-healthy
 * deployment would reliably answer "none" while the errors sat just past the
 * window.
 */
export function RequestExplorer({ deploymentId }: { deploymentId: string }) {
  const [filter, setFilter] = useState<Filter>(EMPTY);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<ForgeRequestLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ForgeRequestLogRecord | null>(null);

  // Filters and the open request are per deployment. Carrying a `/checkout`
  // search onto a project that has no such route just shows an empty table with
  // no obvious cause.
  useEffect(() => {
    setFilter(EMPTY);
    setDraft("");
    setSelected(null);
  }, [deploymentId]);

  useEffect(() => {
    if (draft === filter.search) return;
    const timer = setTimeout(
      () => setFilter((current) => ({ ...current, search: draft })),
      300,
    );
    return () => clearTimeout(timer);
  }, [draft, filter.search]);

  const query = useMemo(
    () => ({
      limit: LIMIT,
      status: filter.status,
      method: filter.method ? [filter.method] : [],
      search: filter.search.trim() || null,
      minDurationMs: filter.minDurationMs,
    }),
    [filter],
  );

  useEffect(() => {
    // A poll in flight when the id or the filter changes would otherwise land on
    // the new view and show the previous one's requests — which happens whenever
    // the container picker moves. The flag is per-effect, so only the current
    // request's responses are accepted.
    let live = true;
    setPage(null);
    setError(null);

    const load = async () => {
      try {
        const next = await api.forge.requests(deploymentId, query);
        if (!live) return;
        setPage(next);
        setError(null);
      } catch (requestError) {
        if (!live) return;
        setError(errorMessage(requestError));
      }
    };

    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [deploymentId, query]);

  const toggleStatus = (status: ForgeRequestStatusClass) =>
    setFilter((current) => ({
      ...current,
      status: current.status.includes(status)
        ? current.status.filter((entry) => entry !== status)
        : [...current.status, status],
    }));

  const active =
    filter.status.length > 0 ||
    filter.method !== null ||
    filter.search !== "" ||
    filter.minDurationMs !== null;

  // Newest first, which is the order anyone reads an access log in.
  const records = useMemo(() => [...(page?.requests ?? [])].reverse(), [page]);

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            {FORGE_REQUEST_STATUS_CLASSES.map((status) => {
              const on = filter.status.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(status)}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors",
                    on
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {status}
                </button>
              );
            })}
          </div>

          <OptionSelect
            aria-label="Method"
            value={filter.method}
            onValueChange={(method) =>
              setFilter((current) => ({ ...current, method }))
            }
            emptyLabel="all methods"
            options={METHOD_OPTIONS}
          />

          <OptionSelect
            aria-label="Minimum duration"
            value={
              filter.minDurationMs === null
                ? null
                : String(filter.minDurationMs)
            }
            onValueChange={(ms) =>
              setFilter((current) => ({
                ...current,
                minDurationMs: ms === null ? null : Number(ms),
              }))
            }
            emptyLabel="any duration"
            options={SLOW_THRESHOLDS}
          />

          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="path, ip, agent, country"
            aria-label="Search requests"
            className="h-8 w-52 text-xs"
          />

          {active ? (
            <button
              type="button"
              onClick={() => {
                setFilter(EMPTY);
                setDraft("");
              }}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              clear
            </button>
          ) : null}

          {page ? (
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
              {records.length}
              {active ? ` of ${page.scanned} scanned` : ""}
              {page.truncated ? "+" : ""}
            </span>
          ) : null}
        </div>

        <Timeline records={records} />

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!page && !error ? (
          <p className="text-xs text-muted-foreground">loading…</p>
        ) : null}
        {page && records.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {active ? `no match in ${page.scanned} requests` : "—"}
          </p>
        ) : null}

        {records.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="py-1.5 pl-3 pr-2 font-normal">time</th>
                  <th className="py-1.5 pr-2 font-normal">status</th>
                  <th className="py-1.5 pr-2 font-normal">request</th>
                  <th className="py-1.5 pr-2 text-right font-normal">ms</th>
                  <th className="py-1.5 pr-2 text-right font-normal">size</th>
                  <th className="py-1.5 pr-3 font-normal">client</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => {
                  const open =
                    selected?.ts === record.ts && selected?.uri === record.uri;
                  return (
                    <tr
                      key={`${record.ts}-${index}`}
                      onClick={() => setSelected(open ? null : record)}
                      className={cn(
                        "cursor-pointer border-b last:border-b-0 hover:bg-muted/40",
                        open && "bg-muted/60",
                      )}
                    >
                      <td className="py-1 pl-3 pr-2 tabular-nums text-muted-foreground">
                        {new Date(record.ts).toLocaleTimeString()}
                      </td>
                      <td className="py-1 pr-2 font-mono">
                        <span className="text-muted-foreground">
                          {record.method}
                        </span>{" "}
                        <span
                          className={cn(
                            "tabular-nums",
                            statusTone(record.status),
                          )}
                        >
                          {record.status}
                        </span>
                      </td>
                      <td
                        className="max-w-0 truncate py-1 pr-2 font-mono"
                        title={record.uri}
                      >
                        {record.uri}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">
                        {record.durationMs.toFixed(0)}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">
                        {formatBytes(record.bytesOut)}
                      </td>
                      <td
                        className="max-w-40 truncate py-1 pr-3 text-muted-foreground"
                        title={record.userAgent ?? record.clientIp}
                      >
                        {record.geo.country ? `${record.geo.country} · ` : ""}
                        {record.clientIp}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {selected ? (
        <RequestDetail
          deploymentId={deploymentId}
          record={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

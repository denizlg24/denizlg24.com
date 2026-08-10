"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { formatBytes } from "@repo/cloud-ui/format";
import {
  FORGE_REQUEST_METHODS,
  FORGE_REQUEST_STATUS_CLASSES,
  type ForgeRequestLogPage,
  type ForgeRequestStatusClass,
} from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { cn } from "@repo/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

function statusTone(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-amber-600 dark:text-amber-500";
  if (status >= 300) return "text-muted-foreground";
  return "text-emerald-600 dark:text-emerald-500";
}

const SLOW_THRESHOLDS = [
  { label: "any", ms: null },
  { label: "≥100ms", ms: 100 },
  { label: "≥500ms", ms: 500 },
  { label: "≥1s", ms: 1_000 },
] as const;

const LIMIT = 200;

interface Filter {
  status: ForgeRequestStatusClass[];
  method: string;
  search: string;
  minDurationMs: number | null;
}

const EMPTY: Filter = {
  status: [],
  method: "",
  search: "",
  minDurationMs: null,
};

/**
 * The requests a deployment recently served.
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
export function RequestTable({ deploymentId }: { deploymentId: string }) {
  const [filter, setFilter] = useState<Filter>(EMPTY);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<ForgeRequestLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters are per deployment. Carrying a `/checkout` search onto a project
  // that has no such route just shows an empty table with no obvious cause.
  useEffect(() => {
    setFilter(EMPTY);
    setDraft("");
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
    // an open container panel or the project picker moves. The flag is
    // per-effect, so only the current request's responses are accepted.
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
    filter.method !== "" ||
    filter.search !== "" ||
    filter.minDurationMs !== null;

  const records = page?.requests ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
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

        <NativeSelect
          size="sm"
          aria-label="Method"
          value={filter.method}
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              method: event.target.value,
            }))
          }
        >
          <NativeSelectOption value="">all methods</NativeSelectOption>
          {FORGE_REQUEST_METHODS.map((method) => (
            <NativeSelectOption key={method} value={method}>
              {method}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          size="sm"
          aria-label="Minimum duration"
          value={String(filter.minDurationMs ?? "")}
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              minDurationMs: event.target.value
                ? Number(event.target.value)
                : null,
            }))
          }
        >
          {SLOW_THRESHOLDS.map((threshold) => (
            <NativeSelectOption
              key={threshold.label}
              value={String(threshold.ms ?? "")}
            >
              {threshold.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="path, ip, agent"
          aria-label="Search requests"
          className="h-7 w-44 text-xs"
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
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-muted-foreground">
                <th className="py-1 pr-2 font-normal">time</th>
                <th className="py-1 pr-2 font-normal">status</th>
                <th className="py-1 pr-2 font-normal">method</th>
                <th className="py-1 pr-2 font-normal">path</th>
                <th className="py-1 pr-2 text-right font-normal">ms</th>
                <th className="py-1 pr-2 text-right font-normal">size</th>
                <th className="py-1 font-normal">client</th>
              </tr>
            </thead>
            <tbody>
              {[...records].reverse().map((record, index) => (
                <tr
                  key={`${record.ts}-${index}`}
                  className="border-b last:border-b-0"
                >
                  <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                    {new Date(record.ts).toLocaleTimeString()}
                  </td>
                  <td
                    className={`py-1 pr-2 font-mono tabular-nums ${statusTone(record.status)}`}
                  >
                    {record.status}
                  </td>
                  <td className="py-1 pr-2 font-mono">{record.method}</td>
                  <td
                    className="max-w-72 truncate py-1 pr-2 font-mono"
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
                    className="max-w-56 truncate py-1 text-muted-foreground"
                    title={`${record.clientIp}${record.userAgent ? ` · ${record.userAgent}` : ""}`}
                  >
                    {record.clientIp}
                    {record.userAgent ? ` · ${record.userAgent}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

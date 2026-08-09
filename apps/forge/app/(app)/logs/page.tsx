"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { api, errorMessage } from "@/lib/api";

type Mode = "runtime" | "build";
const MAX_LINES = 5_000;

function LogViewer() {
  const searchParams = useSearchParams();
  const initialMode: Mode =
    searchParams.get("mode") === "build" ? "build" : "runtime";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [selectedId, setSelectedId] = useState(searchParams.get("id") ?? "");
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "streaming" | "ended" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const { data: overview, error: overviewError } = usePoll(
    api.forge.overview,
    15_000,
  );
  const { data: deployments, error: deploymentError } = usePoll(
    useMemo(() => () => api.forge.deployments({ limit: 100 }), []),
    30_000,
  );

  const options = useMemo(
    () =>
      mode === "runtime"
        ? (overview?.agent?.containers ?? []).map((container) => ({
            id: container.id,
            label: `${container.projectSlug ?? container.name} · ${container.id.slice(0, 12)}`,
          }))
        : (deployments?.deployments ?? []).map((deployment) => ({
            id: deployment.id,
            label: `${deployment.projectSlug} · ${deployment.gitSha.slice(0, 7)} · ${deployment.status}`,
          })),
    [deployments, mode, overview],
  );
  const sourceLoaded =
    mode === "runtime" ? overview !== null : deployments !== null;
  const selectedSourceExists = options.some(
    (option) => option.id === selectedId,
  );

  useEffect(() => {
    if (!sourceLoaded) return;
    if (!selectedId || !options.some((option) => option.id === selectedId)) {
      setSelectedId(options[0]?.id ?? "");
    }
  }, [options, selectedId, sourceLoaded]);

  useEffect(() => {
    if (!sourceLoaded) return;
    if (!selectedId) {
      setLines([]);
      setStatus("idle");
      return;
    }
    if (!selectedSourceExists) return;
    const controller = new AbortController();
    setLines([]);
    setError(null);
    setStatus("connecting");
    const append = (line: string) => {
      setStatus("streaming");
      setLines((current) => {
        const next = [...current, line];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    };
    const stream =
      mode === "runtime"
        ? api.forge.streamLogs(selectedId, append, controller.signal)
        : api.forge.streamBuildLogs(selectedId, append, controller.signal);
    void stream
      .then(() => {
        if (!controller.signal.aborted) setStatus("ended");
      })
      .catch((streamError) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(errorMessage(streamError));
      });
    return () => controller.abort();
  }, [mode, selectedId, selectedSourceExists, sourceLoaded]);

  useEffect(() => {
    tail.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const sourceError = overviewError ?? deploymentError;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeading
        title="logs"
        detail="build output and live container stdout/stderr"
      >
        <span className="font-mono text-[11px] text-muted-foreground">
          {status}
        </span>
      </PageHeading>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(["runtime", "build"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setMode(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-8 min-w-64 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
          aria-label="Log source"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setLines([])}
        >
          clear
        </Button>
      </div>
      {sourceError ? (
        <p className="text-xs text-destructive">{sourceError}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!overview && !deployments ? (
        <Skeleton className="min-h-96 flex-1" />
      ) : (
        <div className="min-h-96 max-h-96 flex-1 overflow-auto rounded-md border bg-zinc-950 p-3 text-zinc-100">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
            {lines.length > 0
              ? lines.join("\n")
              : selectedId
                ? "waiting for output…"
                : "no log source"}
          </pre>
          <div ref={tail} />
        </div>
      )}
    </div>
  );
}

export default function LogsPage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-96" />}>
      <LogViewer />
    </Suspense>
  );
}

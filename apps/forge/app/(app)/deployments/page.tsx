"use client";

import {
  DeploymentKindBadge,
  deploymentLabel,
  deploymentTone,
  isDeploymentRetryable,
} from "@repo/cloud-ui/deploy-status";
import { formatDurationMs, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  ForgeDeploymentSort,
  ForgeDeploymentSummary,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import {
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DateRangeFilter,
  SearchFilter,
  StatusFilter,
} from "@/components/deployment-filters";
import { PageHeading } from "@/components/page-heading";
import { api, errorMessage } from "@/lib/api";
import { resolveDeploymentQuery } from "@/lib/deployment-query";

const PAGE_STEP = 50;
/** `forgeDeploymentQuerySchema` refuses more, and the feed stops being one. */
const MAX_ROWS = 500;

const SORTS: { value: ForgeDeploymentSort; label: string }[] = [
  { value: "createdAt", label: "newest" },
  { value: "projectSlug", label: "project" },
  { value: "status", label: "status" },
  { value: "buildDurationMs", label: "build time" },
  { value: "imageSizeBytes", label: "image size" },
];

const ENVIRONMENTS = [
  { value: "production" as const, label: "Production" },
  { value: "preview" as const, label: "Preview" },
];

function shortRef(gitRef: string): string {
  return gitRef.replace(/^refs\/heads\//, "");
}

function DeploymentsFeed() {
  const router = useRouter();
  const params = useSearchParams();

  const { query, statusFromUrl } = useMemo(
    () => resolveDeploymentQuery(new URLSearchParams(params.toString())),
    [params],
  );

  const setQuery = (
    next: Partial<Record<string, string | number | null | string[]>>,
    { keepSize = false }: { keepSize?: boolean } = {},
  ) => {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      search.delete(key);
      if (value === null || value === "") continue;
      if (Array.isArray(value)) {
        for (const entry of value) search.append(key, entry);
        continue;
      }
      search.set(key, String(value));
    }
    // Any change to what is being listed invalidates how far down it you had
    // scrolled — five pages of an unfiltered feed is rarely five of a filtered
    // one, and keeping it would fetch 250 rows to show three.
    if (!keepSize) search.delete("size");
    router.replace(search.size === 0 ? "?" : `?${search}`, { scroll: false });
  };

  const fetchPage = useMemo(() => () => api.forge.deployments(query), [query]);
  // The first window refreshes on the cadence a feed wants. Ten pages of it is
  // ten times the query and ten times the payload for rows nobody is looking at
  // — someone who has paged that far down is reading, not watching.
  const { data, error, loading, reload } = usePoll(
    fetchPage,
    query.limit > PAGE_STEP ? 120_000 : 30_000,
  );

  // One set for both row actions: a row offers exactly one of them, and the
  // button it offers is the one that has to go busy.
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const withBusy = async (id: string, action: () => Promise<unknown>) => {
    setBusy((current) => new Set(current).add(id));
    try {
      await action();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const restart = (id: string) =>
    withBusy(id, async () => {
      try {
        await api.forge.restart(id);
        toast.success("Deployment restarted");
        await reload();
      } catch (restartError) {
        toast.error(errorMessage(restartError));
      }
    });

  // A retry is a new deployment of the same commit, so following it is the
  // point — staying on the feed leaves you watching a row that will not change
  // while the one you asked for builds somewhere off screen.
  const retry = (id: string) =>
    withBusy(id, async () => {
      try {
        const created = await api.deploy.retry(id);
        toast.success(`Queued ${created.gitSha.slice(0, 7)}`);
        router.push(`/deployments/${created.id}`);
      } catch (retryError) {
        toast.error(errorMessage(retryError));
      }
    });

  const total = data?.total ?? 0;
  const shown = data?.deployments.length ?? 0;
  const filtered =
    statusFromUrl ||
    query.project !== null ||
    query.search !== null ||
    query.kind !== null ||
    query.branch !== null ||
    query.repo !== null ||
    query.since !== null ||
    query.until !== null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="deployments"
        detail={
          data ? `${shown} of ${total}${filtered ? " matched" : ""}` : undefined
        }
      >
        <SearchBox
          value={query.search ?? ""}
          onChange={(search) => setQuery({ search: search || null })}
        />
      </PageHeading>

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          since={params.get("since")}
          until={params.get("until")}
          onChange={(range) => setQuery(range)}
        />

        <OptionSelect
          size="default"
          className="h-9 w-44"
          aria-label="Environment"
          value={query.kind}
          onValueChange={(kind) => setQuery({ kind })}
          emptyLabel="All Environments"
          options={ENVIRONMENTS}
        />

        <SearchFilter
          value={query.repo}
          onChange={(repo) => setQuery({ repo })}
          options={data?.repos ?? []}
          allLabel="All Repositories"
          emptyLabel="no repository matches"
        />

        <SearchFilter
          value={query.project}
          // Branches are scoped to the selected project, so one left behind
          // from the previous project matches nothing and reads as an empty
          // feed with no visible cause.
          onChange={(project) => setQuery({ project, branch: null })}
          options={data?.projects ?? []}
          allLabel="All Projects"
          emptyLabel="no project matches"
        />

        {/* Branches only narrow within a project. Across the box the list runs
            to thousands of refs and the server caps it — a picker that silently
            omits the branch you want is worse than not offering one. */}
        {query.project ? (
          <SearchFilter
            value={query.branch}
            onChange={(branch) => setQuery({ branch })}
            options={data?.branches ?? []}
            allLabel="All Branches"
            emptyLabel="no branch matches"
          />
        ) : null}

        <StatusFilter
          selected={query.status}
          onChange={(status) => setQuery({ status })}
        />

        <OptionSelect
          size="default"
          className="ml-auto h-9"
          aria-label="Sort"
          value={query.sort}
          onValueChange={(sort) =>
            setQuery({
              sort,
              // Every sort but the default reads best largest-first, and
              // `createdAt` already means newest-first descending.
              direction: "desc",
            })
          }
          options={SORTS}
        />

        {filtered ? (
          <button
            type="button"
            onClick={() =>
              setQuery({
                status: null,
                project: null,
                search: null,
                kind: null,
                branch: null,
                repo: null,
                since: null,
                until: null,
              })
            }
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            clear
          </button>
        ) : null}
      </div>

      {!data && !error ? <Skeleton className="h-96" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {data ? (
        <div
          className={cn(
            "flex flex-col transition-opacity",
            loading ? "opacity-60" : "opacity-100",
          )}
        >
          <div className="overflow-hidden rounded-lg border">
            {data.deployments.map((deployment) => (
              <DeploymentRow
                key={deployment.id}
                deployment={deployment}
                busy={busy.has(deployment.id)}
                onRestart={() => void restart(deployment.id)}
                onRetry={() => void retry(deployment.id)}
              />
            ))}
            {data.deployments.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                —
              </p>
            ) : null}
          </div>

          {shown < total ? (
            <Button
              variant="outline"
              className="mt-4 w-full"
              disabled={loading || query.limit >= MAX_ROWS}
              onClick={() =>
                setQuery(
                  { size: Math.min(query.limit + PAGE_STEP, MAX_ROWS) },
                  { keepSize: true },
                )
              }
            >
              {query.limit >= MAX_ROWS ? "Narrow the filters" : "Load More"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One deployment, as one line.
 *
 * Everything on it is fixed-width except the commit message, which takes the
 * slack — a row whose columns move as you scroll is unreadable, and the message
 * is the only field with no natural length. `min-w-0` on that cell is what lets
 * `truncate` fire at all: a flex child defaults to the width of its content.
 */
function DeploymentRow({
  deployment,
  busy,
  onRestart,
  onRetry,
}: {
  deployment: ForgeDeploymentSummary;
  busy: boolean;
  onRestart: () => void;
  onRetry: () => void;
}) {
  const router = useRouter();
  const href = `/deployments/${deployment.id}`;
  const retryable = isDeploymentRetryable(deployment.status);

  return (
    <div
      // The message is the real link — this only widens its target. Clicks
      // landing on the row's own links and buttons are left to them.
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a,button"))
          return;
        router.push(href);
      }}
      className="flex cursor-pointer items-center gap-4 border-b px-4 py-2.5 text-xs transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <Link
        href={href}
        className="min-w-0 flex-1 truncate hover:underline"
        title={deployment.gitMessage ?? shortRef(deployment.gitRef)}
      >
        {deployment.gitMessage ?? shortRef(deployment.gitRef)}
      </Link>

      {/* The feed already carries the failure reason; there is no room to print
          it, but hiding it entirely means opening a row to learn what a red dot
          meant. */}
      <span
        className="flex w-40 shrink-0 items-center gap-1.5"
        title={deployment.error ?? undefined}
      >
        <StatusDot
          tone={deploymentTone(deployment.status)}
          label={deployment.status}
        />
        <span className="truncate capitalize">
          {deploymentLabel(deployment.status, deployment.phase)}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatDurationMs(deployment.buildDurationMs)}
        </span>
      </span>

      <DeploymentKindBadge
        kind={deployment.kind}
        className="w-20 shrink-0 justify-center"
      />

      <Link
        href={`/${deployment.projectSlug}`}
        className="w-44 shrink-0 truncate hover:underline"
        title={deployment.projectSlug}
      >
        {deployment.projectSlug}
      </Link>

      <span className="flex w-24 shrink-0 items-center gap-1 font-mono text-muted-foreground">
        <GitCommitHorizontal className="size-3.5 shrink-0" />
        {deployment.gitSha.slice(0, 7)}
      </span>

      {/* A preview ref is `dependabot/npm_and_yarn/…` and runs past sixty
          characters; without a definite width there is nothing for the ellipsis
          to appear in and the row pushes the timestamp off the edge. */}
      <span
        className="flex w-56 shrink-0 items-center gap-1 text-muted-foreground"
        title={shortRef(deployment.gitRef)}
      >
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate">{shortRef(deployment.gitRef)}</span>
      </span>

      <span className="w-20 shrink-0 text-right text-muted-foreground">
        {formatRelative(deployment.createdAt)}
      </span>

      {/* One action per row, chosen by state: a live container restarts, a run
          that stopped without shipping builds the same commit again. Neither is
          offered while a build is still in flight — cancel is the only thing
          that applies there, and it lives on the deployment's own page. */}
      <span className="flex w-7 shrink-0 justify-end">
        {deployment.status === "ready" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={busy}
            onClick={onRestart}
            aria-label="Restart deployment"
            title="Restart"
          >
            <RotateCw className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
        ) : retryable ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={busy}
            onClick={onRetry}
            aria-label={`Retry deployment of ${deployment.gitSha.slice(0, 7)}`}
            title="Retry this commit"
          >
            <RotateCcw className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Typing is local and only reaches the URL once it settles — every keystroke
 * would otherwise be a history entry and a request.
 */
function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 300);
    return () => clearTimeout(timer);
  }, [draft, onChange, value]);
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder="sha, message, host"
      aria-label="Search deployments"
      className="h-8 w-56 text-xs"
    />
  );
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DeploymentsFeed />
    </Suspense>
  );
}

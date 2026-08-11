"use client";

import {
  DeploymentKindBadge,
  deploymentLabel,
  deploymentTone,
} from "@repo/cloud-ui/deploy-status";
import { formatDurationMs, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  type ForgeDeploymentSort,
  type ForgeDeploymentSummary,
  forgeDeploymentQuerySchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { GitBranch, GitCommitHorizontal, RotateCw } from "lucide-react";
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

/**
 * A day string carries no time and the filter compares timestamps, so a bare
 * date has to be widened to the day it names — local midnight to local
 * midnight. Parsing it as UTC instead shifts the boundary by the offset and
 * drops the first or last few hours of the range.
 */
function dayStart(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dayEnd(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function shortRef(gitRef: string): string {
  return gitRef.replace(/^refs\/heads\//, "");
}

function DeploymentsFeed() {
  const router = useRouter();
  const params = useSearchParams();

  // The URL is the state. A filtered view stays linkable, survives a refresh
  // and comes back intact from a deployment's detail page.
  //
  // Parsed safely because the URL is typed by hand as often as it is navigated
  // to: `?size=`, a status the enum does not hold, or a stale link from before a
  // filter was renamed would otherwise throw inside render and blank the page.
  // An unparseable URL falls back to the unfiltered feed rather than to nothing.
  const query = useMemo(() => {
    const parsed = forgeDeploymentQuerySchema.safeParse({
      limit: params.get("size") ?? undefined,
      sort: params.get("sort") ?? undefined,
      direction: params.get("direction") ?? undefined,
      status: params.getAll("status"),
      project: params.get("project"),
      search: params.get("search"),
      kind: params.get("kind"),
      branch: params.get("branch"),
      repo: params.get("repo"),
      since: dayStart(params.get("since")),
      until: dayEnd(params.get("until")),
    });
    return parsed.success ? parsed.data : forgeDeploymentQuerySchema.parse({});
  }, [params]);

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

  const [restarting, setRestarting] = useState<Set<string>>(() => new Set());
  const restart = async (id: string) => {
    setRestarting((current) => new Set(current).add(id));
    try {
      await api.forge.restart(id);
      toast.success("Deployment restarted");
      await reload();
    } catch (restartError) {
      toast.error(errorMessage(restartError));
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const total = data?.total ?? 0;
  const shown = data?.deployments.length ?? 0;
  const filtered =
    query.status.length > 0 ||
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
                restarting={restarting.has(deployment.id)}
                onRestart={() => void restart(deployment.id)}
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
  restarting,
  onRestart,
}: {
  deployment: ForgeDeploymentSummary;
  restarting: boolean;
  onRestart: () => void;
}) {
  const router = useRouter();
  const href = `/deployments/${deployment.id}`;

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

      <span className="flex w-40 shrink-0 items-center gap-1.5">
        <StatusDot
          tone={deploymentTone(deployment.status)}
          label={deployment.status}
        />
        <span className="capitalize">
          {deploymentLabel(deployment.status, deployment.phase)}
        </span>
        <span className="tabular-nums text-muted-foreground">
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

      <span className="flex w-7 shrink-0 justify-end">
        {deployment.status === "ready" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={restarting}
            onClick={onRestart}
            aria-label="Restart deployment"
          >
            <RotateCw
              className={cn("size-3.5", restarting && "animate-spin")}
            />
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

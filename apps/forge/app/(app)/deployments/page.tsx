"use client";

import {
  DeploymentBadges,
  deploymentLabel,
  deploymentTone,
} from "@repo/cloud-ui/deploy-status";
import {
  formatBytes,
  formatDurationMs,
  formatRelative,
} from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  DEPLOYMENT_STATUSES,
  type DeploymentStatus,
  type ForgeDeploymentSort,
  forgeDeploymentQuerySchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCw,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { api, errorMessage } from "@/lib/api";
import { ProjectGroupRow } from "../_components/project-group-ui";
import { groupByProject } from "../_components/project-groups";
import { ProjectPicker } from "../_components/project-picker";

const PAGE_SIZES = [25, 50, 100, 200];

const SORTABLE: { key: ForgeDeploymentSort; label: string; end?: true }[] = [
  { key: "projectSlug", label: "project" },
  { key: "status", label: "status" },
  { key: "imageSizeBytes", label: "image", end: true },
  { key: "buildDurationMs", label: "build", end: true },
  { key: "createdAt", label: "created" },
];

function DeploymentsTable() {
  const router = useRouter();
  const params = useSearchParams();

  // The URL is the state. A filtered view stays linkable, survives a refresh
  // and comes back intact from a deployment's detail page.
  const query = useMemo(
    () =>
      forgeDeploymentQuerySchema.parse({
        limit: params.get("size") ?? undefined,
        offset: params.get("offset") ?? undefined,
        sort: params.get("sort") ?? undefined,
        direction: params.get("direction") ?? undefined,
        status: params.getAll("status"),
        project: params.get("project"),
        search: params.get("search"),
      }),
    [params],
  );

  const setQuery = (
    next: Partial<Record<string, string | number | null | string[]>>,
    { keepOffset = false }: { keepOffset?: boolean } = {},
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
    // Any change to what is being listed invalidates the page number — page 7
    // of an unfiltered list is rarely page 7 of a filtered one.
    if (!keepOffset) search.delete("offset");
    router.replace(search.size === 0 ? "?" : `?${search}`, { scroll: false });
  };

  const fetchPage = useMemo(() => () => api.forge.deployments(query), [query]);
  const { data, error, loading, reload } = usePoll(fetchPage, 30_000);
  const groups = useMemo(
    () =>
      groupByProject(
        data?.deployments ?? [],
        (deployment) => ({
          projectSlug: deployment.projectSlug,
          kind: deployment.kind,
        }),
        // The server already ordered this page by the selected sort; regrouping
        // alphabetically would make the sort control look broken.
        "input",
      ),
    [data],
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

  const toggleSort = (key: ForgeDeploymentSort) =>
    setQuery({
      sort: key,
      direction:
        query.sort === key && query.direction === "desc" ? "asc" : "desc",
    });

  const toggleStatus = (status: DeploymentStatus) =>
    setQuery({
      status: query.status.includes(status)
        ? query.status.filter((entry) => entry !== status)
        : [...query.status, status],
    });

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : query.offset + 1;
  const last = Math.min(query.offset + query.limit, total);
  const filtered =
    query.status.length > 0 || query.project !== null || query.search !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="deployments"
        detail={
          data
            ? `${first}–${last} of ${total}${filtered ? " matched" : ""}`
            : undefined
        }
      >
        <SearchBox
          value={query.search ?? ""}
          onChange={(search) => setQuery({ search: search || null })}
        />
      </PageHeading>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ProjectPicker
          options={(data?.projects ?? []).map((slug) => ({ slug }))}
          selected={query.project}
          onSelect={(project) => setQuery({ project })}
          allLabel="all projects"
        />

        <div className="flex flex-wrap items-center gap-1">
          {DEPLOYMENT_STATUSES.map((status) => {
            const active = query.status.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(status)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {status}
              </button>
            );
          })}
        </div>

        {filtered ? (
          <button
            type="button"
            onClick={() =>
              setQuery({ status: null, project: null, search: null })
            }
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            clear
          </button>
        ) : null}
      </div>

      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {data ? (
        <div
          className={cn(
            "transition-opacity",
            loading ? "opacity-60" : "opacity-100",
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {SORTABLE.map((column) => (
                  <TableHead
                    key={column.key}
                    className={column.end ? "text-right" : undefined}
                  >
                    <SortButton
                      label={column.label}
                      active={query.sort === column.key}
                      direction={query.direction}
                      end={column.end}
                      onClick={() => toggleSort(column.key)}
                    />
                  </TableHead>
                ))}
                <TableHead>commit</TableHead>
                <TableHead>host</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap((group) => [
                <ProjectGroupRow
                  key={`${group.projectSlug}-group`}
                  slug={group.projectSlug}
                  detail={group.all.length}
                  columns={8}
                />,
                // Production first, previews inset beneath it. Grouping is within
                // the page only: paging is server-side `limit/offset`, so a
                // project with many deployments genuinely does continue onto the
                // next page, and pretending otherwise would mean paging groups
                // the endpoint cannot count.
                ...[...group.production, ...group.previews].map(
                  (deployment) => (
                    <TableRow
                      key={deployment.id}
                      // The link in the project cell is the real navigation — this
                      // only widens its target. Clicks landing on the row's own
                      // links and buttons are left to them.
                      onClick={(event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest("a,button")
                        ) {
                          return;
                        }
                        router.push(`/deployments/${deployment.id}`);
                      }}
                      className="cursor-pointer"
                    >
                      <TableCell
                        className={
                          deployment.kind === "production" ? undefined : "pl-9"
                        }
                      >
                        <div className="flex w-56 flex-col gap-1">
                          <span className="flex items-center gap-2">
                            <Link
                              href={`/deployments/${deployment.id}`}
                              title={deployment.gitRef}
                              className={cn(
                                "truncate hover:underline",
                                deployment.kind === "production"
                                  ? "font-medium"
                                  : "text-xs",
                              )}
                            >
                              {deployment.gitRef.replace(/^refs\/heads\//, "")}
                            </Link>
                            <span className="flex shrink-0 items-center gap-1">
                              <DeploymentBadges
                                kind={deployment.kind}
                                status={deployment.status}
                              />
                            </span>
                          </span>
                          <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={deployment.targetName}
                          >
                            {deployment.targetName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot
                            tone={deploymentTone(deployment.status)}
                            label={deployment.status}
                          />
                          {deploymentLabel(deployment.status, deployment.phase)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {deployment.imageSizeBytes === null
                          ? "—"
                          : formatBytes(deployment.imageSizeBytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatDurationMs(deployment.buildDurationMs)}
                      </TableCell>
                      <TableCell>
                        {formatRelative(deployment.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex w-48 flex-col">
                          <span className="font-mono text-xs">
                            {deployment.gitSha.slice(0, 7)}
                          </span>
                          <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={deployment.gitMessage ?? deployment.gitRef}
                          >
                            {deployment.gitMessage ?? deployment.gitRef}
                          </span>
                        </div>
                      </TableCell>
                      {/* A preview hostname is slug + branch + sha and runs past
                          60 characters. `TableCell` is `whitespace-nowrap`, so
                          unbounded it widens the column until the table scrolls
                          sideways and the actions fall off the edge.
                          `max-w-*` will not hold it: an auto-layout table sizes
                          columns from content and ignores a cell's max-width, so
                          the truncating element needs a definite width of its
                          own. */}
                      <TableCell>
                        <a
                          className="flex w-56 items-center gap-1 hover:underline"
                          href={`https://${deployment.hostname}`}
                          target="_blank"
                          rel="noreferrer"
                          title={deployment.hostname}
                        >
                          <span className="truncate">
                            {deployment.hostname}
                          </span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            asChild
                          >
                            <Link
                              href={`/deployments/${deployment.id}`}
                              aria-label="Logs"
                            >
                              <ScrollText className="size-3.5" />
                            </Link>
                          </Button>
                          {deployment.status === "ready" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              disabled={restarting.has(deployment.id)}
                              onClick={() => void restart(deployment.id)}
                              aria-label="Restart deployment"
                            >
                              <RotateCw
                                className={`size-3.5 ${restarting.has(deployment.id) ? "animate-spin" : ""}`}
                              />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                ),
              ])}
              {data.deployments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between gap-4">
            <NativeSelect
              size="sm"
              aria-label="Rows per page"
              value={String(query.limit)}
              onChange={(event) => setQuery({ size: event.target.value })}
            >
              {PAGE_SIZES.map((size) => (
                <NativeSelectOption key={size} value={String(size)}>
                  {size} / page
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={query.offset === 0}
                aria-label="Previous page"
                onClick={() =>
                  setQuery(
                    { offset: Math.max(0, query.offset - query.limit) },
                    { keepOffset: true },
                  )
                }
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={last >= total}
                aria-label="Next page"
                onClick={() =>
                  setQuery(
                    { offset: query.offset + query.limit },
                    { keepOffset: true },
                  )
                }
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortButton({
  label,
  active,
  direction,
  end,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  end?: true;
  onClick: () => void;
}) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}`}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground",
        end && "flex-row-reverse",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      {active ? <Arrow className="size-3" /> : null}
    </button>
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
    <Suspense fallback={<Skeleton className="h-64" />}>
      <DeploymentsTable />
    </Suspense>
  );
}

"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { RESOURCE_KINDS, type ResourceKind } from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ResourceKindBadge } from "@/components/resource-badges";
import { api } from "@/lib/api";

function ResourcesTable() {
  const router = useRouter();
  const params = useSearchParams();

  const kind = (params.get("kind") ?? null) as ResourceKind | null;
  const search = params.get("search");
  const unconnected = params.get("unconnected") === "true";

  const setQuery = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    router.replace(query.size === 0 ? "?" : `?${query}`, { scroll: false });
  };

  const fetchResources = useCallback(
    () => api.deploy.resources({ kind, search, unconnected }),
    [kind, search, unconnected],
  );
  const { data, error, loading } = usePoll(fetchResources, null);

  const counts = useMemo(() => {
    const byKind = new Map<ResourceKind, number>();
    for (const resource of data ?? []) {
      byKind.set(resource.kind, (byKind.get(resource.kind) ?? 0) + 1);
    }
    return byKind;
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="resources"
        detail={data ? `${data.length} live` : undefined}
      >
        <SearchBox
          value={search ?? ""}
          onChange={(value) => setQuery({ search: value || null })}
        />
      </PageHeading>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            active={kind === null}
            onClick={() => setQuery({ kind: null })}
          >
            all
          </FilterChip>
          {RESOURCE_KINDS.map((option) => (
            <FilterChip
              key={option}
              active={kind === option}
              onClick={() => setQuery({ kind: option })}
            >
              {option}
              {counts.has(option) ? (
                <span className="ml-1 tabular-nums opacity-60">
                  {counts.get(option)}
                </span>
              ) : null}
            </FilterChip>
          ))}
        </div>

        <FilterChip
          active={unconnected}
          onClick={() => setQuery({ unconnected: unconnected ? null : "true" })}
        >
          unconnected
        </FilterChip>
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
                <TableHead>name</TableHead>
                <TableHead>kind</TableHead>
                <TableHead>engine</TableHead>
                <TableHead>database</TableHead>
                <TableHead className="text-right">connections</TableHead>
                <TableHead className="text-right">created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((resource) => (
                <TableRow key={resource.id}>
                  <TableCell>
                    <Link
                      href={`/resources/${resource.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {resource.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ResourceKindBadge kind={resource.kind} />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {resource.engine}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {resource.database ?? resource.bucket ?? "—"}
                  </TableCell>
                  {/* Zero is the normal case, not an error: four of these
                      applications deploy on Vercel and only use the Pi's
                      postgres, so nothing here connects them. */}
                  <TableCell className="text-right text-xs tabular-nums">
                    {resource.connectionCount === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      resource.connectionCount
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatRelative(resource.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Local so a keystroke does not rewrite the URL on every character. */
function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(draft.trim())}
        placeholder="name"
        className="h-7 w-40 text-xs"
      />
    </form>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ResourcesTable />
    </Suspense>
  );
}

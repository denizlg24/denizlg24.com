"use client";

import { formatBytes, pluralize } from "@repo/cloud-ui/format";
import type { SearchHit } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FileTile, FolderTile } from "@/components/file-tiles";
import { NothingFoundIllustration } from "@/components/illustrations";
import {
  parseScope,
  ScopeToggle,
  type SearchScope,
  scopeLabel,
} from "@/components/scope-toggle";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/folder-cache";

const PAGE_SIZE = 48;

function hitHref(hit: SearchHit): string | null {
  if (hit.type === "folder") return `/folders/${hit.id}`;
  return hit.folderId ? `/folders/${hit.folderId}?preview=${hit.id}` : null;
}

/** "in Photos": the folder a hit sits in, read off its path. */
function hitLocation(hit: SearchHit): string {
  const segments = hit.path.split("/").filter(Boolean);
  const parent = segments.at(-2);
  if (segments.length <= 2)
    return hit.scope === "shared" ? "in Family" : "in My files";
  return `in ${parent ?? ""}`;
}

function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const scope = parseScope(params.get("scope"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const enabled = query.length >= 2;

  const results = useQuery({
    queryKey: keys.search(query, scope, page),
    queryFn: () => api.search({ q: query, scope, page, limit: PAGE_SIZE }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const navigate = (next: { scope?: SearchScope; page?: number }) => {
    const search = new URLSearchParams({
      q: query,
      scope: next.scope ?? scope,
      page: String(next.page ?? 1),
    });
    router.replace(`/search?${search.toString()}`);
  };

  const hits = results.data?.data.hits ?? [];
  const total = results.data?.pagination.total ?? 0;
  const totalPages = results.data?.pagination.totalPages ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b px-4 pb-3 pt-3 md:px-6">
        <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
          {query ? (
            <>
              Results for{" "}
              <span className="text-muted-foreground">“{query}”</span>
            </>
          ) : (
            "Search"
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <ScopeToggle
            scope={scope}
            onChange={(next) => navigate({ scope: next })}
          />
          {enabled && results.data && (
            <span className="text-sm text-muted-foreground">
              {pluralize(total, "match", "matches")}
              {results.isFetching && " · searching…"}
            </span>
          )}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!enabled && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <NothingFoundIllustration className="text-muted-foreground/70" />
            <p className="text-base font-medium">Search your files</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Type a name in the search box above — or press ⌘K anywhere.
            </p>
          </div>
        )}
        {enabled && results.error && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <p className="text-base font-medium">
              Search isn't working right now
            </p>
            <p className="text-sm text-muted-foreground">
              {errorMessage(results.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => results.refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {enabled && results.isPending && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3">
            {Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="flex flex-col gap-2 p-2">
                <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        )}
        {enabled && results.data && hits.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <NothingFoundIllustration className="text-muted-foreground/70" />
            <p className="text-base font-medium">Nothing found</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing matched “{query}” in {scopeLabel(scope)}. Try a shorter
              word, or look in{" "}
              {scope === "all" ? "a folder directly" : "Everything"}.
            </p>
          </div>
        )}
        {hits.length > 0 && (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3"
            aria-label="Search results"
          >
            {hits.map((hit) => {
              const href = hitHref(hit);
              const open = () => {
                if (href) router.push(href);
              };
              const location = hitLocation(hit);
              return hit.type === "folder" ? (
                <FolderTile
                  key={hit.id}
                  name={hit.name}
                  meta={location}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open();
                  }}
                  tabIndex={0}
                />
              ) : (
                <FileTile
                  key={hit.id}
                  file={{
                    id: hit.id,
                    mimeType: hit.mimeType ?? null,
                    name: hit.name,
                    sizeBytes: hit.sizeBytes ?? 0,
                    updatedAt: new Date(hit.updatedAt).toISOString(),
                  }}
                  meta={`${location} · ${formatBytes(hit.sizeBytes ?? 0)}`}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open();
                  }}
                  tabIndex={0}
                />
              );
            })}
          </ul>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-4 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => navigate({ page: page - 1 })}
            >
              Previous
            </Button>
            <span className="tabular-nums text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => navigate({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchResults />
    </Suspense>
  );
}

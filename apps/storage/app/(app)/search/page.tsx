"use client";

import { formatBytes, formatRelative, pluralize } from "@repo/cloud-ui/format";
import type { SearchHit } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Folder } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ScopeToggle, type SearchScope } from "@/components/scope-toggle";
import { api, errorMessage } from "@/lib/api";
import { fileIcon } from "@/lib/file-kind";

function hitHref(hit: SearchHit): string | null {
  if (hit.type === "folder") return `/folders/${hit.id}`;
  return hit.folderId ? `/folders/${hit.folderId}?preview=${hit.id}` : null;
}

function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const scope: SearchScope =
    params.get("scope") === "shared" ? "shared" : "user";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setHits([]);
      setTotal(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .search({ q: query, scope, page, limit: 50 })
      .then((result) => {
        if (!active) return;
        setHits(result.data.hits);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setHits([]);
        setTotalPages(0);
        setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, scope, page]);

  const setScope = (next: SearchScope) =>
    router.replace(`/search?q=${encodeURIComponent(query)}&scope=${next}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-12 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
        <h1 className="min-w-0 truncate text-sm">
          {query ? (
            <>
              Results for <span className="font-medium">“{query}”</span>
            </>
          ) : (
            "Search"
          )}
        </h1>
        <ScopeToggle scope={scope} onChange={setScope} className="ml-auto" />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {query.length < 2 && (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            Press ⌘K to search your files.
          </p>
        )}
        {error && (
          <p className="px-4 py-16 text-center text-sm text-destructive">
            {error}
          </p>
        )}
        {!error && loading && query.length >= 2 && (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            Searching…
          </p>
        )}
        {!error && !loading && query.length >= 2 && hits.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            Nothing matched “{query}” in{" "}
            {scope === "user" ? "your files" : "shared files"}.
          </p>
        )}
        {hits.length > 0 && (
          <>
            <p className="px-3 pt-3 text-xs text-muted-foreground">
              {pluralize(total, "match", "matches")}
            </p>
            <ul className="divide-y">
              {hits.map((hit) => {
                const href = hitHref(hit);
                const Icon =
                  hit.type === "folder"
                    ? Folder
                    : fileIcon(hit.name, hit.mimeType ?? null);
                const body = (
                  <>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{hit.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.path}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      <span className="block">
                        {hit.type === "file" && hit.sizeBytes !== undefined
                          ? formatBytes(hit.sizeBytes)
                          : "Folder"}
                      </span>
                      <span className="block">
                        {formatRelative(new Date(hit.updatedAt).toISOString())}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={hit.id}>
                    {href ? (
                      <Link
                        href={href}
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2.5 opacity-60">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() =>
                router.replace(
                  `/search?q=${encodeURIComponent(query)}&scope=${scope}&page=${page - 1}`,
                )
              }
            >
              Previous
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() =>
                router.replace(
                  `/search?q=${encodeURIComponent(query)}&scope=${scope}&page=${page + 1}`,
                )
              }
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

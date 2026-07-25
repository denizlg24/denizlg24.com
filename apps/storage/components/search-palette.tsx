"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import type { SearchHit } from "@repo/schemas/cloud";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { Folder, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ScopeToggle, type SearchScope } from "@/components/scope-toggle";
import { api, errorMessage } from "@/lib/api";
import { fileIcon } from "@/lib/file-kind";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 220;

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("user");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setHits([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const generation = ++requestId.current;
    const timer = setTimeout(() => {
      api
        .search({ q: trimmed, scope, limit: 8 })
        .then((result) => {
          if (generation !== requestId.current) return;
          setHits(result.data.hits);
          setTotal(result.pagination.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (generation !== requestId.current) return;
          setHits([]);
          setError(errorMessage(err));
        })
        .finally(() => {
          if (generation === requestId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, scope, open]);

  const go = (path: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(path);
  };

  const openHit = (hit: SearchHit) => {
    if (hit.type === "folder") {
      go(`/folders/${hit.id}`);
      return;
    }
    if (!hit.folderId) return;
    go(`/folders/${hit.folderId}?preview=${hit.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search your files</DialogTitle>
        {/* Results come ranked from the server; cmdk's own fuzzy filter would
            re-order and hide them. */}
        <Command shouldFilter={false} className="[&_[cmdk-item]]:px-3">
          <CommandInput
            autoFocus
            placeholder="Search files and folders…"
            value={query}
            onValueChange={setQuery}
          />
          <div className="flex items-center gap-1 border-b px-3 py-1.5">
            <ScopeToggle scope={scope} onChange={setScope} />
            {loading && (
              <span className="ml-auto text-xs text-muted-foreground">
                Searching…
              </span>
            )}
          </div>
          <CommandList className="max-h-[60dvh]">
            {error && (
              <p className="px-3 py-6 text-center text-sm text-destructive">
                {error}
              </p>
            )}
            {!error && query.trim().length < MIN_QUERY && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type at least {MIN_QUERY} characters to search.
              </p>
            )}
            {!error && query.trim().length >= MIN_QUERY && !loading && (
              <CommandEmpty>
                Nothing matched “{query.trim()}” in{" "}
                {scope === "user" ? "your files" : "shared files"}.
              </CommandEmpty>
            )}
            {hits.length > 0 && (
              <CommandGroup>
                {hits.map((hit) => {
                  const Icon =
                    hit.type === "folder"
                      ? Folder
                      : fileIcon(hit.name, hit.mimeType ?? null);
                  return (
                    <CommandItem
                      key={hit.id}
                      value={hit.id}
                      onSelect={() => openHit(hit)}
                      className="gap-3"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {hit.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {hit.type === "file" && hit.sizeBytes !== undefined
                          ? formatBytes(hit.sizeBytes)
                          : "Folder"}
                      </span>
                    </CommandItem>
                  );
                })}
                {total > hits.length && (
                  <CommandItem
                    value="__all__"
                    className="gap-3 text-muted-foreground"
                    onSelect={() =>
                      go(
                        `/search?q=${encodeURIComponent(query.trim())}&scope=${scope}`,
                      )
                    }
                  >
                    <Search className="size-4 shrink-0" />
                    See all {total} results
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the palette on ⌘K / Ctrl-K and on `/` outside a text field. */
export function useSearchHotkey(open: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        open();
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
}

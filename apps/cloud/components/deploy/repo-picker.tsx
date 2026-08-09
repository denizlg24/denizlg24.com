"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { GithubRepositorySummary, RepoBadge } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/** How many repositories are rendered, and therefore badged, at once. */
const PAGE_SIZE = 10;

/**
 * Framework and monorepo badges for the rows on screen, keyed by full name.
 *
 * Failure is silent by design: a badge is decoration, and a repository the App
 * cannot read should cost nothing more than a missing chip.
 */
function useRepoBadges(
  repos: GithubRepositorySummary[],
): Map<string, RepoBadge> {
  const [badges, setBadges] = useState<Map<string, RepoBadge>>(new Map());
  // What has already been asked for, including names that came back empty.
  // Held in a ref rather than derived from `badges` so the effect does not
  // depend on the state it sets — a repository the App cannot read resolves to
  // no badge, and re-running on that would ask again forever.
  const requested = useRef(new Set<string>());
  // The identity of `repos` changes on every render of the parent, so the
  // effect is keyed on what it actually depends on: which repositories.
  const key = repos.map((repo) => repo.fullName).join(",");

  useEffect(() => {
    const missing = (key ? key.split(",") : []).filter((fullName) => {
      const id = fullName.toLowerCase();
      if (requested.current.has(id)) return false;
      requested.current.add(id);
      return true;
    });
    if (missing.length === 0) return;

    let cancelled = false;
    void api.deploy.github
      .badges(
        missing.flatMap((fullName) => {
          const [owner, name] = fullName.split("/");
          return owner && name ? [{ owner, name }] : [];
        }),
      )
      .then((results) => {
        if (cancelled) return;
        setBadges((current) => {
          const next = new Map(current);
          for (const badge of results) {
            next.set(`${badge.owner}/${badge.name}`.toLowerCase(), badge);
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return badges;
}

/**
 * The connect state and the repository list are one surface because they are
 * one question — which repository — and the answer to "none listed" is always
 * the install link, never a separate screen to navigate to.
 */
export function RepoPicker({
  onSelect,
}: {
  onSelect: (repo: GithubRepositorySummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  // usePoll refetches when its callback's identity changes, so bumping this is
  // how a sync makes both lists re-read the table it just rebuilt. It is the
  // only dependency either callback has, and deliberately so.
  const [generation, setGeneration] = useState(0);
  const fetchConnection = useCallback(
    () => api.deploy.github.connection(),
    [generation],
  );
  const fetchRepositories = useCallback(
    () => api.deploy.github.repositories(),
    [generation],
  );
  const { data: connection } = usePoll(fetchConnection, null);
  const {
    data: repositories,
    loading,
    error,
  } = usePoll(fetchRepositories, null);

  async function sync() {
    setSyncing(true);
    try {
      const installations = await api.deploy.github.syncInstallations();
      setGeneration((current) => current + 1);
      toast.success(
        installations.length === 0
          ? "No installations"
          : `${installations.length} installation(s)`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = repositories ?? [];
    if (!needle) return all;
    return all.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [repositories, query]);

  // Only what is on screen. Badging every repository an installation exposes is
  // one Contents call each against its rate limit, for a badge nobody has
  // scrolled to.
  const visible = useMemo(() => filtered.slice(0, PAGE_SIZE), [filtered]);
  const badges = useRepoBadges(visible);

  const installUrl = connection?.installUrl ?? null;
  const connected = (connection?.installations.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          placeholder="Search repositories"
          className="h-8 max-w-xs text-xs"
          onChange={(event) => setQuery(event.target.value)}
        />
        {installUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={installUrl} target="_blank" rel="noreferrer">
              {connected ? "Configure access" : "Connect GitHub"}
            </a>
          </Button>
        )}
        {/* The App has one webhook URL and it points at the deployed API, so
            an install performed while running locally is never announced here.
            This pulls the current state from GitHub instead of waiting. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={syncing}
          onClick={() => void sync()}
        >
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col">
        {visible.map((repo) => {
          const badge = badges.get(repo.fullName.toLowerCase());
          return (
            <button
              key={`${repo.installationId}:${repo.id}`}
              type="button"
              onClick={() => onSelect(repo)}
              className="flex items-center justify-between gap-3 border-b py-2 text-left hover:bg-muted/40"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs">
                  {repo.fullName}
                </span>
                {badge?.isTurbo && (
                  <Badge variant="secondary" className="shrink-0">
                    Turbo
                  </Badge>
                )}
                {badge?.frameworkLabel && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {badge.frameworkLabel}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                {repo.private && <span>private</span>}
                <span>{repo.defaultBranch}</span>
                {repo.pushedAt && <span>{formatRelative(repo.pushedAt)}</span>}
              </span>
            </button>
          );
        })}
        {!loading && filtered.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            {repositories === null || repositories.length === 0 ? "—" : "0"}
          </p>
        )}
        {filtered.length > visible.length && (
          <p className="py-2 text-xs text-muted-foreground tabular-nums">
            {filtered.length - visible.length} more — search to narrow
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { GithubRepositorySummary } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

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
        {filtered.map((repo) => (
          <button
            key={`${repo.installationId}:${repo.id}`}
            type="button"
            onClick={() => onSelect(repo)}
            className="flex items-center justify-between gap-3 border-b py-2 text-left hover:bg-muted/40"
          >
            <span className="truncate font-mono text-xs">{repo.fullName}</span>
            <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
              {repo.private && <span>private</span>}
              <span>{repo.defaultBranch}</span>
              {repo.pushedAt && <span>{formatRelative(repo.pushedAt)}</span>}
            </span>
          </button>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            {repositories === null || repositories.length === 0 ? "—" : "0"}
          </p>
        )}
      </div>
    </div>
  );
}

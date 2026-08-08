"use client";

import { Button } from "@repo/ui/button";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";

interface Entry {
  path: string;
  name: string;
  type: "file" | "dir";
}

/**
 * Walks one directory at a time rather than rendering a whole tree: the
 * Contents API is a request per level either way, and a recursive listing of a
 * large repository is megabytes to answer "which of these four apps".
 */
export function DirectoryBrowser({
  owner,
  repo,
  gitRef,
  value,
  workspaces,
  onChange,
}: {
  owner: string;
  repo: string;
  gitRef: string;
  value: string;
  workspaces: { path: string; name: string }[];
  onChange: (path: string) => void;
}) {
  const [browsing, setBrowsing] = useState(value);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        setEntries(
          await api.deploy.github.tree(owner, repo, { ref: gitRef, path }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [owner, repo, gitRef],
  );

  useEffect(() => {
    void load(browsing);
  }, [load, browsing]);

  const segments = browsing.split("/").filter(Boolean);
  const directories = entries.filter((entry) => entry.type === "dir");

  return (
    <div className="flex flex-col gap-3">
      {workspaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {workspaces.map((workspace) => (
            <button
              key={workspace.path}
              type="button"
              onClick={() => {
                setBrowsing(workspace.path);
                onChange(workspace.path);
              }}
              className={`rounded-sm border px-1.5 py-0.5 font-mono text-xs ${
                value === workspace.path
                  ? "border-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {workspace.path}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 font-mono text-xs">
        <button
          type="button"
          onClick={() => setBrowsing("")}
          className="text-muted-foreground hover:text-foreground"
        >
          {repo}
        </button>
        {segments.map((segment, index) => {
          const path = segments.slice(0, index + 1).join("/");
          return (
            <span key={path} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                onClick={() => setBrowsing(path)}
                className="text-muted-foreground hover:text-foreground"
              >
                {segment}
              </button>
            </span>
          );
        })}
        {browsing !== value && (
          <Button
            size="sm"
            variant="outline"
            className="ml-2 h-6"
            onClick={() => onChange(browsing)}
          >
            Use this
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex max-h-56 flex-col overflow-y-auto">
        {directories.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => setBrowsing(entry.path)}
            className="border-b py-1.5 text-left font-mono text-xs hover:bg-muted/40"
          >
            {entry.name}/
          </button>
        ))}
        {!loading && directories.length === 0 && (
          <p className="py-1.5 text-xs text-muted-foreground">—</p>
        )}
      </div>
    </div>
  );
}

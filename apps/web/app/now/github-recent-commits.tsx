"use client";

import { formatDistanceToNow } from "date-fns";
import { GitCommit } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Commit {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  url: string;
  repoName: string;
}

function GitHubRecentCommitsSkeleton() {
  return (
    <div className="flex flex-col gap-3 w-full">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
          <div className="flex flex-col gap-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GitHubRecentCommits() {
  const [commits, setCommits] = useState<Commit[] | null>(null);

  useEffect(() => {
    fetch("/api/github/commits")
      .then((res) => res.json())
      .then(setCommits)
      .catch(() => {});
  }, []);

  if (!commits) return <GitHubRecentCommitsSkeleton />;

  return (
    <div className="flex flex-col gap-3 w-full">
      {commits.map((commit) => (
        <a
          key={commit.oid}
          href={commit.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
        >
          <GitCommit className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm leading-snug line-clamp-1">
              {commit.messageHeadline}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {commit.repoName}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(commit.committedDate), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

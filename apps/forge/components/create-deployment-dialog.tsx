"use client";

import {
  deploymentLabel,
  isDeploymentLive,
} from "@repo/cloud-ui/deploy-status";
import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import { GithubIcon } from "@repo/cloud-ui/tech-icon";
import type {
  Deployment,
  DeployTarget,
  ResolvedRef,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import {
  AlertCircle,
  Check,
  CircleAlert,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/** Long enough that typing a branch name is one request, not fifteen. */
const RESOLVE_DEBOUNCE_MS = 400;

/** How many branch shortcuts fit before the row stops being a shortcut. */
const SUGGESTION_LIMIT = 6;

function repoUrl(target: DeployTarget): string {
  return `https://github.com/${target.repoOwner}/${target.repoName}`;
}

/**
 * What a previously built commit means for this dialog. Deploying it again is
 * always allowed — a failed build is often re-run against a changed resource or
 * a fixed env var, and a successful one is how a rollback-by-redeploy is done —
 * so this reports and never blocks.
 */
function ExistingNotice({
  existing,
  isCurrentProduction,
  href,
}: {
  existing: Deployment;
  isCurrentProduction: boolean;
  href: string;
}) {
  const failed =
    existing.status === "failed" || existing.status === "interrupted";
  const live = isDeploymentLive(existing.status);
  const Icon = failed ? CircleAlert : AlertCircle;

  const headline = failed
    ? "This commit's last deployment failed"
    : live
      ? "This commit is already building"
      : "This commit has already been built";

  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2 text-xs",
        failed
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p>
          {headline}—
          <Link
            href={href}
            target="_blank"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            view here
            <ExternalLink className="size-3" />
          </Link>
        </p>
        {failed && existing.error ? (
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] opacity-90">
            {existing.error}
          </p>
        ) : isCurrentProduction ? (
          <p className="text-muted-foreground">
            It is the current production deployment
          </p>
        ) : (
          <p className="text-muted-foreground">
            {deploymentLabel(existing.status, existing.phase ?? null)} ·{" "}
            {formatRelative(existing.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}

/** The resolved commit, in the shape the row under the input takes. */
function ResolvedCommit({ resolved }: { resolved: ResolvedRef }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs">
          {resolved.branch ?? resolved.sha.slice(0, 7)}
        </span>
        <Badge
          variant={resolved.kind === "production" ? "secondary" : "outline"}
          className="ml-auto shrink-0 text-[10px]"
        >
          {resolved.kind}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitCommitHorizontal className="size-3.5 shrink-0" />
        <span className="shrink-0 font-mono tabular-nums">
          {resolved.sha.slice(0, 7)}
        </span>
        <span className="truncate">
          {resolved.message?.split("\n")[0] ?? "—"}
        </span>
        <span
          className="ml-auto shrink-0 tabular-nums"
          title={formatDateTime(resolved.committedAt)}
        >
          {formatRelative(resolved.committedAt)}
        </span>
      </div>
    </div>
  );
}

export function CreateDeploymentDialog({
  target,
  onCreated,
}: {
  target: DeployTarget;
  onCreated: (deployment: Deployment) => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [resolved, setResolved] = useState<ResolvedRef | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.deploy.github
      .branches(target.repoOwner, target.repoName)
      .then((branches) => {
        if (!live) return;
        // Production first, then whatever else the repository has — the
        // shortcut row exists to save typing the two or three branches
        // actually in flight, not to list every merged one.
        const names = branches.map((branch) => branch.name);
        setSuggestions(
          [
            ...names.filter((name) => name === target.productionBranch),
            ...names.filter((name) => name !== target.productionBranch),
          ].slice(0, SUGGESTION_LIMIT),
        );
      })
      .catch(() => {
        // A repository whose branches cannot be listed still deploys by hand.
        if (live) setSuggestions([]);
      });
    return () => {
      live = false;
    };
  }, [open, target.repoOwner, target.repoName, target.productionBranch]);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setResolved(null);
      setError(null);
      setResolving(false);
      return;
    }
    // The response is only applied if this is still the newest request, so a
    // slow lookup for a half-typed branch cannot overwrite the final one.
    let live = true;
    setResolving(true);
    const timer = setTimeout(() => {
      api.deploy
        .resolveRef(target.id, trimmed)
        .then((next) => {
          if (!live) return;
          setResolved(next);
          setError(null);
        })
        .catch((resolveError: unknown) => {
          if (!live) return;
          setResolved(null);
          setError(errorMessage(resolveError));
        })
        .finally(() => {
          if (live) setResolving(false);
        });
    }, RESOLVE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value, target.id]);

  function reset() {
    setValue("");
    setResolved(null);
    setError(null);
    setSuggestions([]);
  }

  async function create() {
    if (!resolved) return;
    setCreating(true);
    try {
      const deployment = await api.deploy.createDeployment(target.id, {
        ref: resolved.ref,
        sha: resolved.sha,
        message: resolved.message ?? undefined,
        kind: resolved.kind,
      });
      toast.success(`Queued ${resolved.sha.slice(0, 7)}`);
      setOpen(false);
      reset();
      await onCreated(deployment);
    } catch (createError) {
      toast.error(errorMessage(createError));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          create deployment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Deployment</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <GithubIcon className="size-7 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <Link
              href={repoUrl(target)}
              target="_blank"
              className="inline-flex items-center gap-1 truncate text-sm hover:underline"
            >
              {target.repoOwner}/{target.repoName}
              <ExternalLink className="size-3 shrink-0" />
            </Link>
            <span className="text-xs text-muted-foreground">
              Connected {formatDateTime(target.createdAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="deploy-ref" className="text-xs">
            Branch, Commit, or URL
          </Label>
          <div className="relative">
            <Input
              id="deploy-ref"
              value={value}
              autoComplete="off"
              spellCheck={false}
              placeholder={repoUrl(target)}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && resolved && !creating) {
                  event.preventDefault();
                  void create();
                }
              }}
              className={cn(
                "pr-8 font-mono text-xs",
                error && "border-destructive",
              )}
            />
            <span className="-translate-y-1/2 absolute top-1/2 right-2.5">
              {resolving ? (
                <Spinner className="size-3.5 text-muted-foreground" />
              ) : resolved ? (
                <Check className="size-3.5 text-muted-foreground" />
              ) : null}
            </span>
          </div>

          {value.trim().length === 0 && suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => setValue(branch)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs hover:bg-accent"
                >
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{branch}</span>
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {resolved ? <ResolvedCommit resolved={resolved} /> : null}
          {resolved?.existing ? (
            <ExistingNotice
              existing={resolved.existing}
              isCurrentProduction={resolved.existingIsCurrentProduction}
              href={`/deployments/${resolved.existing.id}`}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!resolved || creating}
            variant={resolved?.kind === "production" ? "default" : "secondary"}
            onClick={() => void create()}
          >
            {resolved?.kind === "production"
              ? "Deploy to Production"
              : "Create Preview Deployment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

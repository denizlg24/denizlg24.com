"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { DeployEnvironmentListEntry } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { BranchRoutes, BranchRules } from "@/components/branch-rules";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

/** Slow enough not to hammer the remote, which `branchRoutes` reads. */
const POLL_MS = 30_000;

export default function EnvironmentsPage() {
  const { target } = useTarget();
  const targetId = target.id;

  const fetchEnvironments = useCallback(
    () => api.deploy.environments(targetId),
    [targetId],
  );
  const {
    data: environments,
    error,
    loading,
    reload: reloadEnvironments,
  } = usePoll(fetchEnvironments, POLL_MS);

  const fetchRules = useCallback(
    () => api.deploy.branchRules(targetId),
    [targetId],
  );
  const { data: rules, reload: reloadRules } = usePoll(fetchRules, POLL_MS);

  const fetchRoutes = useCallback(
    () => api.deploy.branchRoutes(targetId),
    [targetId],
  );
  const { data: routes, reload: reloadRoutes } = usePoll(fetchRoutes, POLL_MS);

  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (label: string, run: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await run();
        toast.success(label);
        // All three views read the same rows from different angles, and a rule
        // added against a new environment is wrong in two of them until every
        // one is refreshed.
        await Promise.all([
          reloadEnvironments(),
          reloadRules(),
          reloadRoutes(),
        ]);
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [reloadEnvironments, reloadRules, reloadRoutes],
  );

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!environments && loading) return <Skeleton className="h-40 w-full" />;

  const rows = environments ?? [];
  const normalizedName = name.trim();
  const nameValid = /^[a-z0-9][a-z0-9-]*$/.test(normalizedName);
  const branchNames = (routes ?? []).map((route) => route.branch);

  function create() {
    if (!nameValid || busy) return;
    void act("Environment created", async () => {
      await api.deploy.createEnvironment(targetId, {
        name: normalizedName,
        autoDeploy: true,
        branches:
          branch.trim().length > 0
            ? [{ matchType: "exact", pattern: branch.trim() }]
            : [],
      });
      setName("");
      setBranch("");
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Environments" count={rows.length}>
        <div className="flex flex-col">
          {rows.map((environment) => (
            <EnvironmentRow
              key={environment.id}
              environment={environment}
              productionBranch={target.productionBranch}
              busy={busy}
              onToggleAutoDeploy={(autoDeploy) =>
                act("Saved", () =>
                  api.deploy.updateEnvironment(environment.id, { autoDeploy }),
                )
              }
              onTogglePaused={(paused) =>
                act(paused ? "Paused" : "Resumed", () =>
                  api.deploy.updateEnvironment(environment.id, { paused }),
                )
              }
              onRemove={() =>
                act("Environment deleted", () =>
                  api.deploy.deleteEnvironment(environment.id),
                )
              }
            />
          ))}
          {rows.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">—</p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Input
              value={name}
              placeholder="staging"
              aria-label="Environment name"
              className="h-8 w-40 font-mono text-xs"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") create();
              }}
            />
            <Input
              value={branch}
              placeholder="branch"
              aria-label="Branch"
              list="environment-branches"
              className="h-8 w-48 font-mono text-xs"
              onChange={(event) => setBranch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") create();
              }}
            />
            <datalist id="environment-branches">
              {branchNames.map((candidate) => (
                <option key={candidate} value={candidate} />
              ))}
            </datalist>
            <Button
              size="sm"
              disabled={!nameValid || busy}
              onClick={create}
              className="h-8"
            >
              <Plus className="size-3" />
              Add
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Branch rules" count={(rules ?? []).length}>
        <BranchRules
          rules={rules ?? []}
          environments={rows}
          branches={branchNames}
          busy={busy}
          onCreate={(input) =>
            act("Rule added", () =>
              api.deploy.createBranchRule(targetId, {
                ...input,
                enabled: true,
              }),
            )
          }
          onUpdate={(id, changes) =>
            act("Saved", () => api.deploy.updateBranchRule(id, changes))
          }
          onDelete={(id) =>
            act("Rule removed", () => api.deploy.deleteBranchRule(id))
          }
        />
      </Section>

      <Section title="Branches" count={(routes ?? []).length}>
        <BranchRoutes routes={routes ?? []} />
      </Section>
    </div>
  );
}

function EnvironmentRow({
  environment,
  productionBranch,
  busy,
  onToggleAutoDeploy,
  onTogglePaused,
  onRemove,
}: {
  environment: DeployEnvironmentListEntry;
  productionBranch: string;
  busy: boolean;
  onToggleAutoDeploy: (autoDeploy: boolean) => void;
  onTogglePaused: (paused: boolean) => void;
  onRemove: () => void;
}) {
  const latest = environment.latestDeployment;
  const paused = environment.pausedAt !== null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b py-3">
      <span className="font-mono text-sm">{environment.name}</span>
      <Link
        href={environment.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-baseline gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
      >
        {environment.hostname}
        <ArrowUpRight className="size-3 self-center" />
      </Link>
      <span className="text-xs tabular-nums text-muted-foreground">
        {environment.memoryReservationResolvedMb} MB
      </span>
      <span className="text-xs text-muted-foreground">
        {environment.branchRuleCount} rule
        {environment.branchRuleCount === 1 ? "" : "s"}
      </span>
      <span className="text-xs text-muted-foreground">
        {latest
          ? `${latest.status} · ${latest.gitRef} · ${formatRelative(latest.createdAt)}`
          : `never deployed · not ${productionBranch}`}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          auto
          <Switch
            aria-label="Auto deploy"
            checked={environment.autoDeploy}
            disabled={busy}
            onCheckedChange={onToggleAutoDeploy}
          />
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          paused
          <Switch
            aria-label="Paused"
            checked={paused}
            disabled={busy}
            onCheckedChange={onTogglePaused}
          />
        </span>
        <TypedConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" disabled={busy}>
              Delete
            </Button>
          }
          title={`Delete ${environment.name}`}
          keyword={environment.name}
          actionLabel="Delete"
          onConfirm={onRemove}
        />
      </div>
    </div>
  );
}

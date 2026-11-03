"use client";

import type {
  CreateSprintInput,
  RunConfigOverride,
  Sprint,
  UpdateSprint,
} from "@repo/schemas";
import {
  DEFAULT_RUN_CONFIG,
  gitBranchSchema,
  sprintRepoSchema,
} from "@repo/schemas";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { SectionLabel } from "@repo/ui/section";
import { Textarea } from "@repo/ui/textarea";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { isRunConfigComplete, RunConfigFields } from "./run-config-fields";
import { errorMessage } from "./sprint-meta";

let repoCache: string[] | null = null;

function useRepos(open: boolean): string[] {
  const { client } = useAdmin();
  const [repos, setRepos] = useState<string[]>(() => repoCache ?? []);
  useEffect(() => {
    if (!open || repoCache) return;
    let cancelled = false;
    client
      .get<{ repos: string[] }>("sprints/repos")
      .then((result) => {
        repoCache = result.repos;
        if (!cancelled) setRepos(result.repos);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, open]);
  return repos;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

interface Draft {
  title: string;
  goal: string;
  repo: string;
  baseBranch: string;
  branch: string;
  timeZone: string;
  defaults: RunConfigOverride;
}

function draftOf(sprint: Sprint | null): Draft {
  return {
    title: sprint?.title ?? "",
    goal: sprint?.goal ?? "",
    repo: sprint?.repo ?? "",
    baseBranch: sprint?.baseBranch ?? "main",
    branch: sprint?.branch ?? "",
    timeZone: sprint?.timeZone ?? localTimeZone(),
    defaults: {},
  };
}

/**
 * Create a sprint, or edit an existing one's identity (not its defaults).
 * Mounted while open: the draft is taken from props once.
 */
export function SprintDialog({
  open,
  sprint,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  sprint: Sprint | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (sprint: Sprint) => void;
}) {
  const { client } = useAdmin();
  const repos = useRepos(open);
  const repoListId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(sprint));
  const [pending, setPending] = useState(false);

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const repoValid = sprintRepoSchema.safeParse(draft.repo).success;
  const baseValid = gitBranchSchema.safeParse(draft.baseBranch).success;
  const branchValid =
    !draft.branch.trim() || gitBranchSchema.safeParse(draft.branch).success;
  const valid =
    draft.title.trim().length > 0 &&
    repoValid &&
    baseValid &&
    branchValid &&
    draft.timeZone.trim().length > 0 &&
    isRunConfigComplete(draft.defaults);

  const submit = async () => {
    setPending(true);
    try {
      if (sprint) {
        const body: UpdateSprint = {
          title: draft.title.trim(),
          goal: draft.goal,
          repo: draft.repo.trim(),
          baseBranch: draft.baseBranch.trim(),
          timeZone: draft.timeZone.trim(),
          ...(sprint.branchLocked || !draft.branch.trim()
            ? {}
            : { branch: draft.branch.trim() }),
        };
        const result = await client.patch<{ sprint: Sprint }>(
          `sprints/${sprint.id}`,
          body,
        );
        onSaved(result.sprint);
      } else {
        const body: CreateSprintInput = {
          title: draft.title.trim(),
          goal: draft.goal,
          repo: draft.repo.trim(),
          baseBranch: draft.baseBranch.trim(),
          timeZone: draft.timeZone.trim(),
          defaults: draft.defaults,
          ...(draft.branch.trim() ? { branch: draft.branch.trim() } : {}),
        };
        const result = await client.post<{ sprint: Sprint }>("sprints", body);
        onSaved(result.sprint);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Save failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={sprint ? "Edit sprint" : "New sprint"}
      submitLabel={sprint ? "Save" : "Create"}
      submitDisabled={!valid}
      pending={pending}
      onSubmit={submit}
    >
      <FormGrid>
        <FormField label="Title" className="sm:col-span-2">
          <Input
            autoFocus
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
          />
        </FormField>
        <FormField
          label="Repository"
          error={draft.repo && !repoValid ? "owner/name" : undefined}
        >
          <Input
            list={repoListId}
            value={draft.repo}
            placeholder="owner/name"
            spellCheck={false}
            className="font-mono text-xs md:text-xs"
            onChange={(event) => set({ repo: event.target.value })}
          />
          <datalist id={repoListId}>
            {repos.map((repo) => (
              <option key={repo} value={repo} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Time zone">
          <Input
            value={draft.timeZone}
            spellCheck={false}
            onChange={(event) => set({ timeZone: event.target.value })}
          />
        </FormField>
        <FormField
          label="Base branch"
          error={!baseValid ? "Invalid branch" : undefined}
        >
          <Input
            value={draft.baseBranch}
            spellCheck={false}
            className="font-mono text-xs md:text-xs"
            onChange={(event) => set({ baseBranch: event.target.value })}
          />
        </FormField>
        <FormField
          label="Branch"
          error={!branchValid ? "Invalid branch" : undefined}
        >
          <Input
            value={draft.branch}
            placeholder={sprint ? undefined : "sprint/…"}
            disabled={sprint?.branchLocked}
            spellCheck={false}
            className="font-mono text-xs md:text-xs"
            onChange={(event) => set({ branch: event.target.value })}
          />
        </FormField>
        <FormField label="Goal" className="sm:col-span-2">
          <Textarea
            value={draft.goal}
            rows={6}
            className="min-h-32 resize-y font-mono text-xs md:text-xs"
            onChange={(event) => set({ goal: event.target.value })}
          />
        </FormField>
      </FormGrid>
      {sprint ? null : (
        <div className="flex flex-col gap-3">
          <SectionLabel>Defaults</SectionLabel>
          <RunConfigFields
            value={draft.defaults}
            inherited={DEFAULT_RUN_CONFIG}
            inheritedFrom="Default"
            onChange={(patch) =>
              set({ defaults: { ...draft.defaults, ...patch } })
            }
          />
        </div>
      )}
    </FormDialog>
  );
}

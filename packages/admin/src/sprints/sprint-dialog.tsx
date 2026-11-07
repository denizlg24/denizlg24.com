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
import { FormDialog } from "@repo/ui/form-dialog";
import { cn } from "@repo/ui/utils";
import {
  FolderGit2,
  GitBranch,
  GitPullRequestArrow,
  Globe,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { Composer, isRunConfigComplete, RunConfigPills } from "./run-composer";
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
      <div className="flex flex-col gap-3">
        <input
          aria-label="Title"
          value={draft.title}
          placeholder="Sprint title"
          className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/50"
          onChange={(event) => set({ title: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-1">
          <FieldPill
            label="Repository"
            icon={<FolderGit2 />}
            value={draft.repo}
            placeholder="owner/name"
            invalid={draft.repo !== "" && !repoValid}
            list={repoListId}
            mono
            onChange={(repo) => set({ repo })}
          />
          <datalist id={repoListId}>
            {repos.map((repo) => (
              <option key={repo} value={repo} />
            ))}
          </datalist>
          <FieldPill
            label="Base branch"
            icon={<GitBranch />}
            value={draft.baseBranch}
            placeholder="main"
            invalid={!baseValid}
            mono
            onChange={(baseBranch) => set({ baseBranch })}
          />
          <FieldPill
            label="Branch"
            icon={<GitPullRequestArrow />}
            value={draft.branch}
            placeholder={sprint ? "" : "sprint/…"}
            invalid={!branchValid}
            disabled={sprint?.branchLocked}
            mono
            onChange={(branch) => set({ branch })}
          />
          <FieldPill
            label="Time zone"
            icon={<Globe />}
            value={draft.timeZone}
            placeholder="UTC"
            invalid={!draft.timeZone.trim()}
            onChange={(timeZone) => set({ timeZone })}
          />
        </div>
        <Composer
          label="Goal"
          value={draft.goal}
          placeholder="What this sprint is for"
          rows={8}
          onChange={(goal) => set({ goal })}
          pills={
            sprint ? undefined : (
              <RunConfigPills
                value={draft.defaults}
                inherited={DEFAULT_RUN_CONFIG}
                inheritedFrom="Default"
                instructions
                onChange={(patch) =>
                  set({ defaults: { ...draft.defaults, ...patch } })
                }
              />
            )
          }
        />
      </div>
    </FormDialog>
  );
}

/** A text field shaped like the composer's pills. */
function FieldPill({
  label,
  icon,
  value,
  placeholder,
  invalid = false,
  disabled = false,
  mono = false,
  list,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  mono?: boolean;
  list?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      title={label}
      className={cn(
        "flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors focus-within:border-foreground/30 focus-within:text-foreground hover:bg-surface [&_svg]:size-3.5 [&_svg]:shrink-0",
        invalid && "border-destructive/60 text-destructive",
        disabled && "opacity-60",
      )}
    >
      {icon}
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        list={list}
        spellCheck={false}
        className={cn(
          "field-sizing-content max-w-56 min-w-12 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60",
          mono && "font-mono",
        )}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

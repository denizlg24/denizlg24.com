"use client";

import type {
  DeployPreset,
  GithubRepositorySummary,
  RepoWorkspaceContext,
  ResolvedBuildConfig,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/ui/combobox";
import { Label } from "@repo/ui/label";
import { OptionSelect } from "@repo/ui/option-select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../api-error";
import { FrameworkIcon } from "../tech-icon";
import { usePoll } from "../use-poll";
import { deployApi } from "./api";
import {
  type BuildConfigForm,
  BuildFields,
  defaultBuildConfig,
} from "./build-config-fields";
import { RootDirectoryDialog } from "./directory-browser";

/**
 * The five fields the import actually reads off a repository. Narrower than
 * `GithubRepositorySummary` so a configure step can rebuild one from its URL
 * rather than refetching every installation's repository list to find the row
 * it already had — a summary is still assignable to it, so the picker is
 * unaffected.
 */
export type ImportRepo = Pick<
  GithubRepositorySummary,
  "owner" | "name" | "fullName" | "installationId" | "defaultBranch"
>;

export interface RepoImport {
  repo: ImportRepo | null;
  select: (repo: ImportRepo | null) => void;
  branch: string;
  rootDirectory: string;
  resolved: ResolvedBuildConfig | null;
  presets: DeployPreset[];
  workspace: RepoWorkspaceContext | null;
  detecting: boolean;
  form: BuildConfigForm;
  setForm: (update: (current: BuildConfigForm) => BuildConfigForm) => void;
  redetect: () => void;
  setBranch: (branch: string) => void;
  setRootDirectory: (path: string) => void;
  setPreset: (framework: string) => void;
}

/**
 * The repository half of both create flows: which repo, which branch, which
 * directory, which preset, and what that resolves to. Shared rather than copied
 * because the two pages have to agree on when a re-detect happens — the moment
 * they disagree, one of them silently deploys with commands the form never
 * showed.
 */
export function useRepoImport(initial: ImportRepo | null = null): RepoImport {
  const [repo, setRepo] = useState<ImportRepo | null>(initial);
  const [branch, setBranchState] = useState("");
  const [rootDirectory, setRootDirectoryState] = useState("");
  const [presets, setPresets] = useState<DeployPreset[]>([]);
  const [workspace, setWorkspace] = useState<RepoWorkspaceContext | null>(null);
  const [resolved, setResolved] = useState<ResolvedBuildConfig | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [form, setForm] = useState<BuildConfigForm>(defaultBuildConfig);

  const detect = useCallback(
    async (dir: string, gitRef: string, framework: string | null) => {
      if (!repo) return;
      setDetecting(true);
      try {
        const detected = await deployApi.github.detect(repo.owner, repo.name, {
          ref: gitRef,
          dir,
          ...(framework ? { framework } : {}),
        });
        setResolved(detected.resolved);
        setPresets(detected.presets);
        setWorkspace(detected.workspace);
        // Only the identifying fields are written back. Detection never clears
        // an override: the owner turned that switch on deliberately, and having
        // it reset because they changed branch is how a deploy goes out with
        // commands nobody chose.
        setForm((current) => ({
          ...current,
          rootDirectory: dir,
          productionBranch: gitRef,
          framework: detected.resolved.framework,
        }));
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setDetecting(false);
      }
    },
    [repo],
  );

  // Runs once per repository selection, resetting branch and directory to that
  // repository's own. Branch, directory and preset changes re-detect from their
  // own setters instead — every detect moves what the form displays, so it has
  // to be traceable to something the owner just changed.
  useEffect(() => {
    if (!repo) return;
    setBranchState(repo.defaultBranch);
    setRootDirectoryState("");
    void detect("", repo.defaultBranch, null);
  }, [repo, detect]);

  return {
    repo,
    select: setRepo,
    branch,
    rootDirectory,
    resolved,
    presets,
    workspace,
    detecting,
    form,
    setForm: (update) => setForm(update),
    redetect: () => void detect(rootDirectory, branch, form.framework),
    setBranch: (next) => {
      setBranchState(next);
      void detect(rootDirectory, next, form.framework);
    },
    setRootDirectory: (path) => {
      setRootDirectoryState(path);
      // The preset is not carried across a directory change: a different
      // directory is a different application, and forcing the last one's
      // framework onto it produces commands for something that is not there.
      void detect(path, branch, null);
    },
    setPreset: (framework) => {
      setForm((current) => ({ ...current, framework }));
      void detect(rootDirectory, branch, framework);
    },
  };
}

/**
 * The same resolution for a target that already exists, so Settings and the
 * deploy page show the preset's answer behind each override rather than a blank
 * box beside a switch.
 *
 * Read-only and best-effort: this is what the placeholders say, and the build
 * resolves its own copy at enqueue. A repository the App cannot reach leaves
 * every field showing its override or nothing, which is the pre-preset UI.
 */
export function useResolvedBuildConfig(target: {
  repoOwner: string;
  repoName: string;
  productionBranch: string;
  rootDirectory: string | null;
  framework: string | null;
}): ResolvedBuildConfig | null {
  const [resolved, setResolved] = useState<ResolvedBuildConfig | null>(null);
  const { repoOwner, repoName, productionBranch, rootDirectory, framework } =
    target;

  useEffect(() => {
    let cancelled = false;
    void deployApi.github
      .detect(repoOwner, repoName, {
        ref: productionBranch,
        dir: rootDirectory ?? "",
        ...(framework ? { framework } : {}),
      })
      .then((detected) => {
        if (!cancelled) setResolved(detected.resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoOwner, repoName, productionBranch, rootDirectory, framework]);

  return resolved;
}

/** Which commit, and which directory in it. */
export function RepoImportFields({ state }: { state: RepoImport }) {
  const [browsing, setBrowsing] = useState(false);
  const repo = state.repo;
  if (!repo) return null;

  const fetchBranches = () => deployApi.github.branches(repo.owner, repo.name);

  return (
    <>
      <BranchField
        value={state.branch}
        fallback={repo.defaultBranch}
        fetchBranches={fetchBranches}
        onChange={state.setBranch}
      />
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Root directory</Label>
        <div className="flex items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-muted/30 px-2">
            <span className="truncate font-mono text-xs">
              {state.rootDirectory || "./"}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setBrowsing(true)}>
            Edit
          </Button>
        </div>
        <RootDirectoryDialog
          open={browsing}
          onOpenChange={setBrowsing}
          owner={repo.owner}
          repo={repo.name}
          gitRef={state.branch}
          value={state.rootDirectory}
          workspaces={state.workspace?.workspaces ?? []}
          onChange={state.setRootDirectory}
        />
      </div>
    </>
  );
}

/** Forces a preset instead of the one detection matched. */
export function PresetField({ state }: { state: RepoImport }) {
  const value = state.form.framework ?? state.resolved?.framework ?? "";
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="preset" className="text-xs text-muted-foreground">
        Application preset
      </Label>
      <div className="flex items-center gap-2">
        {/* Decorative and outside the trigger: it tracks the selection, and the
            option's own label is what names the preset. */}
        <FrameworkIcon
          framework={value || null}
          className="size-4 shrink-0 text-muted-foreground"
        />
        <OptionSelect
          id="preset"
          size="default"
          className="w-full"
          value={value || null}
          disabled={state.detecting || state.presets.length === 0}
          onValueChange={(preset) => {
            if (preset) state.setPreset(preset);
          }}
          options={
            // Detection can land on a preset the table does not offer —
            // `unknown` for a directory it cannot read — and a select whose
            // value matches no item renders an empty trigger instead.
            state.presets.some((preset) => preset.id === value)
              ? state.presets.map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                }))
              : [
                  {
                    value,
                    label: state.resolved?.frameworkLabel ?? "—",
                  },
                  ...state.presets.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  })),
                ]
          }
        />
      </div>
    </div>
  );
}

function BranchField({
  value,
  fallback,
  fetchBranches,
  onChange,
}: {
  value: string;
  fallback: string;
  fetchBranches: () => Promise<{ name: string; sha: string }[]>;
  onChange: (branch: string) => void;
}) {
  // Keyed on the callback identity, which changes with the repository.
  const load = useCallback(fetchBranches, [fetchBranches]);
  const { data } = usePoll(load, null);
  const branches = data ?? [{ name: fallback, sha: "" }];
  const names = branches.map((entry) => entry.name);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="branch" className="text-xs text-muted-foreground">
        Production branch
      </Label>
      {/* A combobox rather than a select: an active repository carries hundreds
          of refs, and scrolling to `feat/…` in a flat list is not a thing
          anyone does twice. */}
      <Combobox
        items={names}
        value={value}
        onValueChange={(next: string | null) => {
          if (next) onChange(next);
        }}
      >
        <ComboboxInput id="branch" placeholder="search branches" />
        <ComboboxContent>
          <ComboboxEmpty className="px-2 py-3 text-xs text-muted-foreground">
            no branch matches
          </ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name} className="text-xs">
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

/** The build section's header actions: what was detected, and a way to redo it. */
export function DetectionActions({ state }: { state: RepoImport }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">
        {state.detecting
          ? "detecting…"
          : (state.resolved?.frameworkLabel ?? "—")}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={state.detecting}
        onClick={state.redetect}
      >
        Re-detect
      </Button>
    </div>
  );
}

export function RepoBuildFields({ state }: { state: RepoImport }) {
  return (
    <BuildFields
      form={state.form}
      resolved={state.resolved}
      onChange={(changes) =>
        state.setForm((current) => ({ ...current, ...changes }))
      }
    />
  );
}

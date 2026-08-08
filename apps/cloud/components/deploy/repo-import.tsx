"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { GithubRepositorySummary } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type BuildConfigForm,
  BuildFields,
  defaultBuildConfig,
} from "@/components/deploy/build-config-fields";
import { DirectoryBrowser } from "@/components/deploy/directory-browser";
import { api, errorMessage } from "@/lib/api";

export interface RepoImport {
  repo: GithubRepositorySummary | null;
  select: (repo: GithubRepositorySummary | null) => void;
  branch: string;
  rootDirectory: string;
  framework: string | null;
  frameworkLabel: string | null;
  detecting: boolean;
  form: BuildConfigForm;
  setForm: (update: (current: BuildConfigForm) => BuildConfigForm) => void;
  redetect: () => void;
  setBranch: (branch: string) => void;
  setRootDirectory: (path: string) => void;
  workspaces: { path: string; name: string }[];
}

/**
 * The repository half of both create flows: which repo, which branch, which
 * directory, and what detection made of it. Shared rather than copied because
 * the two pages have to agree on when a re-detect happens — the moment they
 * disagree, one of them silently deploys with commands the form never showed.
 */
export function useRepoImport(): RepoImport {
  const [repo, setRepo] = useState<GithubRepositorySummary | null>(null);
  const [branch, setBranchState] = useState("");
  const [rootDirectory, setRootDirectoryState] = useState("");
  const [workspaces, setWorkspaces] = useState<
    { path: string; name: string }[]
  >([]);
  const [framework, setFramework] = useState<string | null>(null);
  const [frameworkLabel, setFrameworkLabel] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [form, setForm] = useState<BuildConfigForm>(defaultBuildConfig);

  const detect = useCallback(
    async (dir: string, gitRef: string) => {
      if (!repo) return;
      setDetecting(true);
      try {
        const detected = await api.deploy.github.detect(repo.owner, repo.name, {
          ref: gitRef,
          dir,
        });
        setFramework(detected.framework);
        setFrameworkLabel(detected.frameworkLabel);
        setWorkspaces(detected.workspaces);
        setForm((current) => ({
          ...current,
          rootDirectory: dir,
          productionBranch: gitRef,
          builder: detected.builder,
          dockerfilePath: detected.dockerfilePath ?? "",
          installCommand: detected.installCommand ?? "",
          buildCommand: detected.buildCommand ?? "",
          startCommand: detected.startCommand ?? "",
          nodeVersion: detected.nodeVersion ?? "",
          healthPath: detected.healthPath,
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
  // repository's own. Branch and root-directory changes re-detect from their
  // own setters instead — every detect overwrites the command fields, so it
  // has to be traceable to something the owner just changed.
  useEffect(() => {
    if (!repo) return;
    setBranchState(repo.defaultBranch);
    setRootDirectoryState("");
    void detect("", repo.defaultBranch);
  }, [repo, detect]);

  return {
    repo,
    select: setRepo,
    branch,
    rootDirectory,
    framework,
    frameworkLabel,
    detecting,
    form,
    setForm: (update) => setForm(update),
    workspaces,
    redetect: () => void detect(rootDirectory, branch),
    setBranch: (next) => {
      setBranchState(next);
      void detect(rootDirectory, next);
    },
    setRootDirectory: (path) => {
      setRootDirectoryState(path);
      void detect(path, branch);
    },
  };
}

/** Branch and root directory for the selected repository. */
export function RepoImportFields({ state }: { state: RepoImport }) {
  const [browsing, setBrowsing] = useState(false);
  const repo = state.repo;
  if (!repo) return null;

  const fetchBranches = () => api.deploy.github.branches(repo.owner, repo.name);

  return (
    <>
      <BranchField
        value={state.branch}
        fallback={repo.defaultBranch}
        fetchBranches={fetchBranches}
        onChange={state.setBranch}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">
            Root directory
          </Label>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setBrowsing((current) => !current)}
          >
            {browsing ? "Close" : "Browse"}
          </button>
        </div>
        <p className="font-mono text-xs">{state.rootDirectory || "./"}</p>
        {browsing && (
          <div className="mt-1">
            <DirectoryBrowser
              owner={repo.owner}
              repo={repo.name}
              gitRef={state.branch}
              value={state.rootDirectory}
              workspaces={state.workspaces}
              onChange={state.setRootDirectory}
            />
          </div>
        )}
      </div>
    </>
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
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="branch" className="text-xs text-muted-foreground">
        Production branch
      </Label>
      <NativeSelect
        id="branch"
        value={value}
        className="w-full text-xs"
        onChange={(event) => onChange(event.target.value)}
      >
        {branches.map((entry) => (
          <option key={entry.name} value={entry.name}>
            {entry.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** The build section's header actions: what was detected, and a way to redo it. */
export function DetectionActions({ state }: { state: RepoImport }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">
        {state.detecting ? "detecting…" : (state.frameworkLabel ?? "—")}
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
      hideRootDirectory
      onChange={(changes) =>
        state.setForm((current) => ({ ...current, ...changes }))
      }
    />
  );
}

"use client";

import {
  buildConfigPatch,
  RuntimeFields,
} from "@repo/cloud-ui/deploy/build-config-fields";
import { type EnvDraftRow, EnvEditor } from "@repo/cloud-ui/deploy/env-editor";
import {
  DetectionActions,
  PresetField,
  RepoBuildFields,
  RepoImportFields,
  useRepoImport,
} from "@repo/cloud-ui/deploy/repo-import";
import { RepoPicker } from "@repo/cloud-ui/deploy/repo-picker";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { projectServiceHref } from "@/lib/project-routes";

/** A disclosure that keeps its section header visible while collapsed. */
function Disclosure({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/40">
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-muted-foreground tabular-nums">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function NewDeployTargetPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const source = useRepoImport();

  const projectId = params.id;
  const [name, setName] = useState("web");
  const [env, setEnv] = useState<EnvDraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const repo = source.repo;
  const ready = useMemo(
    () => Boolean(repo && name.trim().length > 0),
    [repo, name],
  );

  async function create() {
    if (!repo) return;
    setBusy(true);
    try {
      const created = await api.deploy.createTarget({
        // The patch shape is partial, so the fields create insists on are
        // restated under it rather than spread over it.
        ...buildConfigPatch(source.form),
        projectId,
        name: name.trim(),
        repoOwner: repo.owner,
        repoName: repo.name,
        githubInstallationId: repo.installationId,
        framework: source.form.framework,
        productionBranch: source.branch,
        healthPath: source.form.healthPath,
        memoryReservationMb: Number(source.form.memoryReservationMb),
        cpuLimit: Number(source.form.cpuLimit),
        builder: source.form.builder ?? "auto",
        autoDeploy: true,
        previewDeploys: true,
        env: env
          .filter((row) => row.key.trim().length > 0)
          .map((row) => ({
            source: "literal" as const,
            key: row.key.trim(),
            value: row.value,
            scope: row.scope,
          })),
      });
      toast.success(`Created ${created.name}`);
      router.push(projectServiceHref(projectId, created.id));
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  if (!repo) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Project
        </Link>
        <h1 className="text-base font-semibold leading-tight">
          Import Git repository
        </h1>
        <RepoPicker onSelect={source.select} />
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Project
      </Link>

      <div className="flex flex-col gap-5 rounded-xl border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold leading-tight">
              Configure service
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Review the detected settings, then deploy.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => source.select(null)}>
            Change
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs">
          <span>{repo.fullName}</span>
          <span className="text-muted-foreground">{source.branch}</span>
          <span className="text-muted-foreground">
            {source.rootDirectory || "./"}
          </span>
          {source.workspace?.isTurbo && (
            <Badge variant="secondary">Turbo</Badge>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-xs text-muted-foreground">
              Service name
            </Label>
            <Input
              id="name"
              value={name}
              className="text-xs"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <PresetField state={source} />
          <RepoImportFields state={source} />
        </div>

        <div className="flex flex-col gap-2">
          <Disclosure title="Build and output settings">
            <div className="flex flex-col gap-4">
              <div className="flex justify-end">
                <DetectionActions state={source} />
              </div>
              <RepoBuildFields state={source} />
            </div>
          </Disclosure>
          <Disclosure title="Runtime">
            <RuntimeFields
              form={source.form}
              onChange={(changes) =>
                source.setForm((current) => ({ ...current, ...changes }))
              }
            />
          </Disclosure>
          <Disclosure title="Environment variables" count={env.length}>
            <EnvEditor rows={env} onChange={setEnv} />
          </Disclosure>
        </div>

        <Button
          className="w-full"
          disabled={busy || !ready || source.detecting}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Deploy"}
        </Button>
      </div>
    </div>
  );
}

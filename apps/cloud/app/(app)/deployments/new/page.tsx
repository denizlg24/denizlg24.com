"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildConfigPatch,
  RuntimeFields,
} from "@/components/deploy/build-config-fields";
import { type EnvDraftRow, EnvEditor } from "@/components/deploy/env-editor";
import {
  DetectionActions,
  PresetField,
  RepoBuildFields,
  RepoImportFields,
  useRepoImport,
} from "@/components/deploy/repo-import";
import { RepoPicker } from "@/components/deploy/repo-picker";
import { api, errorMessage } from "@/lib/api";

/** Mirrors the project slug schema: lowercase, 3–64, no leading or trailing dash. */
const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function slugFromRepo(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Truncation can land on a dash, and a one-character repository name is not
  // a slug at all — both fall back to something the field will accept, since
  // the box is editable and a rejected create is a worse first impression.
  const trimmed = slug.slice(0, 63).replace(/-+$/, "");
  return trimmed.length >= 3 ? trimmed : `${trimmed || "app"}-app`;
}

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
  const searchParams = useSearchParams();
  const source = useRepoImport();

  // Prefilled when the flow started from a project page; otherwise the project
  // is created from the repository name in the same call as the target.
  const [projectId, setProjectId] = useState(
    searchParams.get("projectId") ?? "",
  );
  const [projectSlug, setProjectSlug] = useState("");
  const [name, setName] = useState("web");
  const [hostname, setHostname] = useState("");
  const [env, setEnv] = useState<EnvDraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchProjects = useCallback(
    () => api.projects.list({ limit: 100 }),
    [],
  );
  const { data: projects } = usePoll(fetchProjects, null);

  const repo = source.repo;
  useEffect(() => {
    if (repo) setProjectSlug(slugFromRepo(repo.name));
  }, [repo]);

  const ready = useMemo(() => {
    if (!repo || name.trim().length === 0) return false;
    return projectId.length > 0 || PROJECT_SLUG.test(projectSlug);
  }, [repo, name, projectId, projectSlug]);

  async function create() {
    if (!repo) return;
    setBusy(true);
    try {
      const created = await api.deploy.createTarget({
        // The patch shape is partial, so the fields create insists on are
        // restated under it rather than spread over it.
        ...buildConfigPatch(source.form),
        ...(projectId
          ? { projectId }
          : { project: { name: projectSlug, slug: projectSlug } }),
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
        // Blank lets the API derive it from the project slug, which is what it
        // does for every target that has not been given a name of its own.
        ...(hostname.trim() ? { hostname: hostname.trim() } : {}),
      });
      toast.success(`Created ${created.name}`);
      router.push(`/deployments/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  if (!repo) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Link
          href="/deployments"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Deployments
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
        href="/deployments"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Deployments
      </Link>

      <div className="flex flex-col gap-5 rounded-xl border p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold leading-tight">New project</h1>
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
            <Label htmlFor="project" className="text-xs text-muted-foreground">
              Project
            </Label>
            <NativeSelect
              id="project"
              value={projectId}
              className="w-full text-xs"
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">new — {projectSlug}</option>
              {(projects?.items ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.slug}
                </option>
              ))}
            </NativeSelect>
          </div>
          {projectId ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="text-xs text-muted-foreground">
                Target name
              </Label>
              <Input
                id="name"
                value={name}
                className="text-xs"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="projectSlug"
                className="text-xs text-muted-foreground"
              >
                Project slug
              </Label>
              <Input
                id="projectSlug"
                value={projectSlug}
                className="font-mono text-xs"
                onChange={(event) => setProjectSlug(event.target.value)}
              />
            </div>
          )}
          {!projectId && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="text-xs text-muted-foreground">
                Target name
              </Label>
              <Input
                id="name"
                value={name}
                className="text-xs"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {/* The label, not the full name — the zone is appended server side,
                and a name with a dot in it is refused there. */}
            <Label htmlFor="hostname" className="text-xs text-muted-foreground">
              Hostname label
            </Label>
            <Input
              id="hostname"
              value={hostname}
              placeholder="follows the project slug"
              className="font-mono text-xs"
              onChange={(event) => setHostname(event.target.value)}
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

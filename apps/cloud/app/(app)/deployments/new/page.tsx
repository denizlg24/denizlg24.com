"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { Section } from "@repo/ui/section";
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
        framework: source.framework,
        productionBranch: source.branch,
        healthPath: source.form.healthPath,
        memoryLimitMb: Number(source.form.memoryLimitMb),
        cpuLimit: Number(source.form.cpuLimit),
        builder: source.form.builder,
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

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/deployments"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Deployments
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold leading-tight">
            New deploy target
          </h1>
          {repo && (
            <Button
              size="sm"
              disabled={busy || !ready}
              onClick={() => void create()}
            >
              Create
            </Button>
          )}
        </div>
      </div>

      {!repo ? (
        <Section title="Repository">
          <RepoPicker onSelect={source.select} />
        </Section>
      ) : (
        <>
          <Section
            title="Source"
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => source.select(null)}
              >
                Change
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Repository
                </Label>
                <p className="font-mono text-xs leading-8">{repo.fullName}</p>
              </div>
              <RepoImportFields state={source} />
            </div>
          </Section>

          <Section title="Project">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="project"
                  className="text-xs text-muted-foreground"
                >
                  Existing project
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
              {!projectId && (
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="projectSlug"
                    className="text-xs text-muted-foreground"
                  >
                    New project slug
                  </Label>
                  <Input
                    id="projectSlug"
                    value={projectSlug}
                    className="font-mono text-xs"
                    onChange={(event) => setProjectSlug(event.target.value)}
                  />
                </div>
              )}
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
              <div className="flex flex-col gap-1.5">
                {/* The label, not the full name — the zone is appended server
                    side, and a name with a dot in it is refused there. */}
                <Label
                  htmlFor="hostname"
                  className="text-xs text-muted-foreground"
                >
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
            </div>
          </Section>

          <Section title="Build" actions={<DetectionActions state={source} />}>
            <RepoBuildFields state={source} />
          </Section>

          <Section title="Environment" count={env.length}>
            <EnvEditor rows={env} onChange={setEnv} />
          </Section>

          <Section title="Runtime">
            <RuntimeFields
              form={source.form}
              onChange={(changes) =>
                source.setForm((current) => ({ ...current, ...changes }))
              }
            />
          </Section>
        </>
      )}
    </div>
  );
}

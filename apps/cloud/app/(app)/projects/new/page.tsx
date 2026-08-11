"use client";

import { buildConfigPatch } from "@repo/cloud-ui/deploy/build-config-fields";
import { type EnvDraftRow, EnvEditor } from "@repo/cloud-ui/deploy/env-editor";
import {
  DetectionActions,
  RepoBuildFields,
  RepoImportFields,
  useRepoImport,
} from "@repo/cloud-ui/deploy/repo-import";
import { RepoPicker } from "@repo/cloud-ui/deploy/repo-picker";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { projectServiceHref } from "@/lib/project-routes";

const DATABASES = ["postgres", "mongodb", "redis"] as const;
type DatabaseType = (typeof DATABASES)[number];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A project starts from a repository. The repo stays optional, because a
 * project that only carries a database and an S3 credential is a real thing
 * here — skipping the import creates the project and no deploy target.
 *
 * Databases are created before the service is inserted, because that insert is
 * what seeds DATABASE_URL and friends from whatever the project has
 * provisioned at that moment.
 */
export default function NewProjectPage() {
  const router = useRouter();
  const source = useRepoImport();
  const [importing, setImporting] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState({ name: false, slug: false });
  const [description, setDescription] = useState("");
  const [databases, setDatabases] = useState<DatabaseType[]>([]);
  const [env, setEnv] = useState<EnvDraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const repo = source.repo;
  useEffect(() => {
    if (!repo) return;
    setName((current) => (touched.name ? current : repo.name));
    setSlug((current) => (touched.slug ? current : slugify(repo.name)));
  }, [repo, touched.name, touched.slug]);

  const ready = name.trim().length > 0 && slug.length >= 3;

  async function create() {
    setBusy(true);
    const project = await api.projects
      .create({
        name: name.trim(),
        slug,
        description: description.trim() || undefined,
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        return null;
      });
    if (!project) {
      setBusy(false);
      return;
    }

    // Past this point the project exists. Anything that fails below is
    // reported and then left on the project's own page to finish by hand —
    // resubmitting this form would only fail on the duplicate slug.
    for (const type of databases) {
      try {
        await api.projects.databases.provision(project.id, type);
      } catch (error) {
        toast.error(`${type}: ${errorMessage(error)}`);
      }
    }

    if (!repo) {
      router.push(`/projects/${project.id}`);
      return;
    }

    try {
      const target = await api.deploy.createTarget({
        ...buildConfigPatch(source.form),
        projectId: project.id,
        name: "web",
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
      toast.success(`Imported ${repo.fullName}`);
      router.push(projectServiceHref(project.id, target.id));
    } catch (error) {
      toast.error(errorMessage(error));
      router.push(`/projects/${project.id}`);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/projects"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Projects
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold leading-tight">New project</h1>
          <Button
            size="sm"
            disabled={busy || !ready}
            onClick={() => void create()}
          >
            {repo ? "Import" : "Create"}
          </Button>
        </div>
      </div>

      <Section
        title="Repository"
        actions={
          repo || importing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                source.select(null);
                setImporting(false);
              }}
            >
              {repo ? "Change" : "Skip"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setImporting(true)}
            >
              Import from GitHub
            </Button>
          )
        }
      >
        {repo ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Repository
              </Label>
              <p className="font-mono text-xs leading-8">{repo.fullName}</p>
            </div>
            <RepoImportFields state={source} />
          </div>
        ) : importing ? (
          <RepoPicker onSelect={source.select} />
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </Section>

      <Section title="Project">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              className="text-xs"
              onChange={(event) => {
                setTouched((current) => ({ ...current, name: true }));
                setName(event.target.value);
                if (!touched.slug) setSlug(slugify(event.target.value));
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug" className="text-xs text-muted-foreground">
              Slug
            </Label>
            <Input
              id="slug"
              value={slug}
              className="font-mono text-xs"
              onChange={(event) => {
                setTouched((current) => ({ ...current, slug: true }));
                setSlug(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label
              htmlFor="description"
              className="text-xs text-muted-foreground"
            >
              Description
            </Label>
            <Input
              id="description"
              value={description}
              className="text-xs"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section title="Databases">
        <div className="flex flex-wrap gap-6">
          {DATABASES.map((type) => (
            <div key={type} className="flex items-center gap-2">
              <Checkbox
                id={type}
                checked={databases.includes(type)}
                onCheckedChange={(checked) =>
                  setDatabases((current) =>
                    checked === true
                      ? [...current, type]
                      : current.filter((entry) => entry !== type),
                  )
                }
              />
              <Label htmlFor={type} className="text-xs">
                {type}
              </Label>
            </div>
          ))}
        </div>
      </Section>

      {repo && (
        <>
          <Section title="Build" actions={<DetectionActions state={source} />}>
            <RepoBuildFields state={source} />
          </Section>

          <Section title="Environment" count={env.length}>
            <EnvEditor rows={env} onChange={setEnv} />
          </Section>
        </>
      )}
    </div>
  );
}

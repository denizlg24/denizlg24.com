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
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  type ConnectableProject,
  projectSlugSchema,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/ui/combobox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { projectHref } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";
import { importRepoFromQuery } from "../configure-href";

/** A disclosure that keeps its section header visible while collapsed. */
function Disclosure({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-left text-xs font-medium hover:text-foreground">
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-muted-foreground tabular-nums">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Attaches this deployable to a project that already exists instead of minting
 * one.
 *
 * Only projects with no target are offered. The schema permits a project to
 * hold several, but nothing in production does, and a picker that lets you
 * attach a second deployable to a project already serving one produces a
 * hostname collision rather than anything useful.
 *
 * This is a leftover-shaped problem — projects predating Forge that hold a
 * database and no deployable — so it sits under a disclosure rather than beside
 * the slug field. New imports should keep creating both in one call.
 */
function ExistingProjectField({
  value,
  onChange,
}: {
  value: ConnectableProject | null;
  onChange: (project: ConnectableProject | null) => void;
}) {
  const load = useCallback(() => api.deploy.projects(), []);
  const { data, error } = usePoll(load, null);
  const available = useMemo(
    () => (data ?? []).filter((project) => !project.hasTarget),
    [data],
  );

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (available.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <Combobox
        items={available}
        value={value}
        onValueChange={onChange}
        itemToStringLabel={(project: ConnectableProject) => project.slug}
        isItemEqualToValue={(a: ConnectableProject, b: ConnectableProject) =>
          a.id === b.id
        }
      >
        <ComboboxInput
          placeholder="search projects"
          className="h-8 w-64 text-xs"
        />
        <ComboboxContent>
          <ComboboxEmpty className="px-2 py-3 text-xs text-muted-foreground">
            no project matches
          </ComboboxEmpty>
          <ComboboxList>
            {(project: ConnectableProject) => (
              <ComboboxItem
                key={project.id}
                value={project}
                className="flex-col items-start gap-0 py-1.5"
              >
                <span className="font-mono text-xs">{project.slug}</span>
                <span className="text-[11px] text-muted-foreground">
                  {project.name}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {value ? (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

/** `denizlg24.com` and `My_App` are both legal repository names and neither is a legal slug. */
function slugify(repoName: string): string {
  return repoName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export default function ConfigureImportPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = useMemo(() => importRepoFromQuery(params), [params]);
  const source = useRepoImport(initial);

  const repo = source.repo;
  const [slug, setSlug] = useState(() =>
    initial ? slugify(initial.name) : "",
  );
  const [linked, setLinked] = useState<ConnectableProject | null>(null);
  const [env, setEnv] = useState<EnvDraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  // Linking adopts that project's slug wholesale — the project already owns it,
  // and the create call sends an id rather than a name when one is chosen.
  const effectiveSlug = linked?.slug ?? slug;

  const slugError = useMemo(() => {
    if (linked) return null;
    const parsed = projectSlugSchema.safeParse(slug);
    if (parsed.success) return null;
    return parsed.error.issues[0]?.message ?? "Invalid slug";
  }, [slug, linked]);

  async function create() {
    if (!repo || slugError) return;
    setBusy(true);
    try {
      const { target, warning } = await api.deploy.createTarget({
        // The patch shape is partial, so the fields create insists on are
        // restated under it rather than spread over it.
        ...buildConfigPatch(source.form),
        // Exactly one of the two, which the request schema enforces. A Forge
        // project is normally the deployable, so the common path creates both
        // in one call rather than sending the owner through a project form —
        // but projects predating Forge exist with no target, and those are
        // adopted by id instead.
        ...(linked
          ? { projectId: linked.id }
          : { project: { name: slug, slug } }),
        name: effectiveSlug,
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
      // The project page shows the queued build, so the happy path needs no
      // second sentence. A warning means there is nothing to watch for and the
      // page would otherwise sit empty without saying why.
      if (warning) {
        toast.warning(warning);
      } else {
        toast.success(`Deploying ${target.name}`);
      }
      router.push(projectHref(target.projectSlug));
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  if (!repo) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <PageHeading title="configure" />
        <p className="text-xs text-muted-foreground">
          No repository in the URL.{" "}
          <Link href="/new" className="underline hover:text-foreground">
            Pick one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeading title="configure">
        <Button asChild size="sm" variant="ghost">
          <Link href="/new">Change</Link>
        </Button>
      </PageHeading>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        <span>{repo.fullName}</span>
        <span className="text-muted-foreground">{source.branch}</span>
        <span className="text-muted-foreground">
          {source.rootDirectory || "./"}
        </span>
        {source.workspace?.isTurbo && <Badge variant="secondary">Turbo</Badge>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug" className="text-xs text-muted-foreground">
            Project
          </Label>
          <Input
            id="slug"
            value={effectiveSlug}
            disabled={linked !== null}
            className="font-mono text-xs disabled:opacity-60"
            onChange={(event) => setSlug(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {slugError ? (
              <span className="text-destructive">{slugError}</span>
            ) : (
              `/${effectiveSlug}`
            )}
          </p>
        </div>
        <PresetField state={source} />
        <RepoImportFields state={source} />
      </div>

      <div className="flex flex-col">
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
        <Disclosure title="Existing project" count={linked ? 1 : 0}>
          <ExistingProjectField value={linked} onChange={setLinked} />
        </Disclosure>
      </div>

      <Button
        disabled={busy || Boolean(slugError) || source.detecting}
        onClick={() => void create()}
      >
        {busy ? "Creating…" : "Deploy"}
      </Button>
    </div>
  );
}

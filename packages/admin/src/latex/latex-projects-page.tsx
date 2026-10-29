"use client";

import {
  createLatexProjectFromTemplate,
  LATEX_PROJECT_TEMPLATES,
  type LatexProjectTemplateId,
} from "@repo/latex-editor/templates";
import type {
  ImportLatexSourceResponse,
  ImportOverleafTemplateResponse,
  LatexProjectResponse,
  LatexProjectSettings,
  LatexProjectSummary,
  LatexProjectsResponse,
  LlmModelsResponse,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { Spinner } from "@repo/ui/spinner";
import { FilterTabs, RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  FileCode2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

const BIBLIOGRAPHY_TEMPLATES = new Set<LatexProjectTemplateId>([
  "ieee-conference",
  "springer-lncs",
  "acm-sigconf",
  "elsevier-article",
  "thesis",
]);
const DEFAULT_INLINE_MODEL = "openai/gpt-5.4-mini";

type OverleafImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; template: ImportOverleafTemplateResponse }
  | { status: "error"; message: string };

type SourceImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; source: ImportLatexSourceResponse }
  | { status: "error"; message: string };

function editedAgo(value: string): string {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

const STATUS_BADGE: Record<
  LatexProjectSummary["compileStatus"],
  "good" | "critical" | "warning" | "info" | "outline"
> = {
  ready: "good",
  error: "critical",
  stale: "warning",
  compiling: "info",
  never: "outline",
};

export function LatexProjectsSkeleton() {
  return (
    <Page>
      <HeaderBarSkeleton
        icon={<FileCode2 className="size-4 text-muted-foreground" />}
        title="LaTeX"
        actions={["w-7", "w-16"]}
      />
      <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5">
        <Skeleton className="h-7 w-36" />
      </div>
      <PageBody>
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-2.5">
              <Skeleton className="size-4" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-14" />
              <Skeleton className="size-7" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

export function LatexProjectsPage({
  baseHref,
  projectHref = (projectId) => `${baseHref}/${projectId}`,
}: {
  baseHref: string;
  projectHref?: (projectId: string) => string;
}) {
  const { client, platform, slots } = useAdmin();
  const router = useRouter();
  const [projects, setProjects] = useState<LatexProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Untitled paper");
  const [overleafTemplateUrl, setOverleafTemplateUrl] = useState("");
  const [overleafImport, setOverleafImport] = useState<OverleafImportState>({
    status: "idle",
  });
  const [overleafArchive, setOverleafArchive] = useState<File | null>(null);
  const [sourceArchive, setSourceArchive] = useState<File | null>(null);
  const [sourceImport, setSourceImport] = useState<SourceImportState>({
    status: "idle",
  });
  const sourceArchiveInputRef = useRef<HTMLInputElement>(null);
  const overleafArchiveInputRef = useRef<HTMLInputElement>(null);
  const sourceImportRequestRef = useRef(0);
  const [createTemplate, setCreateTemplate] =
    useState<LatexProjectTemplateId>("ieee-conference");
  const [createSettings, setCreateSettings] = useState<LatexProjectSettings>({
    grammarDialect: "american",
    bibliographyFile: "references.bib",
    inlineCompletionEnabled: true,
    inlineCompletionModel: "openai/gpt-5.4-mini",
    agentProvider: "hosted",
    agentModel: null,
    embeddingProvider: "hosted",
    embeddingModel: null,
    agentMemoryMode: "enabled",
  });
  const [hostedModels, setHostedModels] = useState<
    LlmModelsResponse["models"] | null
  >(null);
  const [hostedModelsLoading, setHostedModelsLoading] = useState(false);
  const [hostedModelsError, setHostedModelsError] = useState<string | null>(
    null,
  );
  const [hostedModelsStale, setHostedModelsStale] = useState(false);
  const [localModels, setLocalModels] = useState<
    Array<{
      name: string;
      model: string;
      tools?: boolean;
      embedding?: boolean;
    }>
  >([]);
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<LatexProjectSummary | null>(
    null,
  );
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LatexProjectSummary | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const response = await client.get<LatexProjectsResponse>(
        `latex/projects?includeArchived=${includeArchived}`,
      );
      setProjects(response.projects);
    } catch {
      toast.error("Failed to load LaTeX projects");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHostedModels = useCallback(async () => {
    setHostedModelsLoading(true);
    setHostedModelsError(null);
    try {
      const response = await client.get<LlmModelsResponse>("llm/models");
      setHostedModels(response.models);
      setHostedModelsStale(response.stale);
    } catch (error) {
      setHostedModelsError(
        error instanceof Error ? error.message : "Failed to load models",
      );
    } finally {
      setHostedModelsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!createOpen) return;
    void loadHostedModels();
    if (platform.localLlm) {
      void platform.localLlm
        .listModels()
        .then(setLocalModels)
        .catch(() => setLocalModels([]));
    }
  }, [createOpen, loadHostedModels, platform.localLlm]);

  useEffect(() => {
    if (!createOpen) return;
    const url = overleafTemplateUrl.trim();
    setOverleafArchive(null);
    if (!url) {
      setOverleafImport({ status: "idle" });
      return;
    }

    setOverleafImport({ status: "loading" });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client
        .post<ImportOverleafTemplateResponse>(
          "latex/templates/overleaf",
          { url },
          { signal: controller.signal },
        )
        .then((template) => {
          if (controller.signal.aborted) return;
          setOverleafImport({ status: "ready", template });
          setCreateName((current) =>
            current === "Untitled paper" ? template.name : current,
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setOverleafImport({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not import this Overleaf template",
          });
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, createOpen, overleafTemplateUrl]);

  const activeCount = useMemo(
    () => projects.filter((project) => project.archivedAt === null).length,
    [projects],
  );
  const availableGenerationModels = useMemo(
    () =>
      createSettings.agentProvider === "ollama"
        ? localModels
            .filter((model) => model.tools !== false)
            .map((model) => ({ id: model.model, name: model.name }))
        : (hostedModels ?? [])
            .filter((model) => model.tags.includes("tool-use"))
            .map((model) => ({ id: model.id, name: model.name })),
    [createSettings.agentProvider, hostedModels, localModels],
  );
  const effectiveCreateModel =
    createSettings.agentModel &&
    availableGenerationModels.some(
      (model) => model.id === createSettings.agentModel,
    )
      ? createSettings.agentModel
      : availableGenerationModels[0]?.id;
  const availableInlineModels = useMemo(
    () =>
      (hostedModels ?? []).filter(
        (model) =>
          !model.tags.includes("image-generation") &&
          !model.id.toLowerCase().includes("embedding"),
      ),
    [hostedModels],
  );
  const effectiveInlineModel =
    createSettings.inlineCompletionModel ?? DEFAULT_INLINE_MODEL;
  const HostedModelSelector = platform.HostedModelSelector;

  const openCreateDialog = () => {
    setCreateName("Untitled paper");
    setOverleafTemplateUrl("");
    setOverleafImport({ status: "idle" });
    setOverleafArchive(null);
    setSourceArchive(null);
    setSourceImport({ status: "idle" });
    sourceImportRequestRef.current += 1;
    setCreateTemplate("ieee-conference");
    setCreateSettings((current) => ({
      ...current,
      bibliographyFile: "references.bib",
      agentModel: null,
      embeddingModel: null,
      inlineCompletionModel: DEFAULT_INLINE_MODEL,
    }));
    setCreateOpen(true);
  };

  const importSourceArchive = async (file: File | null) => {
    const requestId = sourceImportRequestRef.current + 1;
    sourceImportRequestRef.current = requestId;
    setSourceArchive(file);
    setOverleafTemplateUrl("");
    setOverleafImport({ status: "idle" });
    setOverleafArchive(null);
    if (!file) {
      setSourceImport({ status: "idle" });
      return;
    }

    const nameBeforeImport = createName;
    setSourceImport({ status: "loading" });
    try {
      const formData = new FormData();
      formData.append("archive", file);
      const source = await client.upload<ImportLatexSourceResponse>(
        "latex/templates/source",
        formData,
      );
      if (sourceImportRequestRef.current !== requestId) return;
      setSourceImport({ status: "ready", source });
      setCreateName((current) =>
        current === nameBeforeImport ? source.name : current,
      );
    } catch (error) {
      if (sourceImportRequestRef.current !== requestId) return;
      setSourceImport({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not import this LaTeX source ZIP",
      });
    }
  };

  const createProject = async () => {
    let name = createName.trim();
    if (!name) return;
    setCreating(true);
    try {
      let source = createLatexProjectFromTemplate(createTemplate, name);
      const overleafUrl = overleafTemplateUrl.trim();
      if (overleafUrl) {
        if (overleafImport.status !== "ready") {
          throw new Error("Wait for the Overleaf template to finish importing");
        }
        let imported = overleafImport.template;
        if (overleafArchive) {
          const formData = new FormData();
          formData.append("url", overleafUrl);
          formData.append("archive", overleafArchive);
          imported = await client.upload<ImportOverleafTemplateResponse>(
            "latex/templates/overleaf",
            formData,
          );
        }
        if (imported.missingSupportFiles.length > 0) {
          throw new Error(
            `The source ZIP is still missing ${imported.missingSupportFiles.join(", ")}`,
          );
        }
        if (name === "Untitled paper") name = imported.name;
        source = { ...imported.project, name };
      } else if (sourceArchive) {
        if (sourceImport.status !== "ready") {
          throw new Error("Wait for the source ZIP to finish importing");
        }
        if (sourceImport.source.missingSupportFiles.length > 0) {
          throw new Error(
            `The source ZIP is missing ${sourceImport.source.missingSupportFiles.join(", ")}`,
          );
        }
        source = { ...sourceImport.source.project, name };
      }
      const bibliographyFile =
        overleafUrl || sourceArchive
          ? (source.entries.find(
              (entry) =>
                entry.kind === "file" &&
                entry.path.toLowerCase().endsWith(".bib"),
            )?.path ?? null)
          : createSettings.bibliographyFile;
      const response = await client.post<LatexProjectResponse>(
        "latex/projects",
        {
          name,
          project: source,
          settings: {
            ...createSettings,
            bibliographyFile,
            agentModel: effectiveCreateModel ?? null,
            embeddingModel:
              createSettings.agentProvider === "ollama"
                ? (createSettings.embeddingModel ??
                  localModels.find((model) => model.embedding !== false)
                    ?.model ??
                  null)
                : null,
          },
        },
      );
      setCreateOpen(false);
      router.push(projectHref(response.project._id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create project",
      );
    } finally {
      setCreating(false);
    }
  };

  const patchProject = async (
    project: LatexProjectSummary,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusyId(project._id);
    try {
      const response = await client.patch<LatexProjectResponse>(
        `latex/projects/${project._id}`,
        { baseRevision: project.revision, ...patch },
      );
      setProjects((current) =>
        current.flatMap((entry) => {
          if (entry._id !== project._id) return [entry];
          if (!includeArchived && response.project.archivedAt) return [];
          const {
            project: _source,
            compileError: _error,
            ...summary
          } = response.project;
          return [summary];
        }),
      );
      return true;
    } catch {
      toast.error("Project update failed");
      void load();
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const renameProject = async () => {
    const name = renameName.trim();
    if (!renameTarget || !name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    if (await patchProject(renameTarget, { name })) {
      setRenameTarget(null);
    }
  };

  const duplicateProject = async (project: LatexProjectSummary) => {
    setBusyId(project._id);
    try {
      const response = await client.post<LatexProjectResponse>(
        `latex/projects/${project._id}/duplicate`,
        {},
      );
      router.push(projectHref(response.project._id));
    } catch {
      toast.error("Failed to duplicate project");
    } finally {
      setBusyId(null);
    }
  };

  const deleteProject = async (project: LatexProjectSummary) => {
    setBusyId(project._id);
    try {
      await client.del(`latex/projects/${project._id}`);
      setProjects((current) =>
        current.filter((entry) => entry._id !== project._id),
      );
      toast.success("Project deleted");
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete project");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LatexProjectsSkeleton />;

  const usingOverleaf = Boolean(overleafTemplateUrl.trim());
  const createBlocked =
    !createName.trim() ||
    (usingOverleaf &&
      (overleafImport.status !== "ready" ||
        (overleafImport.template.missingSupportFiles.length > 0 &&
          !overleafArchive))) ||
    (Boolean(sourceArchive) &&
      (sourceImport.status !== "ready" ||
        sourceImport.source.missingSupportFiles.length > 0));
  const renaming = renameTarget !== null && busyId === renameTarget._id;

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileCode2 />}
        title="LaTeX"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh projects"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={openCreateDialog}>
          <Plus />
          New
        </Button>
      </PageHeader>

      <PageToolbar>
        <FilterTabs
          value={includeArchived ? "all" : "active"}
          onChange={(value) => setIncludeArchived(value === "all")}
          options={[
            { value: "active", label: "Active", count: activeCount },
            {
              value: "all",
              label: "All",
              count: includeArchived ? projects.length : undefined,
            },
          ]}
        />
      </PageToolbar>

      <PageBody>
        {projects.length === 0 ? (
          <EmptyState
            icon={<FileCode2 />}
            label="No projects"
            action={
              <Button variant="outline" size="sm" onClick={openCreateDialog}>
                <Plus /> New
              </Button>
            }
          />
        ) : (
          <List divided>
            {projects.map((project) => {
              const busy = busyId === project._id;
              return (
                <ListRow
                  key={project._id}
                  className="py-2.5"
                  onClick={() => router.push(projectHref(project._id))}
                  leading={project.archivedAt ? <Archive /> : <FileCode2 />}
                  title={project.name}
                  description={[
                    `Edited ${editedAgo(project.updatedAt)}`,
                    project.compileCount > 0
                      ? `${project.compileCount} ${project.compileCount === 1 ? "compile" : "compiles"}`
                      : null,
                    project.archivedAt ? "Archived" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={
                    <Badge
                      variant={STATUS_BADGE[project.compileStatus]}
                      className="capitalize"
                    >
                      {project.compileStatus}
                    </Badge>
                  }
                  trailing={
                    <>
                      {busy ? (
                        <Spinner className="size-3.5 text-muted-foreground" />
                      ) : null}
                      <RowActions>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() => {
                            setRenameName(project.name);
                            setRenameTarget(project);
                          }}
                        >
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() => void duplicateProject(project)}
                        >
                          <Copy /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() =>
                            void patchProject(project, {
                              archived: !project.archivedAt,
                            })
                          }
                        >
                          {project.archivedAt ? (
                            <>
                              <ArchiveRestore /> Restore
                            </>
                          ) : (
                            <>
                              <Archive /> Archive
                            </>
                          )}
                        </DropdownMenuItem>
                        {project.archivedAt ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={busy}
                              onSelect={() => setDeleteTarget(project)}
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </RowActions>
                    </>
                  }
                />
              );
            })}
          </List>
        )}
      </PageBody>

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New LaTeX project"
        size="lg"
        onSubmit={createProject}
        submitLabel="Create"
        submitDisabled={createBlocked}
        pending={creating}
        bodyClassName="p-0"
      >
        <div className="grid min-h-0 md:grid-cols-[1.1fr_0.9fr] md:divide-x">
          <div className="flex min-w-0 flex-col gap-6 p-5">
            <Section title="Template">
              <div
                className="flex flex-col"
                role="radiogroup"
                aria-label="Template"
              >
                {LATEX_PROJECT_TEMPLATES.map((template) => {
                  const selected =
                    !usingOverleaf &&
                    !sourceArchive &&
                    createTemplate === template.id;
                  return (
                    <label
                      key={template.id}
                      className={cn(
                        "-mx-2 flex cursor-pointer gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface/70 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/40",
                        selected && "bg-surface",
                      )}
                    >
                      <input
                        type="radio"
                        name="latex-template"
                        value={template.id}
                        checked={selected}
                        disabled={creating}
                        className="mt-1 size-3.5 accent-current"
                        onChange={() => {
                          setOverleafTemplateUrl("");
                          setOverleafImport({ status: "idle" });
                          setOverleafArchive(null);
                          setSourceArchive(null);
                          setSourceImport({ status: "idle" });
                          sourceImportRequestRef.current += 1;
                          setCreateTemplate(template.id);
                          setCreateSettings((current) => ({
                            ...current,
                            bibliographyFile: BIBLIOGRAPHY_TEMPLATES.has(
                              template.id,
                            )
                              ? "references.bib"
                              : null,
                          }));
                        }}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm text-accent-strong">
                          {template.name}
                          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                            {template.category}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {template.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Section>

            <Section title="Import">
              <FormField
                label="Overleaf template URL"
                htmlFor="overleaf-template-url"
              >
                <Input
                  id="overleaf-template-url"
                  name="overleaf-template-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={2_000}
                  value={overleafTemplateUrl}
                  disabled={creating}
                  placeholder="https://www.overleaf.com/latex/templates/…"
                  onChange={(event) => {
                    const value = event.target.value;
                    setOverleafTemplateUrl(value);
                    if (value.trim()) {
                      setSourceArchive(null);
                      setSourceImport({ status: "idle" });
                      sourceImportRequestRef.current += 1;
                    }
                  }}
                />
                <div className="min-h-4 text-xs" aria-live="polite">
                  {overleafImport.status === "loading" ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Spinner className="size-3" />
                      Importing
                    </span>
                  ) : null}
                  {overleafImport.status === "error" ? (
                    <ImportStatus tone="critical">
                      {overleafImport.message}
                    </ImportStatus>
                  ) : null}
                  {overleafImport.status === "ready" ? (
                    <ImportStatus tone="good">
                      {overleafImport.template.name}
                    </ImportStatus>
                  ) : null}
                </div>
              </FormField>
              {overleafImport.status === "ready" ? (
                <FormField
                  label="Overleaf source ZIP"
                  htmlFor="overleaf-source-zip"
                  error={
                    overleafImport.template.missingSupportFiles.length > 0 &&
                    !overleafArchive
                      ? `Missing ${overleafImport.template.missingSupportFiles.join(", ")}`
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-w-0 justify-start overflow-hidden font-normal"
                    disabled={creating}
                    title={overleafArchive?.name}
                    onClick={() => overleafArchiveInputRef.current?.click()}
                  >
                    <Upload />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {overleafArchive?.name ?? "Choose ZIP"}
                    </span>
                  </Button>
                  <input
                    ref={overleafArchiveInputRef}
                    id="overleaf-source-zip"
                    name="overleaf-source-zip"
                    type="file"
                    accept=".zip,application/zip"
                    disabled={creating}
                    className="hidden"
                    tabIndex={-1}
                    onChange={(event) =>
                      setOverleafArchive(event.target.files?.[0] ?? null)
                    }
                  />
                </FormField>
              ) : null}
              <FormField
                label="Source ZIP"
                error={
                  sourceImport.status === "ready" &&
                  sourceImport.source.missingSupportFiles.length > 0
                    ? `Missing ${sourceImport.source.missingSupportFiles.join(", ")}`
                    : undefined
                }
              >
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-w-0 justify-start overflow-hidden font-normal"
                  disabled={creating || sourceImport.status === "loading"}
                  title={sourceArchive?.name}
                  onClick={() => sourceArchiveInputRef.current?.click()}
                >
                  {sourceImport.status === "loading" ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Upload />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {sourceArchive?.name ?? "Choose ZIP"}
                  </span>
                </Button>
                <input
                  ref={sourceArchiveInputRef}
                  id="latex-source-zip"
                  name="latex-source-zip"
                  type="file"
                  accept=".zip,application/zip"
                  disabled={creating}
                  className="hidden"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void importSourceArchive(file);
                  }}
                />
                <div className="min-h-4 text-xs" aria-live="polite">
                  {sourceImport.status === "error" ? (
                    <ImportStatus tone="critical">
                      {sourceImport.message}
                    </ImportStatus>
                  ) : null}
                  {sourceImport.status === "ready" ? (
                    <ImportStatus tone="good">
                      {
                        sourceImport.source.project.entries.filter(
                          (entry) => entry.kind === "file",
                        ).length
                      }{" "}
                      files · {sourceImport.source.project.mainFile}
                    </ImportStatus>
                  ) : null}
                </div>
              </FormField>
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-6 p-5">
            <FormField label="Name" htmlFor="latex-project-name">
              <Input
                id="latex-project-name"
                name="project-name"
                autoComplete="off"
                maxLength={100}
                value={createName}
                disabled={creating}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </FormField>

            <Section title="Agent">
              <FormGrid>
                <FormField label="Provider" htmlFor="new-project-provider">
                  <Select
                    value={createSettings.agentProvider}
                    onValueChange={(value: "hosted" | "ollama") =>
                      setCreateSettings((current) => ({
                        ...current,
                        agentProvider: value,
                        agentModel: null,
                        embeddingProvider: value,
                        embeddingModel: null,
                      }))
                    }
                  >
                    <SelectTrigger id="new-project-provider" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hosted">Hosted gateway</SelectItem>
                      {platform.localLlm ? (
                        <SelectItem value="ollama">Local Ollama</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Memory" htmlFor="new-project-memory">
                  <Select
                    value={createSettings.agentMemoryMode}
                    onValueChange={(value: "enabled" | "retrieval-off") =>
                      setCreateSettings((current) => ({
                        ...current,
                        agentMemoryMode: value,
                      }))
                    }
                  >
                    <SelectTrigger id="new-project-memory" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enabled">Enabled</SelectItem>
                      <SelectItem value="retrieval-off">
                        Retrieval off
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Model" className="sm:col-span-2">
                  {createSettings.agentProvider === "hosted" &&
                  HostedModelSelector ? (
                    <HostedModelSelector
                      model={effectiveCreateModel ?? null}
                      onModelChange={(value) =>
                        setCreateSettings((current) => ({
                          ...current,
                          agentModel: value,
                        }))
                      }
                      models={hostedModels}
                      loading={hostedModelsLoading}
                      error={hostedModelsError}
                      stale={hostedModelsStale}
                      onRetry={() => void loadHostedModels()}
                      requiredCapabilities={["tool-use"]}
                    />
                  ) : (
                    <Select
                      value={effectiveCreateModel}
                      onValueChange={(value) =>
                        setCreateSettings((current) => ({
                          ...current,
                          agentModel: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label="Generation model"
                        className="w-full"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableGenerationModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                {createSettings.agentProvider === "ollama" ? (
                  <FormField
                    label="Embedding model"
                    htmlFor="new-project-embedding"
                    className="sm:col-span-2"
                  >
                    <Select
                      value={createSettings.embeddingModel ?? undefined}
                      onValueChange={(value) =>
                        setCreateSettings((current) => ({
                          ...current,
                          embeddingProvider: "ollama",
                          embeddingModel: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="new-project-embedding"
                        className="w-full"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent>
                        {localModels
                          .filter((model) => model.embedding !== false)
                          .map((model) => (
                            <SelectItem key={model.model} value={model.model}>
                              {model.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : null}
              </FormGrid>
            </Section>

            <Section title="Inline suggestions">
              <FormField label="Model" htmlFor="new-project-inline-model">
                {HostedModelSelector ? (
                  <HostedModelSelector
                    model={effectiveInlineModel}
                    onModelChange={(value) =>
                      setCreateSettings((current) => ({
                        ...current,
                        inlineCompletionModel: value,
                      }))
                    }
                    models={hostedModels}
                    loading={hostedModelsLoading}
                    error={hostedModelsError}
                    stale={hostedModelsStale}
                    onRetry={() => void loadHostedModels()}
                  />
                ) : (
                  <Select
                    value={effectiveInlineModel}
                    onValueChange={(value) =>
                      setCreateSettings((current) => ({
                        ...current,
                        inlineCompletionModel: value,
                      }))
                    }
                  >
                    <SelectTrigger
                      id="new-project-inline-model"
                      className="w-full"
                    >
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableInlineModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </Section>
          </div>
        </div>
      </FormDialog>

      <FormDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title="Rename project"
        onSubmit={renameProject}
        submitLabel="Rename"
        submitDisabled={
          !renameName.trim() || renameName.trim() === renameTarget?.name
        }
        pending={renaming}
      >
        <FormField label="Name" htmlFor="latex-project-rename">
          <Input
            id="latex-project-rename"
            name="project-name"
            autoComplete="off"
            maxLength={100}
            value={renameName}
            disabled={renaming}
            onChange={(event) => setRenameName(event.target.value)}
          />
        </FormField>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete project?"
        description={`“${deleteTarget?.name ?? ""}” and its compiled PDF are deleted permanently.`}
        actionLabel="Delete"
        destructive
        pending={deleteTarget !== null && busyId === deleteTarget._id}
        onConfirm={() => {
          if (deleteTarget) void deleteProject(deleteTarget);
        }}
      />
    </Page>
  );
}

function ImportStatus({
  tone,
  children,
}: {
  tone: "good" | "critical";
  children: React.ReactNode;
}) {
  const Icon = tone === "good" ? CheckCircle2 : AlertCircle;
  return (
    <span
      className={cn(
        "flex min-w-0 items-start gap-1.5",
        tone === "good" ? "text-status-good" : "text-status-critical",
      )}
    >
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

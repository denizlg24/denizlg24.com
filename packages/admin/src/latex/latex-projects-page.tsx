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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { PageHeader } from "@repo/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  FileCode2,
  FileOutput,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusClass(status: LatexProjectSummary["compileStatus"]): string {
  if (status === "ready") return "text-emerald-600 dark:text-emerald-400";
  if (status === "error") return "text-destructive";
  if (status === "compiling") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

export function LatexProjectsSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3">
      <Skeleton className="h-10 w-full" />
      <div className="divide-y border-y px-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="my-2 h-16 rounded-md" />
        ))}
      </div>
    </div>
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

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const renameProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  return (
    <div className="flex h-full flex-col gap-3 pb-4">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileCode2 className="size-4 text-muted-foreground" />}
        title="LaTeX"
      >
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {activeCount} active
        </span>
        <Button
          variant={includeArchived ? "secondary" : "ghost"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setIncludeArchived((current) => !current)}
        >
          <Archive />
          Archived
        </Button>
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
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" className="h-8 text-xs" onClick={openCreateDialog}>
          <Plus />
          New project
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-1">
        {projects.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center border-y border-dashed text-center">
            <FileCode2 className="mb-3 size-7 text-muted-foreground/50" />
            <p className="text-sm font-medium">No LaTeX projects</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one to start writing and compiling.
            </p>
          </div>
        ) : (
          <div className="divide-y border-y">
            {projects.map((project) => {
              const busy = busyId === project._id;
              return (
                <article
                  key={project._id}
                  className="group flex min-w-0 flex-col gap-3 py-3 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center"
                >
                  <FileCode2 className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={projectHref(project._id)}
                        className="truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {project.name}
                      </Link>
                      <span
                        className={`text-[10px] capitalize ${statusClass(project.compileStatus)}`}
                      >
                        {project.compileStatus}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Edited {formatUpdatedAt(project.updatedAt)}</span>
                      <span className="inline-flex items-center gap-1">
                        <FileOutput className="size-3" />
                        {project.compileCount > 0
                          ? `Compiled ${project.compileCount} ${project.compileCount === 1 ? "time" : "times"}`
                          : "Not compiled"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                    >
                      <Link href={projectHref(project._id)}>
                        <FolderOpen /> Open Project
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Rename project"
                      disabled={busy}
                      onClick={() => {
                        setRenameName(project.name);
                        setRenameTarget(project);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Duplicate project"
                      disabled={busy}
                      onClick={() => void duplicateProject(project)}
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        project.archivedAt
                          ? "Restore project"
                          : "Archive project"
                      }
                      disabled={busy}
                      onClick={() =>
                        void patchProject(project, {
                          archived: !project.archivedAt,
                        })
                      }
                    >
                      {project.archivedAt ? <ArchiveRestore /> : <Archive />}
                    </Button>
                    {project.archivedAt ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label="Delete project"
                        disabled={busy}
                        onClick={() => setDeleteTarget(project)}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                    {busy ? (
                      <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
      >
        <DialogContent className="max-h-[88vh] gap-0 overflow-x-hidden overflow-y-auto overscroll-contain p-0 sm:max-w-4xl">
          <form className="min-w-0" onSubmit={createProject}>
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle>Create LaTeX Project</DialogTitle>
              <DialogDescription>
                Choose a starting structure and configure its writing agent.
              </DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 md:grid-cols-[1.1fr_0.9fr] md:divide-x">
              <section
                className="flex min-w-0 items-center p-5"
                aria-labelledby="latex-template-heading"
              >
                <div className="w-full">
                  <p
                    id="latex-template-heading"
                    className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Template
                  </p>
                  <div
                    className="border-y"
                    role="radiogroup"
                    aria-labelledby="latex-template-heading"
                  >
                    {LATEX_PROJECT_TEMPLATES.map((template) => (
                      <label
                        key={template.id}
                        className={`relative flex cursor-pointer gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring ${!overleafTemplateUrl.trim() && !sourceArchive && createTemplate === template.id ? "bg-muted/50" : ""}`}
                      >
                        <input
                          type="radio"
                          name="latex-template"
                          value={template.id}
                          checked={
                            !overleafTemplateUrl.trim() &&
                            !sourceArchive &&
                            createTemplate === template.id
                          }
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
                          <span className="flex items-center gap-2 text-xs font-medium">
                            {template.name}
                            <span className="text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
                              {template.category}
                            </span>
                          </span>
                          <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                            {template.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div
                    className={`mt-5 min-w-0 space-y-2 overflow-hidden border-y px-3 py-3 transition-colors ${
                      overleafTemplateUrl.trim() ? "bg-muted/40" : ""
                    }`}
                  >
                    <Label htmlFor="overleaf-template-url">
                      Overleaf Template URL
                    </Label>
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
                    <div
                      className="min-h-5 text-[11px] leading-5"
                      aria-live="polite"
                    >
                      {!overleafTemplateUrl.trim() ? (
                        <span className="text-muted-foreground">
                          A public Gallery URL replaces the built-in template.
                        </span>
                      ) : null}
                      {overleafImport.status === "loading" ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          Importing Overleaf template…
                        </span>
                      ) : null}
                      {overleafImport.status === "error" ? (
                        <span className="inline-flex items-start gap-1.5 text-destructive">
                          <AlertCircle className="mt-1 size-3 shrink-0" />
                          {overleafImport.message}
                        </span>
                      ) : null}
                      {overleafImport.status === "ready" ? (
                        <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3 shrink-0" />
                          <span className="block min-w-0 flex-1 truncate">
                            Overleaf selected · {overleafImport.template.name}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {overleafImport.status === "ready" ? (
                      <div className="border-t pt-2.5">
                        {overleafImport.template.missingSupportFiles.length >
                        0 ? (
                          <p className="mb-2 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                            Full source required:{" "}
                            {overleafImport.template.missingSupportFiles.join(
                              ", ",
                            )}
                          </p>
                        ) : (
                          <p className="mb-2 text-[10px] leading-4 text-muted-foreground">
                            For templates with images or extra files, add the
                            complete source ZIP.
                          </p>
                        )}
                        <Label
                          htmlFor="overleaf-source-zip"
                          title={overleafArchive?.name}
                          className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden text-xs"
                        >
                          <Upload className="size-3 shrink-0" />
                          <span className="block min-w-0 flex-1 truncate">
                            {overleafArchive
                              ? overleafArchive.name
                              : "Choose Overleaf source ZIP"}
                          </span>
                        </Label>
                        <Input
                          id="overleaf-source-zip"
                          name="overleaf-source-zip"
                          type="file"
                          accept=".zip,application/zip"
                          disabled={creating}
                          className="sr-only"
                          onChange={(event) =>
                            setOverleafArchive(event.target.files?.[0] ?? null)
                          }
                        />
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                          In Overleaf, choose Download as source (.zip).
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={`mt-3 min-w-0 space-y-2 overflow-hidden border-y px-3 py-3 transition-colors ${
                      sourceArchive ? "bg-muted/40" : ""
                    }`}
                  >
                    <span className="text-sm font-medium">
                      LaTeX Source ZIP
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full min-w-0 justify-start overflow-hidden"
                      disabled={creating || sourceImport.status === "loading"}
                      title={sourceArchive?.name}
                      onClick={() => sourceArchiveInputRef.current?.click()}
                    >
                      {sourceImport.status === "loading" ? (
                        <Loader2 className="shrink-0 animate-spin" />
                      ) : (
                        <Upload className="shrink-0" />
                      )}
                      <span className="block min-w-0 flex-1 truncate text-left">
                        {sourceArchive?.name ?? "Choose Source ZIP"}
                      </span>
                    </Button>
                    <Input
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
                    <div
                      className="min-h-4 text-[10px] leading-4"
                      aria-live="polite"
                    >
                      {sourceImport.status === "idle" ? (
                        <span className="text-muted-foreground">
                          Create directly from an existing source archive.
                        </span>
                      ) : null}
                      {sourceImport.status === "loading" ? (
                        <span className="text-muted-foreground">
                          Importing source…
                        </span>
                      ) : null}
                      {sourceImport.status === "error" ? (
                        <span className="inline-flex items-start gap-1.5 text-destructive">
                          <AlertCircle className="mt-0.5 size-3 shrink-0" />
                          <span className="break-words">
                            {sourceImport.message}
                          </span>
                        </span>
                      ) : null}
                      {sourceImport.status === "ready" ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            Source selected ·{" "}
                            {
                              sourceImport.source.project.entries.filter(
                                (entry) => entry.kind === "file",
                              ).length
                            }{" "}
                            files · {sourceImport.source.project.mainFile}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {sourceImport.status === "ready" &&
                    sourceImport.source.missingSupportFiles.length > 0 ? (
                      <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-400">
                        Missing support files:{" "}
                        {sourceImport.source.missingSupportFiles.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>

              <div className="min-w-0 p-5">
                <div className="space-y-2">
                  <Label htmlFor="latex-project-name">Project Name</Label>
                  <Input
                    id="latex-project-name"
                    name="project-name"
                    autoComplete="off"
                    maxLength={100}
                    value={createName}
                    disabled={creating}
                    placeholder="e.g. Urban mobility study…"
                    onChange={(event) => setCreateName(event.target.value)}
                  />
                </div>

                <fieldset className="mt-6 grid gap-4 sm:grid-cols-2">
                  <legend className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2">
                    Agent Settings
                  </legend>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-project-provider">Provider</Label>
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
                      <SelectTrigger
                        id="new-project-provider"
                        className="h-[54px]! w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hosted">Hosted gateway</SelectItem>
                        {platform.localLlm ? (
                          <SelectItem value="ollama">Local Ollama</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <span className="text-sm font-medium">
                      Generation Model
                    </span>
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
                        className="[&_[data-slot=button]]:min-h-[54px]"
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
                          id="new-project-generation"
                          aria-label="Generation model"
                          className="h-[54px]! w-full"
                        >
                          <SelectValue placeholder="Select a model…" />
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
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-project-memory">Personal Memory</Label>
                    <Select
                      value={createSettings.agentMemoryMode}
                      onValueChange={(value: "enabled" | "retrieval-off") =>
                        setCreateSettings((current) => ({
                          ...current,
                          agentMemoryMode: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="new-project-memory"
                        className="h-[54px]! w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="retrieval-off">
                          Retrieval off
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createSettings.agentProvider === "ollama" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="new-project-embedding">
                        Embedding Model
                      </Label>
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
                          className="h-[54px]! w-full"
                        >
                          <SelectValue placeholder="Select independently…" />
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
                    </div>
                  ) : null}
                </fieldset>

                <fieldset className="mt-6 border-t pt-5">
                  <legend className="pr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Writing Assistance
                  </legend>
                  <div className="mt-3 min-w-0 space-y-1.5">
                    {HostedModelSelector ? (
                      <span className="text-sm font-medium">
                        Inline Suggestion Model
                      </span>
                    ) : (
                      <Label htmlFor="new-project-inline-model">
                        Inline Suggestion Model
                      </Label>
                    )}
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
                        className="[&_[data-slot=button]]:min-h-[54px]"
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
                          className="h-[54px]! w-full"
                        >
                          <SelectValue placeholder="Select a model…" />
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
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      Uses a small bounded context and can differ from the agent
                      model.
                    </p>
                  </div>
                </fieldset>
              </div>
            </div>
            <DialogFooter className="border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  creating ||
                  !createName.trim() ||
                  (Boolean(overleafTemplateUrl.trim()) &&
                    (overleafImport.status !== "ready" ||
                      (overleafImport.template.missingSupportFiles.length > 0 &&
                        !overleafArchive))) ||
                  (Boolean(sourceArchive) &&
                    (sourceImport.status !== "ready" ||
                      sourceImport.source.missingSupportFiles.length > 0))
                }
              >
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyId !== renameTarget?._id) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <form className="space-y-5" onSubmit={renameProject}>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="latex-project-rename">Project name</Label>
              <Input
                id="latex-project-rename"
                name="project-name"
                autoComplete="off"
                maxLength={100}
                value={renameName}
                disabled={busyId === renameTarget?._id}
                placeholder="e.g. Urban mobility study…"
                onChange={(event) => setRenameName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busyId === renameTarget?._id}
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busyId === renameTarget?._id ||
                  !renameName.trim() ||
                  renameName.trim() === renameTarget?.name
                }
              >
                {busyId === renameTarget?._id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Pencil />
                )}
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyId !== deleteTarget?._id) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” and its latest compiled PDF will be
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === deleteTarget?._id}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyId === deleteTarget?._id}
              onClick={() => {
                if (deleteTarget) void deleteProject(deleteTarget);
              }}
            >
              {busyId === deleteTarget?._id ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

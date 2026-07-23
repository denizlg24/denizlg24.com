"use client";

import {
  LatexEditor,
  type LatexEditorHandle,
  type LatexEditorStateSnapshot,
  type LatexProject,
} from "@repo/latex-editor";
import { buildLatexContextPack } from "@repo/latex-editor/context";
import { basename, dirname } from "@repo/latex-editor/project";
import {
  type CompileLatexProjectResponse,
  fingerprintLatexSource,
  type ILatexProjectRecord,
  type LatexAgentEditProposal,
  type LatexProjectResponse,
  type LatexProjectSettings,
  type LatexReferenceSuggestion,
  latexProjectRecordSchema,
} from "@repo/schemas";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/alert";
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
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { cn } from "@repo/ui/utils";
import {
  ArrowLeft,
  CloudAlert,
  CloudCheck,
  CloudUpload,
  Download,
  Loader2,
  Settings2,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";
import {
  type CachedLatexDraft,
  deleteLatexDraft,
  loadLatexDraft,
  saveLatexDraft,
} from "./draft-cache";
import { createLatexGrammarExtension } from "./grammar";
import {
  createLatexInlineCompletionExtension,
  DEFAULT_LATEX_COMPLETION_DELAY_MS,
  type LatexCompletionStatus,
} from "./inline-completion";
import { LatexAgentPanel } from "./latex-agent-panel";
import { LatexDataPanel } from "./latex-data-panel";
import { LatexHistoryPanel } from "./latex-history-panel";
import { LatexReferencePanel } from "./latex-reference-panel";
import {
  AgentReviewOverlay,
  HistoryDiffOverlay,
  type LatexAgentReviewState,
  type LatexHistoryPreview,
} from "./latex-review-overlay";

const LatexProjectPdfPreview = dynamic(
  () =>
    import("./latex-project-pdf-preview").then(
      (module) => module.LatexProjectPdfPreview,
    ),
  { ssr: false },
);

const LatexAssetPdfPreview = dynamic(
  () =>
    import("./latex-project-pdf-preview").then(
      (module) => module.LatexAssetPdfPreview,
    ),
  { ssr: false },
);

type SaveState = "saved" | "local" | "saving" | "conflict" | "error";

function sameProject(left: LatexProject, right: LatexProject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function downloadResponse(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  return { blob, filename };
}

function WorkspaceRightDock({
  record,
  pdf,
  activeParagraph,
  dataContext,
  agentContext,
  activeFile,
  cursor,
  selection,
  onAcceptReference,
  onInsertCitation,
  onInsertText,
  onPrepareAgent,
  onProjectChange,
  onSettingsChange,
  onApplyAgentEdit,
  onReviewStateChange,
  onHistoryPreview,
}: {
  record: ILatexProjectRecord;
  pdf: ReactNode;
  activeParagraph: string;
  dataContext: string;
  agentContext: string;
  activeFile: string | null;
  cursor: number | null;
  selection: LatexEditorStateSnapshot["selection"];
  onAcceptReference: (
    suggestion: LatexReferenceSuggestion,
  ) => Promise<{ citationKey: string }>;
  onInsertCitation: (citationKey: string) => void;
  onInsertText: (value: string) => void;
  onPrepareAgent: () => Promise<ILatexProjectRecord>;
  onProjectChange: (project: ILatexProjectRecord) => void;
  onSettingsChange: (
    settings: Partial<LatexProjectSettings>,
  ) => Promise<ILatexProjectRecord>;
  onApplyAgentEdit: (proposal: LatexAgentEditProposal) => boolean;
  onReviewStateChange: (state: LatexAgentReviewState | null) => void;
  onHistoryPreview: (preview: LatexHistoryPreview | null) => void;
}) {
  const [tab, setTab] = useState("pdf");
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const tabs = [
    { value: "pdf", label: "PDF" },
    { value: "references", label: "Refs" },
    { value: "data", label: "Data" },
    { value: "agent", label: "Agent" },
    { value: "history", label: "History" },
  ];
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-9 shrink-0 items-center overflow-hidden border-b">
        <TabsList
          variant="line"
          aria-label="Project workspace"
          className="h-full min-w-0 flex-1 justify-start gap-4 overflow-x-auto rounded-none border-0 px-3"
        >
          {tabs.map((entry) => (
            <TabsTrigger
              key={entry.value}
              value={entry.value}
              className="h-full flex-none px-0.5 text-[11px] after:bottom-0!"
            >
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Button
          type="button"
          size="icon-sm"
          variant={agentSettingsOpen && tab === "agent" ? "secondary" : "ghost"}
          className="h-full w-9 shrink-0 rounded-none"
          aria-label={
            agentSettingsOpen ? "Close agent settings" : "Open agent settings"
          }
          title={
            agentSettingsOpen ? "Close Agent Settings" : "Open Agent Settings"
          }
          onClick={() => {
            if (tab !== "agent") {
              setTab("agent");
              setAgentSettingsOpen(true);
              return;
            }
            setAgentSettingsOpen((current) => !current);
          }}
        >
          <Settings2 className="size-4" />
        </Button>
      </div>
      <TabsContent value="pdf" className="mt-0 min-h-0 flex-1">
        {pdf}
      </TabsContent>
      <TabsContent value="references" className="mt-0 min-h-0 flex-1">
        <LatexReferencePanel
          projectId={record._id}
          activeParagraph={activeParagraph}
          onAccept={onAcceptReference}
          onInsertCitation={onInsertCitation}
        />
      </TabsContent>
      <TabsContent value="data" className="mt-0 min-h-0 flex-1">
        {tab === "data" ? (
          <LatexDataPanel
            projectId={record._id}
            activeParagraph={dataContext}
            onAcceptReference={onAcceptReference}
            onInsertText={onInsertText}
          />
        ) : null}
      </TabsContent>
      <TabsContent
        value="agent"
        forceMount
        className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
      >
        <LatexAgentPanel
          record={record}
          activeFile={activeFile}
          cursor={cursor}
          selection={selection}
          localContext={agentContext}
          onPrepare={onPrepareAgent}
          onProjectChange={onProjectChange}
          onSettingsChange={onSettingsChange}
          onApplyEdit={onApplyAgentEdit}
          onReviewStateChange={onReviewStateChange}
          settingsOpen={agentSettingsOpen}
        />
      </TabsContent>
      <TabsContent
        value="history"
        forceMount
        className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
      >
        <LatexHistoryPanel
          record={record}
          onPrepareRestore={onPrepareAgent}
          onRestore={onProjectChange}
          onPreview={onHistoryPreview}
        />
      </TabsContent>
    </Tabs>
  );
}

export function LatexWorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Skeleton className="h-12 w-full shrink-0 rounded-none" />
      <div className="flex min-h-0 flex-1 gap-px pt-px">
        <Skeleton className="hidden h-full w-56 rounded-none md:block" />
        <Skeleton className="h-full flex-1 rounded-none" />
        <Skeleton className="hidden h-full w-80 rounded-none md:block" />
      </div>
    </div>
  );
}

export function LatexWorkspacePage({
  projectId,
  listHref,
}: {
  projectId: string;
  listHref: string;
}) {
  const { client, platform, slots } = useAdmin();
  const router = useRouter();
  const [record, setRecord] = useState<ILatexProjectRecord | null>(null);
  const [project, setProject] = useState<LatexProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [serverConflict, setServerConflict] =
    useState<ILatexProjectRecord | null>(null);
  const recordRef = useRef<ILatexProjectRecord | null>(null);
  const projectRef = useRef<LatexProject | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<ILatexProjectRecord> | null>(null);
  const editorRef = useRef<LatexEditorHandle>(null);
  const [editorState, setEditorState] =
    useState<LatexEditorStateSnapshot | null>(null);
  const [completionLatency, setCompletionLatency] = useState<number | null>(
    null,
  );
  const [completionStatus, setCompletionStatus] =
    useState<LatexCompletionStatus>("idle");
  const [downloading, setDownloading] = useState<"pdf" | "source" | null>(null);
  const completionTriggerRef = useRef<(() => void) | null>(null);
  const registerCompletionTrigger = useCallback(
    (trigger: (() => void) | null) => {
      completionTriggerRef.current = trigger;
    },
    [],
  );

  const applyRecord = useCallback((next: ILatexProjectRecord) => {
    recordRef.current = next;
    setRecord(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.get<LatexProjectResponse>(`latex/projects/${projectId}`),
      loadLatexDraft(projectId).catch(() => null),
    ])
      .then(([response, cached]) => {
        if (cancelled) return;
        const cloud = response.project;
        applyRecord(cloud);
        const hasLocalChanges =
          cached !== null && !sameProject(cached.project, cloud.project);
        if (cached && hasLocalChanges) {
          projectRef.current = cached.project;
          setProject(cached.project);
          if (cached.baseRevision !== cloud.revision) {
            setServerConflict(cloud);
            setSaveState("conflict");
          } else {
            setSaveState("local");
          }
        } else {
          projectRef.current = cloud.project;
          setProject(cloud.project);
          setSaveState("saved");
        }
      })
      .catch(() => toast.error("Failed to load LaTeX project"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyRecord, client, projectId]);

  const persistLocal = useCallback(
    (next: LatexProject, baseRevision: number) => {
      const draft: CachedLatexDraft = {
        projectId,
        baseRevision,
        project: next,
        updatedAt: new Date().toISOString(),
      };
      void saveLatexDraft(draft).catch(() => undefined);
    },
    [projectId],
  );

  const saveNow = useCallback(
    async (requestedProject?: LatexProject): Promise<ILatexProjectRecord> => {
      const nextProject = requestedProject ?? projectRef.current;
      if (!nextProject) {
        throw new Error("Project is not loaded");
      }
      if (serverConflict)
        throw new Error("Resolve the revision conflict first");
      while (savePromiseRef.current) {
        await savePromiseRef.current;
      }
      const currentRecord = recordRef.current;
      if (!currentRecord) throw new Error("Project is not loaded");
      setSaveState("saving");
      let operation: Promise<ILatexProjectRecord>;
      operation = client
        .patch<LatexProjectResponse>(`latex/projects/${projectId}`, {
          baseRevision: currentRecord.revision,
          project: nextProject,
        })
        .then((response) => {
          applyRecord(response.project);
          persistLocal(nextProject, response.project.revision);
          setSaveState("saved");
          return response.project;
        })
        .catch((error: unknown) => {
          if (error instanceof AdminApiError && error.code === 409) {
            const parsed = latexProjectRecordSchema.safeParse(
              error.details?.project,
            );
            if (parsed.success) {
              setServerConflict(parsed.data);
              setSaveState("conflict");
            } else {
              setSaveState("error");
            }
          } else {
            setSaveState("error");
          }
          throw error;
        })
        .finally(() => {
          if (savePromiseRef.current === operation) {
            savePromiseRef.current = null;
          }
        });
      savePromiseRef.current = operation;
      return operation;
    },
    [applyRecord, client, persistLocal, projectId, serverConflict],
  );

  const scheduleSave = useCallback(
    (next: LatexProject) => {
      const current = recordRef.current;
      if (!current) return;
      projectRef.current = next;
      setProject(next);
      persistLocal(next, current.revision);
      if (serverConflict) {
        setSaveState("conflict");
        return;
      }
      setSaveState("local");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveNow(next).catch(() => undefined);
      }, 900);
    },
    [persistLocal, saveNow, serverConflict],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const loadCloudCopy = async () => {
    if (!serverConflict) return;
    applyRecord(serverConflict);
    projectRef.current = serverConflict.project;
    setProject(serverConflict.project);
    setServerConflict(null);
    setSaveState("saved");
    await deleteLatexDraft(projectId).catch(() => undefined);
  };

  const saveLocalCopy = async () => {
    if (!project) return;
    try {
      const response = await client.post<LatexProjectResponse>(
        "latex/projects",
        { name: `${record?.name ?? project.name} recovered`, project },
      );
      await deleteLatexDraft(projectId).catch(() => undefined);
      router.push(`${listHref}/${response.project._id}`);
    } catch {
      toast.error("Failed to create the recovered copy");
    }
  };

  const acceptReference = async (
    suggestion: LatexReferenceSuggestion,
  ): Promise<{ citationKey: string }> => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const saved = await saveNow(projectRef.current ?? undefined);
    const bibliographyFile =
      saved.settings.bibliographyFile ??
      saved.project.entries.find(
        (entry) => entry.kind === "file" && entry.path.endsWith(".bib"),
      )?.path ??
      "references.bib";
    const response = await client.post<{
      project: ILatexProjectRecord;
      paper: { citationKey: string };
    }>(`latex/projects/${projectId}/references/accept`, {
      baseRevision: saved.revision,
      suggestion,
      bibliographyFile,
    });
    applyRecord(response.project);
    projectRef.current = response.project.project;
    setProject(response.project.project);
    persistLocal(response.project.project, response.project.revision);
    setSaveState("saved");
    toast.success(`Added ${response.paper.citationKey} to ${bibliographyFile}`);
    return { citationKey: response.paper.citationKey };
  };

  const download = async (kind: "pdf" | "source") => {
    if (downloading) return;
    setDownloading(kind);
    try {
      if (kind === "source") {
        const currentRecord = recordRef.current;
        const currentProject = projectRef.current;
        if (
          currentRecord &&
          currentProject &&
          !sameProject(currentProject, currentRecord.project)
        ) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          await saveNow(currentProject);
        }
      }
      const response = await client.raw(
        `latex/projects/${projectId}/${kind}${kind === "pdf" ? "?download=true" : ""}`,
      );
      const download = await downloadResponse(
        response,
        kind === "pdf" ? "project.pdf" : "project-source.zip",
      );
      await platform.downloadFile(
        download.filename,
        download.blob,
        download.blob.type,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to download ${kind}`,
      );
    } finally {
      setDownloading(null);
    }
  };

  const activeParagraph = useMemo(() => {
    if (!project || !record || !editorState?.activeFilePath) return "";
    try {
      return buildLatexContextPack({
        project,
        revision: record.revision,
        filePath: editorState.activeFilePath,
        cursor: editorState.cursor ?? 0,
        maxPrefixChars: 400,
        maxSuffixChars: 200,
        maxSectionChars: 1_200,
        maxRelatedChunks: 0,
      }).paragraph;
    } catch {
      return "";
    }
  }, [editorState, project, record]);

  const agentContext = useMemo(() => {
    if (!project || !record || !editorState?.activeFilePath) return "{}";
    try {
      return JSON.stringify(
        buildLatexContextPack({
          project,
          revision: record.revision,
          filePath: editorState.activeFilePath,
          cursor: editorState.cursor ?? 0,
          maxPrefixChars: 1_500,
          maxSuffixChars: 800,
          maxSectionChars: 4_000,
          maxRelatedChunks: 3,
        }),
      );
    } catch {
      return "{}";
    }
  }, [editorState, project, record]);

  const dataContext = useMemo(() => {
    const selection = editorState?.selection;
    const filePath = editorState?.activeFilePath;
    if (!selection || !filePath || selection.to <= selection.from || !project) {
      return activeParagraph;
    }
    const file = project.entries.find(
      (entry) => entry.kind === "file" && entry.path === filePath,
    );
    if (file?.kind !== "file" || file.encoding !== "utf8") {
      return activeParagraph;
    }
    return (
      file.content.slice(selection.from, selection.to).trim().slice(0, 2_000) ||
      activeParagraph
    );
  }, [activeParagraph, editorState, project]);

  const prepareAgent = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const currentRecord = recordRef.current;
    const currentProject = projectRef.current;
    if (!currentRecord || !currentProject)
      throw new Error("Project is not loaded");
    if (sameProject(currentProject, currentRecord.project))
      return currentRecord;
    return saveNow(currentProject);
  }, [saveNow]);

  const applyAgentRecord = useCallback(
    (next: ILatexProjectRecord) => {
      applyRecord(next);
      projectRef.current = next.project;
      setProject(next.project);
      persistLocal(next.project, next.revision);
      setSaveState("saved");
    },
    [applyRecord, persistLocal],
  );

  const updateAgentSettings = useCallback(
    async (settings: Partial<LatexProjectSettings>) => {
      const prepared = await prepareAgent();
      const completeSettings: LatexProjectSettings = {
        ...prepared.settings,
        ...settings,
      };
      const response = await client.patch<LatexProjectResponse>(
        `latex/projects/${projectId}`,
        { baseRevision: prepared.revision, settings: completeSettings },
      );
      applyAgentRecord(response.project);
      return response.project;
    },
    [applyAgentRecord, client, prepareAgent, projectId],
  );

  const applyAgentEdit = useCallback((proposal: LatexAgentEditProposal) => {
    const editor = editorRef.current;
    const currentProject = projectRef.current;
    if (!editor || !currentProject) return false;
    if (proposal.kind === "replace") {
      return editor.replaceRange({
        filePath: proposal.filePath,
        from: proposal.from,
        to: proposal.to,
        expectedFingerprint: proposal.expectedFingerprint,
        content: proposal.replacement,
      });
    }
    if (proposal.kind === "create") {
      return editor.createFile(proposal.filePath, proposal.content);
    }
    if (proposal.kind === "rename") {
      if (dirname(proposal.filePath) !== dirname(proposal.targetPath)) {
        return false;
      }
      return editor.renameEntry(
        proposal.filePath,
        basename(proposal.targetPath),
      );
    }
    const target = currentProject.entries.find(
      (entry) => entry.kind === "file" && entry.path === proposal.filePath,
    );
    if (
      target?.kind !== "file" ||
      fingerprintLatexSource(target.content) !== proposal.expectedFingerprint
    ) {
      return false;
    }
    if (
      proposal.filePath === currentProject.mainFile &&
      !currentProject.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.path !== proposal.filePath &&
          entry.path.endsWith(".tex"),
      )
    ) {
      return false;
    }
    return editor.removeEntry(proposal.filePath);
  }, []);

  const [agentReview, setAgentReview] = useState<LatexAgentReviewState | null>(
    null,
  );
  const [reviewIndex, setReviewIndex] = useState(0);
  const [historyPreview, setHistoryPreview] =
    useState<LatexHistoryPreview | null>(null);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  useEffect(() => {
    if (saveState === "saved") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const saveAndLeave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await saveNow();
      router.push(listHref);
    } catch {
      toast.error("Save failed — resolve it before leaving");
    }
  };

  const handleReviewStateChange = useCallback(
    (state: LatexAgentReviewState | null) => {
      setAgentReview(state);
      if (!state) {
        setReviewIndex(0);
      } else {
        setReviewIndex((current) =>
          Math.min(current, state.proposals.length - 1),
        );
      }
    },
    [],
  );

  const handleHistoryPreview = useCallback(
    (preview: LatexHistoryPreview | null) => {
      setHistoryPreview(preview);
      setHistoryPath(preview?.files[0]?.path ?? null);
    },
    [],
  );

  const completionEnabled = record?.settings.inlineCompletionEnabled;
  const grammarDialect = record?.settings.grammarDialect;
  const editorExtensions = useMemo(() => {
    if (!record || !editorState?.activeFilePath) return [];
    return [
      ...createLatexInlineCompletionExtension({
        client,
        projectId,
        getRevision: () => recordRef.current?.revision ?? record.revision,
        filePath: editorState.activeFilePath,
        enabled: completionEnabled,
        delayMs: DEFAULT_LATEX_COMPLETION_DELAY_MS,
        onLatency: (latencyMs) => setCompletionLatency(latencyMs),
        onStatusChange: setCompletionStatus,
        onTriggerChange: registerCompletionTrigger,
      }),
      ...createLatexGrammarExtension({
        dialect: grammarDialect ?? "american",
        filePath: editorState.activeFilePath,
      }),
    ];
  }, [
    client,
    editorState?.activeFilePath,
    projectId,
    registerCompletionTrigger,
    completionEnabled,
    grammarDialect,
  ]);

  if (loading || !record || !project) return <LatexWorkspaceSkeleton />;

  const saveLabel = {
    saved: "Cloud saved",
    local: "Unsaved changes",
    saving: "Saving",
    conflict: "Local conflict",
    error: "Save failed",
  }[saveState];

  const overlay = agentReview ? (
    <AgentReviewOverlay
      review={agentReview}
      index={reviewIndex}
      onIndexChange={setReviewIndex}
      project={project}
    />
  ) : historyPreview ? (
    <HistoryDiffOverlay
      preview={historyPreview}
      activePath={historyPath}
      onSelectPath={setHistoryPath}
      onClose={historyPreview.close}
    />
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {serverConflict ? (
        <Alert variant="destructive" className="rounded-none border-x-0">
          <CloudAlert />
          <AlertTitle>Cloud revision changed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Your local source is still stored on this device. Load the cloud
            copy or preserve the local source as a new project.
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadCloudCopy()}
            >
              Load cloud copy
            </Button>
            <Button size="sm" onClick={() => void saveLocalCopy()}>
              Save local as copy
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <LatexEditor
          ref={editorRef}
          project={project}
          className="min-h-0 rounded-none border-0"
          headerLeading={
            <div className="flex items-center gap-0.5">
              {slots?.sidebarTrigger}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="All projects"
                onClick={() => {
                  if (saveState === "saved") router.push(listHref);
                  else setLeaveDialogOpen(true);
                }}
              >
                <ArrowLeft />
              </Button>
            </div>
          }
          headerTrailing={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "hidden items-center gap-1.5 text-[11px] sm:flex",
                  saveState === "saved"
                    ? "text-muted-foreground"
                    : saveState === "conflict" || saveState === "error"
                      ? "text-destructive"
                      : "text-amber-600",
                )}
              >
                {saveState === "saving" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : saveState === "saved" ? (
                  <CloudCheck className="size-3.5 text-primary" />
                ) : saveState === "conflict" || saveState === "error" ? (
                  <CloudAlert className="size-3.5 text-destructive" />
                ) : (
                  <CloudUpload className="size-3.5" />
                )}
                {saveLabel}
              </span>
              {completionEnabled ? (
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground tabular-nums xl:flex">
                  {completionStatus === "processing" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Suggesting…
                    </>
                  ) : completionStatus === "ready" ? (
                    <>
                      <span className="size-1.5 rounded-full bg-primary" />
                      Suggestion
                      {completionLatency !== null
                        ? ` ${completionLatency} ms`
                        : " ready"}
                    </>
                  ) : completionLatency !== null ? (
                    <>Last suggestion {completionLatency} ms</>
                  ) : (
                    <>Inline suggestions</>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Request inline suggestion"
                    title="Request suggestion (Ctrl/Command + Shift + Space)"
                    disabled={completionStatus === "processing"}
                    onClick={() => completionTriggerRef.current?.()}
                  >
                    <Sparkles />
                  </Button>
                </span>
              ) : null}
              <span className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!record.compiledPdf || downloading !== null}
                  onClick={() => void download("pdf")}
                >
                  {downloading === "pdf" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  PDF
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={downloading !== null}
                  onClick={() => void download("source")}
                >
                  {downloading === "source" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Source
                </Button>
              </span>
            </div>
          }
          overlay={overlay}
          renderAsset={(file) =>
            file.encoding === "base64" &&
            file.path.toLowerCase().endsWith(".pdf") ? (
              <LatexAssetPdfPreview content={file.content} />
            ) : null
          }
          extensions={editorExtensions}
          onChange={scheduleSave}
          onEditorStateChange={setEditorState}
          onSave={async (next) => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            await saveNow(next);
            toast.success("Project saved");
          }}
          onCompile={async (next) => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            const saved = await saveNow(next);
            try {
              const response = await client.post<CompileLatexProjectResponse>(
                `latex/projects/${projectId}/compile`,
                { baseRevision: saved.revision, project: next },
              );
              applyRecord(response.project);
              persistLocal(next, response.project.revision);
              setSaveState("saved");
              toast.success("Project compiled");
              return { log: response.log };
            } catch (error) {
              if (error instanceof AdminApiError) {
                const failedProject = latexProjectRecordSchema.safeParse(
                  error.details?.project,
                );
                if (failedProject.success) {
                  applyRecord(failedProject.data);
                  persistLocal(next, failedProject.data.revision);
                }
                const log = error.details?.log;
                if (typeof log === "string" && log.trim()) {
                  throw new Error(log);
                }
              }
              throw error;
            }
          }}
          rightDock={
            <WorkspaceRightDock
              record={record}
              pdf={
                <LatexProjectPdfPreview
                  client={client}
                  projectId={record._id}
                  revision={record.compiledPdf?.revision ?? null}
                />
              }
              activeParagraph={activeParagraph}
              dataContext={dataContext}
              agentContext={agentContext}
              activeFile={editorState?.activeFilePath ?? null}
              cursor={editorState?.cursor ?? null}
              selection={editorState?.selection ?? null}
              onAcceptReference={acceptReference}
              onInsertCitation={(citationKey) => {
                editorRef.current?.replaceSelection(`\\cite{${citationKey}}`);
              }}
              onInsertText={(value) => {
                editorRef.current?.replaceSelection(value);
              }}
              onPrepareAgent={prepareAgent}
              onProjectChange={applyAgentRecord}
              onSettingsChange={updateAgentSettings}
              onApplyAgentEdit={applyAgentEdit}
              onReviewStateChange={handleReviewStateChange}
              onHistoryPreview={handleHistoryPreview}
            />
          }
          rightDockTitle="Workspace"
          bottomDockLabel="Output"
          bottomDock={(output) => (
            <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-4.5 text-muted-foreground">
              {output.compileError ??
                output.compileLog ??
                "No compiler output yet."}
            </pre>
          )}
          compileLabel="Compile"
        />
      </div>

      <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              {serverConflict
                ? "This draft conflicts with the cloud revision and only exists on this device."
                : "The latest edits are not synced to the cloud yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => router.push(listHref)}>
              Leave anyway
            </Button>
            {!serverConflict ? (
              <AlertDialogAction onClick={() => void saveAndLeave()}>
                Save &amp; leave
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

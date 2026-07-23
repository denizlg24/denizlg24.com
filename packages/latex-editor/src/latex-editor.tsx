"use client";

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@repo/ui/resizable";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { cn } from "@repo/ui/utils";
import CodeMirror from "@uiw/react-codemirror";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  File,
  FileCode2,
  FileImage,
  FileOutput,
  Folder,
  FolderOpen,
  FolderUp,
  Loader2,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Plus,
  Save,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ForwardedRef,
  Fragment,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { latexSupport } from "./latex-language";
import {
  addProjectEntry,
  basename,
  childInsertionIndex,
  createFileEntry,
  createFolderEntry,
  dirname,
  isTextFile,
  joinProjectPath,
  removeProjectEntry,
  renameProjectEntry,
  sortProjectEntries,
  updateFileContent,
} from "./project";
import { appEditorTheme } from "./theme";
import type {
  LatexEditorHandle,
  LatexEditorProps,
  LatexEditorStateSnapshot,
  LatexFileEntry,
  LatexProject,
  LatexProjectEntry,
} from "./types";

function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function fingerprintSource(value: string): string {
  let first = 2_166_136_261;
  let second = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619) >>> 0;
    second = Math.imul(second ^ (code + index), 16_777_619) >>> 0;
  }
  return `${value.length}:${first.toString(16)}:${second.toString(16)}`;
}

interface PendingEntry {
  kind: "file" | "folder";
  parent: string;
}

interface PendingEntryInputProps {
  entry: PendingEntry;
  name: string;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}

function PendingEntryInput({
  entry,
  name,
  onCancel,
  onNameChange,
  onSubmit,
}: PendingEntryInputProps) {
  return (
    <div
      className="flex h-7 items-center gap-1 pr-2"
      style={{
        paddingLeft: `${entry.parent.split("/").filter(Boolean).length * 12 + 21}px`,
      }}
    >
      {entry.kind === "folder" ? (
        <Folder className="size-4 shrink-0 text-amber-600" />
      ) : (
        <FileCode2 className="size-4 shrink-0" />
      )}
      <Input
        autoFocus
        value={name}
        className="h-5 min-w-0 rounded-sm px-1 text-xs"
        onChange={(event) => onNameChange(event.target.value)}
        onBlur={onSubmit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
          if (event.key === "Escape") onCancel();
        }}
      />
    </div>
  );
}

const MAX_IMPORTED_FILE_BYTES = 2 * 1024 * 1024;

function fileIcon(entry: LatexProjectEntry) {
  if (entry.kind === "folder") return Folder;
  if (entry.path.match(/\.(png|jpe?g|gif|webp|pdf|svg|avif|bmp|ico)$/i)) {
    return FileImage;
  }
  if (
    entry.path.match(
      /\.(tex|latex|ltx|bib|bst|cls|clo|sty|def|dtx|ins|cfg|lbx|bbx|cbx|tikz|lua|asy)$/i,
    )
  )
    return FileCode2;
  return File;
}

const ASSET_MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function assetDataUri(file: LatexFileEntry): string | null {
  const extension = basename(file.path).split(".").at(-1)?.toLowerCase();
  const mime = extension ? ASSET_MIME_TYPES[extension] : undefined;
  if (!mime) return null;
  if (file.encoding === "base64") return `data:${mime};base64,${file.content}`;
  return mime === "image/svg+xml"
    ? `data:${mime};utf8,${encodeURIComponent(file.content)}`
    : null;
}

const MAX_DECODED_TEXT_CHARS = 500_000;

function decodedBinaryText(
  content: string,
  limit = MAX_DECODED_TEXT_CHARS,
): string | null {
  try {
    const binary = atob(content);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false })
      .decode(bytes)
      .slice(0, limit);
  } catch {
    return null;
  }
}

function AssetPreview({
  file,
  onConvertToText,
}: {
  file: LatexFileEntry;
  onConvertToText?: () => void;
}) {
  const uri = assetDataUri(file);
  const name = basename(file.path);
  if (!uri) {
    const text =
      file.encoding === "base64" ? decodedBinaryText(file.content) : null;
    if (text === null) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {name} · binary
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">
          {text}
        </pre>
        <div className="flex h-8 shrink-0 items-center gap-2 border-t px-3 font-mono text-[11px] text-muted-foreground">
          {file.path} · read-only
          {onConvertToText ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="ml-auto font-sans"
              onClick={onConvertToText}
            >
              Make editable
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  if (uri.startsWith("data:application/pdf")) {
    return (
      <object
        data={uri}
        type="application/pdf"
        aria-label={name}
        className="h-full w-full"
      >
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {name} · PDF preview unavailable in this webview
        </div>
      </object>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img
          src={uri}
          alt={name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex h-8 shrink-0 items-center border-t px-3 font-mono text-[11px] text-muted-foreground">
        {file.path}
      </div>
    </div>
  );
}

function isEntryVisible(
  entry: LatexProjectEntry,
  folders: Map<string, LatexProjectEntry>,
  expanded: Set<string>,
): boolean {
  let parent = dirname(entry.path);
  while (parent) {
    const folder = folders.get(parent);
    if (folder && !expanded.has(folder.id)) return false;
    parent = dirname(parent);
  }
  return true;
}

async function readImportedFile(file: File): Promise<LatexFileEntry> {
  if (file.size > MAX_IMPORTED_FILE_BYTES) {
    throw new Error(`${file.name} exceeds 2MB`);
  }
  const relativePath =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  if (isTextFile(relativePath)) {
    return {
      ...createFileEntry(relativePath),
      content: await file.text(),
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    ...createFileEntry(relativePath),
    encoding: "base64",
    content: btoa(binary),
  };
}

function withParentFolders(
  project: LatexProject,
  file: LatexFileEntry,
): LatexProject {
  let next = project;
  let parent = dirname(file.path);
  const missing: string[] = [];
  while (parent) {
    if (!next.entries.some((entry) => entry.path === parent)) {
      missing.unshift(parent);
    }
    parent = dirname(parent);
  }
  for (const path of missing) {
    next = addProjectEntry(next, createFolderEntry(path));
  }
  const duplicate = next.entries.find((entry) => entry.path === file.path);
  if (duplicate) next = removeProjectEntry(next, duplicate.id);
  return addProjectEntry(next, file);
}

export const LatexEditor = forwardRef<LatexEditorHandle, LatexEditorProps>(
  function LatexEditor(
    {
      project,
      onChange,
      onCompile,
      onSave,
      onPublish,
      canPublish = false,
      headerLeading,
      headerTrailing,
      overlay,
      renderAsset,
      preview,
      rightDock,
      rightDockTitle,
      bottomDock,
      bottomDockLabel,
      extensions,
      onEditorStateChange,
      onActiveFileChange,
      className,
      compileLabel = "Compile",
      publishLabel = "Publish",
      disabled = false,
    }: LatexEditorProps,
    forwardedRef: ForwardedRef<LatexEditorHandle>,
  ) {
    const isDark = useIsDarkTheme();
    const initialFile = project.entries.find(
      (entry): entry is LatexFileEntry => entry.kind === "file",
    );
    const [activeFileId, setActiveFileId] = useState(initialFile?.id ?? "");
    const [openFileIds, setOpenFileIds] = useState<string[]>(
      initialFile ? [initialFile.id] : [],
    );
    const [expanded, setExpanded] = useState(
      () =>
        new Set(
          project.entries
            .filter((entry) => entry.kind === "folder")
            .map((entry) => entry.id),
        ),
    );
    const [selectedEntryId, setSelectedEntryId] = useState(
      initialFile?.id ?? "",
    );
    const [pendingEntry, setPendingEntry] = useState<PendingEntry | null>(null);
    const [pendingName, setPendingName] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamingName, setRenamingName] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<LatexProjectEntry | null>(
      null,
    );
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [compiling, setCompiling] = useState(false);
    const [compileLog, setCompileLog] = useState("");
    const [compileError, setCompileError] = useState<string | null>(null);
    const [consoleOpen, setConsoleOpen] = useState(false);
    const [consoleExpanded, setConsoleExpanded] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const importFolderInputRef = useRef<HTMLInputElement>(null);
    const tabListRef = useRef<HTMLDivElement>(null);
    const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
    const editorViewRef = useRef<EditorView | null>(null);
    const stateSnapshotRef = useRef<LatexEditorStateSnapshot>({
      activeFileId: initialFile?.id ?? null,
      activeFilePath: initialFile?.path ?? null,
      cursor: 0,
      selection: { from: 0, to: 0, anchor: 0, head: 0 },
    });
    const projectRef = useRef(project);
    projectRef.current = project;

    const filesById = useMemo(
      () =>
        new Map(
          project.entries
            .filter((entry): entry is LatexFileEntry => entry.kind === "file")
            .map((entry) => [entry.id, entry]),
        ),
      [project.entries],
    );
    const foldersByPath = useMemo(
      () =>
        new Map(
          project.entries
            .filter((entry) => entry.kind === "folder")
            .map((entry) => [entry.path, entry]),
        ),
      [project.entries],
    );
    const visibleEntries = useMemo(
      () =>
        sortProjectEntries(project.entries).filter((entry) =>
          isEntryVisible(entry, foldersByPath, expanded),
        ),
      [expanded, foldersByPath, project.entries],
    );
    const activeFile = filesById.get(activeFileId);
    const openFiles = openFileIds.flatMap((id) => {
      const file = filesById.get(id);
      return file ? [file] : [];
    });
    const pendingInsertIndex = pendingEntry
      ? childInsertionIndex(visibleEntries, pendingEntry.parent)
      : -1;

    useEffect(() => {
      const folderInput = importFolderInputRef.current;
      folderInput?.setAttribute("webkitdirectory", "");
      folderInput?.setAttribute("directory", "");
    }, []);

    useEffect(() => {
      if (activeFileId && filesById.has(activeFileId)) return;
      const next = filesById.values().next().value as
        | LatexFileEntry
        | undefined;
      setActiveFileId(next?.id ?? "");
    }, [activeFileId, filesById]);

    useEffect(() => {
      const activeTab = tabListRef.current?.querySelector(
        '[data-active="true"]',
      );
      activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeFileId, openFiles.length]);

    const openFile = useCallback((file: LatexFileEntry) => {
      setActiveFileId(file.id);
      setSelectedEntryId(file.id);
      setOpenFileIds((current) =>
        current.includes(file.id) ? current : [...current, file.id],
      );
    }, []);

    const emitEditorState = useCallback(
      (view: EditorView | null = editorViewRef.current) => {
        const selection = view?.state.selection.main;
        const snapshot: LatexEditorStateSnapshot = {
          activeFileId: activeFile?.id ?? null,
          activeFilePath: activeFile?.path ?? null,
          cursor: selection?.head ?? null,
          selection: selection
            ? {
                from: selection.from,
                to: selection.to,
                anchor: selection.anchor,
                head: selection.head,
              }
            : null,
        };
        stateSnapshotRef.current = snapshot;
        onEditorStateChange?.(snapshot);
      },
      [activeFile?.id, activeFile?.path, onEditorStateChange],
    );

    useEffect(() => {
      onActiveFileChange?.(activeFile ?? null);
      emitEditorState(editorViewRef.current);
    }, [activeFile, emitEditorState, onActiveFileChange]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        getState: () => stateSnapshotRef.current,
        focus: () => editorViewRef.current?.focus(),
        openFile: (path) => {
          const file = projectRef.current.entries.find(
            (entry): entry is LatexFileEntry =>
              entry.kind === "file" && entry.path === path,
          );
          if (!file) return false;
          openFile(file);
          return true;
        },
        createFile: (path, content = "") => {
          try {
            const file = { ...createFileEntry(path), content };
            const next = withParentFolders(projectRef.current, file);
            onChange(next);
            openFile(file);
            return true;
          } catch {
            return false;
          }
        },
        renameEntry: (path, nextName) => {
          const entry = projectRef.current.entries.find(
            (candidate) => candidate.path === path,
          );
          if (!entry) return false;
          try {
            onChange(
              renameProjectEntry(projectRef.current, entry.id, nextName),
            );
            return true;
          } catch {
            return false;
          }
        },
        removeEntry: (path) => {
          const entry = projectRef.current.entries.find(
            (candidate) => candidate.path === path,
          );
          if (!entry) return false;
          onChange(removeProjectEntry(projectRef.current, entry.id));
          return true;
        },
        replaceSelection: (content) => {
          const view = editorViewRef.current;
          if (!view) return false;
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: content },
            selection: { anchor: from + content.length },
          });
          view.focus();
          return true;
        },
        replaceRange: ({
          filePath,
          from,
          to,
          expectedFingerprint,
          content,
        }) => {
          const view = editorViewRef.current;
          const currentFile = projectRef.current.entries.find(
            (entry): entry is LatexFileEntry =>
              entry.kind === "file" && entry.path === filePath,
          );
          if (
            !currentFile ||
            from < 0 ||
            to < from ||
            to > currentFile.content.length ||
            fingerprintSource(currentFile.content.slice(from, to)) !==
              expectedFingerprint
          ) {
            return false;
          }
          if (view && currentFile.id === activeFile?.id) {
            if (
              to > view.state.doc.length ||
              fingerprintSource(view.state.doc.sliceString(from, to)) !==
                expectedFingerprint
            ) {
              return false;
            }
            view.dispatch({
              changes: { from, to, insert: content },
              selection: { anchor: from + content.length },
            });
            view.focus();
          } else {
            const nextContent = `${currentFile.content.slice(0, from)}${content}${currentFile.content.slice(to)}`;
            onChange(
              updateFileContent(
                projectRef.current,
                currentFile.id,
                nextContent,
              ),
            );
          }
          return true;
        },
      }),
      [activeFile?.id, forwardedRef, onChange, openFile],
    );

    const save = useCallback(async () => {
      if (!onSave || disabled || saving) return;
      setSaving(true);
      try {
        await onSave(project);
      } finally {
        setSaving(false);
      }
    }, [disabled, onSave, project, saving]);

    useEffect(() => {
      const handleKeyDown = (event: globalThis.KeyboardEvent) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [save]);

    const compile = async () => {
      if (disabled || compiling || !project.mainFile) return;
      setCompiling(true);
      setCompileError(null);
      setCompileLog("");
      try {
        const result = await onCompile(project);
        setCompileLog(result.log);
        setConsoleOpen(Boolean(result.log.trim()));
      } catch (error) {
        setCompileError(
          error instanceof Error ? error.message : "Compilation failed",
        );
        setConsoleOpen(true);
      } finally {
        setCompiling(false);
      }
    };

    const publish = useCallback(async () => {
      if (!onPublish || disabled || publishing || !canPublish) return;
      setPublishing(true);
      try {
        await onPublish();
      } finally {
        setPublishing(false);
      }
    }, [canPublish, disabled, onPublish, publishing]);

    const toggleSidebar = () => {
      const panel = sidebarPanelRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) panel.expand();
      else panel.collapse();
    };

    const texFileCount = useMemo(
      () =>
        project.entries.filter(
          (entry) => entry.kind === "file" && /\.tex$/i.test(entry.path),
        ).length,
      [project.entries],
    );

    const extensionFactory =
      typeof extensions === "function" ? extensions : null;
    const staticExtensions: Extension[] | null =
      typeof extensions === "function" ? null : (extensions ?? null);
    const extensionProject = extensionFactory ? project : null;
    const extensionActiveFile = extensionFactory ? activeFile : null;
    const activeFilePath = activeFile?.path ?? null;
    const activeFileIsMain = activeFilePath === project.mainFile;

    const editorExtensions = useMemo(
      () => [
        ...appEditorTheme(isDark),
        ...(activeFilePath?.match(/\.(tex|cls|sty)$/i)
          ? [
              latexSupport({
                fileName: activeFilePath,
                isMainFile: activeFileIsMain,
                isMultiFile: texFileCount > 1,
              }),
            ]
          : []),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        ...(extensionFactory
          ? extensionFactory({
              project: extensionProject!,
              activeFile: extensionActiveFile ?? null,
            })
          : (staticExtensions ?? [])),
      ],
      [
        activeFileIsMain,
        activeFilePath,
        extensionActiveFile,
        extensionFactory,
        extensionProject,
        isDark,
        staticExtensions,
        texFileCount,
      ],
    );

    const selectedEntry = project.entries.find(
      (entry) => entry.id === selectedEntryId,
    );
    const selectedParent =
      selectedEntry?.kind === "folder"
        ? selectedEntry.path
        : dirname(selectedEntry?.path ?? "");

    const startCreate = (kind: PendingEntry["kind"]) => {
      setPendingEntry({ kind, parent: selectedParent });
      setPendingName(kind === "file" ? "section.tex" : "folder");
      const parent = foldersByPath.get(selectedParent);
      if (parent) {
        setExpanded((current) => new Set(current).add(parent.id));
      }
    };

    const submitCreate = () => {
      if (!pendingEntry || !pendingName.trim()) return;
      try {
        const path = joinProjectPath(pendingEntry.parent, pendingName.trim());
        const entry =
          pendingEntry.kind === "file"
            ? createFileEntry(path)
            : createFolderEntry(path);
        onChange(addProjectEntry(project, entry));
        setExpanded((current) => {
          const next = new Set(current);
          if (entry.kind === "folder") next.add(entry.id);
          const parent = foldersByPath.get(pendingEntry.parent);
          if (parent) next.add(parent.id);
          return next;
        });
        if (entry.kind === "file") openFile(entry);
        setPendingEntry(null);
        setPendingName("");
      } catch (error) {
        setCompileError(
          error instanceof Error ? error.message : "Invalid path",
        );
        setConsoleOpen(true);
      }
    };

    const submitRename = (entry: LatexProjectEntry) => {
      if (!renamingName.trim()) return;
      try {
        onChange(renameProjectEntry(project, entry.id, renamingName.trim()));
        setRenamingId(null);
      } catch (error) {
        setCompileError(
          error instanceof Error ? error.message : "Rename failed",
        );
        setConsoleOpen(true);
      }
    };

    const confirmDelete = () => {
      if (!deleteTarget) return;
      onChange(removeProjectEntry(project, deleteTarget.id));
      setOpenFileIds((current) =>
        current.filter((id) => id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    };

    const handleImportedFiles = async (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const importedFiles = [...(event.target.files ?? [])];
      event.target.value = "";
      if (!importedFiles.length) return;
      try {
        const entries = await Promise.all(importedFiles.map(readImportedFile));
        let next = project;
        for (const entry of entries) next = withParentFolders(next, entry);
        onChange(next);
        const importedFolderIds = next.entries
          .filter((entry) => entry.kind === "folder")
          .map((entry) => entry.id);
        setExpanded(new Set(importedFolderIds));
        const last = entries.at(-1);
        if (last?.encoding === "utf8") openFile(last);
      } catch (error) {
        setCompileError(
          error instanceof Error ? error.message : "Import failed",
        );
        setConsoleOpen(true);
      }
    };

    const closeTab = (event: React.MouseEvent, id: string) => {
      event.stopPropagation();
      setOpenFileIds((current) => {
        const index = current.indexOf(id);
        const next = current.filter((candidate) => candidate !== id);
        if (activeFileId === id) {
          setActiveFileId(next[Math.max(0, index - 1)] ?? next[0] ?? "");
        }
        return next;
      });
    };

    return (
      <div
        className={cn(
          "flex min-h-[620px] flex-1 flex-col overflow-hidden rounded-lg border bg-background",
          className,
        )}
      >
        <input
          ref={importInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleImportedFiles}
        />
        <input
          ref={importFolderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleImportedFiles}
        />

        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/30 px-2">
          {headerLeading}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              sidebarCollapsed ? "Show file explorer" : "Hide file explorer"
            }
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <div className="flex min-w-0 items-center gap-2 px-1">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold tracking-tight">
              {project.name}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {headerTrailing}
            {(rightDock || preview) && (
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="md:hidden"
                    aria-label="Open workspace dock"
                  >
                    <PanelRightOpen />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-lg md:hidden">
                  <SheetHeader className="h-11 shrink-0 justify-center border-b py-0">
                    <SheetTitle className="text-sm">
                      {rightDockTitle ?? "PDF"}
                    </SheetTitle>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {rightDock ?? preview}
                  </div>
                </SheetContent>
              </Sheet>
            )}
            {onSave && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5 text-xs"
                disabled={disabled || saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs"
              disabled={disabled || compiling || !project.mainFile}
              onClick={() => void compile()}
            >
              {compiling ? <Loader2 className="animate-spin" /> : <Play />}
              {compiling ? "Compiling" : compileLabel}
            </Button>
            {onPublish && (
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                disabled={disabled || publishing || !canPublish}
                onClick={() => void publish()}
              >
                {publishing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CloudUpload />
                )}
                {publishing ? "Publishing" : publishLabel}
              </Button>
            )}
          </div>
        </div>

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize="18%"
            minSize="13%"
            maxSize="30%"
            onResize={(size) => setSidebarCollapsed(size.asPercentage <= 0.5)}
          >
            <div className="flex h-full min-w-0 flex-col border-r bg-muted/15">
              <div className="flex h-9 shrink-0 items-center border-b px-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Project
                </span>
                <div className="ml-auto flex items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Create"
                        disabled={disabled}
                      >
                        <Plus />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => startCreate("file")}>
                        <FileCode2 />
                        New file
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => startCreate("folder")}>
                        <Folder />
                        New folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Upload"
                        disabled={disabled}
                      >
                        <Upload />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => importInputRef.current?.click()}
                      >
                        <Upload />
                        Upload files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => importFolderInputRef.current?.click()}
                      >
                        <FolderUp />
                        Upload folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1 py-1">
                {visibleEntries.map((entry, index) => {
                  const Icon = fileIcon(entry);
                  const depth = entry.path.split("/").length - 1;
                  const isExpanded = expanded.has(entry.id);
                  const isSelected = selectedEntryId === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      {pendingEntry && index === pendingInsertIndex && (
                        <PendingEntryInput
                          entry={pendingEntry}
                          name={pendingName}
                          onCancel={() => setPendingEntry(null)}
                          onNameChange={setPendingName}
                          onSubmit={submitCreate}
                        />
                      )}
                      <div
                        className={cn(
                          "group flex h-7 min-w-0 cursor-default items-center gap-1 pr-1 text-xs",
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50",
                        )}
                        style={{ paddingLeft: `${depth * 12 + 5}px` }}
                        onClick={() => {
                          setSelectedEntryId(entry.id);
                          if (entry.kind === "file") openFile(entry);
                        }}
                        onDoubleClick={() => {
                          setRenamingId(entry.id);
                          setRenamingName(basename(entry.path));
                        }}
                      >
                        {entry.kind === "folder" ? (
                          <button
                            type="button"
                            className="flex size-4 shrink-0 items-center justify-center"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(entry.id)) next.delete(entry.id);
                                else next.add(entry.id);
                                return next;
                              });
                            }}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </button>
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        {entry.kind === "folder" && isExpanded ? (
                          <FolderOpen className="size-4 shrink-0 text-amber-600" />
                        ) : (
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              entry.kind === "folder" && "text-amber-600",
                            )}
                          />
                        )}
                        {renamingId === entry.id ? (
                          <Input
                            autoFocus
                            value={renamingName}
                            className="h-5 min-w-0 rounded-sm px-1 text-xs"
                            onChange={(event) =>
                              setRenamingName(event.target.value)
                            }
                            onBlur={() => submitRename(entry)}
                            onKeyDown={(
                              event: KeyboardEvent<HTMLInputElement>,
                            ) => {
                              if (event.key === "Enter") submitRename(entry);
                              if (event.key === "Escape") setRenamingId(null);
                            }}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {basename(entry.path)}
                          </span>
                        )}
                        {project.mainFile === entry.path && (
                          <Star className="size-3.5 fill-current text-amber-500" />
                        )}
                        <div className="hidden items-center group-hover:flex">
                          {entry.kind === "file" &&
                            entry.path.endsWith(".tex") &&
                            project.mainFile !== entry.path && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-5"
                                aria-label="Set main file"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onChange({
                                    ...project,
                                    mainFile: entry.path,
                                  });
                                }}
                              >
                                <Star />
                              </Button>
                            )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 text-muted-foreground hover:text-destructive"
                            aria-label="Delete"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(entry);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {pendingEntry &&
                  pendingInsertIndex >= visibleEntries.length && (
                    <PendingEntryInput
                      entry={pendingEntry}
                      name={pendingName}
                      onCancel={() => setPendingEntry(null)}
                      onNameChange={setPendingName}
                      onSubmit={submitCreate}
                    />
                  )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize="47%" minSize="25%">
            {overlay ? (
              <div className="flex h-full min-w-0 flex-col bg-card text-foreground">
                {overlay}
              </div>
            ) : (
              <div className="flex h-full min-w-0 flex-col bg-card text-foreground">
                <div
                  ref={tabListRef}
                  className="flex h-10 shrink-0 items-end overflow-x-auto border-b bg-muted/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  onWheel={(event) => {
                    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX))
                      return;
                    event.currentTarget.scrollLeft += event.deltaY;
                    event.preventDefault();
                  }}
                >
                  {openFiles.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      data-active={activeFileId === file.id}
                      className={cn(
                        "group flex h-10 max-w-52 shrink-0 items-center gap-1.5 border-r px-3 text-xs",
                        activeFileId === file.id
                          ? "border-t-2 border-t-primary bg-card text-foreground"
                          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                      )}
                      onClick={() => openFile(file)}
                    >
                      <FileCode2 className="size-3.5" />
                      <span className="truncate">{basename(file.path)}</span>
                      <X
                        className="size-3.5 opacity-0 group-hover:opacity-100"
                        onClick={(event) => closeTab(event, file.id)}
                      />
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1">
                  {activeFile?.encoding === "utf8" ? (
                    <CodeMirror
                      key={activeFile.id}
                      value={activeFile.content}
                      height="100%"
                      className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono"
                      theme="none"
                      extensions={editorExtensions}
                      basicSetup={{
                        autocompletion: true,
                        bracketMatching: true,
                        closeBrackets: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                        highlightSelectionMatches: true,
                        lineNumbers: true,
                      }}
                      editable={!disabled}
                      onCreateEditor={(view) => {
                        editorViewRef.current = view;
                        emitEditorState(view);
                      }}
                      onUpdate={(update: ViewUpdate) => {
                        editorViewRef.current = update.view;
                        if (update.docChanged || update.selectionSet) {
                          emitEditorState(update.view);
                        }
                      }}
                      onChange={(content) =>
                        onChange(
                          updateFileContent(project, activeFile.id, content),
                        )
                      }
                    />
                  ) : activeFile ? (
                    (renderAsset?.(activeFile) ?? (
                      <AssetPreview
                        file={activeFile}
                        onConvertToText={
                          isTextFile(activeFile.path) && !disabled
                            ? () => {
                                const text = decodedBinaryText(
                                  activeFile.content,
                                  Number.POSITIVE_INFINITY,
                                );
                                if (text === null) return;
                                onChange({
                                  ...project,
                                  entries: project.entries.map((entry) =>
                                    entry.id === activeFile.id
                                      ? {
                                          ...entry,
                                          encoding: "utf8" as const,
                                          content: text,
                                        }
                                      : entry,
                                  ),
                                });
                              }
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      —
                    </div>
                  )}
                </div>
              </div>
            )}
          </ResizablePanel>

          <ResizableHandle withHandle className="hidden md:flex" />

          <ResizablePanel
            defaultSize="35%"
            minSize="22%"
            className="hidden md:block"
          >
            <div className="flex h-full min-w-0 flex-col bg-muted/20">
              <div className="flex h-9 shrink-0 items-center border-b px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {rightDockTitle ?? "PDF"}
                </span>
                <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                  {project.mainFile || "no root"}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {rightDock ?? preview ?? (
                  <div className="flex h-full items-center justify-center">
                    <FileOutput className="size-5 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <div className="shrink-0 border-t bg-muted/40 text-muted-foreground">
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 px-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            onClick={() => setConsoleOpen((current) => !current)}
          >
            {consoleOpen ? (
              <PanelBottomClose className="size-3.5" />
            ) : (
              <PanelBottomOpen className="size-3.5" />
            )}
            {bottomDockLabel ?? "Output"}
            <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
              {compileError ? (
                <>
                  <CircleAlert className="size-3.5 text-destructive" /> failed
                </>
              ) : compileLog ? (
                <>
                  <CircleCheck className="size-3.5 text-primary" /> compiled
                </>
              ) : null}
              {consoleOpen && bottomDock ? (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={
                    consoleExpanded
                      ? "Restore bottom dock"
                      : "Expand bottom dock"
                  }
                  className="ml-2 inline-flex size-5 items-center justify-center rounded hover:bg-accent hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConsoleExpanded((current) => !current);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      setConsoleExpanded((current) => !current);
                    }
                  }}
                >
                  {consoleExpanded ? (
                    <Minimize2 className="size-3" />
                  ) : (
                    <Maximize2 className="size-3" />
                  )}
                </span>
              ) : null}
            </span>
          </button>
          {consoleOpen &&
            (bottomDock ? (
              <div
                className={cn(
                  "border-t bg-background text-foreground transition-[height]",
                  consoleExpanded
                    ? "h-[min(48rem,75vh)]"
                    : "h-[min(22rem,45vh)]",
                )}
              >
                {bottomDock({ compileLog, compileError })}
              </div>
            ) : (
              <ScrollArea className="h-32 border-t">
                <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-4 text-muted-foreground">
                  {compileError ?? compileLog ?? ""}
                </pre>
              </ScrollArea>
            ))}
        </div>

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {deleteTarget ? basename(deleteTarget.path) : ""}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.kind === "folder"
                  ? "The folder and everything inside it is removed from the project."
                  : "The file is removed from the project."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
);
LatexEditor.displayName = "LatexEditor";

export type {
  LatexCompileResult,
  LatexEditorBottomDockState,
  LatexEditorExtensionContext,
  LatexEditorHandle,
  LatexEditorProps,
  LatexEditorSelection,
  LatexEditorStateSnapshot,
  LatexFileEntry,
  LatexFolderEntry,
  LatexProject,
  LatexProjectEntry,
} from "./types";

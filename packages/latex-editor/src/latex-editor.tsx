"use client";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@repo/ui/resizable";
import { ScrollArea } from "@repo/ui/scroll-area";
import { cn } from "@repo/ui/utils";
import CodeMirror from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code2,
  File,
  FileCode2,
  FileImage,
  FileOutput,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  PanelBottomClose,
  PanelBottomOpen,
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
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addProjectEntry,
  basename,
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
import type {
  LatexEditorProps,
  LatexFileEntry,
  LatexProject,
  LatexProjectEntry,
} from "./types";

interface PendingEntry {
  kind: "file" | "folder";
  parent: string;
}

const MAX_IMPORTED_FILE_BYTES = 2 * 1024 * 1024;

function fileIcon(entry: LatexProjectEntry) {
  if (entry.kind === "folder") return Folder;
  if (entry.path.match(/\.(png|jpe?g|gif|webp|pdf)$/i)) return FileImage;
  if (entry.path.match(/\.(tex|bib|cls|sty)$/i)) return FileCode2;
  return File;
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

export function LatexEditor({
  project,
  onChange,
  onCompile,
  onSave,
  preview,
  className,
  compileLabel = "Compile",
  disabled = false,
}: LatexEditorProps) {
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
  const [selectedEntryId, setSelectedEntryId] = useState(initialFile?.id ?? "");
  const [pendingEntry, setPendingEntry] = useState<PendingEntry | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileLog, setCompileLog] = useState("");
  const [compileError, setCompileError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (activeFileId && filesById.has(activeFileId)) return;
    const next = filesById.values().next().value as LatexFileEntry | undefined;
    setActiveFileId(next?.id ?? "");
  }, [activeFileId, filesById]);

  const openFile = useCallback((file: LatexFileEntry) => {
    setActiveFileId(file.id);
    setSelectedEntryId(file.id);
    setOpenFileIds((current) =>
      current.includes(file.id) ? current : [...current, file.id],
    );
  }, []);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
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
      setCompileError(error instanceof Error ? error.message : "Invalid path");
      setConsoleOpen(true);
    }
  };

  const submitRename = (entry: LatexProjectEntry) => {
    if (!renamingName.trim()) return;
    try {
      onChange(renameProjectEntry(project, entry.id, renamingName.trim()));
      setRenamingId(null);
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : "Rename failed");
      setConsoleOpen(true);
    }
  };

  const deleteEntry = (entry: LatexProjectEntry) => {
    if (!window.confirm(`Delete ${basename(entry.path)}?`)) return;
    onChange(removeProjectEntry(project, entry.id));
    setOpenFileIds((current) => current.filter((id) => id !== entry.id));
  };

  const handleImportedFiles = async (event: ChangeEvent<HTMLInputElement>) => {
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
      setCompileError(error instanceof Error ? error.message : "Import failed");
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

      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-muted/30 px-2">
        <div className="flex min-w-0 items-center gap-2 px-1">
          <div className="flex size-6 items-center justify-center rounded bg-foreground text-background">
            <Code2 className="size-3.5" />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">
            {project.name}
          </span>
          <span className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            TeX
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {onSave && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={disabled || saving}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={disabled || compiling || !project.mainFile}
            onClick={() => void compile()}
          >
            {compiling ? <Loader2 className="animate-spin" /> : <Play />}
            {compiling ? "Compiling" : compileLabel}
          </Button>
        </div>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="18%" minSize="13%" maxSize="30%">
          <div className="flex h-full min-w-0 flex-col border-r bg-muted/15">
            <div className="flex h-9 shrink-0 items-center border-b px-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Project
              </span>
              <div className="ml-auto flex items-center">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="New file"
                  disabled={disabled}
                  onClick={() => startCreate("file")}
                >
                  <Plus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="New folder"
                  disabled={disabled}
                  onClick={() => startCreate("folder")}
                >
                  <FolderPlus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Import files"
                  disabled={disabled}
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload />
                </Button>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1 py-1">
              {visibleEntries.map((entry) => {
                const Icon = fileIcon(entry);
                const depth = entry.path.split("/").length - 1;
                const isExpanded = expanded.has(entry.id);
                const isSelected = selectedEntryId === entry.id;
                return (
                  <div
                    key={entry.id}
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
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    {entry.kind === "folder" && isExpanded ? (
                      <FolderOpen className="size-3.5 shrink-0 text-amber-600" />
                    ) : (
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
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
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
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
                      <Star className="size-3 fill-current text-amber-500" />
                    )}
                    <div className="hidden items-center group-hover:flex">
                      {entry.kind === "file" && entry.path.endsWith(".tex") && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-5"
                          aria-label="Set main file"
                          onClick={(event) => {
                            event.stopPropagation();
                            onChange({ ...project, mainFile: entry.path });
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
                          deleteEntry(entry);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {pendingEntry && (
                <div
                  className="flex h-7 items-center gap-1 pr-2"
                  style={{
                    paddingLeft: `${pendingEntry.parent.split("/").filter(Boolean).length * 12 + 21}px`,
                  }}
                >
                  {pendingEntry.kind === "folder" ? (
                    <Folder className="size-3.5 shrink-0 text-amber-600" />
                  ) : (
                    <FileCode2 className="size-3.5 shrink-0" />
                  )}
                  <Input
                    autoFocus
                    value={pendingName}
                    className="h-5 min-w-0 rounded-sm px-1 text-xs"
                    onChange={(event) => setPendingName(event.target.value)}
                    onBlur={submitCreate}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitCreate();
                      if (event.key === "Escape") setPendingEntry(null);
                    }}
                  />
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize="47%" minSize="25%">
          <div className="flex h-full min-w-0 flex-col bg-[#111315] text-[#d9dde3]">
            <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-white/10 bg-[#17191c]">
              {openFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className={cn(
                    "group flex h-9 max-w-48 shrink-0 items-center gap-1.5 border-r border-white/10 px-2.5 text-[11px]",
                    activeFileId === file.id
                      ? "border-t-2 border-t-emerald-500 bg-[#111315] text-white"
                      : "text-white/55 hover:bg-white/5 hover:text-white/80",
                  )}
                  onClick={() => openFile(file)}
                >
                  <FileCode2 className="size-3" />
                  <span className="truncate">{basename(file.path)}</span>
                  <X
                    className="size-3 opacity-0 group-hover:opacity-100"
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
                  theme="dark"
                  extensions={[
                    ...(activeFile.path.match(/\.(tex|cls|sty)$/i)
                      ? [latex()]
                      : []),
                    EditorView.lineWrapping,
                    EditorState.tabSize.of(2),
                  ]}
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
                  onChange={(content) =>
                    onChange(updateFileContent(project, activeFile.id, content))
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-white/35">
                  {activeFile ? `${basename(activeFile.path)} · binary` : "—"}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="35%" minSize="22%">
          <div className="flex h-full min-w-0 flex-col bg-muted/20">
            <div className="flex h-9 shrink-0 items-center border-b px-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                PDF
              </span>
              <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                {project.mainFile || "no root"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {preview ?? (
                <div className="flex h-full items-center justify-center">
                  <FileOutput className="size-5 text-muted-foreground/40" />
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <div className="shrink-0 border-t bg-[#0c0e10] text-[#c9ced6]">
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 px-3 text-[10px] uppercase tracking-[0.12em] text-white/55 hover:bg-white/5"
          onClick={() => setConsoleOpen((current) => !current)}
        >
          {consoleOpen ? (
            <PanelBottomClose className="size-3" />
          ) : (
            <PanelBottomOpen className="size-3" />
          )}
          Output
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
            {compileError ? (
              <>
                <CircleAlert className="size-3 text-red-400" /> failed
              </>
            ) : compileLog ? (
              <>
                <CircleCheck className="size-3 text-emerald-400" /> compiled
              </>
            ) : null}
          </span>
        </button>
        {consoleOpen && (
          <ScrollArea className="h-32 border-t border-white/10">
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-4 text-white/65">
              {compileError ?? compileLog ?? ""}
            </pre>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

export type {
  LatexCompileResult,
  LatexEditorProps,
  LatexFileEntry,
  LatexFolderEntry,
  LatexProject,
  LatexProjectEntry,
} from "./types";

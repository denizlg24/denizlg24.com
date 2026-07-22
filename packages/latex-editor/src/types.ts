import type { Extension } from "@codemirror/state";
import type { ReactNode } from "react";

export interface LatexFileEntry {
  id: string;
  path: string;
  kind: "file";
  encoding: "utf8" | "base64";
  content: string;
}

export interface LatexFolderEntry {
  id: string;
  path: string;
  kind: "folder";
}

export type LatexProjectEntry = LatexFileEntry | LatexFolderEntry;

export interface LatexProject {
  version: 1;
  name: string;
  mainFile: string;
  entries: LatexProjectEntry[];
}

export interface LatexCompileResult {
  log: string;
}

export interface LatexEditorSelection {
  from: number;
  to: number;
  anchor: number;
  head: number;
}

export interface LatexEditorStateSnapshot {
  activeFileId: string | null;
  activeFilePath: string | null;
  cursor: number | null;
  selection: LatexEditorSelection | null;
}

export interface LatexEditorExtensionContext {
  project: LatexProject;
  activeFile: LatexFileEntry | null;
}

export interface LatexEditorBottomDockState {
  compileLog: string;
  compileError: string | null;
}

export interface LatexEditorHandle {
  getState: () => LatexEditorStateSnapshot;
  focus: () => void;
  openFile: (path: string) => boolean;
  createFile: (path: string, content?: string) => boolean;
  renameEntry: (path: string, nextName: string) => boolean;
  removeEntry: (path: string) => boolean;
  replaceSelection: (content: string) => boolean;
  replaceRange: (options: {
    filePath: string;
    from: number;
    to: number;
    expectedFingerprint: string;
    content: string;
  }) => boolean;
}

export interface LatexEditorProps {
  project: LatexProject;
  onChange: (project: LatexProject) => void;
  onCompile: (project: LatexProject) => Promise<LatexCompileResult>;
  onSave?: (project: LatexProject) => Promise<void>;
  onPublish?: () => Promise<void>;
  canPublish?: boolean;
  preview?: ReactNode;
  rightDock?: ReactNode;
  rightDockTitle?: ReactNode;
  bottomDock?: (state: LatexEditorBottomDockState) => ReactNode;
  bottomDockLabel?: ReactNode;
  extensions?:
    | Extension[]
    | ((context: LatexEditorExtensionContext) => Extension[]);
  onEditorStateChange?: (state: LatexEditorStateSnapshot) => void;
  onActiveFileChange?: (file: LatexFileEntry | null) => void;
  className?: string;
  compileLabel?: string;
  publishLabel?: string;
  disabled?: boolean;
}

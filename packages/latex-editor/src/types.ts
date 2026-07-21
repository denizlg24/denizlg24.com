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

export interface LatexEditorProps {
  project: LatexProject;
  onChange: (project: LatexProject) => void;
  onCompile: (project: LatexProject) => Promise<LatexCompileResult>;
  onSave?: (project: LatexProject) => Promise<void>;
  onPublish?: () => Promise<void>;
  canPublish?: boolean;
  preview?: ReactNode;
  className?: string;
  compileLabel?: string;
  publishLabel?: string;
  disabled?: boolean;
}

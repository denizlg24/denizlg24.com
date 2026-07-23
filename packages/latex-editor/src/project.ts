import type {
  LatexFileEntry,
  LatexFolderEntry,
  LatexProject,
  LatexProjectEntry,
} from "./types";

const TEXT_EXTENSIONS = new Set([
  "asy",
  "bbx",
  "bib",
  "bst",
  "cbx",
  "cfg",
  "cls",
  "clo",
  "csv",
  "def",
  "dot",
  "dtx",
  "inc",
  "ins",
  "ist",
  "latex",
  "lbx",
  "lco",
  "ldf",
  "ltx",
  "lua",
  "md",
  "sty",
  "tex",
  "tikz",
  "txt",
]);

export const DEFAULT_LATEX_SOURCE = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[margin=1.6cm]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{xcolor}
\pagestyle{empty}

\definecolor{accent}{HTML}{0F766E}
\setlist[itemize]{leftmargin=*,nosep}

\begin{document}
{\LARGE\bfseries Deniz Güneş}\hfill
\href{https://denizlg24.com}{denizlg24.com}

\vspace{0.4em}\hrule\vspace{0.8em}

\section*{Experience}
\textbf{Role} \hfill 2026--Present\\
Company
\begin{itemize}
  \item Replace this line with an achievement.
\end{itemize}

\section*{Projects}
\textbf{Project name} --- concise impact statement.

\section*{Education}
\textbf{Degree} \hfill Graduation year\\
Institution
\end{document}
`;

export function createDefaultLatexProject(): LatexProject {
  return {
    version: 1,
    name: "CV",
    mainFile: "main.tex",
    entries: [
      {
        id: crypto.randomUUID(),
        path: "main.tex",
        kind: "file",
        encoding: "utf8",
        content: DEFAULT_LATEX_SOURCE,
      },
    ],
  };
}

export function normalizeProjectPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

export function basename(path: string): string {
  return normalizeProjectPath(path).split("/").at(-1) ?? "";
}

export function dirname(path: string): string {
  const parts = normalizeProjectPath(path).split("/");
  parts.pop();
  return parts.join("/");
}

export function joinProjectPath(parent: string, name: string): string {
  return normalizeProjectPath([parent, name].filter(Boolean).join("/"));
}

export function isTextFile(path: string): boolean {
  const extension = basename(path).split(".").at(-1)?.toLowerCase();
  return extension ? TEXT_EXTENSIONS.has(extension) : true;
}

export function sortProjectEntries(
  entries: LatexProjectEntry[],
): LatexProjectEntry[] {
  const folderPaths = new Set(
    entries
      .filter((entry) => entry.kind === "folder")
      .map((entry) => entry.path),
  );
  return [...entries].sort((left, right) => {
    if (right.path.startsWith(`${left.path}/`)) return -1;
    if (left.path.startsWith(`${right.path}/`)) return 1;
    const leftParts = left.path.split("/");
    const rightParts = right.path.split("/");
    const sharedLength = Math.min(leftParts.length, rightParts.length);
    for (let index = 0; index < sharedLength; index++) {
      if (leftParts[index] === rightParts[index]) continue;
      const leftPath = leftParts.slice(0, index + 1).join("/");
      const rightPath = rightParts.slice(0, index + 1).join("/");
      const leftIsFolder =
        index < leftParts.length - 1 || folderPaths.has(leftPath);
      const rightIsFolder =
        index < rightParts.length - 1 || folderPaths.has(rightPath);
      if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1;
      return (leftParts[index] ?? "").localeCompare(
        rightParts[index] ?? "",
        undefined,
        {
          sensitivity: "base",
        },
      );
    }
    return left.path.localeCompare(right.path);
  });
}

export function childInsertionIndex(
  entries: LatexProjectEntry[],
  parentPath: string,
): number {
  if (!parentPath) return entries.length;
  const parentIndex = entries.findIndex((entry) => entry.path === parentPath);
  if (parentIndex < 0) return entries.length;
  const prefix = `${parentPath}/`;
  let insertionIndex = parentIndex + 1;
  while (
    insertionIndex < entries.length &&
    entries[insertionIndex]?.path.startsWith(prefix)
  ) {
    insertionIndex += 1;
  }
  return insertionIndex;
}

export function addProjectEntry(
  project: LatexProject,
  entry: LatexProjectEntry,
): LatexProject {
  const path = normalizeProjectPath(entry.path);
  if (!path || path.split("/").some((part) => part === "..")) {
    throw new Error("Invalid project path");
  }
  if (project.entries.some((candidate) => candidate.path === path)) {
    throw new Error("That path already exists");
  }
  return {
    ...project,
    entries: sortProjectEntries([...project.entries, { ...entry, path }]),
  };
}

export function updateFileContent(
  project: LatexProject,
  id: string,
  content: string,
): LatexProject {
  return {
    ...project,
    entries: project.entries.map((entry) =>
      entry.id === id && entry.kind === "file" ? { ...entry, content } : entry,
    ),
  };
}

export function renameProjectEntry(
  project: LatexProject,
  id: string,
  nextName: string,
): LatexProject {
  const entry = project.entries.find((candidate) => candidate.id === id);
  if (!entry) return project;
  const normalizedName = normalizeProjectPath(nextName);
  if (!normalizedName || normalizedName.includes("/")) {
    throw new Error("Names cannot contain slashes");
  }
  const nextPath = joinProjectPath(dirname(entry.path), normalizedName);
  if (
    project.entries.some(
      (candidate) => candidate.id !== id && candidate.path === nextPath,
    )
  ) {
    throw new Error("That path already exists");
  }

  const prefix = `${entry.path}/`;
  const entries = project.entries.map((candidate) => {
    if (candidate.id === id) return { ...candidate, path: nextPath };
    if (entry.kind === "folder" && candidate.path.startsWith(prefix)) {
      return {
        ...candidate,
        path: `${nextPath}/${candidate.path.slice(prefix.length)}`,
      };
    }
    return candidate;
  });
  const mainFile =
    project.mainFile === entry.path
      ? nextPath
      : project.mainFile.startsWith(prefix)
        ? `${nextPath}/${project.mainFile.slice(prefix.length)}`
        : project.mainFile;
  return { ...project, mainFile, entries: sortProjectEntries(entries) };
}

export function removeProjectEntry(
  project: LatexProject,
  id: string,
): LatexProject {
  const entry = project.entries.find((candidate) => candidate.id === id);
  if (!entry) return project;
  const prefix = `${entry.path}/`;
  const entries = project.entries.filter(
    (candidate) =>
      candidate.id !== id &&
      !(entry.kind === "folder" && candidate.path.startsWith(prefix)),
  );
  const firstTexFile = entries.find(
    (candidate): candidate is LatexFileEntry =>
      candidate.kind === "file" && candidate.path.endsWith(".tex"),
  );
  const removedMainFile =
    project.mainFile === entry.path || project.mainFile.startsWith(prefix);
  return {
    ...project,
    entries,
    mainFile: removedMainFile ? (firstTexFile?.path ?? "") : project.mainFile,
  };
}

export function createFileEntry(path: string): LatexFileEntry {
  return {
    id: crypto.randomUUID(),
    path,
    kind: "file",
    encoding: "utf8",
    content: "",
  };
}

export function createFolderEntry(path: string): LatexFolderEntry {
  return { id: crypto.randomUUID(), path, kind: "folder" };
}

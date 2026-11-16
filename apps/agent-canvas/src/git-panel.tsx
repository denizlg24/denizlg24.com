import { Button } from "@repo/ui/button";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import type { FileChange, FileDiff, GitChanges } from "./types";

const REFRESH_MS = 4000;
const statusName: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Conflict",
  "?": "Untracked",
};
const statusLetter: Record<string, string> = { "?": "U", U: "!" };
type DiffState = { data: FileDiff } | { error: string };

export function GitSidebar({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffState>>(new Map());
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const loadDiff = useCallback(
    async (file: FileChange) => {
      let next: DiffState;
      try {
        next = { data: await api.gitDiff(id, file) };
      } catch (e) {
        next = { error: String(e) };
      }
      setDiffs((current) => {
        const previous = current.get(file.path);
        if (
          previous &&
          "data" in previous &&
          "data" in next &&
          previous.data.diff === next.data.diff
        )
          return current;
        return new Map(current).set(file.path, next);
      });
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.gitChanges(id);
        if (cancelled) return;
        setChanges(next);
        setError("");
        for (const file of next.files)
          if (expandedRef.current.has(file.path)) void loadDiff(file);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(refresh, REFRESH_MS);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, loadDiff]);

  const toggle = (file: FileChange) => {
    const next = new Set(expanded);
    if (next.delete(file.path)) {
      setExpanded(next);
      return;
    }
    next.add(file.path);
    setExpanded(next);
    void loadDiff(file);
  };
  const files = changes?.files ?? [];
  const allExpanded =
    files.length > 0 && files.every((f) => expanded.has(f.path));
  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
      return;
    }
    setExpanded(new Set(files.map((f) => f.path)));
    for (const file of files) if (!diffs.has(file.path)) void loadDiff(file);
  };
  const totals = files.reduce(
    (sum, f) => ({
      additions: sum.additions + (f.additions ?? 0),
      deletions: sum.deletions + (f.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <aside className="git-sidebar" aria-label="Git changes">
      <header className="git-sidebar-header">
        <GitBranch size={14} aria-hidden="true" />
        <strong title={changes?.upstream ?? undefined}>
          {changes ? (changes.branch ?? "Detached HEAD") : "Git"}
        </strong>
        {changes && (changes.ahead > 0 || changes.behind > 0) && (
          <span
            className="git-sync"
            title={`${changes.ahead} ahead, ${changes.behind} behind ${changes.upstream ?? "upstream"}`}
          >
            {changes.ahead > 0 && `↑${changes.ahead}`}
            {changes.behind > 0 && ` ↓${changes.behind}`}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close Git sidebar"
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </header>
      {error ? (
        <p role="status" className="git-empty">
          {error}
        </p>
      ) : !changes ? (
        <p role="status" className="git-empty">
          Loading changes…
        </p>
      ) : (
        <>
          <div className="git-summary">
            <span>
              {files.length === 0
                ? "Working tree clean"
                : `${files.length}${changes.filesTruncated ? "+" : ""} changed ${files.length === 1 ? "file" : "files"}`}
            </span>
            {files.length > 0 && (
              <>
                <span className="git-additions">+{totals.additions}</span>
                <span className="git-deletions">−{totals.deletions}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    allExpanded ? "Collapse all diffs" : "Expand all diffs"
                  }
                  onClick={toggleAll}
                >
                  {allExpanded ? (
                    <ChevronsDownUp size={14} />
                  ) : (
                    <ChevronsUpDown size={14} />
                  )}
                </Button>
              </>
            )}
          </div>
          <ul className="git-files">
            {files.map((file) => (
              <ChangedFile
                key={file.path}
                file={file}
                open={expanded.has(file.path)}
                diff={diffs.get(file.path)}
                onToggle={toggle}
              />
            ))}
          </ul>
          {changes.commits.length > 0 && (
            <details className="git-commits">
              <summary>Recent commits</summary>
              <ol>
                {changes.commits.map((c) => (
                  <li key={c.hash}>
                    <code>{c.hash}</code>
                    <span title={c.subject}>{c.subject}</span>
                    <time>{c.when}</time>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </aside>
  );
}

const ChangedFile = memo(function ChangedFile({
  file,
  open,
  diff,
  onToggle,
}: {
  file: FileChange;
  open: boolean;
  diff: DiffState | undefined;
  onToggle: (file: FileChange) => void;
}) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  return (
    <li className={open ? "open" : undefined}>
      <button
        type="button"
        className="git-file"
        aria-expanded={open}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        onClick={() => onToggle(file)}
      >
        <ChevronRight size={12} className="git-chevron" aria-hidden="true" />
        <span
          className={`git-status status-${file.status === "?" ? "untracked" : file.status}`}
          title={`${statusName[file.status] ?? file.status}${file.staged ? ", staged" : ""}`}
        >
          {statusLetter[file.status] ?? file.status}
        </span>
        <span className="git-path">
          <b>{name}</b>
          {dir && <span>{dir}</span>}
        </span>
        {file.additions !== null && (
          <span className="git-additions">+{file.additions}</span>
        )}
        {file.deletions !== null && file.deletions > 0 && (
          <span className="git-deletions">−{file.deletions}</span>
        )}
      </button>
      {open &&
        (!diff ? (
          <p className="git-diff-note">Loading diff…</p>
        ) : "error" in diff ? (
          <p className="git-diff-note" role="alert">
            {diff.error}
          </p>
        ) : diff.data.binary ? (
          <p className="git-diff-note">Binary file</p>
        ) : (
          <DiffView diff={diff.data} />
        ))}
    </li>
  );
});

type DiffLine = {
  kind: "hunk" | "add" | "del" | "context" | "note";
  text: string;
  oldLine?: number;
  newLine?: number;
};

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: "hunk", text: raw });
    } else if (!inHunk) {
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith(" ")) {
      lines.push({
        kind: "context",
        text: raw.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (raw.startsWith("\\")) {
      lines.push({ kind: "note", text: raw.slice(2) });
    } else if (raw.startsWith("diff ")) {
      inHunk = false;
    }
  }
  return lines;
}

function DiffView({ diff }: { diff: FileDiff }) {
  const lines = parseDiff(diff.diff);
  if (!lines.length) return <p className="git-diff-note">No textual changes</p>;
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard scrolling for wide diffs.
    <div className="git-diff" tabIndex={0}>
      <table>
        <tbody>
          {lines.map((line, n) => (
            <tr key={n} className={`diff-${line.kind}`}>
              <td className="diff-number">{line.oldLine}</td>
              <td className="diff-number">{line.newLine}</td>
              <td className="diff-sign" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
              </td>
              <td className="diff-text">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {diff.truncated && (
        <p className="git-diff-note">Diff truncated at 400 KB</p>
      )}
    </div>
  );
}

import { Button } from "@repo/ui/button";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import {
  memo,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./bridge";
import { readStored, writeStored } from "./storage";
import {
  type Agent,
  type FileChange,
  type FileDiff,
  type GitAction,
  type GitChanges,
  shortName,
} from "./types";

const REFRESH_MS = 4000;
const MIN_WIDTH = 320;
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
type Section = "staged" | "unstaged";

function savedWidth() {
  const n = Number(readStored("agents:changes-width"));
  return Number.isFinite(n) && n >= MIN_WIDTH ? n : 520;
}

// One panel for the whole app: whichever agent's directory is chosen, with
// staging, commit and sync on top of the read-only view.
export function ChangesPanel({
  agents,
  id,
  onSelect,
  onClose,
  onError,
}: {
  agents: Agent[];
  id: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const [width, setWidth] = useState(savedWidth);
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffState>>(new Map());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [nonce, setNonce] = useState(0);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  useEffect(() => {
    writeStored("agents:changes-width", String(Math.round(width)), onError);
  }, [width, onError]);
  // Reset everything tied to the old repository when the selection moves.
  useEffect(() => {
    setChanges(null);
    setExpanded(new Set());
    setDiffs(new Map());
    setNotice("");
  }, [id]);

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
  }, [id, loadDiff, nonce]);

  const run = async (label: string, action: GitAction) => {
    setBusy(label);
    setNotice("");
    try {
      const output = await api.gitAction(id, action);
      if (action.kind === "commit") setMessage("");
      const last = output.trim().split("\n").at(-1);
      setNotice(last ? `${label}: ${last}` : `${label} done`);
    } catch (e) {
      setNotice(`${label} failed: ${e}`);
    } finally {
      setBusy(null);
      setNonce((n) => n + 1);
    }
  };

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
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => f.unstaged);
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
  const directories = new Map<string, Agent>();
  for (const a of agents)
    if (!a.parentId && !directories.has(a.cwd)) directories.set(a.cwd, a);
  const current = agents.find((a) => a.id === id);
  if (current && !directories.has(current.cwd))
    directories.set(current.cwd, current);

  const drag = useRef<{ x: number; width: number } | null>(null);
  const beginResize = (e: PointerEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const resize = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const max = Math.max(MIN_WIDTH, window.innerWidth * 0.75);
    setWidth(Math.min(max, Math.max(MIN_WIDTH, d.width + d.x - e.clientX)));
  };

  const section = (kind: Section, list: FileChange[]) =>
    list.length > 0 && (
      <section
        className="git-section"
        aria-label={kind === "staged" ? "Staged changes" : "Changes"}
      >
        <header>
          <span>
            {kind === "staged" ? "Staged" : "Changes"} <b>{list.length}</b>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void run(kind === "staged" ? "Unstage all" : "Stage all", {
                kind: kind === "staged" ? "unstage" : "stage",
                paths: list.map((f) => f.path),
              })
            }
          >
            {kind === "staged" ? <Minus size={12} /> : <Plus size={12} />}
            {kind === "staged" ? "Unstage all" : "Stage all"}
          </Button>
        </header>
        <ul className="git-files">
          {list.map((file) => (
            <ChangedFile
              key={`${kind}:${file.path}`}
              file={file}
              section={kind}
              open={expanded.has(file.path)}
              diff={diffs.get(file.path)}
              busy={busy !== null}
              onToggle={toggle}
              onAction={(label, action) => void run(label, action)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <aside className="changes-panel" aria-label="Git changes" style={{ width }}>
      <div
        className="panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize changes panel"
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={() => setWidth(520)}
      />
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
        <div className="git-header-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fetch"
            title="Fetch"
            disabled={busy !== null}
            onClick={() => void run("Fetch", { kind: "fetch" })}
          >
            <RefreshCw size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || !changes?.behind}
            onClick={() => void run("Pull", { kind: "pull" })}
          >
            <ArrowDown size={12} />
            Pull
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || (!!changes?.upstream && !changes.ahead)}
            onClick={() => void run("Push", { kind: "push" })}
          >
            <ArrowUp size={12} />
            Push
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close Git sidebar"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>
      </header>
      <div className="git-repo">
        <select
          aria-label="Repository"
          value={current ? current.cwd : ""}
          onChange={(e) => {
            const agent = directories.get(e.target.value);
            if (agent) onSelect(agent.id);
          }}
        >
          {[...directories.entries()].map(([cwd, a]) => (
            <option key={cwd} value={cwd}>
              {shortName({ ...a, parentId: null })} — {cwd}
            </option>
          ))}
        </select>
      </div>
      {notice && (
        <p role="status" className="git-notice">
          {notice}
        </p>
      )}
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
          <form
            className="git-commit"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim() && staged.length)
                void run("Commit", { kind: "commit", message });
            }}
          >
            <textarea
              aria-label="Commit message"
              placeholder={
                staged.length ? "Commit message" : "Stage changes to commit"
              }
              value={message}
              rows={2}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy !== null || !message.trim() || !staged.length}
            >
              {busy === "Commit"
                ? "Committing…"
                : `Commit ${staged.length || ""}`}
            </Button>
          </form>
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
          <div className="git-scroll">
            {section("staged", staged)}
            {section("unstaged", unstaged)}
          </div>
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
  section,
  open,
  diff,
  busy,
  onToggle,
  onAction,
}: {
  file: FileChange;
  section: Section;
  open: boolean;
  diff: DiffState | undefined;
  busy: boolean;
  onToggle: (file: FileChange) => void;
  onAction: (label: string, action: GitAction) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  const paths = [file.path];
  return (
    <li className={open ? "open" : undefined}>
      <div className="git-file-row">
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
            title={statusName[file.status] ?? file.status}
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
        <span className="git-file-actions">
          {section === "unstaged" && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={
                confirming ? `Confirm discard ${name}` : `Discard ${name}`
              }
              title={confirming ? "Click again to discard" : "Discard changes"}
              className={confirming ? "confirming" : undefined}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                setConfirming(false);
                onAction("Discard", { kind: "discard", paths });
              }}
            >
              <Undo2 size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`${section === "staged" ? "Unstage" : "Stage"} ${name}`}
            onClick={() =>
              onAction(section === "staged" ? "Unstage" : "Stage", {
                kind: section === "staged" ? "unstage" : "stage",
                paths,
              })
            }
          >
            {section === "staged" ? <Minus size={12} /> : <Plus size={12} />}
          </Button>
        </span>
      </div>
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

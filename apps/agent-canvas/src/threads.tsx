import { ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { readStored, writeStored } from "./storage";
import { type Agent, finished, shortName, statusLabel } from "./types";

type Row = { agent: Agent; depth: number };

function directoryLabel(cwd: string) {
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

// Threads grouped by working directory, each tree in parent → child order.
export function ThreadsSidebar({
  agents,
  focused,
  onOpen,
  onError,
}: {
  agents: Agent[];
  focused: string | undefined;
  onOpen: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showFinished, setShowFinished] = useState(
    () => readStored("agents:threads-finished") !== "off",
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const v: unknown = JSON.parse(
        readStored("agents:threads-collapsed") || "[]",
      );
      return new Set(
        Array.isArray(v) ? v.filter((x) => typeof x === "string") : [],
      );
    } catch {
      return new Set();
    }
  });
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const children = new Map<string | null, Agent[]>();
    const ids = new Set(agents.map((a) => a.id));
    for (const a of agents) {
      const parent = a.parentId && ids.has(a.parentId) ? a.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), a]);
    }
    const matches = (a: Agent) =>
      !needle ||
      [a.name, shortName(a), a.activity, a.cwd, a.provider].some((v) =>
        v.toLowerCase().includes(needle),
      );
    const byDirectory = new Map<string, Row[]>();
    const walk = (a: Agent, depth: number, rows: Row[]): boolean => {
      const own: Row[] = [];
      let kept = false;
      for (const c of children.get(a.id) ?? [])
        if (walk(c, depth + 1, own)) kept = true;
      const visible =
        (showFinished || !finished(a.status) || kept) && (matches(a) || kept);
      if (visible) rows.push({ agent: a, depth }, ...own);
      return visible;
    };
    for (const root of children.get(null) ?? []) {
      const rows: Row[] = [];
      walk(root, 0, rows);
      if (rows.length)
        byDirectory.set(root.cwd, [
          ...(byDirectory.get(root.cwd) ?? []),
          ...rows,
        ]);
    }
    return [...byDirectory.entries()].sort(([a], [b]) =>
      directoryLabel(a).localeCompare(directoryLabel(b)),
    );
  }, [agents, query, showFinished]);
  const toggle = (cwd: string) => {
    const next = new Set(collapsed);
    if (!next.delete(cwd)) next.add(cwd);
    setCollapsed(next);
    writeStored("agents:threads-collapsed", [...next], onError);
  };
  return (
    <nav className="threads" aria-label="Threads">
      <div className="threads-search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search threads"
          placeholder="Search threads"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <label className="threads-filter">
        <input
          type="checkbox"
          checked={showFinished}
          onChange={(e) => {
            setShowFinished(e.target.checked);
            writeStored(
              "agents:threads-finished",
              e.target.checked ? "on" : "off",
              onError,
            );
          }}
        />
        Show finished
      </label>
      <div className="threads-list">
        {groups.length === 0 && (
          <p className="threads-empty">{query ? "No matches" : "—"}</p>
        )}
        {groups.map(([cwd, rows]) => {
          const open = !collapsed.has(cwd) || query.trim() !== "";
          const live = rows.filter((r) => !finished(r.agent.status)).length;
          return (
            <section key={cwd} className="threads-group">
              <button
                type="button"
                className="threads-directory"
                aria-expanded={open}
                title={cwd}
                onClick={() => toggle(cwd)}
              >
                <ChevronRight size={12} aria-hidden="true" />
                <span>{directoryLabel(cwd)}</span>
                <small className="numeric">
                  {live}/{rows.length}
                </small>
              </button>
              {open && (
                <ul>
                  {rows.map(({ agent: a, depth }) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`thread ${a.id === focused ? "active" : ""} ${finished(a.status) ? "is-finished" : ""}`}
                        style={{ paddingLeft: 22 + depth * 14 }}
                        aria-label={`Thread ${a.name}`}
                        title={`${statusLabel[a.status] ?? a.status} · ${a.activity}`}
                        onClick={() => onOpen(a.id)}
                      >
                        <span className={`agent-status ${a.status}`}>
                          <i />
                        </span>
                        <span className="thread-text">
                          <b>{shortName(a)}</b>
                          <small>{a.activity}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

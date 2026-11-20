import { Button } from "@repo/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  ArrowUpRight,
  ChevronRight,
  Copy,
  Eraser,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  LayoutGrid,
  LayoutPanelLeft,
  Maximize2,
  Moon,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AgentWindow } from "./agent-window";
import { api, native } from "./bridge";
import { ChangesPanel } from "./git-panel";
import { LaunchDialog, RECENT_KEY, recentDirectories } from "./launch-dialog";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  freePosition,
  tile,
  treeLayout,
} from "./layout";
import { readStored, writeStored } from "./storage";
import { ThreadsSidebar } from "./threads";
import {
  type Agent,
  count,
  finished,
  type LaunchOptions,
  type Provider,
  shortName,
  statusLabel,
  tokens,
} from "./types";
import { UpdateNotice, useUpdater, VersionButton } from "./updater";

import "@xyflow/react/dist/style.css";
import "./style.css";

type Point = { x: number; y: number };
type CardData = {
  agent: Agent;
  open: (id: string) => void;
  hiddenChildren: number;
  expanded: boolean;
  toggle: (id: string) => void;
};
type AgentNode = Node<CardData, "agent">;

const AgentCard = memo(function AgentCard({
  data,
  selected,
}: NodeProps<AgentNode>) {
  const a = data.agent;
  const native = a.parentId && !(a.hasTerminal ?? false);
  return (
    <article
      className={`agent-card status-${a.status} ${selected ? "is-selected" : ""}`}
      aria-label={`${a.name}, ${statusLabel[a.status] ?? a.status}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header>
        <span className="provider">
          {a.provider === "codex" ? (
            <TerminalSquare size={14} />
          ) : (
            <GitBranch size={14} />
          )}
          {a.provider === "codex" ? "Codex" : "Claude"}
          {native && <em>native</em>}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="nodrag"
          aria-label={`Expand ${a.name}`}
          onClick={() => data.open(a.id)}
        >
          <ArrowUpRight size={15} />
        </Button>
      </header>
      <h2 title={a.name}>{shortName(a)}</h2>
      <div className={`agent-status ${a.status}`}>
        <i />
        {statusLabel[a.status] ?? a.status}
      </div>
      <p className="activity" title={a.activity}>
        {a.activity}
      </p>
      <footer>
        <span title={a.cwd}>
          <FolderOpen size={12} />
          {a.cwd.split("/").filter(Boolean).slice(-2).join("/")}
        </span>
        <span className="numeric">{count(tokens(a))} tokens</span>
      </footer>
      {data.hiddenChildren > 0 && (
        <button
          type="button"
          className="nodrag finished-toggle"
          aria-expanded={data.expanded}
          onClick={(e) => {
            e.stopPropagation();
            data.toggle(a.id);
          }}
        >
          <ChevronRight size={12} />
          {data.expanded ? "Hide" : "Show"} {data.hiddenChildren} finished
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
});
const nodeTypes = { agent: AgentCard };

function readJson<T>(key: string, fallback: T, valid: (v: unknown) => boolean) {
  try {
    const value: unknown = JSON.parse(readStored(key) || "null");
    return valid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
function loadLayout(): {
  positions: Record<string, Point>;
  viewport: Viewport;
} {
  return readJson(
    "agents:layout",
    { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    (v) => typeof v === "object" && v !== null && "positions" in v,
  );
}
const descendants = (agents: Agent[], id: string) => {
  const ids = new Set([id]);
  let size = 0;
  while (size !== ids.size) {
    size = ids.size;
    for (const a of agents)
      if (a.parentId && ids.has(a.parentId)) ids.add(a.id);
  }
  return ids;
};

function App() {
  const layout = useRef(loadLayout());
  const flow = useReactFlow<AgentNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState("");
  // `windows` is the strip order (stable, ⌘1–9); `stack` is z-order.
  const [windows, setWindows] = useState<string[]>(() =>
    readJson("agents:windows", [], isStringArray),
  );
  const [stack, setStack] = useState<string[]>(windows);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(readJson("agents:expanded", [], isStringArray)),
  );
  const [auto, setAuto] = useState(() => readStored("agents:auto") !== "off");
  const [tiled, setTiled] = useState<{
    nonce: number;
    rects: Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
  }>({ nonce: 0, rects: {} });
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(
    () => readStored("agents:threads") !== "off",
  );
  const [changesFor, setChangesFor] = useState<string | null>(
    () => readStored("agents:changes") || null,
  );
  useEffect(() => {
    writeStored("agents:threads", threadsOpen ? "on" : "off", setError);
  }, [threadsOpen]);
  useEffect(() => {
    writeStored("agents:changes", changesFor ?? "", setError);
  }, [changesFor]);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const removed = useRef(new Set<string>());
  const completedChildren = useRef<Set<string> | null>(null);
  const [creating, setCreating] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState({ codex: false, claude: false });
  const [dark, setDark] = useState(() => readStored("agents:theme") === "dark");
  const updater = useUpdater();
  const spawnPoint = useRef<Point | null>(null);

  useEffect(() => {
    writeStored("agents:windows", windows, setError);
  }, [windows]);
  useEffect(() => {
    writeStored("agents:expanded", [...expanded], setError);
  }, [expanded]);
  useEffect(() => {
    writeStored("agents:auto", auto ? "on" : "off", setError);
  }, [auto]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    writeStored("agents:theme", dark ? "dark" : "light", setError);
  }, [dark]);

  const open = useCallback((id: string) => {
    setWindows((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setStack((prev) =>
      prev.at(-1) === id ? prev : [...prev.filter((v) => v !== id), id],
    );
  }, []);
  const close = useCallback((ids: Set<string> | string) => {
    const gone = typeof ids === "string" ? new Set([ids]) : ids;
    setWindows((prev) => {
      const kept = prev.filter((v) => !gone.has(v));
      return kept.length === prev.length ? prev : kept;
    });
    setStack((prev) => {
      const kept = prev.filter((v) => !gone.has(v));
      return kept.length === prev.length ? prev : kept;
    });
  }, []);
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const forget = (id: string) => {
    const ids = descendants(agents, id);
    for (const v of ids) removed.current.add(v);
    close(ids);
    setAgents((prev) => prev.filter((a) => !ids.has(a.id)));
  };

  // Finished subagents fold into their parent's card unless it is expanded;
  // a finished child with live work beneath it stays visible.
  const { visible, hiddenCounts } = useMemo(() => {
    const byParent = new Map<string, Agent[]>();
    for (const a of agents)
      if (a.parentId)
        byParent.set(a.parentId, [...(byParent.get(a.parentId) ?? []), a]);
    const live = (id: string): boolean =>
      (byParent.get(id) ?? []).some((c) => !finished(c.status) || live(c.id));
    const hidden = new Set<string>();
    const counts = new Map<string, number>();
    const hide = (id: string) => {
      hidden.add(id);
      for (const c of byParent.get(id) ?? []) hide(c.id);
    };
    for (const a of agents) {
      if (!a.parentId || !finished(a.status) || live(a.id)) continue;
      counts.set(a.parentId, (counts.get(a.parentId) ?? 0) + 1);
      if (!expanded.has(a.parentId)) hide(a.id);
    }
    return {
      visible: agents.filter((a) => !hidden.has(a.id)),
      hiddenCounts: counts,
    };
  }, [agents, expanded]);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    api
      .providers()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((e) => setError(String(e)));
    async function refresh() {
      try {
        const next = (await api.snapshot()).filter(
          (a) => !removed.current.has(a.id),
        );
        if (cancelled) return;
        setAgents((prev) =>
          JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
        );
        const done = (a: Agent) => a.parentId && finished(a.status);
        const justFinished = new Set(
          next
            .filter(
              (a) =>
                done(a) &&
                completedChildren.current !== null &&
                !completedChildren.current.has(a.id),
            )
            .map((a) => a.id),
        );
        completedChildren.current = new Set(next.filter(done).map((a) => a.id));
        const ids = new Set(next.map((a) => a.id));
        close(
          new Set([
            ...justFinished,
            ...windowsRef.current.filter((id) => !ids.has(id)),
          ]),
        );
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(refresh, 700);
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [close]);

  const measured = useCallback(() => {
    const heights = new Map<string, number>();
    for (const n of flow.getNodes())
      if (n.measured?.height) heights.set(n.id, n.measured.height);
    return heights;
  }, [flow]);
  const persistPositions = useCallback((positions: Map<string, Point>) => {
    layout.current.positions = Object.fromEntries(positions);
    writeStored("agents:layout", layout.current, setError);
  }, []);

  useEffect(() => {
    setNodes((prev) => {
      const known = new Map(prev.map((n) => [n.id, n]));
      let positions: Map<string, Point>;
      if (auto) {
        positions = treeLayout(visible, measured());
      } else {
        positions = new Map();
        const boxes = visible.flatMap((a) => {
          const p = known.get(a.id)?.position ?? layout.current.positions[a.id];
          if (!p) return [];
          positions.set(a.id, p);
          return [{ ...p, width: CARD_WIDTH, height: CARD_HEIGHT }];
        });
        for (const a of visible) {
          if (positions.has(a.id)) continue;
          const parent = a.parentId ? positions.get(a.parentId) : null;
          const lowest = Math.max(80, ...boxes.map((b) => b.y + b.height));
          const desired = parent
            ? { x: parent.x + CARD_WIDTH + 110, y: parent.y }
            : (spawnPoint.current ?? { x: 120, y: lowest + 64 });
          const p = freePosition(desired, boxes);
          positions.set(a.id, p);
          boxes.push({ ...p, width: CARD_WIDTH, height: CARD_HEIGHT });
        }
      }
      spawnPoint.current = null;
      const result = visible.map((a) => {
        const node = known.get(a.id);
        const position = positions.get(a.id) ?? { x: 120, y: 120 };
        const data: CardData = {
          agent: a,
          open,
          hiddenChildren: hiddenCounts.get(a.id) ?? 0,
          expanded: expanded.has(a.id),
          toggle,
        };
        return node &&
          node.position.x === position.x &&
          node.position.y === position.y &&
          node.data.agent === a &&
          node.data.hiddenChildren === data.hiddenChildren &&
          node.data.expanded === data.expanded
          ? node
          : { ...node, id: a.id, type: "agent" as const, position, data };
      });
      return result.length === prev.length &&
        result.every((n, i) => n === prev[i])
        ? prev
        : result;
    });
  }, [visible, hiddenCounts, expanded, auto, open, toggle, measured, setNodes]);

  useEffect(() => {
    if (!completedChildren.current) return;
    persistPositions(new Map(nodes.map((n) => [n.id, n.position])));
  }, [nodes, persistPositions]);

  // Re-run the layout once React Flow has measured real card heights.
  const [measuredOnce, setMeasuredOnce] = useState(0);
  const onNodesChangeMeasured: typeof onNodesChange = (changes) => {
    onNodesChange(changes);
    if (auto && changes.some((c) => c.type === "dimensions"))
      setMeasuredOnce((n) => n + 1);
  };
  useEffect(() => {
    if (!measuredOnce || !auto) return;
    const positions = treeLayout(visible, measured());
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const p = positions.get(n.id);
        if (!p || (p.x === n.position.x && p.y === n.position.y)) return n;
        changed = true;
        return { ...n, position: p };
      });
      return changed ? next : prev;
    });
  }, [measuredOnce, auto, visible, measured, setNodes]);

  const saveViewport = useCallback(() => {
    layout.current.viewport = flow.getViewport();
    writeStored("agents:layout", layout.current, setError);
  }, [flow]);
  const arrange = () => {
    const positions = treeLayout(visible, measured());
    setNodes((prev) =>
      prev.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
    );
    persistPositions(positions);
    requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.2, duration: 250 });
    });
  };
  const tileWindows = () => {
    const layer = document.querySelector(".window-layer");
    if (!layer) return;
    const boxes = tile(windows.length, layer.clientWidth, layer.clientHeight);
    setTiled((t) => ({
      nonce: t.nonce + 1,
      rects: Object.fromEntries(windows.map((id, i) => [id, boxes[i]])),
    }));
  };
  const clearFinished = async () => {
    const roots = agents.filter(
      (a) =>
        !a.parentId &&
        [...descendants(agents, a.id)].every((id) =>
          finished(agents.find((x) => x.id === id)?.status ?? "done"),
        ),
    );
    for (const root of roots) {
      try {
        await api.stop(root.id);
        forget(root.id);
      } catch (e) {
        setError(String(e));
      }
    }
  };
  const choose = (provider: Provider) => {
    setError("");
    setCreating(provider);
  };
  const create = async (cwd: string, options: LaunchOptions) => {
    if (!creating || !cwd || busy) return;
    setBusy(true);
    setError("");
    try {
      const a = await api.create(creating, cwd, options);
      writeStored(
        RECENT_KEY,
        [a.cwd, ...recentDirectories().filter((d) => d !== a.cwd)].slice(0, 6),
        setError,
      );
      setCreating(null);
      setAgents((prev) => [...prev.filter((v) => v.id !== a.id), a]);
      open(a.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const resume = useCallback(
    async (id: string) => {
      try {
        const a = await api.resume(id);
        setAgents((prev) => prev.map((v) => (v.id === a.id ? a : v)));
        open(id);
      } catch (e) {
        setError(String(e));
      }
    },
    [open],
  );
  const rename = async () => {
    if (!renaming) return;
    try {
      await api.rename(renaming.id, renaming.name);
      const { id, name } = renaming;
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, name: name.trim() } : a)),
      );
      setRenaming(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const waiting = agents.filter((a) => a.status === "waiting");
  const active = agents.filter((a) =>
    ["working", "starting"].includes(a.status),
  ).length;
  const liveAgents = agents.filter(
    (a) => (a.hasTerminal ?? !a.parentId) && !finished(a.status),
  ).length;
  const finishedRoots = agents.some(
    (a) =>
      !a.parentId &&
      [...descendants(agents, a.id)].every((id) =>
        finished(agents.find((x) => x.id === id)?.status ?? "done"),
      ),
  );

  // Dock badge for approvals, and a bounce when a new one arrives unseen.
  const waitingIds = waiting.map((a) => a.id).join(",");
  const seenWaiting = useRef(new Set<string>());
  useEffect(() => {
    if (!native) return;
    const ids = waitingIds ? waitingIds.split(",") : [];
    const fresh = ids.some((id) => !seenWaiting.current.has(id));
    seenWaiting.current = new Set(ids);
    try {
      const win = getCurrentWindow();
      win.setBadgeCount(ids.length || undefined).catch(() => {});
      if (fresh && !document.hasFocus())
        win.requestUserAttention(2).catch(() => {});
    } catch {
      // No native window outside the desktop shell.
    }
  }, [waitingIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" && !e.shiftKey && native) {
        e.preventDefault();
        choose("claude");
      } else if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
        const id = windows[Number(e.key) - 1];
        if (!id) return;
        e.preventDefault();
        open(id);
      } else if (e.key.toLowerCase() === "t" && e.shiftKey) {
        e.preventDefault();
        tileWindows();
      } else if (e.key.toLowerCase() === "a" && e.shiftKey) {
        e.preventDefault();
        arrange();
      } else if (e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        setThreadsOpen((v) => !v);
      } else if (e.key.toLowerCase() === "g" && e.shiftKey) {
        e.preventDefault();
        setChangesFor((v) =>
          v !== null
            ? null
            : (front ?? agents.find((a) => !a.parentId)?.id ?? null),
        );
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const visibleIds = new Set(visible.map((a) => a.id));
  const edges: Edge[] = visible
    .filter((a) => a.parentId && visibleIds.has(a.parentId))
    .map((a) => ({
      id: `${a.parentId}-${a.id}`,
      source: a.parentId as string,
      target: a.id,
      type: "default",
      className: `edge-${a.status}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      animated: a.status === "working",
    }));
  const target = agents.find((a) => a.id === menuTarget) ?? null;
  const changesAgent = changesFor
    ? (agents.find((a) => a.id === changesFor) ?? null)
    : null;
  const front = stack.at(-1);
  return (
    <main className="app">
      <header className="toolbar">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={threadsOpen ? "Hide threads" : "Show threads"}
          aria-pressed={threadsOpen}
          title="Threads (⌘B)"
          onClick={() => setThreadsOpen((v) => !v)}
        >
          <PanelLeft size={16} />
        </Button>
        <div className="wordmark">
          <Workflow size={18} />
          <h1>Agents</h1>
        </div>
        <div className="counts">
          <span>{agents.length} agents</span>
          <span>{active} working</span>
          {waiting.length > 0 && (
            <button
              type="button"
              className="count-waiting"
              onClick={() => open(waiting[0].id)}
            >
              {waiting.length} need approval
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          <VersionButton
            version={updater.version}
            phase={updater.phase}
            onClick={updater.fromToolbar}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={auto}
            className={auto ? "active" : undefined}
            title="Keep agent trees arranged as they grow"
            onClick={() => setAuto((v) => !v)}
          >
            Auto layout
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!agents.length}
            title="Arrange (⇧⌘A)"
            onClick={arrange}
          >
            <LayoutGrid size={15} /> Arrange
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={windows.length < 2}
            title="Tile windows (⇧⌘T)"
            onClick={tileWindows}
          >
            <LayoutPanelLeft size={15} /> Tile
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!finishedRoots}
            onClick={() => void clearFinished()}
          >
            <Eraser size={15} /> Clear finished
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={changesFor !== null}
            className={changesFor !== null ? "active" : undefined}
            disabled={!agents.length}
            title="Changes (⇧⌘G)"
            onClick={() =>
              setChangesFor((v) =>
                v !== null
                  ? null
                  : (front ?? agents.find((a) => !a.parentId)?.id ?? null),
              )
            }
          >
            <GitCommitHorizontal size={15} /> Changes
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dark ? "Use light theme" : "Use dark theme"}
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button
            size="sm"
            disabled={!native}
            title="New agent (⌘N)"
            onClick={() => choose("codex")}
          >
            <Plus size={14} />
            New agent
          </Button>
        </div>
      </header>
      {!native && (
        <div role="status" className="notice">
          Open the desktop app to launch local CLIs.{" "}
          <code>bun run desktop</code>
        </div>
      )}
      <UpdateNotice
        phase={updater.phase}
        liveAgents={liveAgents}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
        onRetry={() => void updater.lookForUpdate(true)}
      />
      {error && !creating && (
        <div className="notice error" role="alert">
          {error}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {windows.length > 0 && (
        <nav className="window-tabs" aria-label="Open windows">
          {windows.map((id, index) => {
            const a = agents.find((a) => a.id === id);
            return a ? (
              <div
                key={id}
                className={`window-tab ${id === front ? "active" : ""}`}
              >
                <button
                  type="button"
                  aria-label={`Focus ${a.name} window`}
                  title={index < 9 ? `⌘${index + 1}` : undefined}
                  onClick={() => open(id)}
                >
                  <span className={`agent-status ${a.status}`}>
                    <i />
                  </span>
                  <span>{shortName(a)}</span>
                </button>
                <button
                  type="button"
                  className="window-tab-close"
                  aria-label={`Close ${a.name} tab`}
                  onClick={() => close(id)}
                >
                  <X size={11} />
                </button>
              </div>
            ) : null;
          })}
        </nav>
      )}
      <div className="workspace">
        {threadsOpen && (
          <ThreadsSidebar
            agents={agents}
            focused={front}
            onOpen={(id) => {
              open(id);
              const node = flow.getNode(id);
              if (node)
                void flow.setCenter(
                  node.position.x + CARD_WIDTH / 2,
                  node.position.y + CARD_HEIGHT / 2,
                  { zoom: flow.getZoom(), duration: 250 },
                );
            }}
            onError={setError}
          />
        )}
        <div className="stage">
          <ContextMenu
            onOpenChange={(isOpen) => {
              if (!isOpen) setMenuTarget(null);
            }}
          >
            <ContextMenuTrigger asChild>
              <div
                className={`canvas ${auto ? "auto-layout" : ""}`}
                onContextMenu={(e) => {
                  const node = (e.target as Element).closest(
                    ".react-flow__node",
                  );
                  setMenuTarget(node?.getAttribute("data-id") ?? null);
                  spawnPoint.current = flow.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <ReactFlow<AgentNode>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChangeMeasured}
                  defaultViewport={layout.current.viewport}
                  onNodeDragStart={() => setAuto(false)}
                  onNodeDragStop={() =>
                    persistPositions(
                      new Map(flow.getNodes().map((n) => [n.id, n.position])),
                    )
                  }
                  onMoveEnd={saveViewport}
                  onNodeClick={(_, n) => open(n.id)}
                  minZoom={0.15}
                  maxZoom={2}
                  nodesConnectable={false}
                  deleteKeyCode={null}
                  panOnScroll
                  selectionOnDrag
                  panOnDrag={[1]}
                  zoomOnScroll={false}
                  zoomOnPinch
                >
                  <Background gap={24} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                {agents.length === 0 && (
                  <div className="empty-canvas">
                    <Workflow size={30} strokeWidth={1} />
                    <h2>No agents</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!native}
                      onClick={() => choose("codex")}
                    >
                      <Plus size={14} />
                      New agent
                    </Button>
                  </div>
                )}
                <div className="canvas-caption">
                  Local workspace
                  <span>
                    Right-click to add · Scroll to pan · Pinch to zoom · ⌘N new
                    · ⌘1–9 windows
                  </span>
                </div>
              </div>
            </ContextMenuTrigger>
            {target ? (
              <ContextMenuContent className="canvas-menu">
                <div className="canvas-menu-heading">{target.name}</div>
                <ContextMenuItem onSelect={() => open(target.id)}>
                  <ArrowUpRight size={14} />
                  {(target.hasTerminal ?? !target.parentId)
                    ? "Open terminal"
                    : "Open transcript"}
                </ContextMenuItem>
                {(target.hasTerminal ?? !target.parentId) &&
                  finished(target.status) && (
                    <ContextMenuItem onSelect={() => void resume(target.id)}>
                      <Play size={14} />
                      Resume session
                    </ContextMenuItem>
                  )}
                <ContextMenuItem
                  onSelect={() =>
                    setRenaming({ id: target.id, name: target.name })
                  }
                >
                  <Pencil size={14} />
                  Rename…
                </ContextMenuItem>
                {(hiddenCounts.get(target.id) ?? 0) > 0 && (
                  <ContextMenuItem onSelect={() => toggle(target.id)}>
                    <ChevronRight size={14} />
                    {expanded.has(target.id) ? "Hide" : "Show"} finished
                    subagents
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onSelect={() =>
                    void navigator.clipboard?.writeText(target.cwd)
                  }
                >
                  <Copy size={14} />
                  Copy directory
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() =>
                    void api
                      .stop(target.id)
                      .then(() => forget(target.id))
                      .catch((e) => setError(String(e)))
                  }
                >
                  {finished(target.status) ? (
                    <Trash2 size={14} />
                  ) : (
                    <Square size={14} />
                  )}
                  {finished(target.status) ? "Remove from canvas" : "Stop"}
                </ContextMenuItem>
              </ContextMenuContent>
            ) : (
              <ContextMenuContent className="canvas-menu">
                <div className="canvas-menu-heading">New agent</div>
                <ContextMenuItem
                  disabled={!native}
                  onSelect={() => choose("codex")}
                  aria-label="New Codex agent"
                  className="provider-menu-item"
                >
                  <span className="menu-provider-icon">
                    <TerminalSquare size={19} />
                  </span>
                  <span>
                    <strong>Codex</strong>
                    <small>OpenAI CLI</small>
                  </span>
                  <ArrowUpRight size={14} />
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!native}
                  onSelect={() => choose("claude")}
                  aria-label="New Claude agent"
                  className="provider-menu-item"
                >
                  <span className="menu-provider-icon">
                    <GitBranch size={19} />
                  </span>
                  <span>
                    <strong>Claude</strong>
                    <small>Claude Code CLI</small>
                  </span>
                  <ArrowUpRight size={14} />
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!agents.length}
                  onSelect={() => {
                    for (const a of agents)
                      if (!a.parentId && !finished(a.status)) open(a.id);
                  }}
                >
                  <TerminalSquare size={14} />
                  Open running terminals
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={windows.length < 2}
                  onSelect={tileWindows}
                >
                  <LayoutPanelLeft size={14} />
                  Tile windows
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!windows.length}
                  onSelect={() => close(new Set(windows))}
                >
                  <X size={14} />
                  Close all windows
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={!agents.length} onSelect={arrange}>
                  <LayoutGrid size={14} />
                  Arrange agents
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => flow.fitView({ padding: 0.2, duration: 250 })}
                >
                  <Maximize2 size={14} />
                  Fit agents
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
          <div className="window-layer">
            {windows.map((id, index) => {
              const agent = agents.find((a) => a.id === id);
              const rect = tiled.rects[id];
              return agent ? (
                <AgentWindow
                  key={id}
                  agent={agent}
                  index={index}
                  order={stack.indexOf(id)}
                  active={id === front}
                  layout={rect ? { nonce: tiled.nonce, rect } : undefined}
                  onFocus={() => open(id)}
                  onClose={() => close(id)}
                  onOpen={open}
                  onStop={forget}
                  onResume={resume}
                  onError={setError}
                  changesOpen={changesFor === id}
                  onChanges={(target) =>
                    setChangesFor((v) => (v === target ? null : target))
                  }
                />
              ) : null;
            })}
          </div>
        </div>
        {changesAgent && (
          <ChangesPanel
            agents={agents}
            id={changesAgent.id}
            onSelect={setChangesFor}
            onClose={() => setChangesFor(null)}
            onError={setError}
          />
        )}
      </div>
      {creating && (
        <LaunchDialog
          provider={creating}
          onProvider={setCreating}
          providers={providers}
          busy={busy}
          error={error}
          onClose={() => setCreating(null)}
          onLaunch={create}
        />
      )}
      <Dialog
        open={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
      >
        <DialogContent className="rename-dialog" aria-describedby={undefined}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <DialogTitle>Rename agent</DialogTitle>
            <input
              aria-label="Agent name"
              autoFocus
              maxLength={100}
              value={renaming?.name ?? ""}
              onChange={(e) =>
                setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
              }
            />
            <footer>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!renaming?.name.trim()}>
                Rename
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>,
);

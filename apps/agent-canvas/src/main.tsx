import { Button } from "@repo/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import {
  Background,
  Controls,
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
  FolderOpen,
  GitBranch,
  Maximize2,
  Moon,
  Plus,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AgentWindow } from "./agent-window";
import { api, native } from "./bridge";
import { LaunchDialog } from "./launch-dialog";
import {
  type Agent,
  count,
  type LaunchOptions,
  type Provider,
  statusLabel,
  tokens,
} from "./types";

import "@xyflow/react/dist/style.css";
import "./style.css";

type AgentNode = Node<{ agent: Agent; open: (id: string) => void }, "agent">;
const AgentCard = memo(function AgentCard({
  data,
  selected,
}: NodeProps<AgentNode>) {
  const a = data.agent;
  return (
    <article
      className={`agent-card ${selected ? "is-selected" : ""}`}
      aria-label={`${a.name}, ${statusLabel[a.status] ?? a.status}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header>
        <span className="provider">
          {a.provider === "codex" ? (
            <TerminalSquare size={15} />
          ) : (
            <GitBranch size={15} />
          )}{" "}
          {a.provider === "codex" ? "Codex" : "Claude"}
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
      <h2>
        {a.parentId
          ? a.name
          : a.cwd.split("/").filter(Boolean).at(-1) || a.name}
      </h2>
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
});
const nodeTypes = { agent: AgentCard };
function loadLayout(): {
  positions: Record<string, { x: number; y: number }>;
  viewport: Viewport;
} {
  try {
    return (
      JSON.parse(localStorage.getItem("agents:layout") || "null") ?? {
        positions: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }
    );
  } catch {
    return { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
  }
}
function App() {
  const layout = useRef(loadLayout());
  const flow = useReactFlow<AgentNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const removedRoots = useRef(new Set<string>());
  const [creating, setCreating] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState({ codex: false, claude: false });
  const [dark, setDark] = useState(
    () => localStorage.getItem("agents:theme") === "dark",
  );
  const spawnPoint = useRef<{ x: number; y: number } | null>(null);
  const open = useCallback(
    (id: string) =>
      setOpened((prev) =>
        prev.at(-1) === id ? prev : [...prev.filter((v) => v !== id), id],
      ),
    [],
  );
  const removeRoot = (id: string) => {
    removedRoots.current.add(id);
    const ids = new Set(agents.filter((a) => a.rootId === id).map((a) => a.id));
    setOpened((prev) => prev.filter((v) => v !== id && !ids.has(v)));
    setAgents((prev) => prev.filter((a) => a.rootId !== id));
    setNodes((prev) => prev.filter((n) => n.data.agent.rootId !== id));
  };
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("agents:theme", dark ? "dark" : "light");
  }, [dark]);
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
          (a) => !removedRoots.current.has(a.rootId),
        );
        if (cancelled) return;
        setAgents(next);
        setNodes((prev) => {
          const positions = new Map(prev.map((n) => [n.id, n.position]));
          const known = new Map(prev.map((n) => [n.id, n]));
          const sorted = [...next].sort(
            (a, b) =>
              Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
              a.id.localeCompare(b.id),
          );
          const placed = new Map<string, { x: number; y: number }>();
          let roots = 0;
          const siblings = new Map<string, number>();
          return sorted.map((a) => {
            const siblingIndex = a.parentId
              ? (siblings.get(a.parentId) ?? 0)
              : roots++;
            if (a.parentId) siblings.set(a.parentId, siblingIndex + 1);
            let position =
              positions.get(a.id) ?? layout.current.positions[a.id];
            if (!position) {
              if (a.parentId) {
                const parent = positions.get(a.parentId) ??
                  placed.get(a.parentId) ?? { x: 120, y: 160 };
                position = {
                  x: parent.x + 390,
                  y: parent.y + siblingIndex * 270,
                };
              } else {
                position = { x: 120 + siblingIndex * 370, y: 160 };
              }
            }
            placed.set(a.id, position);
            return {
              ...known.get(a.id),
              id: a.id,
              type: "agent" as const,
              position,
              data: { agent: a, open },
            };
          });
        });
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
  }, [open, setNodes]);
  const save = useCallback(() => {
    layout.current = {
      positions: Object.fromEntries(
        flow.getNodes().map((n) => [n.id, n.position]),
      ),
      viewport: flow.getViewport(),
    };
    localStorage.setItem("agents:layout", JSON.stringify(layout.current));
  }, [flow]);
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
      const position =
        spawnPoint.current ??
        flow.screenToFlowPosition({
          x: 160 + (agents.filter((a) => !a.parentId).length % 3) * 350,
          y:
            160 +
            Math.floor(agents.filter((a) => !a.parentId).length / 3) * 250,
        });
      layout.current.positions[a.id] = position;
      setCreating(null);
      setAgents((prev) => [...prev.filter((v) => v.id !== a.id), a]);
      open(a.id);
      spawnPoint.current = null;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const active = agents.filter((a) =>
    ["working", "starting"].includes(a.status),
  ).length;
  const edges = agents
    .filter((a) => a.parentId)
    .map((a) => ({
      id: `${a.parentId}-${a.id}`,
      source: a.parentId!,
      target: a.id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: a.status === "working",
    }));
  return (
    <main className="app">
      <header className="toolbar">
        <div className="wordmark">
          <GitBranch size={19} />
          <h1>Agents</h1>
        </div>
        <div className="counts">
          <span>{agents.length} agents</span>
          <span>{active} working</span>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dark ? "Use light theme" : "Use dark theme"}
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button size="sm" disabled={!native} onClick={() => choose("codex")}>
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
      {opened.length > 0 && (
        <nav className="window-tabs" aria-label="Open windows">
          {opened.map((id, index) => {
            const a = agents.find((a) => a.id === id);
            return a ? (
              <button
                key={id}
                type="button"
                className={index === opened.length - 1 ? "active" : ""}
                aria-label={`Focus ${a.name} window`}
                onClick={() => open(id)}
              >
                {a.provider === "codex" ? (
                  <TerminalSquare size={12} />
                ) : (
                  <GitBranch size={12} />
                )}
                <span>
                  {a.parentId
                    ? a.name
                    : a.cwd.split("/").filter(Boolean).at(-1) || a.name}
                </span>
              </button>
            ) : null;
          })}
        </nav>
      )}
      <div className="workspace">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="canvas"
              onContextMenu={(e) => {
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
                onNodesChange={onNodesChange}
                defaultViewport={layout.current.viewport}
                onNodeDragStop={save}
                onMoveEnd={save}
                onNodeDoubleClick={(_, n) => open(n.id)}
                onNodeClick={(_, n) => open(n.id)}
                minZoom={0.2}
                maxZoom={2}
                nodesConnectable={false}
                deleteKeyCode={null}
                panOnScroll
                selectionOnDrag
                panOnDrag={[1]}
                zoomOnScroll={false}
              >
                <Background gap={24} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
              {agents.length === 0 && (
                <div className="empty-canvas">
                  <GitBranch size={30} strokeWidth={1} />
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
                <span>Right-click to add · Scroll to pan · Pinch to zoom</span>
              </div>
            </div>
          </ContextMenuTrigger>
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
              onSelect={() =>
                setOpened(agents.filter((a) => !a.parentId).map((a) => a.id))
              }
            >
              <TerminalSquare size={14} />
              Open all terminals
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!opened.length}
              onSelect={() => setOpened([])}
            >
              <X size={14} />
              Close all windows
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => flow.fitView({ padding: 0.2, duration: 250 })}
            >
              <Maximize2 size={14} />
              Fit agents
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <div className="window-layer">
          {opened.map((id, index) => {
            const agent = agents.find((a) => a.id === id);
            return agent ? (
              <AgentWindow
                key={id}
                agent={agent}
                dark={dark}
                index={index}
                order={index}
                onFocus={() => open(id)}
                onClose={() =>
                  setOpened((prev) => prev.filter((v) => v !== id))
                }
                onOpen={open}
                onStop={removeRoot}
                onError={setError}
              />
            ) : null;
          })}
        </div>
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

import { Button } from "@repo/ui/button";
import {
  ArrowUpRight,
  GitBranch,
  Maximize2,
  Minimize2,
  Play,
  Square,
  X,
} from "lucide-react";
import {
  lazy,
  type PointerEvent,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "./bridge";
import { writeStored } from "./storage";
import { type Agent, count, finished, statusLabel, tokens } from "./types";
import { Usage } from "./usage";

type Rect = { x: number; y: number; width: number; height: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const MIN_WIDTH = 380;
const MIN_HEIGHT = 240;
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function readWindow(
  id: string,
): { maximized?: unknown; rect?: unknown } | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`agents:window:${id}`) || "null",
    );
    return typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
function savedRect(value: unknown): Rect | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("x" in value && "y" in value && "width" in value && "height" in value))
    return null;
  const { x, y, width, height } = value;
  return finite(x) && finite(y) && finite(width) && finite(height)
    ? { x, y, width, height }
    : null;
}
function bounds(): { width: number; height: number } {
  const layer = document.querySelector(".window-layer");
  return {
    width: layer?.clientWidth || window.innerWidth,
    height: layer?.clientHeight || window.innerHeight - 90,
  };
}
// Keeps a window reachable: at least its title bar stays inside the layer.
function clamp(r: Rect): Rect {
  const { width, height } = bounds();
  const w = Math.max(MIN_WIDTH, Math.min(width, r.width));
  const h = Math.max(MIN_HEIGHT, Math.min(height, r.height));
  return {
    width: w,
    height: h,
    x: Math.max(-w + 160, Math.min(width - 160, r.x)),
    y: Math.max(0, Math.min(height - 44, r.y)),
  };
}
function initialRect(id: string, index: number): Rect {
  const saved = savedRect(readWindow(id)?.rect);
  if (saved) return clamp(saved);
  const { width, height } = bounds();
  const w = Math.min(760, width - 40);
  const h = Math.min(560, height - 40);
  // Agent trees grow from the canvas's left edge; new windows open on the
  // right so the cards they belong to stay in view.
  return clamp({
    x: Math.max(8, width - w - 20 - (index % 6) * 36),
    y: Math.min(20 + (index % 6) * 30, Math.max(8, height - h - 16)),
    width: w,
    height: h,
  });
}

const AgentTerminal = lazy(() =>
  import("./terminal").then((m) => ({ default: m.AgentTerminal })),
);

function Transcript({ text, live }: { text: string; live: boolean }) {
  const element = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = element.current;
    if (el && pinned.current && text) el.scrollTop = el.scrollHeight;
  }, [text]);
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  return (
    <pre
      ref={element}
      className="transcript"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scrolling for a live transcript
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {lines.length
        ? lines.map((line, index) => (
            <span
              // Lines are append-only, so the index is a stable identity.
              key={index}
              className={line.startsWith("› ") ? "transcript-tool" : undefined}
            >
              {line}
              {index < lines.length - 1 ? "\n" : ""}
            </span>
          ))
        : live
          ? "Waiting for transcript…"
          : "No transcript recorded."}
    </pre>
  );
}

export function AgentWindow({
  agent: a,
  index,
  order,
  active,
  layout,
  changesOpen,
  onChanges,
  onFocus,
  onClose,
  onOpen,
  onStop,
  onResume,
  onError,
}: {
  agent: Agent;
  index: number;
  order: number;
  active: boolean;
  layout?: { nonce: number; rect: Rect };
  changesOpen: boolean;
  onChanges: (id: string) => void;
  onFocus: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onResume: (id: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const [maximized, setMaximized] = useState(
    () => readWindow(a.id)?.maximized === true,
  );
  const [pending, setPending] = useState<"stop" | "resume" | null>(null);
  const [rect, setRect] = useState(() => initialRect(a.id, index));
  const layoutNonce = layout?.nonce;
  const layoutRect = useRef(layout?.rect);
  layoutRect.current = layout?.rect;
  useEffect(() => {
    if (layoutNonce === undefined || !layoutRect.current) return;
    setMaximized(false);
    setRect(clamp(layoutRect.current));
  }, [layoutNonce]);
  // The layer narrows when a sidebar or the changes panel opens; pull the
  // window back fully into view rather than leaving it behind the panel.
  useEffect(() => {
    const layer = document.querySelector(".window-layer");
    if (!layer) return;
    const keep = () =>
      setRect((r) => {
        const { width, height } = bounds();
        const next = clamp({
          ...r,
          x: Math.min(r.x, Math.max(0, width - r.width)),
          y: Math.min(r.y, Math.max(0, height - r.height)),
        });
        return next.x === r.x &&
          next.y === r.y &&
          next.width === r.width &&
          next.height === r.height
          ? r
          : next;
      });
    const observer = new ResizeObserver(keep);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    writeStored(`agents:window:${a.id}`, { rect, maximized }, onError);
  }, [a.id, rect, maximized, onError]);
  const gesture = useRef<{
    x: number;
    y: number;
    rect: Rect;
    edge: Edge | null;
  } | null>(null);
  const begin = (e: PointerEvent, edge: Edge | null = null) => {
    if (e.button !== 0) return;
    if (maximized || (!edge && (e.target as Element).closest("button"))) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    gesture.current = { x: e.clientX, y: e.clientY, rect: { ...rect }, edge };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.edge) {
      setRect(clamp({ ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy }));
      return;
    }
    const { width, height } = bounds();
    let { x, y, width: w, height: h } = g.rect;
    if (g.edge.includes("e"))
      w = Math.min(width - x, Math.max(MIN_WIDTH, w + dx));
    if (g.edge.includes("s"))
      h = Math.min(height - y, Math.max(MIN_HEIGHT, h + dy));
    if (g.edge.includes("w")) {
      const next = Math.max(MIN_WIDTH, w - Math.max(-x, dx));
      x += w - next;
      w = next;
    }
    if (g.edge.includes("n")) {
      const next = Math.max(MIN_HEIGHT, h - Math.max(-y, dy));
      y += h - next;
      h = next;
    }
    setRect({ x, y, width: w, height: h });
  };
  const end = () => {
    gesture.current = null;
  };
  const interactive = a.hasTerminal ?? !a.parentId;
  const live = !finished(a.status);
  const stop = async () => {
    setPending("stop");
    try {
      await api.stop(a.id);
      onStop(a.id);
    } catch (e) {
      onError(String(e));
      setPending(null);
    }
  };
  const resume = async () => {
    setPending("resume");
    try {
      await onResume(a.id);
    } finally {
      setPending(null);
    }
  };
  return (
    <section
      className={`agent-window ${maximized ? "maximized" : ""} ${active ? "is-active" : ""}`}
      aria-label={`${a.name} window`}
      style={{
        left: maximized ? 6 : rect.x,
        top: maximized ? 6 : rect.y,
        width: maximized ? "calc(100% - 12px)" : rect.width,
        height: maximized ? "calc(100% - 12px)" : rect.height,
        zIndex: 20 + order,
      }}
      onPointerDownCapture={onFocus}
    >
      <header
        className="window-titlebar"
        onPointerDown={(e) => begin(e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest("button")) setMaximized((v) => !v);
        }}
      >
        <span className={`agent-status ${a.status}`}>
          <i />
        </span>
        <strong>{a.name}</strong>
        <span className="window-state">
          {statusLabel[a.status] ?? a.status}
        </span>
        <div className="window-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={changesOpen}
            className={changesOpen ? "active" : undefined}
            onClick={() => onChanges(a.id)}
          >
            <GitBranch size={12} />
            Changes
          </Button>
          {interactive && live && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending !== null}
              onClick={stop}
            >
              <Square size={11} />
              {pending === "stop" ? "Stopping…" : "Stop"}
            </Button>
          )}
          {interactive && !live && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending !== null}
              onClick={resume}
            >
              <Play size={11} />
              {pending === "resume" ? "Resuming…" : "Resume"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={maximized ? "Restore window" : "Maximize window"}
            onClick={() => setMaximized((v) => !v)}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Close ${a.name} window`}
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>
      </header>
      <div className="window-info">
        <div className="window-path" title={a.cwd}>
          {a.cwd}
        </div>
        {a.settings && (
          <div className="window-settings">
            {a.settings.model || "CLI default"}
            {a.settings.reasoning && ` · ${a.settings.reasoning}`}
            {a.settings.permissions === "bypass" && (
              <span className="permission-bypass">
                {a.provider === "codex" ? "YOLO" : "Bypass"}
              </span>
            )}
          </div>
        )}
        <details>
          <summary>
            {count(tokens(a))} tokens <span>Usage</span>
          </summary>
          <Usage agent={a} />
        </details>
        {a.checkpointWarning && <p role="status">{a.checkpointWarning}</p>}
      </div>
      <div className="window-body">
        <div className="window-content">
          {!interactive ? (
            <>
              <div className="transcript-heading">
                <span>Native subagent · transcript</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpen(a.parentId ?? a.rootId)}
                >
                  Parent terminal
                  <ArrowUpRight size={13} />
                </Button>
              </div>
              <Transcript text={a.transcript} live={live} />
            </>
          ) : (
            <Suspense
              fallback={
                <div
                  role="status"
                  className="terminal-wrap"
                  aria-label="Loading terminal"
                />
              }
            >
              <AgentTerminal id={a.id} running={live} active={active} />
            </Suspense>
          )}
        </div>
      </div>
      {!maximized &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className={`window-edge edge-${edge}`}
            aria-hidden="true"
            onPointerDown={(e) => begin(e, edge)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      {!maximized && (
        <button
          type="button"
          className="window-resize"
          aria-label={`Resize ${a.name} window`}
          onPointerDown={(e) => begin(e, "se")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            const step: Record<string, [number, number]> = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, -20],
              ArrowDown: [0, 20],
            };
            const delta = step[e.key];
            if (!delta) return;
            e.preventDefault();
            setRect((r) =>
              clamp({
                ...r,
                width: r.width + delta[0],
                height: r.height + delta[1],
              }),
            );
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 10 10 3M7 10l3-3" stroke="currentColor" />
          </svg>
        </button>
      )}
    </section>
  );
}

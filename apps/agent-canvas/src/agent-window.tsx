import { Button } from "@repo/ui/button";
import {
  ArrowUpRight,
  Grip,
  Maximize2,
  Minimize2,
  Square,
  X,
} from "lucide-react";
import { lazy, type PointerEvent, Suspense, useRef, useState } from "react";
import { api } from "./bridge";
import { type Agent, count, statusLabel, tokens } from "./types";
import { Usage } from "./usage";

const AgentTerminal = lazy(() =>
  import("./terminal").then((m) => ({ default: m.AgentTerminal })),
);
export function AgentWindow({
  agent: a,
  dark,
  index,
  order,
  onFocus,
  onClose,
  onOpen,
  onStop,
  onError,
}: {
  agent: Agent;
  dark: boolean;
  index: number;
  order: number;
  onFocus: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onError: (e: string) => void;
}) {
  const element = useRef<HTMLElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [rect, setRect] = useState(() => {
    const width = Math.min(740, window.innerWidth - 40);
    const height = Math.min(590, window.innerHeight - 160);
    return {
      x: Math.min(60 + index * 40, Math.max(8, window.innerWidth - width - 20)),
      y: Math.min(
        40 + index * 34,
        Math.max(8, window.innerHeight - height - 85),
      ),
      width,
      height,
    };
  });
  const gesture = useRef<{
    x: number;
    y: number;
    rect: typeof rect;
    resize: boolean;
  } | null>(null);
  const begin = (e: PointerEvent, resize = false) => {
    if (maximized || (!resize && (e.target as Element).closest("button")))
      return;
    e.preventDefault();
    onFocus();
    gesture.current = { x: e.clientX, y: e.clientY, rect: { ...rect }, resize };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const parent = element.current?.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (g.resize)
      setRect({
        ...g.rect,
        width: Math.max(
          Math.min(420, width - g.rect.x),
          Math.min(width - g.rect.x - 8, g.rect.width + dx),
        ),
        height: Math.max(
          300,
          Math.min(height - g.rect.y - 8, g.rect.height + dy),
        ),
      });
    else
      setRect({
        ...g.rect,
        x: Math.max(0, Math.min(width - 150, g.rect.x + dx)),
        y: Math.max(0, Math.min(height - 60, g.rect.y + dy)),
      });
  };
  const end = () => {
    gesture.current = null;
  };
  const stop = async () => {
    setStopping(true);
    try {
      await api.stop(a.id);
      onStop(a.id);
    } catch (e) {
      onError(String(e));
      setStopping(false);
    }
  };
  return (
    <section
      ref={element}
      className={`agent-window ${maximized ? "maximized" : ""}`}
      aria-label={`${a.name} window`}
      style={{
        left: maximized ? 8 : rect.x,
        top: maximized ? 8 : rect.y,
        width: maximized ? "calc(100% - 16px)" : rect.width,
        height: maximized ? "calc(100% - 16px)" : rect.height,
        zIndex: 20 + order,
      }}
      onPointerDownCapture={onFocus}
    >
      <header
        className="window-titlebar"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest("button")) setMaximized((v) => !v);
        }}
      >
        <Grip size={14} className="window-grip" />
        <strong>{a.name}</strong>
        <span className={`agent-status ${a.status}`}>
          <i />
          {statusLabel[a.status] ?? a.status}
        </span>
        <div className="window-actions">
          {!a.parentId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={stopping}
              onClick={stop}
            >
              <Square size={11} />
              {stopping ? "Stopping…" : "Stop"}
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
        <details>
          <summary>
            {count(tokens(a))} tokens <span>Usage</span>
          </summary>
          <Usage agent={a} />
        </details>
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
      </div>
      <div className="window-content">
        {a.parentId ? (
          <>
            <div className="transcript-heading">
              <span>Subagent transcript</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpen(a.rootId)}
              >
                Parent terminal
                <ArrowUpRight size={13} />
              </Button>
            </div>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard scrolling for live transcript. */}
            <pre className="transcript" tabIndex={0}>
              {a.transcript || "Waiting for transcript…"}
            </pre>
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
            <AgentTerminal id={a.id} dark={dark} />
          </Suspense>
        )}
      </div>
      {!maximized && (
        <button
          type="button"
          className="window-resize"
          aria-label={`Resize ${a.name} window`}
          onPointerDown={(e) => begin(e, true)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              setRect((r) => ({
                ...r,
                width: Math.max(
                  420,
                  r.width +
                    (e.key === "ArrowRight"
                      ? 20
                      : e.key === "ArrowLeft"
                        ? -20
                        : 0),
                ),
                height: Math.max(
                  300,
                  r.height +
                    (e.key === "ArrowDown"
                      ? 20
                      : e.key === "ArrowUp"
                        ? -20
                        : 0),
                ),
              }));
            }
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

"use client";

import type { BackgroundAgentRun } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@repo/ui/resizable";
import { cn } from "@repo/ui/utils";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentPanel } from "./agent-panel";
import { AgentSessionProvider, useAgentSession } from "./agent-session";
import {
  AGENT_DOCK_MIN_WIDTH,
  type AgentLauncherPrefs,
  clampLauncherPosition,
  DEFAULT_AGENT_DOCK_PREFS,
  DEFAULT_AGENT_LAUNCHER_PREFS,
  loadAgentDockPrefs,
  loadAgentLauncherPrefs,
  saveAgentDockPrefs,
  saveAgentLauncherPrefs,
} from "./launcher-prefs";

const LAUNCHER_SIZE = 36;
const DRAG_THRESHOLD = 4;
const LONG_PRESS_MS = 550;

interface AgentDockState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  width: number;
  commitWidth: (width: number) => void;
}

const AgentDockContext = createContext<AgentDockState | null>(null);

export function useAgentDock(): AgentDockState {
  const dock = useContext(AgentDockContext);
  if (!dock)
    throw new Error("useAgentDock must be used within AgentDockProvider");
  return dock;
}

/**
 * Owns the agent session for a host layout plus the dock's open state and
 * width (persisted). ⌘J toggles it; an `agent:open` window event opens it.
 */
export function AgentDockProvider({
  allowBackground = false,
  onActiveRunChange,
  children,
}: {
  allowBackground?: boolean;
  onActiveRunChange?: (run: BackgroundAgentRun | null) => void;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState(DEFAULT_AGENT_DOCK_PREFS);

  useEffect(() => {
    setPrefs(loadAgentDockPrefs());
  }, []);

  const update = useCallback((patch: Partial<typeof prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      saveAgentDockPrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPrefs((current) => {
          const next = { ...current, open: !current.open };
          saveAgentDockPrefs(next);
          return next;
        });
      }
    };
    const open = () => update({ open: true });
    window.addEventListener("keydown", keydown);
    window.addEventListener("agent:open", open);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("agent:open", open);
    };
  }, [update]);

  const value = useMemo<AgentDockState>(
    () => ({
      open: prefs.open,
      setOpen: (open) => update({ open }),
      toggle: () => update({ open: !prefs.open }),
      width: prefs.width,
      commitWidth: (width) =>
        update({ width: Math.max(AGENT_DOCK_MIN_WIDTH, Math.round(width)) }),
    }),
    [prefs.open, prefs.width, update],
  );

  return (
    <AgentDockContext.Provider value={value}>
      <AgentSessionProvider
        allowBackground={allowBackground}
        onActiveRunChange={onActiveRunChange}
      >
        {children}
      </AgentSessionProvider>
    </AgentDockContext.Provider>
  );
}

function AgentLauncherButton({
  prefs,
  onPrefsChange,
  onOpen,
  active,
}: {
  prefs: AgentLauncherPrefs;
  onPrefsChange: (prefs: AgentLauncherPrefs) => void;
  onOpen: () => void;
  active: boolean;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragged: boolean;
  } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const place = () =>
      setPosition(
        clampLauncherPosition(
          prefs.xPct * window.innerWidth,
          prefs.yPct * window.innerHeight,
          LAUNCHER_SIZE,
        ),
      );
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [prefs.xPct, prefs.yPct]);

  useEffect(
    () => () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
    },
    [],
  );

  if (!position) return null;

  const endPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = null;
    pointerRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointer.dragged) {
      onPrefsChange({
        ...prefs,
        xPct: position.x / window.innerWidth,
        yPct: position.y / window.innerHeight,
      });
    } else if (!menu) {
      onOpen();
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label="Open agent"
        className="fixed z-80 size-9 touch-none rounded-full bg-background text-muted-foreground shadow-md hover:text-foreground"
        style={{ left: position.x, top: position.y }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerRef.current = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
            dragged: false,
          };
          const { clientX, clientY } = event;
          longPressRef.current = setTimeout(() => {
            setMenu({ x: clientX, y: clientY });
            pointerRef.current = null;
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.id !== event.pointerId) return;
          const dx = event.clientX - pointer.startX;
          const dy = event.clientY - pointer.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          pointer.dragged = true;
          if (longPressRef.current) clearTimeout(longPressRef.current);
          setPosition(
            clampLauncherPosition(
              pointer.originX + dx,
              pointer.originY + dy,
              LAUNCHER_SIZE,
            ),
          );
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <MessageCircle className="size-4" />
        {active ? (
          <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-foreground/70" />
        ) : null}
      </Button>
      {menu ? (
        <div
          className="fixed z-[110] min-w-28 rounded-md border bg-popover p-1 shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerLeave={() => setMenu(null)}
        >
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              onPrefsChange({ ...prefs, hidden: true });
              setMenu(null);
            }}
          >
            Hide button
          </button>
        </div>
      ) : null}
    </>
  );
}

function matchesPath(
  pathname: string,
  exact: readonly string[],
  under: readonly string[],
): boolean {
  return (
    exact.includes(pathname) ||
    under.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

/**
 * The host content and the agent side by side in a resizable row, so the page
 * reflows instead of sitting under an overlay. Below `md` the panel covers the
 * viewport — a 360px column beside a phone-width page is neither usable.
 */
export function AgentDock({
  children,
  hiddenOnPaths = [],
  hiddenUnderPaths = [],
  className,
}: {
  children: ReactNode;
  /** Exact paths where the dock never shows (a page that is the agent). */
  hiddenOnPaths?: readonly string[];
  /** Path prefixes where the dock never shows (surfaces with their own agent). */
  hiddenUnderPaths?: readonly string[];
  className?: string;
}) {
  const dock = useAgentDock();
  const session = useAgentSession();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [launcher, setLauncher] = useState(DEFAULT_AGENT_LAUNCHER_PREFS);
  const widthRef = useRef(dock.width);

  useEffect(() => {
    setLauncher(loadAgentLauncherPrefs());
  }, []);

  const hidden = matchesPath(pathname, hiddenOnPaths, hiddenUnderPaths);
  const wasHidden = useRef(hidden);
  const { busy } = session;
  const { setOpen } = dock;

  useEffect(() => {
    if (wasHidden.current && !hidden && busy) setOpen(true);
    wasHidden.current = hidden;
  }, [busy, hidden, setOpen]);

  const updateLauncher = (next: AgentLauncherPrefs) => {
    setLauncher(next);
    saveAgentLauncherPrefs(next);
  };

  const showDock = dock.open && !hidden;
  const panel = (
    <AgentPanel
      variant="docked"
      onClose={() => dock.setOpen(false)}
      headerActions={
        launcher.hidden ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Show launcher button"
            onClick={() => updateLauncher({ ...launcher, hidden: false })}
          >
            <MessageCircle className="size-3.5" />
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        className={cn("min-h-0 min-w-0 flex-1", className)}
        onLayoutChanged={(_layout, meta) => {
          if (meta.isUserInteraction) dock.commitWidth(widthRef.current);
        }}
      >
        <ResizablePanel
          id="agent-host"
          minSize={320}
          className="h-full min-w-0 overflow-hidden"
        >
          {children}
        </ResizablePanel>
        {showDock && !isMobile ? (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="agent-dock"
              defaultSize={dock.width}
              minSize={AGENT_DOCK_MIN_WIDTH}
              maxSize="50"
              className="h-full min-w-0 overflow-hidden"
              onResize={(size) => {
                widthRef.current = size.inPixels;
              }}
            >
              {panel}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {showDock && isMobile ? (
        <div className="fixed inset-0 z-[90] flex flex-col bg-background pt-(--titlebar-inset,0px)">
          {panel}
        </div>
      ) : null}
      {!showDock && !hidden && !launcher.hidden ? (
        <AgentLauncherButton
          prefs={launcher}
          onPrefsChange={updateLauncher}
          onOpen={() => dock.setOpen(true)}
          active={session.backgroundRun !== null || busy}
        />
      ) : null}
    </>
  );
}

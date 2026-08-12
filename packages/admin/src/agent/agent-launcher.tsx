"use client";

import type { BackgroundAgentRun, BackgroundAgentRunList } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/sheet";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { ChatView } from "./chat-view";
import {
  type AgentLauncherPrefs,
  clampLauncherPosition,
  loadAgentLauncherPrefs,
  saveAgentLauncherPrefs,
} from "./launcher-prefs";

const BUTTON_SIZE = 36;
const DRAG_THRESHOLD = 4;

export function AgentLauncher({
  hiddenOnPaths = [],
  allowBackground = false,
  onActiveRunChange,
}: {
  hiddenOnPaths?: string[];
  allowBackground?: boolean;
  onActiveRunChange?: (run: BackgroundAgentRun | null) => void;
}) {
  const { client } = useAdmin();
  const pathname = usePathname();
  const [prefs, setPrefs] = useState<AgentLauncherPrefs>(() =>
    loadAgentLauncherPrefs(),
  );
  const [position, setPosition] = useState(() => ({ x: 0, y: 0 }));
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [activeRun, setActiveRun] = useState<BackgroundAgentRun | null>(null);
  const pointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragged: boolean;
  } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: AgentLauncherPrefs) => {
    setPrefs(next);
    saveAgentLauncherPrefs(next);
  }, []);

  const clampFromPrefs = useCallback((current: AgentLauncherPrefs) => {
    const next = clampLauncherPosition(
      current.xPct * window.innerWidth,
      current.yPct * window.innerHeight,
      BUTTON_SIZE,
    );
    setPosition(next);
    return next;
  }, []);

  useEffect(() => {
    clampFromPrefs(prefs);
    setReady(true);
    const handleViewportChange = () => {
      const next = clampFromPrefs(prefs);
      persist({
        ...prefs,
        xPct: next.x / window.innerWidth,
        yPct: next.y / window.innerHeight,
      });
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, [clampFromPrefs, persist, prefs]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const openSheet = () => setOpen(true);
    window.addEventListener("keydown", keydown);
    window.addEventListener("agent:open", openSheet);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("agent:open", openSheet);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let run: BackgroundAgentRun | null = null;
      try {
        const result = await client.get<BackgroundAgentRunList>(
          "background-agent/runs?active=true",
        );
        run = result.runs[0] ?? null;
      } catch {}
      if (cancelled) return;
      setActiveRun(run);
      onActiveRunChange?.(run);
      timeout = setTimeout(poll, run ? 4_000 : 15_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [client, onActiveRunChange]);

  useEffect(
    () => () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
    },
    [],
  );

  const routeSuppressed = hiddenOnPaths.some((path) => pathname === path);

  const endPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = null;
    pointerRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointer.dragged) {
      persist({
        ...prefs,
        xPct: position.x / window.innerWidth,
        yPct: position.y / window.innerHeight,
      });
    } else if (!menu) {
      setOpen(true);
    }
  };

  return (
    <>
      {ready && !prefs.hidden && !routeSuppressed ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Open agent"
          className="fixed z-80 size-9 touch-none rounded-full bg-background shadow-md"
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
            longPressRef.current = setTimeout(() => {
              setMenu({ x: event.clientX, y: event.clientY });
              pointerRef.current = null;
            }, 550);
          }}
          onPointerMove={(event) => {
            const pointer = pointerRef.current;
            if (!pointer || pointer.id !== event.pointerId) return;
            const dx = event.clientX - pointer.startX;
            const dy = event.clientY - pointer.startY;
            if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
              pointer.dragged = true;
              if (longPressRef.current) clearTimeout(longPressRef.current);
              setPosition(
                clampLauncherPosition(
                  pointer.originX + dx,
                  pointer.originY + dy,
                  BUTTON_SIZE,
                ),
              );
            }
          }}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <MessageCircle className="size-4" />
          {activeRun ? (
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-violet-500" />
          ) : null}
        </Button>
      ) : null}

      {menu ? (
        <div
          className="fixed z-[110] min-w-28 rounded-md border bg-popover p-1 shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerLeave={() => setMenu(null)}
        >
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              persist({ ...prefs, hidden: true });
              setMenu(null);
            }}
          >
            Hide button
          </button>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          forceMount
          side="right"
          showCloseButton
          data-agent-sheet
          inert={!open}
          className="data-[state=closed]:invisible gap-0 p-0"
          style={{ width: "min(96vw, 56rem)", maxWidth: "56rem" }}
        >
          <SheetTitle className="sr-only">Agent</SheetTitle>
          {prefs.hidden ? (
            <Button
              size="sm"
              variant="ghost"
              className="absolute left-2 top-2 z-10 h-7 text-xs"
              onClick={() => persist({ ...prefs, hidden: false })}
            >
              Show button
            </Button>
          ) : null}
          <div className="min-h-0 flex-1 pt-10">
            <ChatView
              surface="sheet"
              allowBackground={allowBackground}
              observedBackgroundRun={activeRun ?? undefined}
              onActiveRunChange={onActiveRunChange}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

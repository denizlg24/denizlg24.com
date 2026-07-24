"use client";

import type { TerminalSession } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const TerminalClient = dynamic(
  () =>
    import("./_components/terminal-client").then(
      (module) => module.TerminalClient,
    ),
  { ssr: false },
);

function mostRecentlyActive(
  sessions: TerminalSession[],
): TerminalSession | null {
  return sessions.reduce<TerminalSession | null>(
    (best, session) =>
      best === null || session.lastActivityAt > best.lastActivityAt
        ? session
        : best,
    null,
  );
}

export default function TerminalPage() {
  const { data: sessions, reload } = usePoll(api.terminal.sessions, 15_000);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const [resolved, setResolved] = useState(false);

  // A null session id makes the client mint a new tmux session, so mounting
  // before the list arrives spawned one on every visit to this page. Resolve
  // the target first and reattach to whatever was last in use; only the +
  // button and killing the last session should ever create one.
  useEffect(() => {
    if (resolved || sessions === null) return;
    setResolved(true);
    const target = mostRecentlyActive(sessions);
    if (target) setActiveSession(target.id);
  }, [sessions, resolved]);

  const onSessionEstablished = useCallback(
    (sessionId: string) => {
      setActiveSession((current) =>
        current === sessionId ? current : sessionId,
      );
      void reload();
    },
    [reload],
  );

  const kill = async (sessionId: string) => {
    try {
      await api.terminal.kill(sessionId);
      if (activeSession === sessionId) {
        const remaining = (sessions ?? []).filter(
          (session) => session.id !== sessionId,
        );
        setActiveSession(mostRecentlyActive(remaining)?.id ?? null);
        setConnectionKey((key) => key + 1);
      }
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-sm font-semibold">terminal</h1>
        {(sessions ?? []).map((session) => {
          const active = session.id === activeSession;
          return (
            <span
              key={session.id}
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40",
              )}
            >
              <button
                type="button"
                className={active ? undefined : "hover:text-foreground"}
                title={`${session.attachedClients} attached · active ${formatRelative(session.lastActivityAt)}`}
                onClick={() => setActiveSession(session.id)}
              >
                {session.id.replace(/^cloud-/, "")}
              </button>
              <button
                type="button"
                className={cn(
                  "hover:text-destructive",
                  active ? "text-background/70" : "text-muted-foreground",
                )}
                onClick={() => void kill(session.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setActiveSession(null);
            setConnectionKey((key) => key + 1);
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {resolved && (
          <TerminalClient
            key={connectionKey}
            sessionId={activeSession}
            onSessionEstablished={onSessionEstablished}
          />
        )}
      </div>
    </div>
  );
}

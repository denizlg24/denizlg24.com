"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
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

export default function TerminalPage() {
  const { data: sessions, reload } = usePoll(api.terminal.sessions, 15_000);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);

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
        setActiveSession(null);
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
        {(sessions ?? []).map((session) => (
          <span
            key={session.id}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px]",
              session.id === activeSession
                ? "border-foreground/40 text-foreground"
                : "text-muted-foreground",
            )}
          >
            <button
              type="button"
              className="hover:text-foreground"
              title={`${session.attachedClients} attached · active ${formatRelative(session.lastActivityAt)}`}
              onClick={() => setActiveSession(session.id)}
            >
              {session.id.replace(/^cloud-/, "")}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void kill(session.id)}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
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
      <div className="flex min-h-[60dvh] flex-1 flex-col">
        <TerminalClient
          key={connectionKey}
          sessionId={activeSession}
          onSessionEstablished={onSessionEstablished}
        />
      </div>
    </div>
  );
}

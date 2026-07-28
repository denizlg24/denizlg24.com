"use client";

import { Button } from "@repo/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@repo/ui/sheet";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChatView } from "@/app/dashboard/_components/chat-view";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  BackgroundAgentRun,
  BackgroundAgentRunList,
} from "@/lib/data-types";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

function taskFromRun(run: BackgroundAgentRun) {
  return {
    id: `agent:${run.id}`,
    label: "Agent",
    statusText: run.status === "queued" ? "Queued" : "Working",
    color: "bg-violet-500",
    active: true,
  };
}

function BackgroundAgentObserver({
  api,
  onActiveRunChange,
}: {
  api: denizApi;
  onActiveRunChange: (run: BackgroundAgentRun | null) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const result = await api.GET<BackgroundAgentRunList>({
        endpoint: "background-agent/runs?active=true",
      });
      if (cancelled || "code" in result) return;
      const store = useBackgroundTasksStore.getState();
      const activeIds = new Set(result.runs.map((run) => `agent:${run.id}`));
      for (const run of result.runs) {
        const task = taskFromRun(run);
        if (store.tasks[task.id]) store.update(task.id, task);
        else store.register(task);
      }
      for (const id of Object.keys(store.tasks)) {
        if (id.startsWith("agent:") && !activeIds.has(id)) {
          store.unregister(id);
        }
      }
      onActiveRunChange(result.runs[0] ?? null);
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 4_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, onActiveRunChange]);
  return null;
}

export function AgentSheet() {
  const { settings, loading } = useUserSettings();
  const [open, setOpen] = useState(false);
  const [activeRun, setActiveRun] = useState<BackgroundAgentRun | null>(null);
  const pathname = usePathname();
  const api = useMemo(
    () => (loading || !settings.apiKey ? null : new denizApi(settings.apiKey)),
    [loading, settings.apiKey],
  );

  useEffect(() => {
    const toggle = () => setOpen((current) => !current);
    const openSheet = () => setOpen(true);
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("agent:open", openSheet);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("agent:open", openSheet);
    };
  }, []);

  if (!api || !pathname.startsWith("/dashboard")) return null;

  return (
    <>
      <BackgroundAgentObserver api={api} onActiveRunChange={setActiveRun} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="fixed right-4 bottom-4 z-80 size-9 rounded-full bg-background shadow-md"
            aria-label="Open agent"
          >
            <MessageCircle className="size-4" />
            {activeRun ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-violet-500" />
            ) : null}
          </Button>
        </SheetTrigger>
        <SheetContent
          forceMount
          side="right"
          showCloseButton
          data-agent-sheet
          className="gap-0 p-0"
          style={{ width: "min(96vw, 56rem)", maxWidth: "56rem" }}
        >
          <SheetTitle className="sr-only">Agent</SheetTitle>
          <div className="min-h-0 flex-1 pt-10">
            <ChatView
              surface="sheet"
              allowBackground
              observedBackgroundRunId={activeRun?.id}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

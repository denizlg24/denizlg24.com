"use client";

import type {
  AgentTaskFeedbackResponse,
  AgentTaskRun,
  AgentTaskRunStatus,
} from "@repo/schemas";
import { agentTaskRunResponseSchema } from "@repo/schemas";
import { Shimmer } from "@repo/ui/ai-elements/shimmer";
import { Button } from "@repo/ui/button";
import { Marker, MarkerContent } from "@repo/ui/marker";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import type { ChatStatus } from "ai";
import { formatDistanceStrict } from "date-fns";
import { Check, Loader2, Sparkles, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AgentMessageHandlers,
  AgentMessageList,
} from "../agent/agent-messages";
import {
  formatCost,
  formatTokenCount,
  isAgentToolPart,
} from "../agent/agent-parts";
import { useAdmin } from "../provider";

/** How often a live run is re-read; the server persists every ~2 s. */
const LIVE_POLL_MS = 2_500;

const STATUS_TONE: Record<AgentTaskRunStatus, StatusTone> = {
  queued: "muted",
  running: "warning",
  completed: "good",
  failed: "critical",
};

const STATUS_LABEL: Record<AgentTaskRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function isLiveRunStatus(status: AgentTaskRunStatus): boolean {
  return status === "queued" || status === "running";
}

const NO_HANDLERS: AgentMessageHandlers = { onApproval: () => undefined };

function formatClock(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Seconds tick while the run is live so the duration reads as a clock, not a snapshot. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function countToolCalls(run: AgentTaskRun): number {
  let count = 0;
  for (const message of run.messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (isAgentToolPart(part) && !part.providerExecuted) count += 1;
    }
  }
  return count;
}

function RunHeader({ run }: { run: AgentTaskRun }) {
  const live = isLiveRunStatus(run.status);
  const now = useNow(live);
  const duration = run.startedAt
    ? formatDistanceStrict(
        run.completedAt ? new Date(run.completedAt) : new Date(now),
        new Date(run.startedAt),
      )
    : null;
  const tools = countToolCalls(run);
  const usage = run.tokenUsage;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <StatusDot
          tone={STATUS_TONE[run.status]}
          label={STATUS_LABEL[run.status]}
          className={cn(run.status === "running" && "animate-pulse")}
        />
        {STATUS_LABEL[run.status]}
      </span>
      <span className="capitalize">{run.trigger}</span>
      <span className="tabular-nums">
        {formatClock(run.startedAt ?? run.scheduledFor)}
      </span>
      {duration ? <span className="tabular-nums">{duration}</span> : null}
      <span className="tabular-nums">
        {tools} {tools === 1 ? "tool call" : "tool calls"}
      </span>
      {usage ? (
        <span className="ml-auto tabular-nums">
          {formatTokenCount(usage.inputTokens)} in ·{" "}
          {formatTokenCount(usage.outputTokens)} out ·{" "}
          {formatCost(usage.costUsd)}
        </span>
      ) : null}
    </div>
  );
}

function FeedbackSection({
  run,
  onChanged,
}: {
  run: AgentTaskRun;
  onChanged: () => Promise<void> | void;
}) {
  const { client } = useAdmin();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (run.feedback) {
    const learned = run.feedback.learnedProcedureIds.length;
    return (
      <div className="flex items-start gap-2 border-t px-4 py-3 text-xs">
        <Check className="mt-0.5 size-3.5 shrink-0 text-status-good" />
        <div className="min-w-0 flex-1">
          <span className="font-medium capitalize">{run.feedback.verdict}</span>
          <span className="ml-2 tabular-nums text-muted-foreground">
            {learned} {learned === 1 ? "procedure" : "procedures"}
          </span>
          {run.feedback.text ? (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {run.feedback.text}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  if (isLiveRunStatus(run.status)) return null;

  const submit = async (verdict: "useful" | "correction") => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const result = await client.post<AgentTaskFeedbackResponse>(
        `agent-tasks/runs/${run.id}/feedback`,
        { feedbackId: crypto.randomUUID(), verdict, text: text.trim() },
      );
      setText("");
      await onChanged();
      if (result.learnedProcedures.length > 0) {
        const count = result.learnedProcedures.length;
        toast.success(
          `${count} ${count === 1 ? "procedure" : "procedures"} learned`,
        );
      } else {
        // Nothing stuck is a normal outcome, but a silent success would read
        // as a bug — say which check dropped it.
        toast.message("Feedback saved, nothing learned", {
          description: result.rejected[0]?.reason,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Feedback failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Feedback"
          rows={2}
          className="min-h-16 resize-y text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            disabled={submitting || !text.trim()}
            onClick={() => submit("useful")}
          >
            <ThumbsUp className="size-3.5" /> Keep doing
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={submitting || !text.trim()}
            onClick={() => submit("correction")}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Correct
          </Button>
        </div>
      </div>
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/**
 * One run, read whole and rendered with the chat's own blocks. A live run is
 * re-read on a short interval and the transcript grows in place — the same
 * reasoning and tool rows the chat shows, driven by what the server persisted
 * rather than by a stream.
 */
export function RunTranscript({
  runId,
  onChanged,
}: {
  runId: string;
  /** A status change or feedback landed; the overview's list is stale. */
  onChanged: () => Promise<void> | void;
}) {
  const { client } = useAdmin();
  const [run, setRun] = useState<AgentTaskRun | null>(null);

  const load = useCallback(async () => {
    const result = agentTaskRunResponseSchema.parse(
      await client.get<unknown>(`agent-tasks/runs/${runId}`),
    );
    return result.run;
  }, [client, runId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let lastStatus: AgentTaskRunStatus | null = null;
    setRun(null);
    const tick = async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setRun(next);
        if (lastStatus && lastStatus !== next.status) void onChanged();
        lastStatus = next.status;
        if (isLiveRunStatus(next.status)) {
          timer = window.setTimeout(tick, LIVE_POLL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        toast.error(
          error instanceof Error ? error.message : "Failed to load run",
        );
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, onChanged]);

  // The request message is the task's own prompt wrapped for an unattended
  // run; the task pane already shows the prompt, so only the agent's side is
  // drawn here.
  const messages = useMemo(
    () => run?.messages.filter((message) => message.role === "assistant") ?? [],
    [run],
  );
  const chatStatus: ChatStatus =
    run?.status === "running"
      ? "streaming"
      : run?.status === "queued"
        ? "submitted"
        : "ready";

  if (!run) return <TranscriptSkeleton />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RunHeader run={run} />
      {run.error ? (
        <div className="border-b px-4 py-2 text-xs text-destructive">
          {run.error}
        </div>
      ) : null}
      {run.status === "queued" && messages.length === 0 ? (
        <div className="flex-1 px-4 py-5">
          <Marker role="status" className="text-xs">
            <MarkerContent>
              <Shimmer>Queued</Shimmer>
            </MarkerContent>
          </Marker>
        </div>
      ) : (
        <AgentMessageList
          key={run.id}
          messages={messages}
          status={chatStatus}
          handlers={NO_HANDLERS}
          contentClassName="max-w-3xl"
        />
      )}
      <FeedbackSection key={run.id} run={run} onChanged={onChanged} />
    </div>
  );
}

"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import {
  CalendarClock,
  Check,
  ClipboardList,
  ListTodo,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  IEmailTriage,
  ITriageActionSuggestion,
  TriageSuggestionType,
} from "@/lib/data-types";

type SuggestionStatus = "pending" | "accepted" | "dismissed";

/**
 * One proposed action. Hairline-separated rows with a status spine rather than
 * a card, so a long list of proposals stays scannable.
 */
function SuggestionRow({
  icon,
  title,
  detail,
  meta,
  call,
  status,
  pending,
  onAccept,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  meta?: ReactNode;
  /** The exact write an action runs, shown before it is accepted. */
  call?: Record<string, unknown>;
  status: SuggestionStatus;
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const settled = status !== "pending";

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 py-3 pl-3",
        status === "dismissed" && "opacity-45",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2.5 left-0 w-0.5 rounded-full",
          status === "accepted"
            ? "bg-status-good"
            : status === "dismissed"
              ? "bg-border"
              : "bg-foreground/25",
        )}
      />

      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] font-medium leading-snug",
            status === "dismissed" && "line-through",
          )}
        >
          {title}
        </p>
        {detail && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {detail}
          </p>
        )}
        {meta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
            {meta}
          </div>
        )}
        {call && (
          <details className="mt-1.5 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer select-none">arguments</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
              {JSON.stringify(call, null, 2)}
            </pre>
          </details>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {settled ? (
          <>
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-[0.12em]",
                status === "accepted"
                  ? "text-status-good"
                  : "text-muted-foreground",
              )}
            >
              {status}
            </span>
            {status === "dismissed" && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Accept instead"
                className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                disabled={pending}
                onClick={onAccept}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Undo2 className="size-3.5" />
                )}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Accept ${title}`}
              className="size-7"
              disabled={pending}
              onClick={onAccept}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5 text-status-good" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Dismiss ${title}`}
              className="size-7"
              disabled={pending}
              onClick={onDismiss}
            >
              <X className="size-3.5 text-muted-foreground" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const ACTION_ICONS: Record<ITriageActionSuggestion["effect"], ReactNode> = {
  create: <Plus className="size-3.5" />,
  update: <PencilLine className="size-3.5" />,
  delete: <Trash2 className="size-3.5" />,
};

/** `web_finance_rules` → `finance rules`. */
function resourceLabel(tool: string): string {
  return tool.replace(/^web_/, "").replaceAll("_", " ");
}

export function TriageSuggestions({
  triage,
  pendingIds,
  onDecide,
}: {
  triage: Pick<
    IEmailTriage,
    "suggestedTasks" | "suggestedEvents" | "suggestedActions"
  >;
  pendingIds: Set<string>;
  onDecide: (
    id: string,
    type: TriageSuggestionType,
    action: "accept" | "dismiss",
  ) => void;
}) {
  const tasks = triage.suggestedTasks;
  const events = triage.suggestedEvents;
  const actions = triage.suggestedActions;
  const total = tasks.length + events.length + actions.length;

  if (total === 0) return null;

  const open = [...tasks, ...events, ...actions].filter(
    (entry) => entry.status === "pending",
  ).length;

  return (
    <section className="border-b">
      <div className="flex items-center gap-3 px-4 pb-2 pt-3 sm:px-8">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Proposed actions
        </h2>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {open > 0 ? `${open} open · ${total}` : total}
        </span>
      </div>

      <div className="divide-y px-4 pb-3 sm:px-8">
        {tasks.map((task) => (
          <SuggestionRow
            key={task._id}
            icon={<ListTodo className="size-3.5" />}
            title={task.title}
            detail={task.description}
            status={task.status}
            pending={pendingIds.has(task._id)}
            onAccept={() => onDecide(task._id, "task", "accept")}
            onDismiss={() => onDecide(task._id, "task", "dismiss")}
            meta={
              <>
                <span className="uppercase tracking-[0.12em]">
                  {task.priority}
                </span>
                {task.kanbanBoardTitle && task.kanbanColumnTitle && (
                  <span>
                    {task.kanbanBoardTitle} / {task.kanbanColumnTitle}
                  </span>
                )}
                {task.dueDate && (
                  <span className="tabular-nums">
                    due {new Date(task.dueDate).toLocaleDateString()}
                  </span>
                )}
                {task.assignmentType && (
                  <span className="inline-flex items-center gap-1">
                    <ClipboardList className="size-3" />
                    {task.assignmentType}
                  </span>
                )}
              </>
            }
          />
        ))}

        {events.map((event) => (
          <SuggestionRow
            key={event._id}
            icon={<CalendarClock className="size-3.5" />}
            title={event.title}
            detail={event.place}
            status={event.status}
            pending={pendingIds.has(event._id)}
            onAccept={() => onDecide(event._id, "event", "accept")}
            onDismiss={() => onDecide(event._id, "event", "dismiss")}
            meta={
              <span className="tabular-nums">
                {new Date(event.date).toLocaleString()}
              </span>
            }
          />
        ))}

        {actions.map((change) => (
          <SuggestionRow
            key={change._id}
            icon={ACTION_ICONS[change.effect]}
            title={change.summary}
            detail={change.status === "accepted" ? change.result : undefined}
            status={change.status}
            pending={pendingIds.has(change._id)}
            onAccept={() => onDecide(change._id, "action", "accept")}
            onDismiss={() => onDecide(change._id, "action", "dismiss")}
            call={change.status === "pending" ? change.arguments : undefined}
            meta={
              <>
                <span
                  className={cn(
                    "uppercase tracking-[0.12em]",
                    change.effect === "delete" && "text-destructive",
                  )}
                >
                  {change.effect}
                </span>
                <span className="font-mono">
                  {resourceLabel(change.tool)}
                  {change.action ? ` · ${change.action}` : ""}
                </span>
              </>
            }
          />
        ))}
      </div>
    </section>
  );
}

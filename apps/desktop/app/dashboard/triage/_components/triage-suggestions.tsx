"use client";

import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import {
  CalendarClock,
  Check,
  CircleCheck,
  ClipboardList,
  ListTodo,
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

/** One proposed action: a quiet row with accept/dismiss on the right. */
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
  return (
    <div
      role="listitem"
      className={cn(
        "group/suggestion -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface/70",
        status === "dismissed" && "opacity-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center",
          status === "accepted" ? "text-status-good" : "text-muted-foreground",
        )}
      >
        {status === "accepted" ? <CircleCheck className="size-3.5" /> : icon}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className={cn(
            "text-sm leading-snug text-accent-strong",
            status === "dismissed" && "line-through",
          )}
        >
          {title}
        </p>
        {detail ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{detail}</p>
        ) : null}
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        ) : null}
        {call ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">arguments</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
              {JSON.stringify(call, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {status === "pending" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={onAccept}
            >
              {pending ? <Spinner className="size-3.5" /> : <Check />}
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={pending}
              onClick={onDismiss}
            >
              <X />
              Dismiss
            </Button>
          </>
        ) : (
          <>
            {status === "dismissed" ? (
              <Button
                size="sm"
                variant="ghost"
                className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/suggestion:opacity-100"
                disabled={pending}
                onClick={onAccept}
              >
                {pending ? <Spinner className="size-3.5" /> : <Undo2 />}
                Accept
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {status === "accepted" ? "Accepted" : "Dismissed"}
            </span>
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
    <Section title="Suggestions" count={open > 0 ? `${open}/${total}` : total}>
      <div role="list" className="flex flex-col">
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
                <span className="capitalize">{task.priority}</span>
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
                    "capitalize",
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
    </Section>
  );
}

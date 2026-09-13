"use client";

import type { BackgroundAgentRun, IConversationMeta } from "@repo/schemas";
import { Suggestion, Suggestions } from "@repo/ui/ai-elements/suggestion";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Marker, MarkerContent, MarkerIcon } from "@repo/ui/marker";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { History, SquarePen, Trash2, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { AgentComposer } from "./agent-composer";
import { AgentMessageList } from "./agent-messages";
import {
  AgentSessionProvider,
  useAgentSession,
  useOptionalAgentSession,
} from "./agent-session";
import { describeAgentError } from "./use-agent-chat";

export type AgentPanelVariant = "page" | "docked";

const PAGE_SUGGESTIONS = [
  "What's on my calendar this week?",
  "Summarize my recent notes",
  "Check my latest emails",
  "What's on my timetable today?",
];

const DOCKED_SUGGESTIONS = [
  "Summarize this page",
  "What's on my calendar this week?",
  "Check my latest emails",
];

type ConversationGroup = { label: string; conversations: IConversationMeta[] };

function groupByDate(conversations: IConversationMeta[]): ConversationGroup[] {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;
  const buckets: Array<[string, number]> = [
    ["Today", today],
    ["Yesterday", today - day],
    ["Previous 7 days", today - 7 * day],
    ["Previous 30 days", today - 30 * day],
    ["Older", Number.NEGATIVE_INFINITY],
  ];
  const groups = new Map<string, IConversationMeta[]>();
  for (const conversation of conversations) {
    const updated = new Date(conversation.updatedAt).getTime();
    const label = buckets.find(([, floor]) => updated >= floor)?.[0] ?? "Older";
    const bucket = groups.get(label);
    if (bucket) bucket.push(conversation);
    else groups.set(label, [conversation]);
  }
  return buckets.flatMap(([label]) => {
    const entries = groups.get(label);
    return entries ? [{ label, conversations: entries }] : [];
  });
}

function HistoryPopover() {
  const session = useAgentSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { history } = session;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groupByDate(
      needle
        ? history.conversations.filter((conversation) =>
            conversation.title.toLowerCase().includes(needle),
          )
        : history.conversations,
    );
  }, [history.conversations, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void history.refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Conversations"
        >
          <History className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-1.5rem)] flex-col p-0"
      >
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            className="h-8 text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto overscroll-contain py-1">
          {history.loading ? (
            <div className="space-y-2 p-3">
              {[62, 48, 71, 55].map((width) => (
                <Skeleton
                  key={width}
                  className="h-3.5 bg-surface"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              —
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="pb-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground/80 uppercase">
                  {group.label}
                </div>
                {group.conversations.map((conversation) => {
                  const current = conversation._id === session.conversationId;
                  return (
                    <div
                      key={conversation._id}
                      className={cn(
                        "group/row flex items-center pr-1.5 transition-colors hover:bg-accent/60",
                        current && "bg-accent/40",
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs text-foreground/90 outline-none focus-visible:bg-accent"
                        onClick={() => {
                          setOpen(false);
                          void session.openConversation(conversation._id);
                        }}
                      >
                        {conversation.title}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${conversation.title}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity outline-none group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        onClick={() =>
                          void session.deleteConversation(conversation._id)
                        }
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {history.nextCursor && !query ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs text-muted-foreground"
              disabled={history.loadingMore}
              onClick={() => void history.loadMore()}
            >
              {history.loadingMore ? "Loading…" : "More"}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConversationTitle() {
  const session = useAgentSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!session.conversationId) {
    return <span className="truncate text-xs text-muted-foreground">New</span>;
  }
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (value.trim() && value.trim() !== session.title) {
        void session.renameConversation(value);
      }
    };
    return (
      <Input
        value={value}
        autoFocus
        aria-label="Conversation title"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(false);
        }}
        className="h-7 min-w-0 flex-1 text-xs"
      />
    );
  }
  return (
    <button
      type="button"
      className="min-w-0 truncate rounded-sm text-left text-xs text-foreground/90 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => {
        setValue(session.title);
        setEditing(true);
      }}
    >
      {session.title || "Untitled"}
    </button>
  );
}

function PanelHeader({
  variant,
  onClose,
  actions,
}: {
  variant: AgentPanelVariant;
  onClose?: () => void;
  actions?: ReactNode;
}) {
  const session = useAgentSession();
  const { slots } = useAdmin();
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
      {variant === "page" ? slots?.sidebarTrigger : null}
      <HistoryPopover />
      <div className="flex min-w-0 flex-1 items-center">
        <ConversationTitle />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7 text-muted-foreground hover:text-foreground"
        aria-label="New conversation"
        onClick={session.newChat}
      >
        <SquarePen className="size-3.5" />
      </Button>
      {actions}
      {onClose ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Close agent"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function StatusRows() {
  const session = useAgentSession();
  const { chat } = session;
  const error = describeAgentError(chat.error);
  if (!error && !session.backgroundRun) return null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-1 px-4 pb-2">
      {session.backgroundRun ? (
        <Marker role="status" className="text-xs">
          <MarkerIcon>
            <span className="block size-1.5 animate-pulse rounded-full bg-foreground/60" />
          </MarkerIcon>
          <MarkerContent className="shimmer">
            Working in background
          </MarkerContent>
        </Marker>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex min-w-0 items-center gap-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <Button
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={session.retry}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            className="text-muted-foreground"
            onClick={chat.clearError}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EmptySuggestions({ variant }: { variant: AgentPanelVariant }) {
  const session = useAgentSession();
  const list = variant === "page" ? PAGE_SUGGESTIONS : DOCKED_SUGGESTIONS;
  return (
    <Suggestions
      className={
        variant === "page"
          ? "[&>*:first-child]:ml-auto [&>*:last-child]:mr-auto"
          : undefined
      }
    >
      {list.map((suggestion) => (
        <Suggestion
          key={suggestion}
          suggestion={suggestion}
          onClick={(text) => {
            if (session.settings.model && !session.busy)
              void session.send(text);
            else session.setDraft(text);
          }}
        />
      ))}
    </Suggestions>
  );
}

function PanelSurface({
  variant,
  summary,
  onClose,
  headerActions,
}: {
  variant: AgentPanelVariant;
  summary?: ReactNode;
  onClose?: () => void;
  headerActions?: ReactNode;
}) {
  const session = useAgentSession();
  const { chat } = session;
  const empty = chat.messages.length === 0;
  const page = variant === "page";

  const handlers = useMemo(
    () => ({
      onApproval: (id: string, approved: boolean) =>
        void chat.addToolApprovalResponse({ id, approved }),
      onRegenerate: (messageId: string) => void chat.regenerate({ messageId }),
      onContinue: () => void session.send("Continue."),
    }),
    [chat, session.send],
  );

  if (page && empty && !session.loadingConversation) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1.5 px-2">
          <PanelHeaderSlots />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-8">
            <div data-agent-sheet className="space-y-3">
              <AgentComposer autoFocus />
              <StatusRows />
              <EmptySuggestions variant="page" />
            </div>
            {summary ? <div className="min-w-0 pt-6">{summary}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-agent-sheet
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background"
    >
      <PanelHeader
        variant={variant}
        onClose={onClose}
        actions={headerActions}
      />
      {session.loadingConversation ? (
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 py-6">
          {[80, 55, 68].map((width) => (
            <Skeleton
              key={width}
              className="h-3.5 bg-surface"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : empty ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <AgentMessageList
          messages={chat.messages}
          status={chat.status}
          handlers={handlers}
          contentClassName={page ? "max-w-3xl" : undefined}
        />
      )}
      <StatusRows />
      <div
        className={cn(
          "mx-auto w-full shrink-0 space-y-2",
          page ? "max-w-3xl px-4 pb-4" : "px-3 pb-3",
        )}
      >
        {empty && !session.loadingConversation ? (
          <EmptySuggestions variant={variant} />
        ) : null}
        <AgentComposer autoFocus={!page} />
      </div>
    </div>
  );
}

function PanelHeaderSlots() {
  const { slots } = useAdmin();
  return (
    <>
      {slots?.sidebarTrigger}
      <HistoryPopover />
    </>
  );
}

/**
 * The agent surface. `page` fills a route (the desktop home); `docked` sits in
 * the resizable side panel. Both read the session from the nearest
 * `AgentSessionProvider`, so a turn started on one keeps running on the other.
 */
export function AgentPanel({
  variant,
  allowBackground = false,
  summary,
  onClose,
  headerActions,
  onActiveRunChange,
}: {
  variant: AgentPanelVariant;
  allowBackground?: boolean;
  summary?: ReactNode;
  onClose?: () => void;
  headerActions?: ReactNode;
  onActiveRunChange?: (run: BackgroundAgentRun | null) => void;
}) {
  const session = useOptionalAgentSession();
  const surface = (
    <PanelSurface
      variant={variant}
      summary={summary}
      onClose={onClose}
      headerActions={headerActions}
    />
  );
  if (session) return surface;
  return (
    <AgentSessionProvider
      allowBackground={allowBackground}
      onActiveRunChange={onActiveRunChange}
    >
      {surface}
    </AgentSessionProvider>
  );
}

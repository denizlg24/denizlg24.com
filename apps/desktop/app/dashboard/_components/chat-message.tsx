"use client";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@repo/ui/attachment";
import { Bubble, BubbleContent } from "@repo/ui/bubble";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Marker, MarkerContent, MarkerIcon } from "@repo/ui/marker";
import { Message, MessageContent, MessageFooter } from "@repo/ui/message";
import { Spinner } from "@repo/ui/spinner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  FileText,
  RotateCcw,
  X,
} from "lucide-react";
import { useState } from "react";
import { mergeContentSegments } from "@/lib/chat-segments";
import type {
  IChatContentSegment,
  IChatMessage,
  IChatMessageAttachment,
  IChatToolCall,
} from "@/lib/data-types";
import { cn } from "@/lib/utils";

function ErrorCard({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <Bubble variant="destructive" className="max-w-full">
      <BubbleContent className="w-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <X className="w-3 h-3 text-destructive shrink-0" />
            <span className="text-xs text-destructive/80">{error}</span>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      </BubbleContent>
    </Bubble>
  );
}

function extractAttachmentsFromContent(
  content: unknown[],
): IChatMessageAttachment[] {
  const attachments: IChatMessageAttachment[] = [];
  for (const block of content as any[]) {
    if (block.type === "image" && block.source?.url) {
      attachments.push({ type: "image", url: block.source.url, name: "Image" });
    } else if (block.type === "document" && block.source?.url) {
      attachments.push({
        type: "pdf",
        url: block.source.url,
        name: block.source.url.split("/").pop() ?? "Document",
      });
    }
  }
  return attachments;
}

function ChatMessageAttachment({
  attachment,
}: {
  attachment: IChatMessageAttachment;
}) {
  const isImage = attachment.type === "image";

  return (
    <Attachment size="sm" className="max-w-64">
      <AttachmentMedia variant={isImage ? "image" : "icon"}>
        {isImage ? (
          <img src={attachment.url} alt={attachment.name} />
        ) : (
          <FileText />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>
          {isImage ? "Image" : "Document"}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger asChild>
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${attachment.name}`}
        >
          <span className="sr-only">Open {attachment.name}</span>
        </a>
      </AttachmentTrigger>
    </Attachment>
  );
}

const TOOL_LABELS: Record<string, string> = {
  get_calendar_events: "Fetched calendar events",
  create_calendar_event: "Creating calendar event",
  update_calendar_event: "Updating calendar event",
  delete_calendar_event: "Deleting calendar event",
  list_kanban_boards: "Listed kanban boards",
  get_kanban_board: "Fetched kanban board",
  create_kanban_card: "Creating kanban card",
  update_kanban_card: "Updating kanban card",
  list_groups: "Listed groups",
  create_group: "Creating group",
  update_group: "Updating group",
  delete_group: "Deleting group",
  list_notes: "Listed notes",
  search_notes: "Searched notes",
  get_note: "Read note",
  create_note: "Creating note",
  update_note: "Updating note",
  delete_note: "Deleting note",
  semantic_classify_note: "Classifying note",
  get_timetable: "Fetched timetable",
  create_timetable_entry: "Creating timetable entry",
  update_timetable_entry: "Updating timetable entry",
  delete_timetable_entry: "Deleting timetable entry",
  list_contacts: "Listed contacts",
  get_contact: "Read contact",
  update_contact_status: "Updating contact status",
  list_blogs: "Listed blog posts",
  get_blog: "Read blog post",
  search_blogs: "Searched blogs",
  list_projects: "Listed projects",
  get_project: "Read project",
  list_timeline_items: "Fetched timeline",
  list_emails: "Listed emails",
  get_email: "Read email",
  web_search: "Searched the web",
  get_resources: "Fetched resources",
  get_resource_by_id: "Fetched resource",
  get_resource_health: "Checked resource health",
  get_healthy_resources: "Fetched healthy resources",
  create_resource: "Creating resource",
  delete_resource: "Deleting resource",
  update_resource: "Updating resource",
  reboot_resource: "Rebooting resource",
  restart_resource_service: "Restarting service",
  get_now_page: "Fetched now page",
  update_now_page: "Updating now page",
  mark_email_as_read: "Marking email as read",
  delete_email: "Deleting email",
  list_account_emails: "Listed account emails",
  reply_to_contact: "Replying to contact",
  list_kanban_columns: "Listed kanban columns",
};

function ToolCallStatusIcon({ status }: { status: IChatToolCall["status"] }) {
  switch (status) {
    case "calling":
    case "pending_approval":
      return (
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" />
      );
    case "error":
      return <X className="w-3 h-3 text-destructive" />;
    default:
      return <Check className="w-3 h-3 text-foreground" />;
  }
}

function TypingIndicator() {
  return (
    <Message>
      <MessageContent>
        <Marker role="status" className="py-1">
          <MarkerIcon>
            <Spinner className="size-3.5" />
          </MarkerIcon>
          <MarkerContent className="shimmer">Thinking...</MarkerContent>
        </Marker>
      </MessageContent>
    </Message>
  );
}

function SingleToolCall({
  call,
  onApproveAll,
  onDenyAll,
  hasPendingGroup,
}: {
  call: IChatToolCall;
  onApproveAll?: () => void;
  onDenyAll?: () => void;
  hasPendingGroup?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[call.toolName] ?? call.toolName;
  const isPending = call.status === "pending_approval";
  const isActive =
    call.status === "calling" || call.status === "pending_approval";

  return (
    <div className="w-full">
      <Marker className="gap-1.5">
        <MarkerIcon className="flex items-center justify-center">
          <ToolCallStatusIcon status={call.status} />
        </MarkerIcon>
        <button
          onClick={() => call.result && setExpanded(!expanded)}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          <span className={cn("truncate", isActive && "shimmer")}>{label}</span>
          {call.result &&
            (expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            ))}
        </button>
        {isPending && !hasPendingGroup && (
          <span className="flex items-center gap-0.5 ml-1">
            <button
              onClick={onApproveAll}
              className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              onClick={onDenyAll}
              className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </Marker>
      {expanded && call.result && (
        <pre className="mt-1.5 ml-5 text-[11px] bg-surface rounded p-2 overflow-x-auto max-h-40 text-muted-foreground/70">
          {tryFormatJson(call.result)}
        </pre>
      )}
    </div>
  );
}

function ToolGroupBlock({
  calls,
  onApproveAll,
  onDenyAll,
}: {
  calls: IChatToolCall[];
  onApproveAll?: () => void;
  onDenyAll?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPending = calls.some((c) => c.status === "pending_approval");

  if (calls.length === 1) {
    return (
      <div className="my-1.5 w-full">
        <SingleToolCall
          call={calls[0]}
          onApproveAll={onApproveAll}
          onDenyAll={onDenyAll}
        />
      </div>
    );
  }

  const anyError = calls.some((c) => c.status === "error");
  const anyActive = calls.some(
    (c) => c.status === "calling" || c.status === "pending_approval",
  );

  const uniqueNames = [...new Set(calls.map((c) => c.toolName))];
  const summaryParts = uniqueNames.map((name) => {
    const count = calls.filter((c) => c.toolName === name).length;
    const label = TOOL_LABELS[name] ?? name;
    return count > 1 ? `${label} (x${count})` : label;
  });

  return (
    <div className="my-1.5">
      <Marker className="gap-1.5">
        <MarkerIcon className="flex items-center justify-center">
          {anyActive ? (
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" />
          ) : anyError ? (
            <X className="w-3 h-3 text-destructive" />
          ) : (
            <Check className="w-3 h-3 text-foreground" />
          )}
        </MarkerIcon>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          <span className={cn("truncate", anyActive && "shimmer")}>
            {summaryParts.join(", ")}
          </span>
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        {hasPending && (
          <span className="flex items-center gap-0.5 ml-1">
            <button
              onClick={onApproveAll}
              className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              onClick={onDenyAll}
              className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </Marker>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 pl-5">
          {calls.map((call) => (
            <SingleToolCall
              key={call.toolId}
              call={call}
              onApproveAll={onApproveAll}
              onDenyAll={onDenyAll}
              hasPendingGroup
            />
          ))}
        </div>
      )}
    </div>
  );
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function getTextContent(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("");
}

function SegmentRenderer({
  segments,
  isStreaming,
  onApproveAll,
  onDenyAll,
}: {
  segments: IChatContentSegment[];
  isStreaming?: boolean;
  onApproveAll?: () => void;
  onDenyAll?: () => void;
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "tool_group") {
          return (
            <ToolGroupBlock
              key={`tg-${i}`}
              calls={seg.calls}
              onApproveAll={onApproveAll}
              onDenyAll={onDenyAll}
            />
          );
        }
        return (
          <div key={`txt-${i}`} className="max-w-none">
            <MarkdownRenderer content={seg.text} />
            {isStreaming && i === segments.length - 1 && (
              <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse ml-0.5 -mb-0.5" />
            )}
          </div>
        );
      })}
    </>
  );
}

export function ChatMessage({
  message,
  isStreaming,
  streamSegments,
  onApproveAll,
  onDenyAll,
  onRetry,
}: {
  message: IChatMessage;
  isStreaming?: boolean;
  streamSegments?: IChatContentSegment[];
  onApproveAll?: () => void;
  onDenyAll?: () => void;
  onRetry?: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);

  if (message.role === "user") {
    const displayContent =
      typeof message.content === "string"
        ? message.content
        : getTextContent(message.content);

    const displayAttachments: IChatMessageAttachment[] =
      message.attachments ??
      (Array.isArray(message.content)
        ? extractAttachmentsFromContent(message.content)
        : []);

    return (
      <Message align="end">
        <MessageContent>
          {displayAttachments.length > 0 && (
            <AttachmentGroup className="max-w-[80%] justify-end">
              {displayAttachments.map((att, i) => (
                <ChatMessageAttachment
                  key={`${att.url}-${i}`}
                  attachment={att}
                />
              ))}
            </AttachmentGroup>
          )}
          {displayContent && (
            <Bubble variant="muted" align="end">
              <BubbleContent className="whitespace-pre-wrap text-muted-foreground">
                {displayContent}
              </BubbleContent>
            </Bubble>
          )}
        </MessageContent>
      </Message>
    );
  }

  const segments: IChatContentSegment[] | null =
    isStreaming && streamSegments
      ? mergeContentSegments(message.segments ?? [], streamSegments)
      : (message.segments ?? null);

  const textContent = segments
    ? segments
        .filter((s): s is { type: "text"; text: string } => s.type === "text")
        .map((s) => s.text)
        .join("")
    : getTextContent(message.content);

  const rawContent = textContent;

  const hasContent = segments
    ? segments.some(
        (s) =>
          (s.type === "text" && s.text.length > 0) || s.type === "tool_group",
      )
    : textContent.length > 0;

  if (isStreaming && !hasContent) return <TypingIndicator />;

  return (
    <Message className="group">
      <MessageContent>
        {hasContent && (
          <Bubble
            variant={showRaw ? "outline" : "ghost"}
            className="max-w-full"
          >
            <BubbleContent className="w-full max-w-none">
              {showRaw ? (
                <pre className="scroll-fade-x max-h-[60vh] overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface p-4 font-mono text-sm text-foreground/80">
                  {rawContent}
                </pre>
              ) : segments ? (
                <SegmentRenderer
                  segments={segments}
                  isStreaming={isStreaming}
                  onApproveAll={onApproveAll}
                  onDenyAll={onDenyAll}
                />
              ) : (
                <div className="max-w-none">
                  <MarkdownRenderer content={textContent} />
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse ml-0.5 -mb-0.5" />
                  )}
                </div>
              )}
            </BubbleContent>
          </Bubble>
        )}

        {message.error && <ErrorCard error={message.error} onRetry={onRetry} />}

        {!isStreaming && textContent && (
          <MessageFooter className="gap-2">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
            >
              {showRaw ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <Code className="w-3.5 h-3.5" />
              )}
            </button>
            {message.tokenUsage && (
              <p className="text-[11px] text-muted-foreground/50">
                {(message.tokenUsage.inputTokens ?? 0) +
                  (message.tokenUsage.outputTokens ?? 0)}{" "}
                tokens &middot; ${(message.tokenUsage.costUsd ?? 0).toFixed(4)}
              </p>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

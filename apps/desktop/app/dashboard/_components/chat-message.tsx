"use client";

import type { AgentRetrievalTrace } from "@repo/schemas";
import { getToolLabel } from "@repo/schemas";
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
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Marker, MarkerContent, MarkerIcon } from "@repo/ui/marker";
import { Message, MessageContent, MessageFooter } from "@repo/ui/message";
import { Spinner } from "@repo/ui/spinner";
import { tryFormatJson } from "@repo/utils";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import { mergeContentSegments } from "@/lib/chat-segments";
import type {
  IChatContentSegment,
  IChatMessage,
  IChatMessageAttachment,
  IChatToolCall,
} from "@/lib/data-types";
import { cn } from "@/lib/utils";

interface SelectedMemoryTraceCandidate {
  memoryId: string;
  revisionId: string;
  statement: string;
  memoryType?: string;
  explicitness?: string;
  confidence?: number;
  evidenceIds: string[];
}

interface SelectedDerivedTraceItem {
  kind: "profile" | "goal" | "procedure";
  id: string;
  statement: string;
}

function selectedDerivedTraceItems(
  trace: AgentRetrievalTrace,
): SelectedDerivedTraceItem[] {
  const derived = trace.filters.derivedContext;
  if (typeof derived !== "object" || derived === null) return [];
  const items = (derived as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const value = item as Record<string, unknown>;
    if (
      !["profile", "goal", "procedure"].includes(String(value.kind)) ||
      typeof value.id !== "string" ||
      typeof value.statement !== "string"
    ) {
      return [];
    }
    return [value as unknown as SelectedDerivedTraceItem];
  });
}

function selectedTraceCandidates(
  trace: AgentRetrievalTrace,
): SelectedMemoryTraceCandidate[] {
  const selectedIds = new Set(trace.selectedRevisionIds);
  return trace.candidates.flatMap((candidate) => {
    const memoryId = candidate.memoryId;
    const revisionId = candidate.revisionId;
    const statement = candidate.statement;
    if (
      typeof memoryId !== "string" ||
      typeof revisionId !== "string" ||
      typeof statement !== "string" ||
      !selectedIds.has(revisionId)
    ) {
      return [];
    }
    return [
      {
        memoryId,
        revisionId,
        statement,
        memoryType:
          typeof candidate.memoryType === "string"
            ? candidate.memoryType
            : undefined,
        explicitness:
          typeof candidate.explicitness === "string"
            ? candidate.explicitness
            : undefined,
        confidence:
          typeof candidate.confidence === "number"
            ? candidate.confidence
            : undefined,
        evidenceIds: Array.isArray(candidate.evidenceIds)
          ? candidate.evidenceIds.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      },
    ];
  });
}

function MemoryDisclosure({
  traceId,
  api,
}: {
  traceId: string;
  api: denizApi | null;
}) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<AgentRetrievalTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMemoryId, setPendingMemoryId] = useState<string | null>(null);
  const [correctionMemoryId, setCorrectionMemoryId] = useState<string | null>(
    null,
  );
  const [correction, setCorrection] = useState("");
  const [recorded, setRecorded] = useState<Record<string, string>>({});

  const loadTrace = async () => {
    if (!api || trace || loading) return;
    setLoading(true);
    setError(null);
    const result = await api.GET<{ trace: AgentRetrievalTrace }>({
      endpoint: `agent-memory/retrieval-traces/${traceId}`,
    });
    setLoading(false);
    if ("code" in result) {
      setError(result.message);
      return;
    }
    setTrace(result.trace);
  };

  const submitFeedback = async (
    kind: "useful" | "not-relevant" | "forget" | "correction",
    memoryId: string,
  ) => {
    if (!api || pendingMemoryId) return;
    if (
      kind === "forget" &&
      !window.confirm("Forget this memory and remove it from retrieval?")
    ) {
      return;
    }
    const replacement = correction.trim();
    if (kind === "correction" && !replacement) return;
    setPendingMemoryId(memoryId);
    const result = await api.POST<{
      feedbackId: string;
      kind: string;
      memoryIds: string[];
    }>({
      endpoint: `agent-memory/retrieval-traces/${traceId}/feedback`,
      body: {
        feedbackId: crypto.randomUUID(),
        kind,
        memoryId,
        ...(kind === "correction" ? { correction: replacement } : {}),
      },
    });
    setPendingMemoryId(null);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setRecorded((current) => ({ ...current, [memoryId]: kind }));
    setCorrectionMemoryId(null);
    setCorrection("");
    toast.success(
      kind === "forget"
        ? "Memory forgotten"
        : kind === "correction"
          ? "Correction saved"
          : "Feedback saved",
    );
  };

  const selected = trace ? selectedTraceCandidates(trace) : [];
  const selectedDerived = trace ? selectedDerivedTraceItems(trace) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadTrace();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        >
          <Brain className="size-3" />
          <span>Memory used</span>
        </button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[min(80dvh,48rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">Memory used</DialogTitle>
          <DialogDescription className="truncate font-mono text-[11px]">
            {traceId}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          {loading ? (
            <div className="flex min-h-28 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={loadTrace}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="divide-y border-y">
              {selectedDerived.map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  className="min-w-0 space-y-2 py-4"
                >
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {item.kind}
                  </div>
                  <p className="break-words text-sm leading-6">
                    {item.statement}
                  </p>
                  <p
                    className="truncate font-mono text-[10px] text-muted-foreground/60"
                    title={item.id}
                  >
                    {item.id}
                  </p>
                </div>
              ))}
              {selected.map((candidate) => {
                const isPending = pendingMemoryId === candidate.memoryId;
                const feedback = recorded[candidate.memoryId];
                return (
                  <div
                    key={candidate.revisionId}
                    className="min-w-0 space-y-3 py-4"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
                      {candidate.memoryType && (
                        <span>{candidate.memoryType}</span>
                      )}
                      {candidate.explicitness && (
                        <span>{candidate.explicitness}</span>
                      )}
                      {candidate.confidence !== undefined && (
                        <span>
                          {Math.round(candidate.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    <p className="break-words text-sm leading-6">
                      {candidate.statement}
                    </p>
                    <p className="break-all font-mono text-[10px] leading-4 text-muted-foreground/60">
                      Evidence: {candidate.evidenceIds.join(", ")}
                    </p>
                    {correctionMemoryId === candidate.memoryId ? (
                      <div className="flex min-w-0 gap-2">
                        <Input
                          value={correction}
                          onChange={(event) =>
                            setCorrection(event.target.value)
                          }
                          placeholder="Enter the corrected memory"
                          className="min-w-0"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            void submitFeedback(
                              "correction",
                              candidate.memoryId,
                            )
                          }
                          disabled={!correction.trim() || isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCorrectionMemoryId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void submitFeedback("useful", candidate.memoryId)
                          }
                          disabled={isPending}
                        >
                          <ThumbsUp /> Useful
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void submitFeedback(
                              "not-relevant",
                              candidate.memoryId,
                            )
                          }
                          disabled={isPending}
                        >
                          <ThumbsDown /> Not relevant
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCorrectionMemoryId(candidate.memoryId);
                            setCorrection(candidate.statement);
                          }}
                          disabled={isPending}
                        >
                          <Pencil /> Correct
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void submitFeedback("forget", candidate.memoryId)
                          }
                          disabled={isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 /> Forget
                        </Button>
                        {isPending && (
                          <Loader2 className="size-3 animate-spin" />
                        )}
                        {feedback && (
                          <span className="text-xs text-muted-foreground">
                            {feedback === "not-relevant"
                              ? "Marked not relevant"
                              : feedback === "forget"
                                ? "Forgotten"
                                : feedback === "correction"
                                  ? "Corrected"
                                  : "Marked useful"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const label = getToolLabel(call.toolName);
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
    const label = getToolLabel(name);
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
  api,
}: {
  message: IChatMessage;
  isStreaming?: boolean;
  streamSegments?: IChatContentSegment[];
  onApproveAll?: () => void;
  onDenyAll?: () => void;
  onRetry?: () => void;
  api?: denizApi | null;
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
            {message.memoryInjected && message.retrievalTraceId && (
              <MemoryDisclosure
                traceId={message.retrievalTraceId}
                api={api ?? null}
              />
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

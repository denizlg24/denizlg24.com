"use client";

import type { AgentMessageMetadata, AgentUIMessage } from "@repo/schemas";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@repo/ui/ai-elements/confirmation";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@repo/ui/ai-elements/context";
import { MessageAction, MessageResponse } from "@repo/ui/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@repo/ui/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@repo/ui/ai-elements/sources";
import { ThinkingDots } from "@repo/ui/ai-elements/thinking-dots";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@repo/ui/ai-elements/tool";
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
import { Marker, MarkerContent, MarkerIcon } from "@repo/ui/marker";
import { Message, MessageContent, MessageFooter } from "@repo/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/message-scroller";
import { cn } from "@repo/ui/utils";
import type { ChatStatus, FileUIPart } from "ai";
import {
  Check,
  Copy,
  FileText,
  Globe,
  Info,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { AgentMemoryDisclosure } from "./agent-memory-disclosure";
import {
  type AgentBlock,
  type AgentToolPart,
  awaitsClient,
  buildAgentBlocks,
  connectorContent,
  formatCost,
  formatTokenCount,
  messageText,
  shortModelName,
  toLanguageModelUsage,
  toolPartName,
  toolProvenance,
  toolTitle,
} from "./agent-parts";

export interface AgentMessageHandlers {
  onApproval: (approvalId: string, approved: boolean) => void;
  onRegenerate?: (messageId: string) => void;
  /** Replaces the default row for a tool part; return undefined to keep it. */
  renderTool?: (part: AgentToolPart) => ReactNode | undefined;
}

function FileAttachment({ part }: { part: FileUIPart }) {
  const isImage = part.mediaType.startsWith("image");
  const name = part.filename ?? (isImage ? "Image" : "Document");
  return (
    <Attachment size="xs" className="max-w-56">
      <AttachmentMedia variant={isImage ? "image" : "icon"}>
        {isImage ? <img src={part.url} alt="" /> : <FileText />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>
          {isImage ? "Image" : "PDF"}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger asChild>
        <a href={part.url} target="_blank" rel="noreferrer">
          <span className="sr-only">Open {name}</span>
        </a>
      </AttachmentTrigger>
    </Attachment>
  );
}

function ToolResult({ part }: { part: AgentToolPart }) {
  if (part.state === "output-error") {
    return <ToolOutput output={undefined} errorText={part.errorText} />;
  }
  if (part.state !== "output-available") return null;
  const blocks = connectorContent(part.output);
  if (!blocks) {
    return <ToolOutput output={part.output} errorText={undefined} />;
  }
  const text = blocks
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n\n");
  const images = blocks.flatMap((block) =>
    block.kind === "image" ? [block.src] : [],
  );
  return (
    <>
      {text ? <ToolOutput output={text} errorText={undefined} /> : null}
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((src) => (
            <img
              key={src.slice(-32)}
              src={src}
              alt=""
              className="max-h-48 rounded-md bg-surface object-contain"
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Tool rows stay shut. The header already says which tool, on what, and how
 * it went, which is what a reader following a turn needs; opening every call
 * buried the answer under argument JSON.
 *
 * The one exception is a call waiting on approval, where the arguments are
 * the thing being approved — an approve button over a collapsed row asks the
 * reader to consent to something they cannot see.
 */
function opensOnItsOwn(state: AgentToolPart["state"]): boolean {
  return state === "approval-requested";
}

function AgentToolRow({
  part,
  onApproval,
}: {
  part: AgentToolPart;
  onApproval: AgentMessageHandlers["onApproval"];
}) {
  // Opens itself and stays open afterwards; a row that mounts already
  // finished stays closed.
  const [open, setOpen] = useState(opensOnItsOwn(part.state));
  useEffect(() => {
    if (opensOnItsOwn(part.state)) setOpen(true);
  }, [part.state]);

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader
        part={part}
        title={toolTitle(part)}
        provenance={toolProvenance(part)}
      />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolResult part={part} />
      </ToolContent>
      {part.approval && !part.approval.isAutomatic ? (
        <Confirmation approval={part.approval} state={part.state}>
          <ConfirmationTitle>
            <ConfirmationRequest />
            <ConfirmationAccepted />
            <ConfirmationRejected />
          </ConfirmationTitle>
          <ConfirmationActions>
            <ConfirmationAction
              variant="ghost"
              onClick={() => {
                if (part.approval) onApproval(part.approval.id, false);
              }}
            >
              Deny
            </ConfirmationAction>
            <ConfirmationAction
              onClick={() => {
                if (part.approval) onApproval(part.approval.id, true);
              }}
            >
              Approve
            </ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>
      ) : null}
    </Tool>
  );
}

function webTarget(part: AgentToolPart): string | undefined {
  const input = part.input;
  if (typeof input !== "object" || input === null) return undefined;
  if ("query" in input && typeof input.query === "string") return input.query;
  if ("url" in input && typeof input.url === "string") {
    try {
      return new URL(input.url).hostname.replace(/^www\./, "");
    } catch {
      return input.url;
    }
  }
  return undefined;
}

function AgentWebRow({ part }: { part: AgentToolPart }) {
  const fetching = toolPartName(part) === "web_fetch";
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const title = fetching
    ? running
      ? "Reading a page"
      : "Read a page"
    : running
      ? "Searching the web"
      : "Searched the web";
  return (
    <Tool>
      <ToolHeader
        part={part}
        title={title}
        provenance={webTarget(part)}
        icon={<Globe />}
      />
      <ToolContent>
        <ToolInput input={part.input} />
        {part.state === "output-error" ? (
          <ToolOutput output={undefined} errorText={part.errorText} />
        ) : null}
      </ToolContent>
    </Tool>
  );
}

function AgentBlockView({
  block,
  isStreaming,
  handlers,
}: {
  block: AgentBlock;
  isStreaming: boolean;
  handlers: AgentMessageHandlers;
}) {
  switch (block.kind) {
    case "text":
      return (
        <MessageResponse isAnimating={isStreaming && block.streaming}>
          {block.text}
        </MessageResponse>
      );
    case "reasoning":
      // Open on arrival and left to the reader afterwards. `Reasoning` opens
      // itself when it sees streaming start, which a block that mounts
      // already finished never does — a polled task transcript renders every
      // one of them closed without this.
      return (
        <Reasoning defaultOpen isStreaming={isStreaming && block.streaming}>
          <ReasoningTrigger />
          <ReasoningContent>{block.text}</ReasoningContent>
        </Reasoning>
      );
    case "tool":
      return (
        handlers.renderTool?.(block.part) ?? (
          <AgentToolRow part={block.part} onApproval={handlers.onApproval} />
        )
      );
    case "web":
      return <AgentWebRow part={block.part} />;
    case "sources":
      return (
        <Sources className="pl-5">
          <SourcesTrigger count={block.sources.length} />
          <SourcesContent>
            {block.sources.map((source) => (
              <Source
                key={source.sourceId}
                href={source.url}
                title={source.title}
              />
            ))}
          </SourcesContent>
        </Sources>
      );
    case "notice":
      return (
        <Marker className="text-xs">
          <MarkerIcon>
            {block.level === "warning" ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <Info className="size-3.5" />
            )}
          </MarkerIcon>
          <MarkerContent>{block.text}</MarkerContent>
        </Marker>
      );
    case "file":
      return <FileAttachment part={block.part} />;
    case "divider":
      return <hr className="border-border/60" />;
  }
}

function UsageMeter({ metadata }: { metadata: AgentMessageMetadata }) {
  const usage = metadata.usage;
  if (!usage) return null;
  const label = [
    `${formatTokenCount(usage.inputTokens + usage.outputTokens)} tok`,
    formatCost(usage.costUsd),
    ...(metadata.model ? [shortModelName(metadata.model)] : []),
  ].join(" · ");

  if (!usage.contextWindow) {
    return (
      <span className="truncate text-[11px] text-muted-foreground/80 tabular-nums">
        {label}
      </span>
    );
  }
  return (
    <Context
      usedTokens={usage.inputTokens}
      maxTokens={usage.contextWindow}
      usage={toLanguageModelUsage(usage)}
      cost={{ total: usage.costUsd }}
      modelId={metadata.model}
    >
      <ContextTrigger
        aria-label={label}
        className="h-6 min-w-0 rounded-sm px-1 text-[11px] text-muted-foreground/80"
      >
        <span className="truncate">{label}</span>
      </ContextTrigger>
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}

function CopyAction({ text }: { text: string }) {
  const { platform } = useAdmin();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <MessageAction
      tooltip={copied ? "Copied" : "Copy"}
      onClick={() => {
        void platform.copyText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check /> : <Copy />}
    </MessageAction>
  );
}

function UserMessage({ message }: { message: AgentUIMessage }) {
  const files = message.parts.filter(
    (part): part is FileUIPart => part.type === "file",
  );
  const text = messageText(message);
  return (
    <Message align="end">
      <MessageContent>
        {files.length > 0 ? (
          <AttachmentGroup className="max-w-[85%] justify-end">
            {files.map((file) => (
              <FileAttachment key={file.url} part={file} />
            ))}
          </AttachmentGroup>
        ) : null}
        {text ? (
          <Bubble variant="secondary" align="end" className="max-w-[85%]">
            <BubbleContent className="whitespace-pre-wrap">
              {text}
            </BubbleContent>
          </Bubble>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({
  message,
  isLast,
  isStreaming,
  handlers,
}: {
  message: AgentUIMessage;
  isLast: boolean;
  isStreaming: boolean;
  handlers: AgentMessageHandlers;
}) {
  const blocks = useMemo(() => buildAgentBlocks(message), [message]);
  const metadata = message.metadata;
  const text = messageText(message);
  const showFooter =
    !isStreaming &&
    !(isLast && awaitsClient([message])) &&
    (text || metadata?.usage);

  if (blocks.length === 0 && !isStreaming) return null;

  return (
    <Message className="group/turn">
      <MessageContent className="gap-3">
        {blocks.length === 0 ? (
          <Marker role="status" className="text-xs">
            <MarkerContent>
              <ThinkingDots />
            </MarkerContent>
          </Marker>
        ) : (
          blocks.map((block) => (
            <AgentBlockView
              key={block.key}
              block={block}
              isStreaming={isStreaming}
              handlers={handlers}
            />
          ))
        )}
        {showFooter ? (
          <MessageFooter
            className={cn(
              "gap-1 px-0 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/turn:opacity-100 [@media(hover:hover)]:focus-within:opacity-100",
              isLast && "[@media(hover:hover)]:opacity-100",
            )}
          >
            {text ? <CopyAction text={text} /> : null}
            {isLast && handlers.onRegenerate ? (
              <MessageAction
                tooltip="Regenerate"
                onClick={() => handlers.onRegenerate?.(message.id)}
              >
                <RotateCcw />
              </MessageAction>
            ) : null}
            {metadata ? <UsageMeter metadata={metadata} /> : null}
            {metadata?.retrievalTraceId && metadata.memoryInjected ? (
              <AgentMemoryDisclosure traceId={metadata.retrievalTraceId} />
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function AgentMessageList({
  messages,
  status,
  handlers,
  className,
  contentClassName,
}: {
  messages: AgentUIMessage[];
  status: ChatStatus;
  handlers: AgentMessageHandlers;
  className?: string;
  contentClassName?: string;
}) {
  const active = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const pending = active && last?.role !== "assistant";

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className={cn("min-h-0 flex-1", className)}>
        <MessageScrollerViewport className="px-4 py-5">
          <MessageScrollerContent
            className={cn("mx-auto w-full gap-6", contentClassName)}
          >
            {messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              return (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={isLast}
                >
                  {message.role === "user" ? (
                    <UserMessage message={message} />
                  ) : (
                    <AssistantMessage
                      message={message}
                      isLast={isLast}
                      isStreaming={isLast && active}
                      handlers={handlers}
                    />
                  )}
                </MessageScrollerItem>
              );
            })}
            {pending ? (
              <MessageScrollerItem messageId="agent-pending" scrollAnchor>
                <Marker role="status" className="text-xs">
                  <MarkerContent>
                    <ThinkingDots />
                  </MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

"use client";

import { useChat } from "@ai-sdk/react";
import {
  APICallError,
  DefaultChatTransport,
  generateId,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  Check,
  Copy,
  History,
  Maximize2,
  Minimize2,
  PanelLeft,
  Paperclip,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  type ClipboardEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { mutate } from "swr";
import type { StickToBottomContext } from "use-stick-to-bottom";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextIcon,
  ContextRow,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { isToolRunning, Tool, ToolStatus } from "@/components/ai-elements/tool";
import { api } from "@/components/shared";
import { useMediaQuery, useStoredFlag } from "@/components/shell/hooks";
import { Button } from "@/components/ui/button";
import type { StockwatcherMessage } from "@/lib/ai/tools";
import type { AskUserOutput, DashboardState } from "@/lib/assistant-types";
import { documentExtensions } from "@/lib/documents/types";
import {
  creditsKey,
  formatCredits,
  isOutOfCredits,
  outOfCreditsMessage,
  useCredits,
} from "./credits";
import { errorMessage } from "./format";
import { Markdown } from "./markdown";
import { memoriesKey } from "./memory-panel";
import {
  InlineName,
  patchThread,
  ThreadLibrary,
  threadsKey,
  useThreads,
} from "./thread-library";
import {
  type AlertProposal,
  isToolPart,
  SourceList,
  ToolActions,
  ToolPartView,
} from "./tool-parts";
import { UploadList } from "./upload-list";
import { useDocumentUpload } from "./use-document-upload";

const alertChannelsKey = "/api/alerts/channels";

export type AssistantContext = {
  dashboard?: DashboardState;
  ticker?: string;
  view?: string;
};

export type AssistantHandle = {
  send: (text: string) => void;
  focus: () => void;
  /** Absent on the legacy assistant, which has no saved threads. */
  openThread?: (id: string) => void;
};

export type AssistantMode = "docked" | "full";

export type AssistantPanelProps = {
  ref?: Ref<AssistantHandle>;
  mode?: AssistantMode;
  /** Omitted where only one mode exists (phones), which hides the toggle. */
  onModeChange?: (mode: AssistantMode) => void;
  context: AssistantContext;
  onOpenView: (state: DashboardState) => void;
  onProposeAlert: (proposal: AlertProposal) => void;
  onWorkspaceChanged: () => void;
  onOpenSymbol: (symbol: string) => void;
  onClose?: () => void;
  onUnavailable?: () => void;
  available?: boolean;
  hasBook?: boolean;
  className?: string;
};

export type { AlertProposal };

type Session = { id: string; messages: StockwatcherMessage[] };
type StoredThread = {
  id: string;
  title: string;
  messages: StockwatcherMessage[];
};

const transport = new DefaultChatTransport<StockwatcherMessage>({
  api: "/api/chat",
});

const bookStarters = [
  "What moved my book today and why?",
  "Which of my holdings report earnings or file with the SEC soon?",
  "Where is my book most concentrated, per currency?",
  "What % of S&P 500 stocks are above their 50-day average? Chart it",
  "Compare NVDA, AMD and AVGO since January",
];

const marketStarters = [
  "What % of S&P 500 stocks are above their 50-day average? Chart it",
  "Which S&P 500 sectors are leading this month, by equal-weight return?",
  "Compare NVDA, AMD and AVGO since January",
  "Summarise Berkshire's latest 13F changes",
  "Pin a 6M chart of ^STOXX50E to my desk",
];

const drawerQuery = "(max-width: 760px)";

const viewLabels: Partial<Record<string, string>> = {
  markets: "Markets",
  portfolio: "Portfolio",
  research: "Research",
  watchlists: "Watchlists",
  alerts: "Alerts",
};

const newSession = (): Session => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : generateId(),
  messages: [],
});

const textOf = (message: StockwatcherMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

function toolCallIds(messages: StockwatcherMessage[]) {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isToolPart(part) ? [part.toolCallId] : [],
    ),
  );
}

function requestBody(context: AssistantContext) {
  const clean: AssistantContext = {};
  if (context.dashboard) clean.dashboard = context.dashboard;
  if (context.ticker) clean.ticker = context.ticker;
  if (context.view) clean.view = context.view.slice(0, 40);
  return {
    context: {
      ...clean,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

function contextLabel(context: AssistantContext) {
  const view = context.dashboard?.view ?? context.view;
  const ticker = context.ticker ?? context.dashboard?.ticker;
  const name = view ? (viewLabels[view] ?? view) : undefined;
  return [name, ticker].filter(Boolean).join(" · ");
}

export function AssistantPanel({
  ref,
  mode = "docked",
  onModeChange,
  context,
  onOpenView,
  onProposeAlert,
  onWorkspaceChanged,
  onOpenSymbol,
  onClose,
  onUnavailable,
  available = true,
  hasBook = true,
  className,
}: AssistantPanelProps) {
  const [session, setSession] = useState<Session>(newSession);
  const full = mode === "full";
  const [library, setLibrary] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railHidden, setRailHidden] = useStoredFlag(
    "stockwatcher.assistant.sidebar-hidden",
    false,
  );
  const narrow = useMediaQuery(drawerQuery);
  const sidebarShown = !narrow && !railHidden;
  const sidebarId = useId();
  const modeButton = useRef<HTMLButtonElement>(null);
  const sidebarButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [headError, setHeadError] = useState("");
  const threads = useThreads();
  const [rejected, setRejected] = useState(false);
  const unavailable = !available || rejected;
  const [draft, setDraft] = useState("");
  const handled = useRef(new Set<string>());
  const conversation = useRef<StickToBottomContext>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const attachments = useDocumentUpload((document) => {
    setDraft((current) => {
      const reference = `(document: "${document.name}", id: ${document.id}) `;
      return current.trim() ? `${current.trimEnd()} ${reference}` : reference;
    });
    requestAnimationFrame(() => {
      input.current?.focus();
      resize();
    });
  });

  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
    addToolOutput,
  } = useChat<StockwatcherMessage>({
    id: session.id,
    messages: session.messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (reason) => {
      if (APICallError.isInstance(reason) && reason.statusCode === 503) {
        setRejected(true);
        onUnavailable?.();
      }
    },
    onFinish: () => {
      void mutate(threadsKey);
      void mutate(creditsKey);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const creditsLeft = useCredits();
  const threadCredits = messages.reduce(
    (sum, message) => sum + (message.metadata?.credits ?? 0),
    0,
  );
  const lastCredits = messages.findLast(
    (message) => message.metadata?.credits !== undefined,
  )?.metadata?.credits;

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolPart(part) || part.state !== "output-available") continue;
        if (handled.current.has(part.toolCallId)) continue;
        switch (part.type) {
          case "tool-openView":
            handled.current.add(part.toolCallId);
            onOpenView(part.output);
            break;
          case "tool-proposeAlert":
            handled.current.add(part.toolCallId);
            onProposeAlert({
              symbol: part.output.symbol,
              direction: part.output.direction,
              target: part.output.target,
              metric: part.output.metric,
              repeat: part.output.repeat,
              note: part.output.note,
              expires: part.output.expires,
            });
            break;
          case "tool-updateDesk":
          case "tool-manageWatchlists":
          case "tool-manageAlerts":
          case "tool-manageSignals":
          case "tool-manageRoutines":
          case "tool-manageNotes":
          case "tool-managePortfolios":
          case "tool-manageDrawings":
          case "tool-manageOverlays":
          case "tool-manageScreens":
          case "tool-manageRelations":
          case "tool-manageChartTemplates":
          case "tool-updateSettings":
            handled.current.add(part.toolCallId);
            if (!("error" in part.output)) {
              onWorkspaceChanged();
              if (
                part.type === "tool-manageAlerts" ||
                part.type === "tool-manageSignals" ||
                part.type === "tool-manageRoutines"
              )
                void mutate(alertChannelsKey);
            }
            break;
          case "tool-remember":
          case "tool-forget":
            handled.current.add(part.toolCallId);
            void mutate(memoriesKey);
            break;
        }
      }
    }
  }, [messages, onOpenView, onProposeAlert, onWorkspaceChanged]);

  const actions = useMemo(
    () => ({
      openSymbol: onOpenSymbol,
      proposeAlert: onProposeAlert,
      answer: (toolCallId: string, output: AskUserOutput) =>
        void addToolOutput({ tool: "askUser", toolCallId, output }),
      openSecurity: (ticker: string, fn: string) =>
        onOpenView({ view: "security", ticker, fn }),
    }),
    [onOpenSymbol, onProposeAlert, onOpenView, addToolOutput],
  );

  function resize() {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, full ? 320 : 200)}px`;
  }

  function closeOverlays() {
    setLibrary(false);
    setDrawerOpen(false);
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || unavailable) return;
    if (error) clearError();
    closeOverlays();
    void conversation.current?.scrollToBottom();
    void sendMessage({ text: trimmed }, { body: requestBody(context) });
    setDraft("");
    requestAnimationFrame(resize);
  }

  useImperativeHandle(ref, () => ({
    send: (text) => {
      if (!busy) return send(text);
      setDraft(text);
      requestAnimationFrame(() => input.current?.focus());
    },
    focus: () => input.current?.focus(),
    openThread: (id) =>
      void openThread(id).catch(() =>
        setHeadError("That conversation could not be opened."),
      ),
  }));

  const shownMode = useRef(mode);
  useEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    if (mode === "full") input.current?.focus();
    else modeButton.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (!full && !library) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (!full) {
        setLibrary(false);
        requestAnimationFrame(() => historyButton.current?.focus());
      } else if (onModeChange) onModeChange("docked");
      else onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, library, onModeChange, onClose]);

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (!files.length || unavailable) return;
    event.preventDefault();
    void attachments.upload(files);
  }

  function retry() {
    clearError();
    void conversation.current?.scrollToBottom();
    void regenerate({ body: requestBody(context) });
  }

  function startNew() {
    if (busy) void stop();
    closeOverlays();
    setRenaming(false);
    setSession(newSession());
    setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }

  async function openThread(id: string) {
    if (id === session.id) {
      closeOverlays();
      return;
    }
    const thread = await api<StoredThread>(
      `/api/threads/${encodeURIComponent(id)}`,
    );
    if (busy) void stop();
    for (const callId of toolCallIds(thread.messages))
      handled.current.add(callId);
    setRenaming(false);
    setSession({ id: thread.id, messages: thread.messages });
    closeOverlays();
  }

  function threadDeleted(id: string) {
    if (id === session.id) startNew();
  }

  function toggleSidebar() {
    if (narrow) setDrawerOpen(true);
    else setRailHidden(!railHidden);
  }

  function rename(next: string | null) {
    setRenaming(false);
    setHeadError("");
    if (next)
      patchThread(session.id, { title: next }).catch((reason: unknown) =>
        setHeadError(
          reason instanceof Error
            ? reason.message
            : "Could not rename the conversation.",
        ),
      );
  }

  const last = messages.at(-1);
  const lastPart = last?.role === "assistant" ? last.parts.at(-1) : undefined;
  const writing =
    (lastPart?.type === "text" || lastPart?.type === "reasoning") &&
    lastPart.state === "streaming";
  const toolRunning =
    lastPart !== undefined &&
    isToolPart(lastPart) &&
    isToolRunning(lastPart.state);
  const working =
    status === "submitted" ||
    (status === "streaming" && !writing && !toolRunning);
  const firstPrompt = useMemo(() => {
    const first = messages.find((message) => message.role === "user");
    return first ? textOf(first) : "";
  }, [messages]);
  const saved = threads.data?.find((thread) => thread.id === session.id);
  const title = saved?.title ?? firstPrompt;
  const scope = contextLabel(context);
  const sidebar = full && !unavailable;

  const conversations = (
    <ThreadLibrary
      activeId={session.id}
      onOpen={openThread}
      onNew={startNew}
      onDeleted={threadDeleted}
    />
  );

  return (
    <ToolActions value={actions}>
      <section
        className={["chat-panel", className].filter(Boolean).join(" ")}
        aria-label="Research assistant"
        data-mode={mode}
        data-sidebar={sidebar && sidebarShown && !narrow ? "" : undefined}
        data-dragging={dragging || undefined}
        onDragOver={(event) => {
          if (unavailable || !event.dataTransfer.types.includes("Files"))
            return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node && event.currentTarget.contains(next)))
            setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (unavailable || !event.dataTransfer.files.length) return;
          event.preventDefault();
          void attachments.upload(event.dataTransfer.files);
        }}
      >
        {sidebar ? (
          narrow ? (
            <DialogPrimitive.Root
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
            >
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="chat-sidebar-scrim" />
                <DialogPrimitive.Content
                  className="chat-sidebar chat-sidebar-drawer"
                  aria-describedby={undefined}
                >
                  <DialogPrimitive.Title className="sr-only">
                    Conversations
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="chat-sidebar-close"
                      aria-label="Close conversations"
                    >
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                  {conversations}
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
          ) : sidebarShown ? (
            <div className="chat-sidebar" id={sidebarId}>
              {conversations}
            </div>
          ) : null
        ) : null}

        <div className="chat-main">
          <header className="chat-head">
            <div className="chat-head-title">
              {sidebar ? (
                <Button
                  ref={sidebarButton}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    narrow || !sidebarShown
                      ? "Show conversations"
                      : "Hide conversations"
                  }
                  title="Conversations"
                  aria-expanded={narrow ? drawerOpen : sidebarShown}
                  aria-controls={narrow ? undefined : sidebarId}
                  onClick={toggleSidebar}
                >
                  <PanelLeft />
                </Button>
              ) : (
                <h2 className="kicker">Assistant</h2>
              )}
              {renaming && saved ? (
                <InlineName
                  initial={saved.title}
                  label="Conversation name"
                  maxLength={200}
                  className="chat-head-rename-input"
                  onDone={rename}
                />
              ) : saved ? (
                <button
                  type="button"
                  className="chat-head-thread chat-head-rename chat-truncate"
                  title={`${saved.title} · click to rename`}
                  aria-label={`Rename “${saved.title}”`}
                  onClick={() => setRenaming(true)}
                >
                  {saved.title}
                </button>
              ) : title || full ? (
                <span className="chat-head-thread chat-truncate" title={title}>
                  {title || "New conversation"}
                </span>
              ) : null}
              {full && threadCredits ? (
                <span className="meta chat-head-credits">
                  {formatCredits(threadCredits)}
                </span>
              ) : null}
            </div>
            <div className="row-actions">
              {!full || !sidebarShown || narrow ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New conversation"
                  title="New conversation"
                  onClick={startNew}
                  disabled={unavailable}
                >
                  <Plus />
                </Button>
              ) : null}
              {full ? null : (
                <Button
                  ref={historyButton}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Conversations"
                  title="Conversations"
                  aria-pressed={library}
                  data-active={library || undefined}
                  onClick={() => setLibrary((open) => !open)}
                  disabled={unavailable}
                >
                  <History />
                </Button>
              )}
              {onModeChange ? (
                <Button
                  ref={modeButton}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={full ? "Exit full screen" : "Full screen"}
                  title={full ? "Exit full screen (Esc)" : "Full screen"}
                  onClick={() => onModeChange(full ? "docked" : "full")}
                >
                  {full ? <Minimize2 /> : <Maximize2 />}
                </Button>
              ) : null}
              {onClose ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close assistant"
                  title="Close"
                  onClick={onClose}
                >
                  <X />
                </Button>
              ) : null}
            </div>
          </header>
          {headError ? (
            <p className="chat-tool-error chat-head-error" role="alert">
              {headError}
            </p>
          ) : null}

          {unavailable ? (
            <div className="chat-unavailable">
              <p className="chat-unavailable-title">AI is not configured</p>
              <p>
                The research assistant needs an AI Gateway key on the server (
                <code>AI_GATEWAY_API_KEY</code>). Demo sessions only get it when{" "}
                <code>DEMO_AI=1</code>. Market data, portfolios and alerts work
                without it.
              </p>
            </div>
          ) : (
            <>
              <div
                className="chat-body"
                data-empty={messages.length ? undefined : ""}
              >
                <Conversation
                  key={session.id}
                  className="chat-scroll"
                  contextRef={conversation}
                  inert={!full && library}
                >
                  <ConversationContent className="chat-log">
                    {messages.length ? (
                      <>
                        {messages.map((message, index) =>
                          message.role === "user" ? (
                            <Prompt key={message.id} text={textOf(message)} />
                          ) : message.role === "assistant" ? (
                            <Answer
                              key={message.id}
                              message={message}
                              done={!busy || index < messages.length - 1}
                              canRegenerate={
                                !busy && index === messages.length - 1
                              }
                              latest={index === messages.length - 1}
                              onRegenerate={retry}
                            />
                          ) : null,
                        )}
                        {working ? (
                          <ToolStatus
                            text={
                              status === "submitted"
                                ? "Thinking"
                                : "Working through it"
                            }
                          />
                        ) : null}
                        {error && isOutOfCredits(error) ? (
                          <div className="chat-error" role="alert">
                            <span>
                              {outOfCreditsMessage(error)} Free credits reset on
                              the 1st of the month.
                            </span>
                            <Button variant="ghost" size="xs" asChild>
                              <a href="/account">Buy credits</a>
                            </Button>
                          </div>
                        ) : error ? (
                          <div className="chat-error" role="alert">
                            <span>{errorMessage(error)}</span>
                            <Button variant="ghost" size="xs" onClick={retry}>
                              <RotateCcw /> Retry
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <Starters
                        full={full}
                        hasBook={hasBook}
                        onPick={send}
                        onAddBook={() => onOpenView({ view: "portfolio" })}
                      />
                    )}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
                {!full && library ? (
                  <div className="chat-library-overlay">
                    <ThreadLibrary
                      activeId={session.id}
                      onOpen={openThread}
                      onDeleted={threadDeleted}
                      autoFocusSearch
                    />
                  </div>
                ) : null}
              </div>

              <div className="chat-composer">
                <UploadList
                  items={attachments.items}
                  onDismiss={attachments.dismiss}
                />
                <PromptInput onSubmit={() => send(draft)}>
                  <PromptInputBody>
                    <PromptInputTextarea
                      ref={input}
                      rows={full ? 3 : 1}
                      value={draft}
                      placeholder="Ask about your book, a ticker, a filing…"
                      aria-label="Message the assistant"
                      maxLength={8000}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        resize();
                      }}
                      onPaste={onPaste}
                    />
                  </PromptInputBody>
                  <PromptInputFooter>
                    <PromptInputTools>
                      <PromptInputButton
                        aria-label="Attach a document"
                        title="Attach a PDF, DOCX, text, CSV or HTML file"
                        onClick={() => picker.current?.click()}
                      >
                        <Paperclip />
                      </PromptInputButton>
                      <input
                        ref={picker}
                        type="file"
                        multiple
                        hidden
                        accept={documentExtensions}
                        onChange={(event) => {
                          if (event.target.files?.length)
                            void attachments.upload(event.target.files);
                          event.target.value = "";
                        }}
                      />
                      <span className="meta chat-truncate chat-composer-scope">
                        {scope
                          ? `Context: ${scope}`
                          : "Enter to send · Shift+Enter for a new line"}
                      </span>
                    </PromptInputTools>
                    {creditsLeft !== null ? (
                      <CreditMeter
                        left={creditsLeft}
                        thread={threadCredits}
                        last={lastCredits}
                      />
                    ) : null}
                    <PromptInputSubmit
                      status={status}
                      onStop={() => void stop()}
                      disabled={!busy && !draft.trim()}
                    />
                  </PromptInputFooter>
                </PromptInput>
              </div>
            </>
          )}
        </div>
      </section>
    </ToolActions>
  );
}

function Prompt({ text }: { text: string }) {
  return (
    <Message from="user" className="chat-prompt">
      <MessageContent>
        <p>{text}</p>
      </MessageContent>
    </Message>
  );
}

function CreditMeter({
  left,
  thread,
  last,
}: {
  left: number;
  thread: number;
  last: number | undefined;
}) {
  return (
    <Context
      used={thread}
      max={thread + Math.max(left, 0)}
      format={formatCredits}
    >
      <ContextTrigger asChild>
        <a
          href="/account"
          className={`meta chat-credit-balance${left <= 0 ? " negative" : ""}`}
        >
          <ContextIcon />
          {thread
            ? `${formatCredits(thread)} · ${formatCredits(left)} left`
            : `${formatCredits(left)} left`}
        </a>
      </ContextTrigger>
      <ContextContent align="end" side="top">
        <ContextContentHeader label="Thread" />
        <ContextContentBody>
          <ContextRow label="This thread" value={formatCredits(thread)} />
          {last !== undefined ? (
            <ContextRow label="Last answer" value={formatCredits(last)} />
          ) : null}
          <ContextRow
            label="Balance"
            value={
              <span className={left <= 0 ? "negative" : undefined}>
                {formatCredits(left)}
              </span>
            }
          />
        </ContextContentBody>
        <ContextContentFooter className="justify-end">
          <Button variant="link" size="xs" asChild>
            <a href="/account">Buy credits</a>
          </Button>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function Answer({
  message,
  done,
  canRegenerate,
  onRegenerate,
  latest,
}: {
  message: StockwatcherMessage;
  done: boolean;
  latest: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = textOf(message);
  const sources = useMemo(() => {
    const cited = new Set<string>();
    for (const part of message.parts)
      if (
        part.type === "tool-webSearch" &&
        part.state === "output-available" &&
        !("error" in part.output)
      )
        for (const result of part.output.results) cited.add(result.url);
    const seen = new Set<string>();
    return message.parts.flatMap((part) => {
      if (
        part.type !== "source-url" ||
        cited.has(part.url) ||
        seen.has(part.url)
      )
        return [];
      seen.add(part.url);
      return [{ url: part.url, title: part.title }];
    });
  }, [message.parts]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Message from="assistant" className="chat-answer">
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === "text")
            return part.text ? (
              <Markdown
                key={index}
                text={part.text}
                streaming={part.state === "streaming"}
              />
            ) : null;
          if (part.type === "reasoning")
            return part.text.trim() ? (
              <Reasoning
                key={index}
                className="chat-reasoning"
                isStreaming={part.state === "streaming"}
              >
                <ReasoningTrigger />
                <ReasoningContent>
                  <Markdown
                    text={part.text}
                    streaming={part.state === "streaming"}
                  />
                </ReasoningContent>
              </Reasoning>
            ) : null;
          if (isToolPart(part))
            return (
              <ToolPartView
                key={part.toolCallId}
                part={part}
                interactive={latest}
              />
            );
          if (part.type === "dynamic-tool")
            return (
              <Tool key={part.toolCallId} state={part.state}>
                {part.state === "output-error" ? (
                  <p className="chat-tool-error" role="alert">
                    {part.toolName}: {part.errorText}
                  </p>
                ) : isToolRunning(part.state) ? (
                  <ToolStatus text={`Running ${part.toolName}`} />
                ) : null}
              </Tool>
            );
          return null;
        })}
      </MessageContent>
      <SourceList sources={sources} />
      {message.metadata?.stopped === "credits" ? (
        <div className="chat-error" role="status">
          <span>
            Stopped here: this turn used the credits left on your account.
          </span>
          <Button variant="ghost" size="xs" asChild>
            <a href="/account">Buy credits</a>
          </Button>
        </div>
      ) : null}
      {done && text ? (
        <MessageActions className="chat-answer-actions">
          {message.metadata?.credits !== undefined ? (
            <span className="meta chat-answer-credits">
              {formatCredits(message.metadata.credits)}
            </span>
          ) : null}
          <MessageAction label="Copy answer" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </MessageAction>
          {canRegenerate ? (
            <MessageAction label="Regenerate answer" onClick={onRegenerate}>
              <RotateCcw /> Regenerate
            </MessageAction>
          ) : null}
        </MessageActions>
      ) : null}
    </Message>
  );
}

function Starters({
  full,
  hasBook,
  onPick,
  onAddBook,
}: {
  full: boolean;
  hasBook: boolean;
  onPick: (text: string) => void;
  onAddBook: () => void;
}) {
  return (
    <ConversationEmptyState className="chat-empty">
      {full ? (
        <h2 className="chat-empty-title">What are you looking into?</h2>
      ) : null}
      <p className="chat-empty-lead">
        Reads your ledger, live quotes, SEC filings and the news, and computes
        any indicator or statistic from live prices. Every number comes back
        with its source, time and currency.
      </p>
      {hasBook ? null : (
        <p className="chat-empty-lead">
          No portfolio yet.{" "}
          <button type="button" className="chat-empty-link" onClick={onAddBook}>
            Connect Interactive Brokers or add positions
          </button>{" "}
          to ask about your book.
        </p>
      )}
      <Suggestions>
        {(hasBook ? bookStarters : marketStarters).map((starter) => (
          <Suggestion key={starter} suggestion={starter} onClick={onPick} />
        ))}
      </Suggestions>
    </ConversationEmptyState>
  );
}

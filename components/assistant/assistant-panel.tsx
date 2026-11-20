"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  APICallError,
  DefaultChatTransport,
  generateId,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { mutate } from "swr";
import {
  ArrowUp,
  Check,
  Copy,
  History,
  Plus,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/components/shared";
import type { StockwatcherMessage } from "@/lib/ai/tools";
import type { AskUserOutput, DashboardState } from "@/lib/assistant-types";
import { Markdown } from "./markdown";
import {
  SourceList,
  Status,
  ToolActions,
  ToolPartView,
  isToolPart,
  type AlertProposal,
} from "./tool-parts";
import { ThreadDrawer, threadsKey } from "./thread-drawer";
import { memoriesKey } from "./memory-panel";
import { errorMessage } from "./format";

export type AssistantContext = {
  dashboard?: DashboardState;
  ticker?: string;
  view?: string;
};

export type AssistantHandle = {
  send: (text: string) => void;
  focus: () => void;
};

export type AssistantPanelProps = {
  ref?: Ref<AssistantHandle>;
  context: AssistantContext;
  onOpenView: (state: DashboardState) => void;
  onProposeAlert: (proposal: AlertProposal) => void;
  onDeskChanged: () => void;
  onOpenSymbol: (symbol: string) => void;
  onClose?: () => void;
  onUnavailable?: () => void;
  available?: boolean;
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

const starters = [
  "What moved my book today and why?",
  "Compare NVDA, AMD and AVGO since January",
  "Summarise Berkshire's latest 13F changes",
  "Pin a 6M chart of ^STOXX50E to my desk",
  "Which of my holdings report earnings or file with the SEC soon?",
  "Where is my book most concentrated, per currency?",
];

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
  return { context: clean };
}

function contextLabel(context: AssistantContext) {
  const view = context.dashboard?.view ?? context.view;
  const ticker = context.ticker ?? context.dashboard?.ticker;
  const name = view ? (viewLabels[view] ?? view) : undefined;
  return [name, ticker].filter(Boolean).join(" · ");
}

export function AssistantPanel({
  ref,
  context,
  onOpenView,
  onProposeAlert,
  onDeskChanged,
  onOpenSymbol,
  onClose,
  onUnavailable,
  available = true,
  className,
}: AssistantPanelProps) {
  const [session, setSession] = useState<Session>(newSession);
  const [drawer, setDrawer] = useState(false);
  const [rejected, setRejected] = useState(false);
  const unavailable = !available || rejected;
  const [draft, setDraft] = useState("");
  const handled = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

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
      },
    });

  const busy = status === "submitted" || status === "streaming";

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
            });
            break;
          case "tool-updateDesk":
            handled.current.add(part.toolCallId);
            if (!("error" in part.output)) onDeskChanged();
            break;
          case "tool-remember":
          case "tool-forget":
            handled.current.add(part.toolCallId);
            void mutate(memoriesKey);
            break;
        }
      }
    }
  }, [messages, onOpenView, onProposeAlert, onDeskChanged]);

  useEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages, status]);

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
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || unavailable) return;
    if (error) clearError();
    setDrawer(false);
    stick.current = true;
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
  }));

  function submit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    send(draft);
  }

  function retry() {
    clearError();
    stick.current = true;
    void regenerate({ body: requestBody(context) });
  }

  function startNew() {
    if (busy) void stop();
    setDrawer(false);
    setSession(newSession());
    setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }

  async function openThread(id: string) {
    const thread = await api<StoredThread>(
      `/api/threads/${encodeURIComponent(id)}`,
    );
    if (busy) void stop();
    for (const callId of toolCallIds(thread.messages))
      handled.current.add(callId);
    stick.current = true;
    setSession({ id: thread.id, messages: thread.messages });
    setDrawer(false);
  }

  function threadDeleted(id: string) {
    if (id === session.id) setSession(newSession());
  }

  const last = messages.at(-1);
  const lastPart = last?.role === "assistant" ? last.parts.at(-1) : undefined;
  const writing = lastPart?.type === "text" && lastPart.state === "streaming";
  const toolRunning =
    lastPart !== undefined &&
    isToolPart(lastPart) &&
    (lastPart.state === "input-streaming" ||
      lastPart.state === "input-available");
  const working =
    status === "submitted" ||
    (status === "streaming" && !writing && !toolRunning);
  const title = useMemo(() => {
    const first = messages.find((message) => message.role === "user");
    return first ? textOf(first) : "";
  }, [messages]);
  const scope = contextLabel(context);

  return (
    <ToolActions value={actions}>
      <section
        className={["chat-panel", className].filter(Boolean).join(" ")}
        aria-label="Research assistant"
      >
        <header className="chat-head">
          <div className="chat-head-title">
            <h2 className="kicker">Assistant</h2>
            {title ? (
              <span className="chat-head-thread chat-truncate" title={title}>
                {title}
              </span>
            ) : null}
          </div>
          <div className="row-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New thread"
              title="New thread"
              onClick={startNew}
              disabled={unavailable}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Conversation history"
              title="History"
              aria-pressed={drawer}
              data-active={drawer || undefined}
              onClick={() => setDrawer((open) => !open)}
              disabled={unavailable}
            >
              <History />
            </Button>
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
        ) : drawer ? (
          <ThreadDrawer
            activeId={session.id}
            onOpen={openThread}
            onDeleted={threadDeleted}
          />
        ) : (
          <>
            <div
              className="chat-scroll"
              ref={scroller}
              onScroll={(event) => {
                const element = event.currentTarget;
                stick.current =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  48;
              }}
            >
              {messages.length ? (
                <div className="chat-log" aria-live="polite">
                  {messages.map((message, index) =>
                    message.role === "user" ? (
                      <Prompt key={message.id} text={textOf(message)} />
                    ) : message.role === "assistant" ? (
                      <Answer
                        key={message.id}
                        message={message}
                        done={!busy || index < messages.length - 1}
                        canRegenerate={!busy && index === messages.length - 1}
                        latest={index === messages.length - 1}
                        onRegenerate={retry}
                      />
                    ) : null,
                  )}
                  {working ? (
                    <Status
                      text={
                        status === "submitted"
                          ? "Thinking"
                          : "Working through it"
                      }
                    />
                  ) : null}
                  {error ? (
                    <div className="chat-error" role="alert">
                      <span>{errorMessage(error)}</span>
                      <Button variant="ghost" size="xs" onClick={retry}>
                        <RotateCcw /> Retry
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Starters onPick={send} />
              )}
            </div>

            <form className="chat-composer" onSubmit={submit}>
              <textarea
                ref={input}
                className="chat-input"
                rows={1}
                value={draft}
                placeholder="Ask about your book, a ticker, a filing…"
                aria-label="Message the assistant"
                maxLength={8000}
                onChange={(event) => {
                  setDraft(event.target.value);
                  resize();
                }}
                onKeyDown={onKeyDown}
              />
              <div className="chat-composer-bar">
                <span className="meta chat-truncate">
                  {scope
                    ? `Context: ${scope}`
                    : "Enter to send · Shift+Enter for a new line"}
                </span>
                {busy ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void stop()}
                  >
                    <Square /> Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!draft.trim()}
                    aria-label="Send"
                  >
                    <ArrowUp /> Send
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </ToolActions>
  );
}

function Prompt({ text }: { text: string }) {
  return (
    <div className="chat-prompt">
      <p>{text}</p>
    </div>
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
    <article className="chat-answer">
      {message.parts.map((part, index) => {
        if (part.type === "text")
          return part.text ? (
            <Markdown
              key={index}
              text={part.text}
              streaming={part.state === "streaming"}
            />
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
          return part.state === "output-error" ? (
            <p key={part.toolCallId} className="chat-tool-error" role="alert">
              {part.toolName}: {part.errorText}
            </p>
          ) : part.state === "input-streaming" ||
            part.state === "input-available" ? (
            <Status key={part.toolCallId} text={`Running ${part.toolName}`} />
          ) : null;
        return null;
      })}
      <SourceList sources={sources} />
      {done && text ? (
        <div className="chat-answer-actions">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void copy()}
            aria-label="Copy answer"
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
          {canRegenerate ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onRegenerate}
              aria-label="Regenerate answer"
            >
              <RotateCcw /> Regenerate
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Starters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="chat-empty">
      <p className="chat-empty-lead">
        Reads your ledger, live quotes, SEC filings and the news. Every number
        comes back with its source, time and currency.
      </p>
      <ul className="ruled-list flush-top chat-starters">
        {starters.map((starter) => (
          <li key={starter}>
            <button type="button" onClick={() => onPick(starter)}>
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

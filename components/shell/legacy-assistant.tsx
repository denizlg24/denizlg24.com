"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import { ArrowRight, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, Failure, SourceLink } from "@/components/shared";
import type { Save } from "@/components/forms";
import type { AssistantHandle } from "@/components/assistant/assistant-panel";
import type { Workspace } from "@/lib/models";
import {
  dashboardFromResult,
  dashboardLink,
  type AssistantResult,
  type DashboardState,
} from "@/lib/assistant-types";

const suggestions = [
  "Show me the S&P 500",
  "Warren Buffett’s portfolio",
  "What is WallStreetBets talking about?",
  "Healthcare stocks",
  "Chips",
  "Magnificent 7",
  "Show the Russian market",
  "DAX",
];

type Exchange = {
  query: string;
  result: AssistantResult;
  symbol: string;
  dashboard?: DashboardState;
};

export function LegacyAssistant({
  ref,
  close,
  ticker,
  currentDashboard,
  navigate,
  saved,
  save,
}: {
  ref?: Ref<AssistantHandle>;
  close?: () => void;
  ticker: string;
  currentDashboard?: DashboardState;
  navigate: (result: AssistantResult) => void;
  saved: Workspace["requests"];
  save: Save;
}) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  const latest = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (history.length) latest.current?.scrollIntoView({ block: "nearest" });
  }, [history.length]);

  useImperativeHandle(ref, () => ({
    send: (text) => void ask(text),
    focus: () => input.current?.focus(),
  }));

  async function ask(
    text: string,
    symbol = ticker,
    dashboard = currentDashboard,
  ) {
    if (!text.trim() || working) return;
    setQuery(text);
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<AssistantResult>("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, symbol, dashboard }),
      });
      setHistory((items) => [
        ...items,
        { query: text, result, symbol, dashboard },
      ]);
      navigate(result);
      setQuery("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("The request failed."),
      );
    } finally {
      setWorking(false);
    }
  }

  const isSaved = (item: Exchange) =>
    saved.some(
      (entry) => entry.query === item.query && entry.symbol === item.symbol,
    );

  function bookmark(item: Exchange) {
    void save((workspace) => ({
      ...workspace,
      requests: [
        ...workspace.requests,
        {
          id: crypto.randomUUID(),
          query: item.query,
          answer: item.result.answer.slice(0, 8000),
          web: false,
          symbol: item.symbol,
          dashboard: item.dashboard,
          sources: (item.result.sources ?? [])
            .filter((source) => source.url.length <= 2500)
            .map((source) => ({
              title: source.title.slice(0, 500),
              url: source.url,
            })),
        },
      ],
    })).catch((cause: Error) => setError(cause));
  }

  function remove(id: string) {
    void save((workspace) => ({
      ...workspace,
      requests: workspace.requests.filter((entry) => entry.id !== id),
    })).catch((cause: Error) => setError(cause));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(query);
  }

  return (
    <section className="legacy-assistant" aria-labelledby="assistant-title">
      <header className="chat-head">
        <div className="chat-head-title">
          <h2 className="kicker" id="assistant-title">
            Ask Stockwatcher
          </h2>
          <span className="meta">Commands · AI off</span>
        </div>
        {close ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide assistant"
            onClick={close}
          >
            <X />
          </Button>
        ) : null}
      </header>
      <div className="legacy-body">
        {history.map((item, index) => {
          const state = dashboardFromResult(item.result);
          return (
            <div
              className="legacy-exchange"
              key={index}
              ref={index === history.length - 1 ? latest : null}
            >
              <p className="legacy-query">{item.query}</p>
              <p className="legacy-answer">{item.result.answer}</p>
              {item.result.sources?.length ? (
                <ul className="legacy-sources">
                  {item.result.sources.map((source, key) => (
                    <li key={key}>
                      <SourceLink href={source.url}>{source.title}</SourceLink>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="row-actions">
                {state ? (
                  <Button asChild size="xs" variant="outline">
                    <a href={dashboardLink(state)}>
                      Open dashboard <ArrowRight />
                    </a>
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => bookmark(item)}
                  disabled={isSaved(item) || saved.length >= 40}
                >
                  <Bookmark /> {isSaved(item) ? "Saved" : "Save request"}
                </Button>
              </div>
            </div>
          );
        })}
        {!history.length ? (
          <ul className="ruled-list flush-top legacy-suggestions">
            {suggestions.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void ask(text)}
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {saved.length ? (
          <details className="saved-requests">
            <summary>Saved requests ({saved.length})</summary>
            {saved.map((item) => (
              <div key={item.id}>
                <details className="saved-answer">
                  <summary>{item.query}</summary>
                  <p className="legacy-answer">{item.answer}</p>
                  {item.sources.length ? (
                    <ul className="legacy-sources">
                      {item.sources.map((source) => (
                        <li key={source.url}>
                          <SourceLink href={source.url}>
                            {source.title}
                          </SourceLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={working}
                    onClick={() =>
                      void ask(
                        item.query,
                        item.symbol ?? ticker,
                        item.dashboard,
                      )
                    }
                  >
                    Run again
                  </Button>
                </details>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove saved request ${item.query}`}
                  onClick={() => remove(item.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </details>
        ) : null}
      </div>
      <Failure error={error} />
      <form className="legacy-input" onSubmit={submit}>
        <Input
          ref={input}
          aria-label="Request"
          placeholder="Show the DAX, compare NVDA AMD…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={500}
        />
        <Button type="submit" size="sm" disabled={working || !query.trim()}>
          {working ? "Looking up…" : "Ask"}
        </Button>
      </form>
    </section>
  );
}

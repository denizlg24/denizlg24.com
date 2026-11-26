"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Streamdown } from "streamdown";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markdownComponents } from "@/components/assistant/markdown";
import { api, Change, Failure } from "@/components/shared";
import type { Brief } from "@/lib/memory-types";
import { amount } from "@/lib/utils";
import { useHoldings } from "./data";
import {
  DeskEmpty,
  SkeletonRows,
  Stamp,
  SymbolButton,
  WidgetFrame,
  useLocalDate,
  useNow,
  type WidgetProps,
} from "./frame";

const autoKey = "stockwatcher:brief-auto";
const claimed = new Set<string>();

function claimAutoBrief(date: string) {
  if (claimed.has(date)) return false;
  claimed.add(date);
  try {
    if (localStorage.getItem(autoKey) === date) return false;
    localStorage.setItem(autoKey, date);
  } catch {}
  return true;
}

type Stream = {
  date: string;
  text: string;
  status: "streaming" | "failed";
  error?: Error;
};

export function BriefWidget({ ctx }: WidgetProps<"brief">) {
  return ctx.aiEnabled ? <AiBrief {...ctx} /> : <MorningSummary {...ctx} />;
}

function AiBrief({ onOpenView }: WidgetProps<"brief">["ctx"]) {
  const date = useLocalDate();
  const key = date ? `/api/brief?date=${date}` : null;
  const { mutate: store } = useSWRConfig();
  const [stream, setStream] = useState<Stream | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const generate = useCallback(
    async (day: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setStream({ date: day, text: "", status: "streaming" });
      let text = "";
      try {
        const response = await fetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day }),
          signal: current.signal,
        });
        if (!response.ok || !response.body) {
          const body: { error?: string } | null = await response
            .json()
            .catch(() => null);
          throw new Error(body?.error ?? "The brief could not be generated.");
        }
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += value;
          setStream({ date: day, text, status: "streaming" });
        }
        const content = text.trim();
        if (!content) throw new Error("The model returned an empty brief.");
        await store<Brief | null>(
          `/api/brief?date=${day}`,
          { date: day, content, generatedAt: new Date().toISOString() },
          { revalidate: false },
        );
        setStream(null);
      } catch (cause) {
        if (current.signal.aborted) return;
        setStream({
          date: day,
          text,
          status: "failed",
          error:
            cause instanceof Error
              ? cause
              : new Error("The brief could not be generated."),
        });
      }
    },
    [store],
  );

  const { data, error, isLoading, mutate } = useSWR<Brief | null>(key, api, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
    onSuccess: (brief) => {
      if (brief === null && date && !stream && claimAutoBrief(date))
        void generate(date);
    },
  });

  const streaming = stream?.status === "streaming";
  const content = stream?.text || data?.content || "";
  return (
    <WidgetFrame
      label="Morning brief"
      className="desk-brief"
      subtitle={date ? `For ${date} · your book, movers and news` : undefined}
      ask="Walk me through today's brief: what matters most for my book, and what should I watch into the close?"
      actions={
        <Button
          variant="ghost"
          size="xs"
          disabled={!date || streaming}
          onClick={() => date && void generate(date)}
        >
          <RefreshCw className={streaming ? "animate-spin" : undefined} />
          {data || stream ? "Regenerate" : "Generate"}
        </Button>
      }
      foot={
        <>
          <span>
            {streaming
              ? "Writing from live portfolio, watchlist, news and alert data…"
              : "AI-written from your ledger, watchlists, news and alerts · verify before acting"}
          </span>
          {data?.generatedAt && !streaming ? (
            <Stamp ms={Date.parse(data.generatedAt)} prefix="Generated" />
          ) : null}
        </>
      }
    >
      <Failure error={error} retry={mutate} />
      {stream?.status === "failed" ? (
        <Failure error={stream.error} retry={() => date && generate(date)} />
      ) : null}
      {content ? (
        <div className="desk-brief-body" aria-busy={streaming}>
          <Streamdown
            mode={streaming ? "streaming" : "static"}
            isAnimating={streaming}
            components={markdownComponents}
          >
            {content}
          </Streamdown>
        </div>
      ) : isLoading || !date || streaming ? (
        <SkeletonRows rows={6} label="Loading the morning brief" />
      ) : !error && stream?.status !== "failed" ? (
        <DeskEmpty
          title="No brief yet today"
          action={
            <Button size="sm" onClick={() => date && void generate(date)}>
              <Sparkles /> Generate today&rsquo;s brief
            </Button>
          }
        >
          It reads your positions, watchlists, alerts and holdings news.{" "}
          <button
            type="button"
            className="desk-link"
            onClick={() => onOpenView({ view: "portfolio" })}
          >
            Check your ledger
          </button>{" "}
          first if positions are missing.
        </DeskEmpty>
      ) : null}
    </WidgetFrame>
  );
}

function MorningSummary({
  workspace,
  refresh,
  onOpenSymbol,
  onOpenView,
}: WidgetProps<"brief">["ctx"]) {
  const date = useLocalDate();
  const { rows, totals, loading, quotes } = useHoldings(workspace, refresh);
  const ranked = rows
    .filter((row) => row.quote?.percent != null)
    .toSorted((a, b) => (b.quote?.percent ?? 0) - (a.quote?.percent ?? 0));
  const gainers = ranked.filter((row) => (row.quote?.percent ?? 0) > 0);
  const losers = ranked
    .filter((row) => (row.quote?.percent ?? 0) < 0)
    .toReversed();
  const now = useNow();
  const dayAgo = now ? now - 86_400_000 : Infinity;
  const triggered = workspace.alerts.filter(
    (alert) => alert.lastTriggered && Date.parse(alert.lastTriggered) >= dayAgo,
  );
  return (
    <WidgetFrame
      label="Morning summary"
      className="desk-brief"
      subtitle={date ? `${date} · computed from your ledger` : undefined}
      ask="Summarise my book this morning: biggest movers, triggered alerts and what to watch."
      foot={
        <>
          <span>
            {quotes.data?.source ?? "Market data"} · AI brief is unavailable
          </span>
          <span>Totals per currency, never converted</span>
        </>
      }
    >
      {loading ? (
        <SkeletonRows rows={5} label="Loading the morning summary" />
      ) : rows.length === 0 ? (
        <DeskEmpty
          title="No open positions"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenView({ view: "portfolio" })}
            >
              Record a transaction
            </Button>
          }
        >
          Add your trades to see overnight moves in your book here.
        </DeskEmpty>
      ) : (
        <div className="desk-summary">
          <div className="stat-row">
            {totals.map((total) => (
              <div className="figure" key={total.currency}>
                <span className="figure-label">Day · {total.currency}</span>
                <strong
                  className={`figure-value ${total.day > 0 ? "positive" : total.day < 0 ? "negative" : ""}`}
                >
                  {total.day > 0 ? "+" : ""}
                  {amount(total.day)}
                </strong>
                <span className="figure-sub">
                  on {amount(total.value)} {total.currency}
                </span>
              </div>
            ))}
            <div className="figure">
              <span className="figure-label">Alerts · 24h</span>
              <strong className="figure-value">{triggered.length}</strong>
              <span className="figure-sub">triggered</span>
            </div>
          </div>
          <div className="desk-split">
            <MoverList
              title="Leading"
              rows={gainers.slice(0, 3)}
              onOpenSymbol={onOpenSymbol}
            />
            <MoverList
              title="Lagging"
              rows={losers.slice(0, 3)}
              onOpenSymbol={onOpenSymbol}
            />
          </div>
          {triggered.length ? (
            <ul className="ruled-list flush-top">
              {triggered.map((alert) => (
                <li key={alert.id} className="desk-line">
                  <SymbolButton symbol={alert.symbol} onOpen={onOpenSymbol} />
                  <span className="muted">
                    crossed {alert.direction} {amount(alert.target)}
                  </span>
                  <span className="num">{amount(alert.triggeredPrice)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  );
}

function MoverList({
  title,
  rows,
  onOpenSymbol,
}: {
  title: string;
  rows: ReturnType<typeof useHoldings>["rows"];
  onOpenSymbol: (symbol: string) => void;
}) {
  return (
    <div>
      <span className="kicker">{title}</span>
      {rows.length ? (
        <ul className="ruled-list">
          {rows.map((row) => (
            <li key={`${row.symbol}:${row.currency}`} className="desk-line">
              <SymbolButton symbol={row.symbol} onOpen={onOpenSymbol} />
              <span className="muted desk-ellipsis">{row.quote?.name}</span>
              <Change value={row.quote?.percent} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta desk-none">None</p>
      )}
    </div>
  );
}

"use client";

import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import type { InferUITools } from "ai";
import { mutate } from "swr";
import {
  ArrowUpRight,
  BellPlus,
  BookmarkCheck,
  BookmarkX,
  CircleAlert,
  FileText,
  LayoutGrid,
  MoveRight,
  Presentation,
  Undo2,
} from "lucide-react";
import type { StockwatcherMessage, StockwatcherTools } from "@/lib/ai/tools";
import type {
  AskUserInput,
  AskUserOutput,
  DashboardState,
} from "@/lib/assistant-types";
import { amount, compact, number, percent, tone } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { ago, hostOf, listSymbols, stamp, useNow } from "./format";
import { memoriesKey } from "./memory-panel";
import { ChartView } from "@/components/reports/chart";
import { ShareControl } from "@/components/reports/share-control";
import type { PublishedDoc } from "@/lib/reports/types";

type Tools = InferUITools<StockwatcherTools>;
type Part = StockwatcherMessage["parts"][number];
export type ToolPart = Extract<Part, { type: `tool-${string}` }>;
type DonePart = Extract<ToolPart, { state: "output-available" }>;
type Success<N extends keyof Tools> = Exclude<
  Tools[N]["output"],
  { error: unknown }
>;

export type AlertProposal = {
  symbol: string;
  direction: "above" | "below";
  target: number;
};

type Actions = {
  openSymbol: (symbol: string) => void;
  proposeAlert: (proposal: AlertProposal) => void;
  answer: (toolCallId: string, output: AskUserOutput) => void;
  openSecurity: (symbol: string, fn: string) => void;
};

export const ToolActions = createContext<Actions>({
  openSymbol: () => {},
  proposeAlert: () => {},
  answer: () => {},
  openSecurity: () => {},
});

export function isToolPart(part: Part): part is ToolPart {
  return part.type.startsWith("tool-");
}

function isFailure<T extends object>(
  output: T,
): output is Extract<T, { error: unknown }> {
  return !Array.isArray(output) && "error" in output;
}

function failureText(output: { error: unknown }) {
  if ("message" in output && typeof output.message === "string")
    return output.message;
  return typeof output.error === "string" ? output.error : "The tool failed.";
}

const viewNames: Record<DashboardState["view"], string> = {
  markets: "Markets",
  portfolio: "Portfolio",
  research: "Research",
  watchlists: "Watchlists",
  alerts: "Alerts",
  security: "Security",
  monitor: "Monitor",
  overlay: "Charts",
};

const toolNames: Record<ToolPart["type"], string> = {
  "tool-getQuotes": "Quotes",
  "tool-getPriceHistory": "Price history",
  "tool-searchSymbols": "Symbol search",
  "tool-getCompanyFundamentals": "Fundamentals",
  "tool-getNews": "News",
  "tool-getInstitutionalHoldings": "13F holdings",
  "tool-getSocialMentions": "Social mentions",
  "tool-getPortfolio": "Portfolio",
  "tool-getWatchlists": "Watchlists",
  "tool-remember": "Memory",
  "tool-forget": "Memory",
  "tool-updateDesk": "Desk",
  "tool-openView": "Navigation",
  "tool-proposeAlert": "Alert",
  "tool-webSearch": "Web search",
  "tool-createChart": "Chart",
  "tool-createReport": "Report",
  "tool-createDeck": "Deck",
  "tool-shareReport": "Sharing",
  "tool-askUser": "Question",
  "tool-getSecurityData": "Security data",
};

export function runningLabel(part: ToolPart): string {
  switch (part.type) {
    case "tool-getQuotes": {
      const symbols = listSymbols(part.input?.symbols);
      return symbols ? `Pulling ${symbols} quotes` : "Pulling quotes";
    }
    case "tool-getPriceHistory":
      return part.input?.symbol
        ? `Loading ${part.input.symbol} ${part.input.range ?? ""} history`
        : "Loading price history";
    case "tool-searchSymbols":
      return part.input?.query
        ? `Looking up “${part.input.query}”`
        : "Looking up symbols";
    case "tool-getCompanyFundamentals":
      return part.input?.symbol
        ? `Reading ${part.input.symbol} SEC filings`
        : "Reading SEC filings";
    case "tool-getNews": {
      const symbols = listSymbols(part.input?.symbols);
      return symbols ? `Scanning ${symbols} headlines` : "Scanning headlines";
    }
    case "tool-getInstitutionalHoldings":
      return part.input?.manager
        ? `Reading ${part.input.manager} 13F`
        : part.input?.cik
          ? `Reading 13F for CIK ${part.input.cik}`
          : "Reading 13F filing";
    case "tool-getSocialMentions":
      return "Checking WallStreetBets mentions";
    case "tool-getPortfolio":
      return "Valuing your book at live prices";
    case "tool-getWatchlists":
      return "Loading watchlists";
    case "tool-remember":
      return "Saving to memory";
    case "tool-forget":
      return "Removing from memory";
    case "tool-updateDesk":
      return "Updating your desk";
    case "tool-openView":
      return "Opening view";
    case "tool-proposeAlert":
      return part.input?.symbol
        ? `Drafting ${part.input.symbol} alert`
        : "Drafting alert";
    case "tool-webSearch": {
      const query = part.input?.query;
      const text = Array.isArray(query)
        ? query.filter(Boolean).join("; ")
        : query;
      return text ? `Searching the web for “${text}”` : "Searching the web";
    }
    case "tool-createChart":
      return part.input?.spec?.title
        ? `Drawing “${part.input.spec.title}”`
        : "Drawing chart";
    case "tool-createReport":
      return part.input?.title
        ? `Writing “${part.input.title}”`
        : "Writing report";
    case "tool-createDeck":
      return part.input?.title
        ? `Building deck “${part.input.title}”`
        : "Building deck";
    case "tool-shareReport":
      return part.input?.share === false
        ? "Revoking share link"
        : "Creating share link";
    case "tool-askUser":
      return "Waiting for your answer";
    case "tool-getSecurityData":
      return part.input?.symbol
        ? `Reading ${part.input.symbol} ${part.input.kind?.toUpperCase() ?? ""}`
        : "Reading security data";
  }
}

export function ToolPartView({
  part,
  interactive = false,
}: {
  part: ToolPart;
  interactive?: boolean;
}) {
  if (part.type === "tool-askUser" && part.state === "input-available")
    return (
      <QuestionCard
        id={part.toolCallId}
        input={part.input}
        interactive={interactive}
      />
    );
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <Status text={runningLabel(part)} />;
    case "output-error":
      return <ToolError name={toolNames[part.type]} text={part.errorText} />;
    case "output-available":
      return <ToolOutput part={part} />;
    default:
      return null;
  }
}

export function Status({ text }: { text: string }) {
  return (
    <div className="chat-status" role="status">
      <span className="chat-pulse" aria-hidden />
      <span>{text}…</span>
    </div>
  );
}

function ToolError({ name, text }: { name: string; text: string }) {
  return (
    <div className="chat-tool-error" role="alert">
      <CircleAlert aria-hidden />
      <span>
        <strong>{name}:</strong> {text}
      </span>
    </div>
  );
}

function Sym({ symbol }: { symbol: string }) {
  const { openSymbol } = use(ToolActions);
  return (
    <button
      type="button"
      className="chat-sym"
      onClick={() => openSymbol(symbol)}
      title={`Open ${symbol}`}
    >
      {symbol}
    </button>
  );
}

function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chat-tool">
      <div className="chat-tool-head">
        <span className="kicker">{title}</span>
        {meta ? <span className="chat-tool-meta">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Signed({ value }: { value: number | null | undefined }) {
  return <span className={tone(value)}>{percent(value)}</span>;
}

function ToolOutput({ part }: { part: DonePart }) {
  const failed = (output: { error: unknown }) => (
    <ToolError name={toolNames[part.type]} text={failureText(output)} />
  );
  switch (part.type) {
    case "tool-getQuotes": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Quotes quotes={output} />;
    }
    case "tool-getPriceHistory": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <History data={output} />;
    }
    case "tool-searchSymbols": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Instruments items={output} />
      );
    }
    case "tool-getCompanyFundamentals": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Fundamentals data={output} />
      );
    }
    case "tool-getNews": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <NewsList items={output} />;
    }
    case "tool-getInstitutionalHoldings": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Holdings data={output} />;
    }
    case "tool-getSocialMentions": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Mentions items={output} />;
    }
    case "tool-getPortfolio": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Portfolio data={output} />;
    }
    case "tool-getWatchlists": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Watchlists data={output} />;
    }
    case "tool-remember": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <Remembered data={output} />;
    }
    case "tool-forget": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <p className="chat-chip-line">
          <span className="chip">
            <BookmarkX aria-hidden /> Removed from memory
          </span>
        </p>
      );
    }
    case "tool-updateDesk": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <DeskChip data={output} />;
    }
    case "tool-openView":
      return <ViewChip state={part.output} />;
    case "tool-proposeAlert":
      return <AlertChip data={part.output} />;
    case "tool-webSearch": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <WebResults data={output} />;
    }
    case "tool-createChart": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <div className="chat-tool chat-chart">
          <ChartView chart={output} size="inline" />
        </div>
      );
    }
    case "tool-createReport":
    case "tool-createDeck": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <DocChip data={output} />;
    }
    case "tool-shareReport": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <DocChip data={output} />;
    }
    case "tool-askUser":
      return <Answered input={part.input} output={part.output} />;
    case "tool-getSecurityData": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <SecurityChip symbol={part.input.symbol} kind={part.input.kind} />
      );
    }
  }
}

function QuestionCard({
  id,
  input,
  interactive,
}: {
  id: string;
  input: AskUserInput;
  interactive: boolean;
}) {
  const { answer } = use(ToolActions);
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const multiple = input.multiple ?? false;
  const allowOther = input.allowOther ?? true;
  const submit = (labels: string[], text = other) =>
    answer(id, {
      selected: labels,
      ...(text.trim() ? { other: text.trim().slice(0, 500) } : {}),
    });
  const toggle = (label: string) => {
    if (!multiple) return submit([label], "");
    setSelected((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  };
  const ready = selected.length > 0 || other.trim().length > 0;
  const choose = useEffectEvent((index: number) => {
    const option = input.options[index];
    if (option) toggle(option.label);
  });
  useEffect(() => {
    if (!interactive) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < 6) {
        event.preventDefault();
        choose(index);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive]);
  return (
    <fieldset className="chat-question" disabled={!interactive}>
      <legend>{input.question}</legend>
      {input.context ? <p>{input.context}</p> : null}
      <div className="chat-question-options" role="group">
        {input.options.map((option, index) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={multiple ? selected.includes(option.label) : undefined}
            onClick={() => toggle(option.label)}
          >
            <kbd aria-hidden>{index + 1}</kbd>
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
          </button>
        ))}
      </div>
      {allowOther || multiple ? (
        <form
          className="chat-question-other"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) submit(selected);
          }}
        >
          {allowOther ? (
            <input
              value={other}
              maxLength={500}
              placeholder="Something else…"
              aria-label="Other answer"
              onChange={(event) => setOther(event.target.value)}
            />
          ) : null}
          <button type="submit" disabled={!ready}>
            {multiple ? "Send answers" : "Send"}
          </button>
          <button
            type="button"
            className="chat-question-skip"
            onClick={() => answer(id, { selected: [], skipped: true })}
          >
            Skip
          </button>
        </form>
      ) : (
        <div className="chat-question-other">
          <button
            type="button"
            className="chat-question-skip"
            onClick={() => answer(id, { selected: [], skipped: true })}
          >
            Skip
          </button>
        </div>
      )}
    </fieldset>
  );
}

function Answered({
  input,
  output,
}: {
  input: AskUserInput;
  output: AskUserOutput;
}) {
  const reply = output.skipped
    ? "Skipped"
    : [...output.selected, ...(output.other ? [`“${output.other}”`] : [])].join(
        ", ",
      );
  return (
    <div className="chat-question-answered">
      <span>{input.question}</span>
      <strong>{reply || "No answer"}</strong>
    </div>
  );
}

const securityFns = {
  des: "DES",
  anr: "ANR",
  ern: "ERN",
  hds: "HDS",
  mgmt: "MGMT",
  peers: "RELS",
  splc: "SPLC",
} as const;

function SecurityChip({
  symbol,
  kind,
}: {
  symbol: string;
  kind: keyof typeof securityFns;
}) {
  const { openSecurity } = use(ToolActions);
  const fn = securityFns[kind];
  return (
    <p className="chat-chip-line">
      <button
        type="button"
        className="chip"
        onClick={() => openSecurity(symbol, fn)}
      >
        <LayoutGrid aria-hidden /> {symbol} {fn} <MoveRight aria-hidden />
      </button>
    </p>
  );
}

function DocChip({ data }: { data: PublishedDoc }) {
  const Icon = data.kind === "deck" ? Presentation : FileText;
  return (
    <div className="chat-doc">
      <p className="chat-doc-title">
        <Icon aria-hidden />
        <span>
          <a href={data.previewUrl} target="_blank" rel="noopener">
            {data.title}
          </a>
          <span className="chat-doc-kind">
            {data.kind === "deck" ? "Deck" : "Report"} · saved to Reports
          </span>
        </span>
      </p>
      <ShareControl
        id={data.id}
        shareUrl={data.shareUrl}
        previewUrl={data.previewUrl}
        compact
      />
    </div>
  );
}

function latest(times: readonly number[]) {
  const valid = times.filter((time) => time > 0);
  return valid.length ? Math.max(...valid) : 0;
}

function Quotes({ quotes }: { quotes: Success<"getQuotes"> }) {
  const time = latest(quotes.map((quote) => quote.time));
  return (
    <Block
      title={quotes.length === 1 ? "Quote" : `Quotes · ${quotes.length}`}
      meta={time ? `As of ${stamp(time * 1000)}` : undefined}
    >
      <table className="data-table chat-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="chat-col-name">Name</th>
            <th className="num">Last</th>
            <th className="num">Chg</th>
            <th className="num chat-col-wide">52w range</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.symbol}>
              <td>
                <Sym symbol={quote.symbol} />
              </td>
              <td className="chat-col-name chat-truncate">{quote.name}</td>
              <td className="num">
                {amount(quote.price)}{" "}
                <span className="chat-ccy">{quote.currency}</span>
              </td>
              <td className="num">
                <Signed value={quote.percent} />
              </td>
              <td className="num chat-col-wide muted">
                {quote.yearLow != null && quote.yearHigh != null
                  ? `${amount(quote.yearLow)}–${amount(quote.yearHigh)}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

function History({ data }: { data: Success<"getPriceHistory"> }) {
  return (
    <Block
      title={`${data.range} history`}
      meta={[data.source, data.asOf ? stamp(data.asOf) : ""]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className="chat-history">
        <Sym symbol={data.symbol} />
        <Sparkline
          points={data.points}
          label={`${data.symbol} ${data.range} closes, ${percent(data.changePercent)}`}
        />
        <div className="chat-history-figures">
          <span className="num">
            {amount(data.last.c)}{" "}
            <span className="chat-ccy">{data.currency ?? ""}</span>
          </span>
          <Signed value={data.changePercent} />
        </div>
        <span className="chat-history-range muted">
          L {amount(data.low)} · H {amount(data.high)}
        </span>
      </div>
    </Block>
  );
}

function Instruments({ items }: { items: Success<"searchSymbols"> }) {
  if (!items.length)
    return <p className="chat-quiet">No matching instruments.</p>;
  return (
    <Block title="Matches">
      <ul className="ruled-list chat-list">
        {items.map((item) => (
          <li key={item.symbol} className="chat-row">
            <Sym symbol={item.symbol} />
            <span className="chat-truncate">{item.name}</span>
            <span className="meta">
              {[item.exchange, item.type].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function factValue(value: number, unit: string) {
  if (/shares/i.test(unit) && /usd/i.test(unit)) return `$${amount(value)}`;
  if (/^usd$/i.test(unit)) return `$${compact(value)}`;
  return `${compact(value)} ${unit}`;
}

function Fundamentals({ data }: { data: Success<"getCompanyFundamentals"> }) {
  const filings = data.filings.slice(0, 4);
  return (
    <Block
      title={data.company}
      meta={
        <a href={data.url} target="_blank" rel="noopener noreferrer">
          {data.source} · CIK {data.cik}
        </a>
      }
    >
      {data.facts.length ? (
        <dl className="kv chat-kv">
          {data.facts.map((fact) => (
            <div key={fact.label} className="chat-kv-row">
              <dt>
                {fact.label}{" "}
                <span className="chat-ccy">
                  {fact.form} {fact.period}
                </span>
              </dt>
              <dd className="num">{factValue(fact.value, fact.unit)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {filings.length ? (
        <ul className="ruled-list chat-list chat-filings">
          {filings.map((filing) => (
            <li key={filing.url} className="chat-row">
              <span className="tag">{filing.form}</span>
              <a href={filing.url} target="_blank" rel="noopener noreferrer">
                Filed {filing.filed}
                {filing.report ? ` · period ${filing.report}` : ""}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </Block>
  );
}

function NewsList({ items }: { items: Success<"getNews"> }) {
  const now = useNow();
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="chat-quiet">No recent headlines.</p>;
  const shown = all ? items : items.slice(0, 6);
  return (
    <Block title={`Headlines · ${items.length}`}>
      <ul className="ruled-list chat-list">
        {shown.map((item) => (
          <li key={item.url || item.title} className="chat-news">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
            <span className="meta">
              <Sym symbol={item.symbol} /> · {item.publisher}
              {item.time ? ` · ${ago(item.time * 1000, now)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {items.length > shown.length ? (
        <button
          type="button"
          className="chat-more"
          onClick={() => setAll(true)}
        >
          {items.length - shown.length} more headlines
        </button>
      ) : null}
    </Block>
  );
}

function Holdings({ data }: { data: Success<"getInstitutionalHoldings"> }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.holdings : data.holdings.slice(0, 10);
  return (
    <Block
      title={`${data.manager} · 13F`}
      meta={
        <a href={data.url} target="_blank" rel="noopener noreferrer">
          Period {data.period} · filed {data.filed}
          {data.amended ? " · amended" : ""}
        </a>
      }
    >
      <table className="data-table chat-table">
        <thead>
          <tr>
            <th>Issuer</th>
            <th className="num">Value</th>
            <th className="num">Weight</th>
            <th className="num chat-col-wide">Shares</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item) => (
            <tr key={`${item.cusip}-${item.putCall ?? ""}`}>
              <td className="chat-truncate">
                {item.name}
                {item.putCall ? (
                  <span className="tag chat-inline-tag">{item.putCall}</span>
                ) : null}
              </td>
              <td className="num">${compact(item.value)}</td>
              <td className="num">
                {item.weightPercent == null
                  ? "—"
                  : `${amount(item.weightPercent)}%`}
              </td>
              <td className="num chat-col-wide muted">
                {compact(item.shares)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="chat-tool-foot">
        <span>
          {data.positionCount} positions · ${compact(data.totalValue)}{" "}
          {data.currency}
        </span>
        {data.holdings.length > shown.length ? (
          <button
            type="button"
            className="chat-more"
            onClick={() => setAll(true)}
          >
            Show top {data.holdings.length}
          </button>
        ) : null}
      </div>
    </Block>
  );
}

function Mentions({ items }: { items: Success<"getSocialMentions"> }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 10);
  return (
    <Block title="WallStreetBets · 24h" meta="ApeWisdom">
      <table className="data-table chat-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Symbol</th>
            <th className="chat-col-name">Name</th>
            <th className="num">Mentions</th>
            <th className="num">vs prior</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item) => {
            const delta = item.prior
              ? ((item.count - item.prior) / item.prior) * 100
              : null;
            return (
              <tr key={item.symbol}>
                <td className="num muted">{item.rank}</td>
                <td>
                  <Sym symbol={item.symbol} />
                </td>
                <td className="chat-col-name chat-truncate">{item.name}</td>
                <td className="num">{number(item.count)}</td>
                <td className="num">
                  <Signed value={delta} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length > shown.length ? (
        <button
          type="button"
          className="chat-more"
          onClick={() => setAll(true)}
        >
          Show all {items.length}
        </button>
      ) : null}
    </Block>
  );
}

function Portfolio({ data }: { data: Success<"getPortfolio"> }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.positions : data.positions.slice(0, 12);
  if (!data.positions.length)
    return <p className="chat-quiet">No open positions in {data.scope}.</p>;
  return (
    <Block title={data.scope} meta={`${data.source} · ${stamp(data.asOf)}`}>
      <div className="stat-row chat-totals">
        {data.totalsByCurrency.map((total) => (
          <div className="figure" key={total.currency}>
            <span className="figure-label">
              {total.currency} · {total.positions} pos
            </span>
            <strong className="figure-value">
              {amount(total.marketValue)}
            </strong>
            <span className="figure-sub">
              Day <Signed value={total.dayChangePercent} /> · Unrl{" "}
              <Signed value={total.unrealizedPercent} />
            </span>
          </div>
        ))}
      </div>
      <table className="data-table chat-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="num">Price</th>
            <th className="num">Value</th>
            <th className="num">Day</th>
            <th className="num chat-col-wide">Unrl</th>
            <th className="num">Wt</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((position) => (
            <tr key={`${position.symbol}:${position.currency}`}>
              <td>
                <Sym symbol={position.symbol} />
              </td>
              <td className="num">{amount(position.price)}</td>
              <td className="num">
                {compact(position.marketValue)}{" "}
                <span className="chat-ccy">{position.currency}</span>
              </td>
              <td className="num">
                <Signed value={position.dayChangePercent} />
              </td>
              <td className="num chat-col-wide">
                <Signed value={position.unrealizedPercent} />
              </td>
              <td className="num muted">
                {position.weightInCurrencyPercent == null
                  ? "—"
                  : `${amount(position.weightInCurrencyPercent)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="chat-tool-foot">
        <span>Weights within currency · totals never converted</span>
        {data.positions.length > shown.length ? (
          <button
            type="button"
            className="chat-more"
            onClick={() => setAll(true)}
          >
            All {data.positions.length} positions
          </button>
        ) : null}
      </div>
    </Block>
  );
}

function Watchlists({ data }: { data: Success<"getWatchlists"> }) {
  if (!data.watchlists.length)
    return <p className="chat-quiet">No watchlists yet.</p>;
  return (
    <Block title="Watchlists" meta={`${data.source} · ${stamp(data.asOf)}`}>
      {data.watchlists.map((list) => (
        <div key={list.id} className="chat-watchlist">
          <div className="chat-watchlist-name">
            {list.name} <span className="muted">· {list.size}</span>
          </div>
          {list.quotes.length ? (
            <ul className="chat-quote-strip">
              {list.quotes.slice(0, 10).map((quote) => (
                <li key={quote.symbol}>
                  <Sym symbol={quote.symbol} />
                  <span className="num">{amount(quote.price)}</span>
                  <Signed value={quote.changePercent} />
                </li>
              ))}
              {list.quotes.length > 10 ? (
                <li className="muted">+{list.quotes.length - 10}</li>
              ) : null}
            </ul>
          ) : (
            <p className="chat-quiet">No live quotes.</p>
          )}
        </div>
      ))}
    </Block>
  );
}

function Remembered({ data }: { data: Success<"remember"> }) {
  const [state, setState] = useState<"saved" | "removing" | "removed">("saved");
  const [error, setError] = useState("");
  async function undo() {
    setState("removing");
    setError("");
    try {
      const response = await fetch(`${memoriesKey}/${data.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404)
        throw new Error("Could not undo.");
      setState("removed");
      void mutate(memoriesKey);
    } catch {
      setState("saved");
      setError("Undo failed");
    }
  }
  if (state === "removed")
    return (
      <p className="chat-chip-line">
        <span className="chip muted">
          <BookmarkX aria-hidden /> Memory discarded
        </span>
      </p>
    );
  return (
    <p className="chat-chip-line">
      <span className="chip chat-memory-chip" title={data.content}>
        <BookmarkCheck aria-hidden />
        <span className="chat-truncate">Saved to memory: {data.content}</span>
      </span>
      <button
        type="button"
        className="chat-link-button"
        onClick={() => void undo()}
        disabled={state === "removing"}
      >
        <Undo2 aria-hidden /> Undo
      </button>
      {error ? <span className="negative">{error}</span> : null}
    </p>
  );
}

function DeskChip({ data }: { data: Success<"updateDesk"> }) {
  return (
    <p className="chat-chip-line">
      <span className="chip">
        <LayoutGrid aria-hidden /> Desk updated · {data.widgets.length} widgets
      </span>
    </p>
  );
}

function ViewChip({ state }: { state: DashboardState }) {
  const target = [
    viewNames[state.view],
    state.ticker,
    state.symbols?.length ? listSymbols(state.symbols) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="chat-chip-line">
      <span className="chip">
        <MoveRight aria-hidden /> Opened {target}
      </span>
    </p>
  );
}

function AlertChip({ data }: { data: Success<"proposeAlert"> }) {
  const { proposeAlert } = use(ToolActions);
  return (
    <p className="chat-chip-line">
      <span className="chip">
        <BellPlus aria-hidden /> Alert proposed: {data.symbol} {data.direction}{" "}
        {amount(data.target)} {data.currency ?? ""}
      </span>
      {data.price != null ? (
        <span className="meta">
          Last {amount(data.price)} {data.currency ?? ""}
        </span>
      ) : null}
      <button
        type="button"
        className="chat-link-button"
        onClick={() =>
          proposeAlert({
            symbol: data.symbol,
            direction: data.direction,
            target: data.target,
          })
        }
      >
        Review
      </button>
    </p>
  );
}

function WebResults({ data }: { data: Success<"webSearch"> }) {
  if (!data.results.length)
    return <p className="chat-quiet">The web search returned nothing.</p>;
  return (
    <Block title={`Web · ${data.results.length} sources`}>
      <ol className="chat-sources">
        {data.results.map((result) => (
          <li key={result.url}>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.title || hostOf(result.url)}
              <ArrowUpRight aria-hidden />
            </a>
            <span className="meta">
              {hostOf(result.url)}
              {result.date ? ` · ${result.date}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

export function SourceList({
  sources,
}: {
  sources: readonly { url: string; title?: string }[];
}) {
  if (!sources.length) return null;
  return (
    <div className="chat-tool">
      <div className="chat-tool-head">
        <span className="kicker">Sources</span>
      </div>
      <ol className="chat-sources">
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title || hostOf(source.url)}
              <ArrowUpRight aria-hidden />
            </a>
            <span className="meta">{hostOf(source.url)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

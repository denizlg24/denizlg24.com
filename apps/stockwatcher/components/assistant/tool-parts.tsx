"use client";

import type { InferUITools } from "ai";
import {
  Activity,
  ArrowUpRight,
  BellPlus,
  BookmarkCheck,
  BookmarkX,
  CalendarDays,
  CircleAlert,
  Database,
  FileText,
  FlaskConical,
  Globe,
  LayoutGrid,
  MoveRight,
  Newspaper,
  PenLine,
  Presentation,
  TrendingUp,
  Undo2,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { mutate } from "swr";
import {
  Question,
  QuestionActions,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  QuestionSubmit,
  type QuestionValue,
} from "@/components/ai-elements/question";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { isToolRunning, Tool, ToolStatus } from "@/components/ai-elements/tool";
import { ChartView } from "@/components/reports/chart";
import { ShareControl } from "@/components/reports/share-control";
import { Button } from "@/components/ui/button";
import type { StockwatcherMessage, StockwatcherTools } from "@/lib/ai/tools";
import { formatTarget, metricLabels } from "@/lib/alerts";
import type {
  AskUserInput,
  AskUserOutput,
  DashboardState,
} from "@/lib/assistant-types";
import type { AlertMetric } from "@/lib/models";
import type { PublishedDoc } from "@/lib/reports/types";
import { amount, compact, number, percent, tone } from "@/lib/utils";
import { DocumentHits, DocumentList, DocumentRead } from "./document-parts";
import { ago, hostOf, listSymbols, stamp, useNow } from "./format";
import { memoriesKey } from "./memory-panel";
import {
  ActivistStakesView,
  InsiderBuyingView,
  PortfolioRiskView,
} from "./risk-parts";
import { Sparkline } from "./sparkline";
import { Block } from "./tool-block";

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
  metric?: AlertMetric;
  repeat?: "once" | "rearm";
  note?: string;
  expires?: string;
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
  "tool-getPortfolioHistory": "Portfolio history",
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
  "tool-getWorkspace": "Workspace",
  "tool-getNote": "Note",
  "tool-listDocuments": "Documents",
  "tool-searchDocuments": "Documents",
  "tool-readDocument": "Documents",
  "tool-manageWatchlists": "Watchlists",
  "tool-manageAlerts": "Alerts",
  "tool-manageSignals": "Signals",
  "tool-manageRoutines": "Routines",
  "tool-manageNotes": "Notes",
  "tool-managePortfolios": "Portfolios",
  "tool-manageDrawings": "Drawings",
  "tool-manageOverlays": "Overlays",
  "tool-manageScreens": "Screens",
  "tool-manageRelations": "Relationships",
  "tool-manageChartTemplates": "Chart templates",
  "tool-updateSettings": "Settings",
  "tool-getTechnicals": "Technicals",
  "tool-getMarketOverview": "World indices",
  "tool-getMarketMovers": "Market movers",
  "tool-getEarningsCalendar": "Earnings calendar",
  "tool-getMacroCalendar": "Macro calendar",
  "tool-getRiskAnalytics": "Risk analytics",
  "tool-getNewsWire": "News wire",
  "tool-backtestStrategy": "Backtest",
  "tool-compute": "Compute",
  "tool-getPortfolioRisk": "Portfolio risk",
  "tool-getInsiderBuying": "Insider buying",
  "tool-getActivistStakes": "Activist stakes",
  "tool-getYieldCurve": "Yield curve",
  "tool-getFearGreed": "Fear & Greed",
  "tool-getFearGreedHistory": "Fear & Greed history",
  "tool-readFiling": "Filing",
  "tool-getOptions": "Options",
  "tool-getCongressTrades": "Congress trades",
  "tool-getCongressMember": "Congress member",
  "tool-getCongressHolders": "Congress holders",
  "tool-getTrumpTrades": "Presidential trades",
  "tool-getGovernmentContracts": "Government contracts",
  "tool-getCorporatePacs": "Corporate PACs",
  "tool-getOffExchangeVolume": "Off-exchange volume",
  "tool-getOffExchangeLeaders": "Off-exchange leaders",
  "tool-getPolymarketTrades": "Polymarket trades",
  "tool-getPolymarketMarkets": "Polymarket markets",
  "tool-getWarnNotices": "Layoff notices",
  "tool-getAppStoreRatings": "App ratings",
  "tool-getWikipediaAttention": "Wikipedia attention",
  "tool-getWsbAttention": "WallStreetBets attention",
  "tool-getGooglePlayRatings": "Google Play ratings",
  "tool-getCorporateFlights": "Corporate flights",
  "tool-getManagerHoldings": "13F holdings",
  "tool-getManagerChanges": "13F changes",
  "tool-searchFundManagers": "Fund managers",
  "tool-getInstitutionalHolders": "13F holders",
  "tool-getExecutiveCompensation": "Executive pay",
  "tool-getEtfHoldings": "ETF holdings",
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
    case "tool-getPortfolioHistory":
      return part.input?.date
        ? `Rebuilding your book on ${part.input.date}`
        : "Rebuilding your book day by day";
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
    case "tool-getWorkspace":
      return "Reading your workspace";
    case "tool-getNote":
      return "Reading note";
    case "tool-listDocuments":
      return "Listing your documents";
    case "tool-searchDocuments":
      return "Searching your documents";
    case "tool-readDocument":
      return "Reading document";
    case "tool-manageWatchlists":
      return "Updating watchlist";
    case "tool-manageAlerts":
      return part.input?.symbol
        ? `Updating ${part.input.symbol} alert`
        : "Updating alerts";
    case "tool-manageSignals":
      return part.input?.action === "test"
        ? "Testing signal"
        : "Updating signals";
    case "tool-manageRoutines":
      return part.input?.name
        ? `Saving routine “${part.input.name}”`
        : "Updating routines";
    case "tool-manageNotes":
      return part.input?.title
        ? `Saving note “${part.input.title}”`
        : "Updating notes";
    case "tool-managePortfolios":
      return "Updating portfolio";
    case "tool-manageDrawings":
      return part.input?.symbol
        ? `Updating ${part.input.symbol} drawings`
        : "Updating drawings";
    case "tool-manageOverlays":
      return "Updating overlays";
    case "tool-manageScreens":
      return "Updating screens";
    case "tool-manageRelations":
      return "Updating relationship notes";
    case "tool-manageChartTemplates":
      return "Updating chart templates";
    case "tool-updateSettings":
      return "Updating settings";
    case "tool-getTechnicals":
      return part.input?.symbol
        ? `Computing ${part.input.symbol} technicals`
        : "Computing technicals";
    case "tool-getMarketOverview":
      return "Loading world indices";
    case "tool-getMarketMovers":
      return "Scanning market movers";
    case "tool-getEarningsCalendar":
      return "Loading earnings calendar";
    case "tool-getMacroCalendar":
      return "Loading macro calendar";
    case "tool-getRiskAnalytics": {
      const symbols = listSymbols(part.input?.symbols);
      return symbols ? `Measuring ${symbols} risk` : "Measuring risk";
    }
    case "tool-getNewsWire":
      return "Reading the news wire";
    case "tool-backtestStrategy":
      return part.input?.symbol
        ? `Backtesting ${part.input.symbol}`
        : "Backtesting strategy";
    case "tool-compute":
      return part.input?.description ?? "Computing";
    case "tool-getPortfolioRisk":
      return part.input?.analysis
        ? `Running ${{ factors: "factor exposure", attribution: "attribution", stress: "stress tests", var: "VaR" }[part.input.analysis]} on your book`
        : "Measuring portfolio risk";
    case "tool-getInsiderBuying":
      return "Screening SEC Form 4 insider purchases";
    case "tool-getActivistStakes":
      return "Scanning SEC 13D filings";
    case "tool-getYieldCurve":
      return "Loading the Treasury yield curve";
    case "tool-getFearGreed":
      return "Reading CNN Fear & Greed";
    case "tool-getFearGreedHistory":
      return "Reading Fear & Greed history";
    case "tool-readFiling":
      return part.input?.symbol
        ? `Reading ${part.input.symbol} ${part.input.form ?? "filing"}${part.input.section ? ` · ${part.input.section}` : ""}`
        : "Reading filing";
    case "tool-getOptions":
      return part.input?.symbol
        ? `Reading ${part.input.symbol} options chain`
        : "Reading options chain";
    case "tool-getCongressTrades":
    case "tool-getCongressMember":
    case "tool-getCongressHolders":
    case "tool-getTrumpTrades":
    case "tool-getGovernmentContracts":
    case "tool-getCorporatePacs":
    case "tool-getOffExchangeVolume":
    case "tool-getOffExchangeLeaders":
    case "tool-getPolymarketTrades":
    case "tool-getPolymarketMarkets":
    case "tool-getWarnNotices":
    case "tool-getAppStoreRatings":
    case "tool-getWikipediaAttention":
    case "tool-getWsbAttention":
    case "tool-getGooglePlayRatings":
    case "tool-getCorporateFlights":
    case "tool-getManagerHoldings":
    case "tool-getManagerChanges":
    case "tool-searchFundManagers":
    case "tool-getInstitutionalHolders":
    case "tool-getExecutiveCompensation":
    case "tool-getEtfHoldings":
      return `Reading ${toolNames[part.type].toLowerCase()}`;
  }
}

export function ToolPartView({
  part,
  interactive = false,
}: {
  part: ToolPart;
  interactive?: boolean;
}) {
  return (
    <Tool state={part.state} data-tool={part.type.slice(5)}>
      {part.type === "tool-askUser" && part.state === "input-available" ? (
        <QuestionCard
          id={part.toolCallId}
          input={part.input}
          interactive={interactive}
        />
      ) : part.state === "output-available" ? (
        <ToolOutput part={part} />
      ) : part.state === "output-error" ? (
        <ToolError name={toolNames[part.type]} text={part.errorText} />
      ) : isToolRunning(part.state) ? (
        <ToolStatus text={runningLabel(part)} />
      ) : null}
    </Tool>
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
    case "tool-getPortfolioHistory": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <PortfolioHistory data={output} />
      );
    }
    case "tool-getOptions": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <OptionsSummary data={output} />
      );
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
    case "tool-updateSettings": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip icon={<PenLine aria-hidden />} text={output.summary} />
      );
    }
    case "tool-getWorkspace": {
      const output = part.output;
      if (isFailure(output)) return failed(output);
      const read = Object.keys(output).filter((key) => key !== "counts");
      return (
        <Chip
          icon={<Database aria-hidden />}
          text={`Read workspace: ${read.join(", ")}`}
        />
      );
    }
    case "tool-listDocuments": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <DocumentList count={output.documents.length} />
      );
    }
    case "tool-searchDocuments": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <DocumentHits query={output.query} results={output.results} />
      );
    }
    case "tool-readDocument": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <DocumentRead
          name={output.name}
          fromPage={output.fromPage}
          toPage={output.toPage}
        />
      );
    }
    case "tool-getNote": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<FileText aria-hidden />}
          text={`Read note “${output.title}”`}
        />
      );
    }
    case "tool-getTechnicals": {
      const output = part.output;
      if (isFailure(output)) return failed(output);
      const text = [
        output.signals.vsSma200 && `${output.signals.vsSma200} 200d`,
        output.signals.rsiZone && `RSI ${output.signals.rsiZone}`,
        output.signals.lastCross &&
          `${output.signals.lastCross.type} cross ${output.signals.lastCross.barsAgo} bars ago`,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <Chip
          icon={<Activity aria-hidden />}
          text={`${output.symbol} ${output.range} technicals${text ? ` · ${text}` : ""}`}
        />
      );
    }
    case "tool-getMarketOverview": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<Globe aria-hidden />}
          text={`World indices · ${output.regions.reduce((sum, region) => sum + region.indices.length, 0)} quotes`}
        />
      );
    }
    case "tool-getMarketMovers": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<TrendingUp aria-hidden />}
          text={`Movers · ${output.source}${"universe" in output && output.universe ? ` · ${output.universe}` : ""}`}
        />
      );
    }
    case "tool-getEarningsCalendar": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<CalendarDays aria-hidden />}
          text={`Earnings ${output.from} to ${output.through} · ${output.events.length} reports`}
        />
      );
    }
    case "tool-getMacroCalendar": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<CalendarDays aria-hidden />}
          text={
            "series" in output && output.series
              ? `Macro · ${output.series.name}`
              : `Next FOMC ${output.upcomingFomc[0] ?? "n/a"}`
          }
        />
      );
    }
    case "tool-getRiskAnalytics": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<Activity aria-hidden />}
          text={`Risk · ${listSymbols(output.symbols.map((item) => item.symbol))} · ${output.years}y vs ${output.benchmark}`}
        />
      );
    }
    case "tool-getNewsWire": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<Newspaper aria-hidden />}
          text={`News wire · ${output.scope} · ${output.items.length} headlines`}
        />
      );
    }
    case "tool-getYieldCurve": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <YieldCurve data={output} />;
    }
    case "tool-getFearGreed": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <FearGreedRead data={output} />
      );
    }
    case "tool-getFearGreedHistory": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<Activity aria-hidden />}
          text={`Fear & Greed · ${output.range} · ${output.readings} readings · latest ${output.latest.score} ${output.latest.rating}`}
        />
      );
    }
    case "tool-readFiling": {
      const output = part.output;
      return isFailure(output) ? failed(output) : <FilingRead data={output} />;
    }
    case "tool-getPortfolioRisk": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <PortfolioRiskView data={output} />
      );
    }
    case "tool-getInsiderBuying": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <InsiderBuyingView data={output} />
      );
    }
    case "tool-getActivistStakes": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <ActivistStakesView data={output} />
      );
    }
    case "tool-compute": {
      const output = part.output;
      return isFailure(output) ? (
        <ComputeFailure
          description={part.input.description}
          code={part.input.code}
          error={failureText(output)}
        />
      ) : (
        <Compute input={part.input} output={output} />
      );
    }
    case "tool-backtestStrategy": {
      const output = part.output;
      return isFailure(output) ? (
        failed(output)
      ) : (
        <Chip
          icon={<FlaskConical aria-hidden />}
          text={`${output.symbol} ${output.strategy} · ${output.stats.totalReturnPercent ?? "n/a"}% vs ${output.stats.buyAndHoldPercent ?? "n/a"}% hold`}
        />
      );
    }
  }
}

type ComputeInput = Tools["compute"]["input"];
type ComputeResult = Success<"compute">["result"];
type Cell = string | number | boolean | null;

const isCell = (value: ComputeResult): value is Cell =>
  value === null || typeof value !== "object";
const isRecord = (
  value: ComputeResult,
): value is { [key: string]: ComputeResult } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 12;
const PREVIEW_CHARS = 1200;

function cellText(value: Cell | undefined) {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(Number(value.toPrecision(5)));
}

function tabulate(result: ComputeResult) {
  if (isRecord(result)) {
    const entries = Object.entries(result);
    const rows = entries.flatMap(([key, value]): Cell[][] =>
      isCell(value) ? [[key, value]] : [],
    );
    if (rows.length !== entries.length || rows.length === 0 || rows.length > 40)
      return null;
    return { columns: ["Field", "Value"], rows, total: rows.length };
  }
  if (!Array.isArray(result) || result.length === 0) return null;
  const records = result.filter(isRecord);
  if (records.length !== result.length) return null;
  if (!records.every((record) => Object.values(record).every(isCell)))
    return null;
  const columns = [
    ...new Set(records.flatMap((record) => Object.keys(record))),
  ];
  if (columns.length === 0 || columns.length > MAX_TABLE_COLUMNS) return null;
  return {
    columns,
    rows: records.slice(0, MAX_TABLE_ROWS).map((record) =>
      columns.map((column) => {
        const value = record[column];
        return value !== undefined && isCell(value) ? value : null;
      }),
    ),
    total: records.length,
  };
}

function ComputeResultView({ result }: { result: ComputeResult }) {
  const table = tabulate(result);
  if (table)
    return (
      <>
        <div className="chat-compute-scroll">
          <table className="data-table chat-table">
            <thead>
              <tr>
                {table.columns.map((column, i) => (
                  <th key={column} className={i === 0 ? undefined : "num"}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={table.columns[c]}
                      className={c === 0 ? undefined : "num"}
                    >
                      {cellText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.total > table.rows.length ? (
          <p className="muted chat-compute-note">
            Showing {table.rows.length} of {table.total} rows
          </p>
        ) : null}
      </>
    );
  if (isCell(result))
    return <p className="chat-compute-value">{cellText(result)}</p>;
  const pretty = JSON.stringify(result, null, 2);
  if (pretty.length <= PREVIEW_CHARS)
    return <pre className="chat-compute-code">{pretty}</pre>;
  return (
    <details className="chat-compute-details">
      <summary>
        <pre className="chat-compute-code">
          {pretty.slice(0, PREVIEW_CHARS)}…
        </pre>
        <span className="muted">Expand full result</span>
      </summary>
      <pre className="chat-compute-code">{pretty}</pre>
    </details>
  );
}

function ComputeCode({ code }: { code: string }) {
  return (
    <details className="chat-compute-details">
      <summary>Code</summary>
      <pre className="chat-compute-code">{code}</pre>
    </details>
  );
}

function Compute({
  input,
  output,
}: {
  input: ComputeInput;
  output: Success<"compute">;
}) {
  const stats = [
    output.symbols > 0 ? `${output.symbols} symbols` : null,
    output.missingCount > 0 ? `${output.missingCount} missing` : null,
    `${(output.ms / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  return (
    <Block title="Compute" meta={stats.join(" · ")}>
      <p className="chat-compute-title">{output.description}</p>
      <ComputeResultView result={output.result} />
      {output.missingCount > 0 ? (
        <p
          className="muted chat-compute-note"
          title={output.missing.join(", ")}
        >
          No data for {output.missing.slice(0, 8).join(", ")}
          {output.missingCount > 8
            ? ` and ${output.missingCount - 8} more`
            : ""}
        </p>
      ) : null}
      <ComputeCode code={input.code} />
      <div className="chat-tool-foot">
        <span>{output.source}</span>
        <span>As of {stamp(Date.parse(output.asOf))}</span>
      </div>
    </Block>
  );
}

function ComputeFailure({
  description,
  code,
  error,
}: {
  description: string;
  code: string;
  error: string;
}) {
  return (
    <Block title="Compute" meta="failed">
      <p className="chat-compute-title">{description}</p>
      <ToolError name="Compute" text={error} />
      <ComputeCode code={code} />
    </Block>
  );
}

function Chip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <p className="chat-chip-line">
      <span className="chip" title={text}>
        {icon}
        <span className="chat-truncate">{text}</span>
      </span>
    </p>
  );
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
  const [value, setValue] = useState<QuestionValue>({
    selectedValues: [],
    text: "",
  });
  const multiple = input.multiple ?? false;
  const allowOther = input.allowOther ?? true;
  const submit = (labels: readonly string[], text = value.text) =>
    answer(id, {
      selected: [...labels],
      ...(text.trim() ? { other: text.trim().slice(0, 500) } : {}),
    });
  const skip = () => answer(id, { selected: [], skipped: true });
  const pick = (label: string) => {
    if (multiple)
      setValue((current) => ({
        ...current,
        selectedValues: current.selectedValues.includes(label)
          ? current.selectedValues.filter((item) => item !== label)
          : [...current.selectedValues, label],
      }));
    else submit([label], "");
  };
  const choose = useEffectEvent((index: number) => {
    const option = input.options[index];
    if (option) pick(option.label);
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
    <Question
      aria-label={input.question}
      disabled={!interactive}
      selectionMode={multiple ? "multiple" : "single"}
      value={value}
      onValueChange={setValue}
      onSubmit={(response) => submit(response.selectedValues, response.text)}
    >
      <QuestionPrompt>{input.question}</QuestionPrompt>
      {input.context ? (
        <QuestionDescription>{input.context}</QuestionDescription>
      ) : null}
      <QuestionOptions>
        {input.options.map((option, index) => (
          <QuestionOption
            key={option.label}
            value={option.label}
            onClick={multiple ? undefined : () => submit([option.label], "")}
          >
            <kbd
              aria-hidden
              className="grid size-[18px] place-items-center rounded-sm border border-input font-[inherit] text-[11px] text-muted-foreground"
            >
              {index + 1}
            </kbd>
            <span className="grid gap-px">
              <strong className="font-semibold text-[13px]">
                {option.label}
              </strong>
              {option.description ? (
                <small className="text-muted-foreground text-xs">
                  {option.description}
                </small>
              ) : null}
            </span>
          </QuestionOption>
        ))}
      </QuestionOptions>
      <QuestionActions>
        {allowOther ? (
          <QuestionInput
            maxLength={500}
            placeholder="Something else…"
            aria-label="Other answer"
          />
        ) : null}
        {allowOther || multiple ? (
          <QuestionSubmit>{multiple ? "Send answers" : "Send"}</QuestionSubmit>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          disabled={!interactive}
          onClick={skip}
        >
          Skip
        </Button>
      </QuestionActions>
    </Question>
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
      <div className="chat-table-scroll">
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
      </div>
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
      <div className="chat-table-scroll">
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
      </div>
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
      <div className="chat-table-scroll">
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
      </div>
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

function PortfolioHistory({ data }: { data: Success<"getPortfolioHistory"> }) {
  const [all, setAll] = useState(false);
  const curve = [
    ...data.days.map((day) => ({
      t: Date.parse(`${day.date}T00:00:00Z`) / 1000,
      c: day.value,
    })),
  ];
  const listed = data.focus ? data.focus.positions : data.positions;
  const limit = all ? listed.length : 12;
  const rows = data.focus
    ? data.focus.positions.slice(0, limit).map((position) => ({
        symbol: position.symbol,
        change: position.change,
        sub: position.priceChangePercent,
        stale: position.stale,
      }))
    : data.positions.slice(0, limit).map((position) => ({
        symbol: position.symbol,
        change: position.pnl,
        sub: position.contributionPercent,
        stale: false,
      }));
  return (
    <Block
      title={`Book · ${data.window.from} → ${data.window.to}`}
      meta={`${data.base} · ${data.sampled ?? "daily"} · ${data.source} · as of ${data.asOf}`}
    >
      <div className="stat-row chat-totals">
        <div className="figure">
          <span className="figure-label">Period P&L · {data.base}</span>
          <strong className={`figure-value ${tone(data.period.pnl)}`}>
            {amount(data.period.pnl)}
          </strong>
          <span className="figure-sub">
            TWR <Signed value={data.period.timeWeightedReturnPercent} />
            {data.period.netFlows
              ? ` · flows ${amount(data.period.netFlows)}`
              : ""}
          </span>
        </div>
        <div className="figure">
          <span className="figure-label">
            Unrealised incl. FX
            {data.costBasis.unrealized != null && !data.costBasis.complete
              ? " · partial"
              : ""}
          </span>
          <strong className={`figure-value ${tone(data.costBasis.unrealized)}`}>
            {data.costBasis.unrealized == null
              ? "n/a"
              : amount(data.costBasis.unrealized)}
          </strong>
          <span className="figure-sub">
            {data.costBasis.unrealized == null
              ? "no purchase dates"
              : `price ${amount(data.costBasis.priceEffect)} · FX ${amount(data.costBasis.fxEffect)}`}
          </span>
        </div>
        {data.focus ? (
          <div className="figure">
            <span className="figure-label">{data.focus.date}</span>
            <strong className={`figure-value ${tone(data.focus.change)}`}>
              {amount(data.focus.change)}
            </strong>
            <span className="figure-sub">
              <Signed value={data.focus.changePercent} /> vs{" "}
              {data.focus.previousDate}
            </span>
          </div>
        ) : null}
        <Sparkline points={curve} label={`Book value in ${data.base}`} />
      </div>
      {rows.length ? (
        <div className="chat-table-scroll">
          <table className="data-table chat-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">
                  {data.focus ? `P&L ${data.focus.date}` : "Period P&L"}
                </th>
                <th className="num">{data.focus ? "Price" : "Contrib."}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol}>
                  <td>
                    <Sym symbol={row.symbol} />
                    {row.stale ? (
                      <span className="chat-quiet"> no trade</span>
                    ) : null}
                  </td>
                  <td className={`num ${tone(row.change)}`}>
                    {amount(row.change)}
                  </td>
                  <td className="num">
                    <Signed value={row.sub} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {listed.length > 12 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setAll((open) => !open)}
        >
          {all ? "Show fewer" : `Show all ${listed.length}`}
        </Button>
      ) : null}
      {data.costBasis.excluded.length ? (
        <p className="chat-quiet">
          Left out of the FX-inclusive figure:{" "}
          {data.costBasis.excluded
            .map((item) => `${item.symbol} (${item.reason})`)
            .join(", ")}
          .
        </p>
      ) : null}
      {data.missing.length ? (
        <p className="chat-quiet">
          No price or FX for {data.missing.join(", ")}.
        </p>
      ) : null}
    </Block>
  );
}

function Portfolio({ data }: { data: Success<"getPortfolio"> }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.positions : data.positions.slice(0, 12);
  const fxAsOf = data.base.fx.find((fx) => fx.asOf)?.asOf;
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
      {data.base.marketValue ? (
        <div className="stat-row chat-totals">
          <div className="figure">
            <span className="figure-label">
              Net value · {data.base.currency}
              {data.base.excludedNoFxRate.length ? " · partial" : ""}
            </span>
            <strong className="figure-value">
              {amount(data.base.marketValue)}
            </strong>
            <span className="figure-sub">
              Day <Signed value={data.base.dayChangePercent} /> · Unrl{" "}
              <Signed value={data.base.unrealizedPercent} />
              {fxAsOf ? ` · FX ${stamp(fxAsOf)}` : ""}
            </span>
          </div>
        </div>
      ) : null}
      <div className="chat-table-scroll">
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
      </div>
      <div className="chat-tool-foot">
        <span>
          Weights within currency · net value converted at listed FX only
        </span>
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
        <BellPlus aria-hidden /> Alert proposed: {data.symbol}{" "}
        {metricLabels[data.metric]} {data.direction}{" "}
        {formatTarget(data.metric, data.target)}
        {data.metric === "price" ? ` ${data.currency ?? ""}` : ""}
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
            metric: data.metric,
            repeat: data.repeat,
            note: data.note,
            expires: data.expires,
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
    <Sources>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((source) => (
          <Source key={source.url} href={source.url} meta={hostOf(source.url)}>
            {source.title || hostOf(source.url)}
          </Source>
        ))}
      </SourcesContent>
    </Sources>
  );
}

function OptionsSummary({ data }: { data: Success<"getOptions"> }) {
  const move = data.earningsImpliedMove;
  return (
    <Block
      title={`${data.symbol} options`}
      meta={`${data.source} · ${stamp(data.asOf)}`}
    >
      <div className="stat-row chat-totals">
        <div className="figure">
          <span className="figure-label">Spot</span>
          <strong className="figure-value">{amount(data.spot)}</strong>
          <span className="figure-sub">{data.currency}</span>
        </div>
        {move ? (
          <div className="figure">
            <span className="figure-label">Earnings {move.date}</span>
            <strong className="figure-value">
              ±{amount(move.eventMovePercent ?? move.straddleMovePercent)}%
            </strong>
            <span className="figure-sub">
              {move.eventMovePercent == null ? "straddle" : "event est."} · exp{" "}
              {move.expiry}
            </span>
          </div>
        ) : null}
      </div>
      <div className="chat-table-scroll">
        <table className="data-table chat-table">
          <thead>
            <tr>
              <th>Expiry</th>
              <th className="num">ATM IV</th>
              <th className="num">Move</th>
              <th className="num chat-col-wide">25Δ skew</th>
              <th className="num">P/C vol</th>
              <th className="num chat-col-wide">P/C OI</th>
              <th className="num chat-col-wide">Pain</th>
            </tr>
          </thead>
          <tbody>
            {data.analyses.map((row) => (
              <tr key={row.expiry}>
                <td>{row.expiry}</td>
                <td className="num">
                  {row.atmIvPercent == null
                    ? "—"
                    : `${amount(row.atmIvPercent)}%`}
                </td>
                <td className="num">
                  {row.impliedMovePercent == null
                    ? "—"
                    : `±${amount(row.impliedMovePercent)}%`}
                </td>
                <td className="num chat-col-wide">
                  {row.riskReversal25Points == null
                    ? "—"
                    : amount(row.riskReversal25Points)}
                </td>
                <td className="num">{amount(row.putCallRatioVolume)}</td>
                <td className="num chat-col-wide">
                  {amount(row.putCallRatioOpenInterest)}
                </td>
                <td className="num chat-col-wide">{amount(row.maxPain)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function FearGreedRead({ data }: { data: Success<"getFearGreed"> }) {
  return (
    <Block
      title={`Fear & Greed · ${data.score} ${data.rating}`}
      meta={`${data.source} · updated ${data.updatedAt}${data.stale ? " · stale" : ""}`}
    >
      <table className="data-table chat-table">
        <thead>
          <tr>
            <th>Indicator</th>
            <th className="num">Score</th>
            <th>Rating</th>
          </tr>
        </thead>
        <tbody>
          {data.indicators.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td className="num">{item.score}</td>
              <td>{item.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

function YieldCurve({ data }: { data: Success<"getYieldCurve"> }) {
  return (
    <Block
      title="US Treasury yield curve"
      meta={`${data.source} · as of ${data.asOf}`}
    >
      <div className="chat-compute-scroll">
        <table className="data-table chat-table">
          <thead>
            <tr>
              <th>Tenor</th>
              {data.curves.map((curve) => (
                <th key={curve.label} className="num">
                  {curve.label === "latest"
                    ? curve.date
                    : `${curve.label} · ${curve.date}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tenors.map((tenor, row) => (
              <tr key={tenor}>
                <td>{tenor}</td>
                {data.curves.map((curve) => {
                  const value = curve.yields[row];
                  return (
                    <td key={curve.label} className="num">
                      {value === null ? "n/a" : `${value.toFixed(2)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function FilingRead({ data }: { data: Success<"readFiling"> }) {
  const range = data.text
    ? `${compact(data.offset)}–${compact(data.offset + data.text.length)} of ${compact(data.section?.chars ?? data.totalChars)} chars`
    : data.passages
      ? `${data.passages.length} matching passages`
      : null;
  return (
    <Block
      title={`${data.symbol} ${data.form}`}
      meta={
        <a href={data.url} target="_blank" rel="noopener noreferrer">
          SEC EDGAR · filed {data.filed}
          {data.period ? ` · period ${data.period}` : ""}
        </a>
      }
    >
      <p className="chat-chip-line">
        {data.section
          ? [
              /^(\d+[A-E]?|I{1,3}-.+|IV-.+|\d\.\d+)$/.test(data.section.id) &&
              !data.section.id.includes("99.")
                ? `Item ${data.section.id}`
                : null,
              data.section.title,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Whole filing"}
        {range ? ` · ${range}` : ""}
        {data.exhibitUrl ? (
          <>
            {" · "}
            <a href={data.exhibitUrl} target="_blank" rel="noopener noreferrer">
              Exhibit 99.1
            </a>
          </>
        ) : null}
      </p>
    </Block>
  );
}

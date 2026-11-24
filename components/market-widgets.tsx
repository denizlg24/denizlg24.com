"use client";

import { tidyPrice } from "@/lib/alerts";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Grid2X2,
  List,
  Plus,
  RefreshCw,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  PanelHeading,
  signed,
  SortHead,
  SourceLink,
  SymbolLink,
  useSort,
  Tick,
} from "./shared";
import {
  benchmarks,
  ranges,
  universes,
  type Range,
  type Universe,
} from "@/lib/universes";
import type {
  ChartPreferences,
  ChartStyle,
  Instrument,
  MarketSeries,
  News,
  Quote,
  Workspace,
  AlertRule,
} from "@/lib/models";
import { amount, compact, marketTime, percent, tone } from "@/lib/utils";
import { useLiveTick, useLiveTicks, type LiveTick } from "./live-quotes";
import { Freshness } from "./freshness";
import {
  samePreferences,
  StudyChips,
  StudyPicker,
  StylePicker,
} from "./chart-controls";
import { FunctionBar, type SecurityFunction } from "./security/functions";
import {
  AppearanceMenu,
  AverageEditor,
  CompareControl,
  DrawingTools,
  ExportMenu,
  FullscreenToggle,
  PaneEditor,
  ScalePicker,
  TemplateMenu,
  compareColors,
  toolShortcuts,
} from "./chart/studio-controls";
import type { Tool } from "./chart/drawing-layer";
import { downloadCsv, downloadPng, downloadSvg } from "@/lib/export";
import {
  defaultAppearance,
  type ChartAppearance,
  type ChartScale,
  type ChartTemplate,
  type CustomAverage,
  type CustomPane,
  type Drawing,
} from "@/lib/models";
import type { StudyKey } from "@/lib/indicators";

const PriceChart = dynamic(() => import("./price-chart"), {
  ssr: false,
  loading: () => <Loading />,
});

type QuotesData = {
  quotes: Quote[];
  missing: string[];
  members: Instrument[];
  source: string;
};
type SearchData = { instruments: Instrument[]; news: News[] };
const benchmarkSymbols = Object.keys(benchmarks).join(",");
const benchmarkLabels = benchmarks as Record<string, string>;
export const marketURL = (query: Record<string, string>) =>
  `/api/market?${new URLSearchParams(query)}`;

function withTick(quote: Quote, tick: LiveTick | undefined): Quote {
  const time = tick ? Math.floor(tick.time / 1000) : 0;
  if (!tick || time < quote.time) return quote;
  const previous = quote.previous ?? tick.previous;
  const change = previous == null ? null : tick.last - previous;
  return {
    ...quote,
    price: tick.last,
    previous,
    change,
    percent: change == null || !previous ? null : (change / previous) * 100,
    time,
    open: quote.open ?? tick.open,
    high: Math.max(quote.high ?? tick.last, tick.high ?? tick.last, tick.last),
    low: Math.min(quote.low ?? tick.last, tick.low ?? tick.last, tick.last),
    volume: tick.volume ?? quote.volume,
  };
}

export function useQuotes(symbols: string[], refresh = false) {
  const unique = [...new Set(symbols)].sort();
  const key = unique.length ? marketURL({ symbols: unique.join(",") }) : null;
  const { data, error, mutate, isLoading, isValidating } = useSWR<QuotesData>(
    key,
    api,
    { refreshInterval: refresh ? 75_000 : 0, errorRetryCount: 1 },
  );
  const ticks = useLiveTicks(refresh ? unique : []);
  const live = useMemo(
    () =>
      data && ticks.size
        ? {
            ...data,
            quotes: data.quotes.map((quote) =>
              withTick(quote, ticks.get(quote.symbol)),
            ),
          }
        : data,
    [data, ticks],
  );
  return { data: live, error, mutate, isLoading, isValidating };
}
export function useSearch(query: string, enabled = true) {
  return useSWR<SearchData>(
    enabled && query.trim() ? marketURL({ q: query.trim() }) : null,
    api,
    { errorRetryCount: 1 },
  );
}

export function Benchmarks({
  select,
  selected,
  refresh,
}: {
  select: (ticker: string) => void;
  selected: string;
  refresh: boolean;
}) {
  const { data, error, mutate, isLoading } = useQuotes(
    benchmarkSymbols.split(","),
    refresh,
  );
  const bySymbol = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  return (
    <section aria-label="Market benchmarks" className="benchmark-section">
      <div className="benchmark-strip">
        {Object.entries(benchmarks).map(([ticker, label]) => {
          const quote = bySymbol.get(ticker);
          return (
            <button
              type="button"
              key={ticker}
              className={`benchmark ${ticker === selected ? "chosen" : ""}`}
              onClick={() => select(ticker)}
              aria-pressed={ticker === selected}
            >
              <span>{label}</span>
              <div>
                <strong>
                  {isLoading ? (
                    <i className="number-placeholder" />
                  ) : quote ? (
                    <Tick value={quote.price} />
                  ) : (
                    "—"
                  )}
                </strong>
                <Change value={quote?.percent} />
              </div>
            </button>
          );
        })}
      </div>
      {error ? <Failure error={error} retry={mutate} /> : null}
    </section>
  );
}

export function ChartPanel({
  ticker,
  refresh,
  watch,
  onWatch,
  onResearch,
  onFunction,
  preferences,
  savePreferences,
  since,
  clearSince,
  drawings = [],
  saveDrawings,
  alerts = [],
  createAlert,
  templates,
  saveTemplates,
}: {
  ticker: string;
  refresh: boolean;
  watch: boolean;
  onWatch: () => void;
  onResearch: () => void;
  onFunction?: (fn: SecurityFunction) => void;
  preferences: ChartPreferences;
  savePreferences?: (next: ChartPreferences) => Promise<void>;
  since?: string;
  clearSince?: () => void;
  drawings?: Drawing[];
  saveDrawings?: (symbol: string, next: Drawing[]) => Promise<void>;
  alerts?: Pick<AlertRule, "symbol" | "metric" | "target" | "direction" | "enabled">[];
  createAlert?: (symbol: string, target: number, direction: "above" | "below") => void;
  templates?: ChartTemplate[];
  saveTemplates?: (next: ChartTemplate[]) => void;
}) {
  const [range, setRange] = useState<Range>(preferences.range);
  const [style, setStyle] = useState<ChartStyle>(preferences.style);
  const [studies, setStudies] = useState<StudyKey[]>(preferences.studies);
  const [scale, setScale] = useState<ChartScale>(
    preferences.scale ?? (preferences.log ? "log" : "linear"),
  );
  const [averages, setAverages] = useState<CustomAverage[]>(
    preferences.averages ?? [],
  );
  const [panes, setPanes] = useState<CustomPane[]>(preferences.panes ?? []);
  const [appearance, setAppearance] = useState<ChartAppearance>(
    preferences.appearance ?? defaultAppearance,
  );
  const [compare, setCompare] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [drawColor, setDrawColor] = useState("#e0a030");
  const [fullscreen, setFullscreen] = useState(false);
  const [local, setLocal] = useState<Drawing[] | null>(null);
  const chartArea = useRef<HTMLDivElement>(null);
  const mine = (local ?? drawings).filter((item) => item.symbol === ticker);
  const updateDrawings = (next: Drawing[]) => {
    setLocal([
      ...(local ?? drawings).filter((item) => item.symbol !== ticker),
      ...next,
    ]);
    void saveDrawings?.(ticker, next).catch(() => setLocal(null));
  };
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setTool("cursor");
        setFullscreen(false);
        return;
      }
      if (!saveDrawings) return;
      const next = toolShortcuts.get(event.key.toLowerCase());
      if (next && event.shiftKey) {
        event.preventDefault();
        setTool(next);
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [saveDrawings]);
  const compareKey = compare.length
    ? ["compare", range, since ?? "", ...compare]
    : null;
  const { data: compareData } = useSWR(
    compareKey,
    () =>
      Promise.all(
        compare.map((symbol) =>
          api<MarketSeries>(
            marketURL({ symbol, range, ...(since ? { since } : {}) }),
          ).then((result) => ({ symbol, points: result.points })),
        ),
      ),
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const compareSeries = useMemo(
    () =>
      (compareData ?? []).flatMap((item) => {
        const index = compare.indexOf(item.symbol);
        return index < 0
          ? []
          : [{ ...item, color: compareColors[index % compareColors.length] }];
      }),
    [compareData, compare],
  );
  const log = scale === "log";
  const [saving, setSaving] = useState(false);
  const { data, error, mutate, isLoading } = useSWR<MarketSeries>(
    marketURL({
      symbol: ticker,
      range,
      warmup: "1",
      ...(since ? { since } : {}),
    }),
    api,
    { refreshInterval: refresh ? 75_000 : 0, errorRetryCount: 1 },
  );
  const { data: quoteData } = useQuotes([ticker], refresh);
  const snapshot = quoteData?.quotes[0] ?? data?.quote;
  const tick = useLiveTick(refresh ? ticker : undefined);
  const lead = data?.lead ?? 0;
  const latest = data?.points.at(-1);
  const oldest = data?.points[lead];
  const periodChange =
    oldest?.close && latest ? (latest.close / oldest.close - 1) * 100 : null;
  const title = benchmarkLabels[ticker] ?? snapshot?.name ?? ticker;
  const unit = ticker.startsWith("^") ? "pts" : snapshot?.currency;
  const current: ChartPreferences = {
    style,
    range,
    studies,
    log,
    scale,
    averages,
    panes,
    appearance,
  };
  const dirty = savePreferences && !samePreferences(current, preferences);
  const turnover =
    snapshot?.volume != null ? snapshot.volume * snapshot.price : null;
  return (
    <section className="panel chart-panel" data-fullscreen={fullscreen || undefined}>
      <div className="chart-heading">
        <div className="ticker-identity">
          <div>
            <h2>{title}</h2>
            <p>
              <span className="security-code">{ticker}</span>
              {snapshot?.exchange ? ` · ${snapshot.exchange}` : ""}
              {unit ? ` · ${unit}` : ""}
            </p>
          </div>
        </div>
        <div className="row-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              watch
                ? "Remove from primary watchlist"
                : "Add to primary watchlist"
            }
            title={
              watch
                ? "Remove from primary watchlist"
                : "Add to primary watchlist"
            }
            onClick={onWatch}
          >
            <Star className={watch ? "filled-star" : ""} />
          </Button>
          <Button variant="outline" size="sm" onClick={onResearch}>
            Research <ArrowRight />
          </Button>
        </div>
      </div>
      <div className="quote-strip">
        <div className="price-hero">
          <strong>
            <Tick value={snapshot?.price} />
          </strong>
          <span className="currency">{unit}</span>
          <span className={`price-delta ${tone(snapshot?.change)}`}>
            {signed(snapshot?.change)}
          </span>
          <Change value={snapshot?.percent} arrows />
          <span className="period-label">vs prev close</span>
          <Freshness
            symbol={refresh ? ticker : undefined}
            quoteMs={snapshot ? snapshot.time * 1000 : null}
          />
        </div>
        <dl className="quote-fields">
          {tick?.bid != null || tick?.ask != null ? (
            <div>
              <dt>Bid/Ask</dt>
              <dd>
                {amount(tick?.bid)}/{amount(tick?.ask)}
              </dd>
            </div>
          ) : null}
          {(
            [
              ["O", snapshot?.open],
              ["H", snapshot?.high],
              ["L", snapshot?.low],
              ["Prev", snapshot?.previous],
            ] as const
          ).map(([label, value]) =>
            value == null ? null : (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{amount(value)}</dd>
              </div>
            ),
          )}
          {snapshot?.volume != null ? (
            <div>
              <dt>Vol</dt>
              <dd>{compact(snapshot.volume)}</dd>
            </div>
          ) : null}
          {turnover != null && !ticker.startsWith("^") ? (
            <div title="Approximate value traded: volume × last price">
              <dt>Val</dt>
              <dd>{compact(turnover)}</dd>
            </div>
          ) : null}
          <div>
            <dt>52w</dt>
            <dd>
              {amount(snapshot?.yearLow)}–{amount(snapshot?.yearHigh)}
            </dd>
          </div>
          {snapshot?.cap ? (
            <div>
              <dt>Mkt cap</dt>
              <dd>{compact(snapshot.cap)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {onFunction ? <FunctionBar active="GP" onSelect={onFunction} /> : null}
      <div className="chart-toolbar">
        <div className="seg" role="group" aria-label="Price history period">
          {(Object.keys(ranges) as Range[]).map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => {
                setRange(option);
                if (since) clearSince?.();
              }}
              aria-pressed={!since && option === range}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="row-actions chart-toggles">
          <StylePicker value={style} onChange={setStyle} />
          <StudyPicker value={studies} onChange={setStudies} />
          {templates && saveTemplates ? (
            <TemplateMenu
              templates={templates}
              current={{ style, studies, scale, averages, panes, appearance }}
              apply={(template) => {
                setPanes(template.panes);
                setStyle(template.style);
                setStudies(template.studies);
                setScale(template.scale);
                setAverages(template.averages);
                setAppearance(template.appearance);
              }}
              save={saveTemplates}
            />
          ) : null}
          <AverageEditor value={averages} onChange={setAverages} />
          <PaneEditor value={panes} onChange={setPanes} />
          <ScalePicker value={scale} onChange={setScale} />
          <AppearanceMenu value={appearance} onChange={setAppearance} />
          <ExportMenu
            onPng={() => {
              const svgs = [
                ...(chartArea.current?.querySelectorAll<SVGSVGElement>(
                  "svg.recharts-surface",
                ) ?? []),
              ];
              void downloadPng(svgs, `${ticker}-${range}`);
            }}
            onSvg={() => {
              const svg = chartArea.current?.querySelector<SVGSVGElement>(
                "svg.recharts-surface",
              );
              if (svg) downloadSvg(svg, `${ticker}-${range}`);
            }}
            onCsv={() =>
              downloadCsv(
                (data?.points ?? []).slice(lead).map((point) => ({
                  date: new Date(point.time * 1000).toISOString(),
                  open: point.open,
                  high: point.high,
                  low: point.low,
                  close: point.close,
                  adjustedClose: point.adjustedClose ?? "",
                  volume: point.volume ?? "",
                })),
                `${ticker}-${range}`,
              )
            }
          />
          <FullscreenToggle value={fullscreen} onChange={setFullscreen} />
          {dirty ? (
            <button
              type="button"
              className="chip chip-save"
              disabled={saving}
              title="Use this chart type, period and studies by default"
              onClick={() => {
                setSaving(true);
                void savePreferences(current).finally(() => setSaving(false));
              }}
            >
              {saving ? "Saving…" : "Save as default"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="studio-bar">
        {saveDrawings ? (
          <DrawingTools
            tool={tool}
            setTool={setTool}
            color={drawColor}
            setColor={setDrawColor}
            count={mine.length}
            clear={() => updateDrawings([])}
          />
        ) : null}
        <CompareControl ticker={ticker} value={compare} onChange={setCompare} />
      </div>
      <StudyChips
        value={studies}
        onRemove={(key) => setStudies(studies.filter((item) => item !== key))}
      />
      {since ? (
        <p className="chart-since">
          Since <time dateTime={since}>{since}</time>
        </p>
      ) : null}
      {error ? <Failure error={error} retry={mutate} /> : null}
      {isLoading ? (
        <Loading message="Loading price history" />
      ) : data?.points.length ? (
        <div ref={chartArea} className="studio-chart">
          <PriceChart
            key={`${range}-${since ?? ""}`}
            points={data.points}
            lead={lead}
            range={since ? "1Y" : range}
            style={style}
            studies={studies}
            scale={scale}
            averages={averages}
            customPanes={panes}
            appearance={appearance}
            compare={compareSeries}
            drawings={mine}
            tool={tool}
            drawColor={drawColor}
            symbol={ticker}
            onAddDrawing={
              saveDrawings
                ? (drawing) => updateDrawings([...mine, drawing].slice(-80))
                : undefined
            }
            onRemoveDrawing={
              saveDrawings
                ? (id) => updateDrawings(mine.filter((item) => item.id !== id))
                : undefined
            }
            zoomable
            events={data.events}
            alertLevels={alerts.filter(
              (alert) =>
                alert.symbol === ticker && alert.enabled && alert.metric === "price",
            )}
            onAlert={
              createAlert
                ? (price) => {
                    const last = snapshot?.price ?? data.points.at(-1)?.close ?? price;
                    createAlert(ticker, tidyPrice(price), price >= last ? "above" : "below");
                    setTool("cursor");
                  }
                : undefined
            }
            previousClose={snapshot?.previous}
            currency={unit}
          />
        </div>
      ) : !error ? (
        <Empty title="No chart history">Try a longer period.</Empty>
      ) : null}
      <div className="chart-foot">
        <span>
          {data?.source ?? quoteData?.source ?? "Market data"}
          {snapshot ? ` · ${marketTime(snapshot.time)}` : ""}
          {unit ? ` · ${unit}` : ""}
        </span>
        {periodChange != null ? (
          <span>
            {since ? "Period" : range} <Change value={periodChange} />
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function WatchlistPanel({
  lists,
  listId,
  changeList,
  onOpen,
  onAdd,
  select,
  refresh,
  full = false,
}: {
  lists: Workspace["watchlists"];
  listId: string;
  changeList: (id: string) => void;
  onOpen: () => void;
  onAdd: () => void;
  select: (ticker: string) => void;
  refresh: boolean;
  full?: boolean;
}) {
  const list = lists.find((item) => item.id === listId) ?? lists[0];
  const { data, error, mutate, isLoading } = useQuotes(
    list?.symbols ?? [],
    refresh,
  );
  const bySymbol = new Map(data?.quotes.map((item) => [item.symbol, item]));
  return (
    <section className="panel watchlist-panel">
      <PanelHeading title="Watchlist">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add symbol"
          title="Add symbol"
          onClick={onAdd}
        >
          <Plus />
        </Button>
      </PanelHeading>
      {list ? (
        <div className="watch-select">
          <Select value={list.id} onValueChange={changeList}>
            <SelectTrigger aria-label="Choose watchlist">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lists.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>{list.symbols.length} symbols</span>
        </div>
      ) : null}
      <Failure error={error} retry={mutate} />
      {list?.symbols.length ? (
        <div className="watch-rows">
          <div className="watch-row watch-labels">
            <span>Symbol</span>
            <span>Last</span>
            <span>Change</span>
          </div>
          {list.symbols.slice(0, full ? 120 : 6).map((ticker) => {
            const quote = bySymbol.get(ticker);
            return (
              <button
                className="watch-row"
                type="button"
                key={ticker}
                onClick={() => select(ticker)}
              >
                <span className="watch-name">
                  <strong>{ticker}</strong>
                  <small>
                    {quote?.name ??
                      (isLoading ? "Loading quote…" : "Quote unavailable")}
                  </small>
                </span>
                <span>
                  <Tick value={quote?.price} />
                  <small>{quote?.currency}</small>
                </span>
                <Change value={quote?.percent} />
              </button>
            );
          })}
        </div>
      ) : (
        <Empty title="Your watchlist is empty">
          Add a ticker to follow its price here.
        </Empty>
      )}
      {!full ? (
        <div className="watch-foot">
          <Button variant="ghost" onClick={onOpen}>
            Manage watchlists <ArrowRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

const sortedGroups = [
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Financials",
  "Health Care",
];

type MapRow = Instrument & { quote?: Quote; change?: number | null };
const mapSort = {
  symbol: (row: MapRow) => row.symbol,
  name: (row: MapRow) => row.quote?.name ?? row.name,
  sector: (row: MapRow) => row.sector,
  price: (row: MapRow) => row.quote?.price,
  change: (row: MapRow) => row.change,
  volume: (row: MapRow) => row.quote?.volume,
};

function heatTone(value?: number | null) {
  if (value == null) return "heat-missing";
  if (value >= 2) return "heat-gain-strong";
  if (value >= 0.5) return "heat-gain";
  if (value > 0.02) return "heat-gain-soft";
  if (value <= -2) return "heat-loss-strong";
  if (value <= -0.5) return "heat-loss";
  if (value < -0.02) return "heat-loss-soft";
  return "heat-flat";
}

export function MarketMap({
  universe,
  setUniverse,
  custom,
  excluded,
  since,
  select,
  compactView,
  onOpen,
  refresh,
}: {
  universe?: Universe;
  setUniverse: (universe: Universe) => void;
  custom: string[];
  excluded?: string[];
  since?: string;
  select: (ticker: string) => void;
  compactView?: boolean;
  onOpen?: () => void;
  refresh: boolean;
}) {
  const [mode, setMode] = useState<"map" | "table">("map");
  const [filter, setFilter] = useState("");
  const { data, error, mutate, isLoading } = useSWR<QuotesData>(
    marketURL({
      ...(universe ? { universe } : {}),
      symbols: custom.join(","),
      ...(since ? { since } : {}),
      ...(excluded?.length ? { exclude: excluded.join(",") } : {}),
    }),
    api,
    {
      refreshInterval: refresh && universe !== "S&P 500" ? 90_000 : 0,
      errorRetryCount: 1,
    },
  );
  const rows = useMemo(() => {
    if (!data) return [];
    const indexed = new Map(data.quotes.map((quote) => [quote.symbol, quote]));
    const members = data.members;
    const needle = filter.toUpperCase().trim();
    return members
      .map((member) => {
        const quote = indexed.get(member.symbol);
        return {
          ...member,
          quote,
          change: since ? quote?.periodPercent : quote?.percent,
        };
      })
      .filter(
        ({ symbol, name, sector, quote }) =>
          !needle ||
          [symbol, name, sector, quote?.name].some((value) =>
            value?.toUpperCase().includes(needle),
          ),
      );
  }, [data, filter, since]);
  const { sorted, sort, toggle } = useSort(rows, mapSort, {
    key: "change",
    dir: "desc",
  });
  const groups = new Map<string, typeof rows>();
  for (const row of compactView ? rows.slice(0, 12) : rows) {
    const group = universe === "S&P 500" ? (row.sector ?? "Other") : "All";
    const current = groups.get(group) ?? [];
    current.push(row);
    groups.set(group, current);
  }
  const groupRows = [...groups].sort(([a], [b]) => {
    const order = (label: string) =>
      sortedGroups.includes(label) ? sortedGroups.indexOf(label) : 99;
    return order(a) - order(b) || a.localeCompare(b);
  });
  const label = universe ?? "Custom symbols";
  const up = rows.filter((item) => (item.change ?? 0) > 0).length;
  const down = rows.filter((item) => (item.change ?? 0) < 0).length;
  return (
    <section className="panel map-panel">
      <PanelHeading
        title={compactView ? "Market heat map" : label}
        subtitle={
          since
            ? `Since ${since} · from first available close`
            : compactView
              ? "Day moves vs prior close"
              : "Day moves vs prior close · equal-sized tiles"
        }
      >
        {compactView ? (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Explore <ArrowRight />
          </Button>
        ) : (
          <div className="seg" role="group" aria-label="Display">
            <button
              type="button"
              aria-label="Heat map"
              title="Heat map"
              aria-pressed={mode === "map"}
              onClick={() => setMode("map")}
            >
              <Grid2X2 aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Table view"
              title="Table view"
              aria-pressed={mode === "table"}
              onClick={() => setMode("table")}
            >
              <List aria-hidden />
            </button>
          </div>
        )}
      </PanelHeading>
      <div className="map-toolbar">
        <Select
          value={universe ?? ""}
          onValueChange={(value) => setUniverse(value as Universe)}
        >
          <SelectTrigger aria-label="Choose market group">
            <SelectValue placeholder="Custom symbols" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(universes).map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!compactView ? (
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by symbol, company, or sector"
            aria-label="Filter market group"
          />
        ) : null}
        <div className="breadth">
          <span className="positive">
            <ArrowUp size={13} /> {up}
          </span>
          <span className="negative">
            <ArrowDown size={13} /> {down}
          </span>
        </div>
        {!compactView ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh market group"
            onClick={() => void mutate()}
          >
            <RefreshCw />
          </Button>
        ) : null}
      </div>
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <Loading />
      ) : rows.length ? (
        mode === "map" ? (
          <div className={`heat-groups ${compactView ? "compact-map" : ""}`}>
            {groupRows.map(([group, instruments]) => (
              <div className="heat-group" key={group}>
                {group !== "All" ? (
                  <h3>
                    {group} <small>{instruments.length}</small>
                  </h3>
                ) : null}
                <div className="heat-tiles">
                  {instruments.map((item) => (
                    <button
                      key={item.symbol}
                      className={`heat-tile ${heatTone(item.change)}`}
                      title={`${item.quote?.name ?? item.name} · ${percent(item.change)}`}
                      onClick={() => select(item.symbol)}
                    >
                      <strong>{item.symbol}</strong>
                      <span>{percent(item.change)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead
                  label="Symbol"
                  column="symbol"
                  sort={sort}
                  toggle={toggle}
                />
                <SortHead
                  label="Company"
                  column="name"
                  sort={sort}
                  toggle={toggle}
                />
                <SortHead
                  label="Sector"
                  column="sector"
                  sort={sort}
                  toggle={toggle}
                />
                <SortHead
                  label="Last"
                  column="price"
                  sort={sort}
                  toggle={toggle}
                  numeric
                />
                <TableHead>Ccy</TableHead>
                <SortHead
                  label={since ? "Since" : "Change"}
                  column="change"
                  sort={sort}
                  toggle={toggle}
                  numeric
                />
                <SortHead
                  label="Volume"
                  column="volume"
                  sort={sort}
                  toggle={toggle}
                  numeric
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((item) => (
                <TableRow key={item.symbol}>
                  <TableCell>
                    <SymbolLink
                      symbol={item.symbol}
                      select={select}
                      label={item.quote?.name ?? item.name}
                    />
                  </TableCell>
                  <TableCell className="truncate-cell">
                    {item.quote?.name ?? item.name}
                  </TableCell>
                  <TableCell className="muted">{item.sector ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {amount(item.quote?.price)}
                  </TableCell>
                  <TableCell className="muted">
                    {item.quote?.currency ?? ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <Change value={item.change} />
                  </TableCell>
                  <TableCell className="text-right muted">
                    {compact(item.quote?.volume)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : !error ? (
        <Empty title="No matching symbols">
          Change the filter or pick another market group.
        </Empty>
      ) : null}
      <div className="map-foot">
        <span>
          <i className="heat-loss" /> Loss <i className="heat-flat" /> Flat{" "}
          <i className="heat-gain" /> Gain
        </span>
        <span>
          {data?.source ? `${data.source} · ` : ""}
          {data?.quotes.length ?? "—"} quotes · {data?.missing.length ?? 0}{" "}
          unavailable
        </span>
      </div>
    </section>
  );
}

export function NewsPanel({
  ticker,
  limit = 5,
  onOpen,
}: {
  ticker: string;
  limit?: number;
  onOpen?: () => void;
}) {
  const { data, error, mutate, isLoading } = useSearch(ticker);
  return (
    <section className="panel news-panel">
      <PanelHeading
        title="Company news"
        subtitle={benchmarkLabels[ticker] ?? ticker}
      >
        {onOpen ? (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Open research <ArrowRight />
          </Button>
        ) : null}
      </PanelHeading>
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <Loading message="Loading company news" />
      ) : data?.news.length ? (
        <div className="news-list">
          {data.news.slice(0, limit).map((item, index) => (
            <article key={`${item.url}:${index}`}>
              <SourceLink href={item.url}>{item.title}</SourceLink>
              <p>
                {item.publisher}
                {item.time ? ` · ${marketTime(item.time)}` : ""}
              </p>
            </article>
          ))}
        </div>
      ) : !error ? (
        <Empty title="No headlines returned">
          Search for a company to see its recent coverage.
        </Empty>
      ) : null}
    </section>
  );
}

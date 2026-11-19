import "server-only";
import { series } from "@/lib/market";
import { isMoex } from "@/lib/moex";
import type { ChartPoint } from "@/lib/models";
import type { Range } from "@/lib/universes";
import {
  chartSchema,
  isMarketSpec,
  maxPoints,
  type Chart,
  type ChartSeries,
  type ChartSpec,
  type MarketChartSpec,
} from "./chart";
import {
  deckSchema,
  maxDocBytes,
  reportSchema,
  type Deck,
  type DeckInput,
  type Report,
  type ReportInput,
} from "./types";

const intraday = (range: Range | undefined, since: string | undefined) =>
  !since && (range === "1D" || range === "5D");

const dayKey = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10);
const timeKey = (seconds: number, intra: boolean) =>
  intra
    ? new Date(seconds * 1000).toISOString().slice(0, 16) + "Z"
    : dayKey(seconds);

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

function thin<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)]);
}

function sourceFor(symbols: string[]) {
  if (symbols.every(isMoex)) return "Moscow Exchange";
  if (symbols.some(isMoex)) return "Yahoo Finance · Moscow Exchange";
  return "Yahoo Finance";
}

type Fetched = {
  symbol: string;
  name: string;
  currency: string | null;
  time: number;
  points: ChartPoint[];
};

async function fetchAll(spec: MarketChartSpec): Promise<Fetched[]> {
  const { symbols, since } = spec.market;
  const range = spec.market.range ?? (since ? undefined : "1Y");
  const results = await Promise.allSettled(
    symbols.map((symbol) => series(symbol, range ?? "1Y", since)),
  );
  const fetched = results.flatMap((result, i): Fetched[] =>
    result.status === "fulfilled" && result.value.points.length > 1
      ? [
          {
            symbol: symbols[i],
            name: result.value.quote?.name ?? symbols[i],
            currency: result.value.quote?.currency ?? null,
            time: result.value.quote?.time ?? result.value.points.at(-1)!.time,
            points: since
              ? result.value.points.filter(
                  (point) => point.time >= Date.parse(since) / 1000 - 43_200,
                )
              : result.value.points,
          },
        ]
      : [],
  );
  const missing = symbols.filter(
    (symbol) => !fetched.some((item) => item.symbol === symbol),
  );
  if (missing.length)
    throw new Error(
      `No price history for ${missing.join(", ")}. Check the symbols with searchSymbols.`,
    );
  return fetched;
}

const closeOf = (point: ChartPoint, adjusted: boolean) =>
  adjusted && point.adjustedClose != null ? point.adjustedClose : point.close;

const rangeWords: Record<Range, string> = {
  "1D": "over the last session",
  "5D": "over five days",
  "1M": "over one month",
  "3M": "over three months",
  "6M": "over six months",
  YTD: "year to date",
  "1Y": "over one year",
  "5Y": "over five years",
};

function periodLabel(spec: MarketChartSpec) {
  if (spec.market.since) return `since ${spec.market.since}`;
  return rangeWords[spec.market.range ?? "1Y"];
}

async function resolveMarket(spec: MarketChartSpec): Promise<Chart> {
  const fetched = await fetchAll(spec);
  const intra = intraday(spec.market.range, spec.market.since);
  const asOf = new Date(
    Math.max(...fetched.map((item) => item.time)) * 1000,
  ).toISOString();
  const adjusted = fetched.every((item) =>
    item.points.every((point) => point.adjustedClose != null),
  );
  const source = sourceFor(fetched.map((item) => item.symbol));
  const common = {
    title: spec.title,
    subtitle: spec.subtitle,
    source,
    asOf,
  };

  if (spec.kind === "bar" || spec.kind === "stacked-bar") {
    return {
      ...common,
      kind: "bar",
      x: { type: "category" },
      y: { format: "percent", decimals: 1 },
      note:
        spec.note ??
        `Price return ${periodLabel(spec)}${adjusted ? ", adjusted for dividends and splits" : ""}, in each instrument’s quote currency.`,
      series: [
        {
          name: "Return",
          points: fetched.map((item) => {
            const first = closeOf(item.points[0], adjusted);
            const last = closeOf(item.points.at(-1)!, adjusted);
            return { x: item.symbol, y: round((last / first - 1) * 100, 2) };
          }),
        },
      ],
    };
  }

  if (spec.kind === "performance") {
    const byKey = fetched.map(
      (item) =>
        new Map(
          item.points.map((point) => [
            timeKey(point.time, intra),
            closeOf(point, adjusted),
          ]),
        ),
    );
    const keys = [...byKey[0].keys()].filter((key) =>
      byKey.every((map) => (map.get(key) ?? 0) > 0),
    );
    if (keys.length < 2)
      throw new Error(
        "These symbols share too few trading dates to compare. Try a longer range.",
      );
    const kept = thin(keys, maxPoints);
    return {
      ...common,
      kind: "performance",
      x: { type: "time" },
      y: { format: "percent", decimals: 1 },
      note:
        spec.note ??
        `Cumulative ${adjusted ? "total" : "price"} return ${periodLabel(spec)} on shared trading dates, in each instrument’s quote currency.`,
      series: fetched.map((item, i): ChartSeries => {
        const start = byKey[i].get(kept[0])!;
        return {
          name: item.symbol,
          points: kept.map((key) => ({
            x: key,
            y: round((byKey[i].get(key)! / start - 1) * 100, 3),
          })),
        };
      }),
    };
  }

  const currencies = [...new Set(fetched.map((item) => item.currency))];
  if (currencies.length > 1 || !currencies[0])
    throw new Error(
      `These instruments quote in different currencies (${currencies.map((c) => c ?? "unknown").join(", ")}). Use kind "performance" to compare them on one axis.`,
    );
  const currency = currencies[0];
  return {
    ...common,
    kind: spec.kind,
    x: { type: "time" },
    y: { format: "currency", currency, decimals: 2 },
    note: spec.note ?? `Closing prices in ${currency}, not adjusted.`,
    series: fetched.map((item) => ({
      name: item.symbol,
      points: thin(item.points, maxPoints).map((point) => ({
        x: timeKey(point.time, intra),
        y: round(point.close, 4),
      })),
    })),
  };
}

export async function resolveChart(spec: ChartSpec): Promise<Chart> {
  if (isMarketSpec(spec)) return chartSchema.parse(await resolveMarket(spec));
  const y = spec.y;
  if (spec.kind === "performance" && y.format !== "percent")
    throw new Error(
      "A performance chart plots percent returns (y.format percent).",
    );
  return chartSchema.parse({
    ...spec,
    asOf: spec.asOf ?? new Date().toISOString(),
  });
}

function capSize<T>(doc: T): T {
  const bytes = Buffer.byteLength(JSON.stringify(doc));
  if (bytes > maxDocBytes)
    throw new Error(
      `The document is too large (${Math.round(bytes / 1000)} KB; limit ${maxDocBytes / 1000} KB). Use fewer chart points or shorter tables.`,
    );
  return doc;
}

async function resolveCharts<T extends { chart?: ChartSpec }>(
  items: T[],
  label: string,
) {
  return Promise.all(
    items.map(async (item, i) => {
      if (!item.chart) return { ...item, chart: undefined };
      try {
        return { ...item, chart: await resolveChart(item.chart) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "chart failed";
        throw new Error(`${label} ${i + 1}: ${reason}`);
      }
    }),
  );
}

export async function resolveReport(input: ReportInput): Promise<Report> {
  const sections = await resolveCharts(input.sections, "Section");
  return capSize(reportSchema.parse({ ...input, sections }));
}

export async function resolveDeck(input: DeckInput): Promise<Deck> {
  const slides = await resolveCharts(input.slides, "Slide");
  return capSize(deckSchema.parse({ ...input, slides }));
}

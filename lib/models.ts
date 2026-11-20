import { z } from "zod";
import { dashboardSchema } from "./assistant-types";
import { rangeKeys, symbolPattern } from "./universes";
import { studyKeySchema } from "./indicators";
import { overlayRanges, overlaySpecSchema } from "./overlay";
import { deskSchema } from "./desk";
import { screenSchema } from "./screens";

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(symbolPattern);
const id = z.string().uuid();

export const chartStyles = [
  "line",
  "area",
  "candles",
  "hollow",
  "bars",
  "heikin",
] as const;
export type ChartStyle = (typeof chartStyles)[number];
export const chartStyleLabels: Record<ChartStyle, string> = {
  line: "Line",
  area: "Mountain",
  candles: "Candles",
  hollow: "Hollow candles",
  bars: "OHLC bars",
  heikin: "Heikin-Ashi",
};
export const averageKinds = ["sma", "ema", "wma", "hma"] as const;
export type AverageKind = (typeof averageKinds)[number];
export const chartColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const customAverageSchema = z.object({
  kind: z.enum(averageKinds),
  period: z.number().int().min(2).max(500),
  color: chartColorSchema,
  source: z.enum(["close", "hl2", "hlc3", "ohlc4"]).default("close"),
});
export type CustomAverage = z.infer<typeof customAverageSchema>;
export const oscillatorKinds = [
  "rsi",
  "roc",
  "zscore",
  "atr",
  "stdev",
  "williams",
  "cci",
] as const;
export type OscillatorKind = (typeof oscillatorKinds)[number];
export const customPaneSchema = z.object({
  kind: z.enum(oscillatorKinds),
  period: z.number().int().min(2).max(500),
  color: chartColorSchema,
});
export type CustomPane = z.infer<typeof customPaneSchema>;
export const chartAppearanceSchema = z.object({
  grid: z.boolean().default(true),
  crosshair: z.boolean().default(true),
  extremes: z.boolean().default(false),
  events: z.boolean().default(true),
  alerts: z.boolean().default(true),
  lastPrice: z.boolean().default(true),
  lineWidth: z.number().min(0.5).max(4).default(1.6),
  up: chartColorSchema.nullable().default(null),
  down: chartColorSchema.nullable().default(null),
});
export type ChartAppearance = z.infer<typeof chartAppearanceSchema>;
export const defaultAppearance: ChartAppearance = {
  grid: true,
  crosshair: true,
  extremes: false,
  events: true,
  alerts: true,
  lastPrice: true,
  lineWidth: 1.6,
  up: null,
  down: null,
};
export const chartScales = ["linear", "log", "percent"] as const;
export type ChartScale = (typeof chartScales)[number];
export const chartPreferencesSchema = z.object({
  style: z.enum(chartStyles).default("area"),
  range: z.enum(rangeKeys).default("1M"),
  studies: z.array(studyKeySchema).max(12).default([]),
  log: z.boolean().default(false),
  scale: z.enum(chartScales).optional(),
  averages: z.array(customAverageSchema).max(8).default([]),
  panes: z.array(customPaneSchema).max(4).default([]),
  appearance: chartAppearanceSchema.default(defaultAppearance),
});

export const drawingKinds = [
  "trend",
  "ray",
  "hline",
  "vline",
  "rect",
  "fib",
  "channel",
  "text",
] as const;
export type DrawingKind = (typeof drawingKinds)[number];
export const drawingSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().trim().toUpperCase().regex(symbolPattern),
  kind: z.enum(drawingKinds),
  points: z
    .array(z.object({ t: z.number().int(), p: z.number().finite() }))
    .min(1)
    .max(3),
  color: chartColorSchema,
  text: z.string().max(200).optional(),
});
export type Drawing = z.infer<typeof drawingSchema>;

export const relationNoteSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().trim().toUpperCase().regex(symbolPattern),
  counterparty: z.string().trim().min(1).max(120),
  ticker: z.string().trim().toUpperCase().regex(symbolPattern).nullable(),
  role: z.enum(["supplier", "customer", "partner", "competitor"]),
  share: z.number().min(0).max(1).nullable(),
  note: z.string().max(300),
  created: z.iso.date(),
});
export type RelationNote = z.infer<typeof relationNoteSchema>;

export const chartTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  style: z.enum(chartStyles),
  studies: z.array(studyKeySchema).max(12),
  scale: z.enum(chartScales),
  averages: z.array(customAverageSchema).max(8),
  panes: z.array(customPaneSchema).max(4).default([]),
  appearance: chartAppearanceSchema,
});
export type ChartTemplate = z.infer<typeof chartTemplateSchema>;
export type ChartPreferences = z.infer<typeof chartPreferencesSchema>;
export const defaultChartPreferences: ChartPreferences = {
  style: "area",
  range: "1M",
  studies: [],
  log: false,
  averages: [],
  panes: [],
  appearance: defaultAppearance,
};
const title = z.string().trim().min(1).max(120);

export const brokerBookSchema = z.object({
  provider: z.literal("ibkr"),
  account: z.string().trim().min(1).max(40),
  asOf: z.iso.date(),
  syncedAt: z.iso.datetime(),
  cash: z
    .array(
      z.object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount: z.number(),
      }),
    )
    .max(40)
    .default([]),
  skipped: z
    .array(
      z.object({ symbol: z.string().max(60), reason: z.string().max(120) }),
    )
    .max(200)
    .default([]),
});
export type BrokerBook = z.infer<typeof brokerBookSchema>;

export const workspaceSchema = z.object({
  watchlists: z
    .array(
      z.object({ id, name: title, symbols: z.array(symbolSchema).max(120) }),
    )
    .max(30),
  books: z
    .array(
      z.object({
        id,
        name: title,
        broker: brokerBookSchema.optional(),
      }),
    )
    .max(25),
  trades: z
    .array(
      z.object({
        id,
        bookId: id,
        symbol: symbolSchema,
        side: z.enum(["buy", "sell"]),
        quantity: z.number().positive().max(1e12),
        price: z.number().positive().max(1e12),
        fees: z.number().min(0).max(1e12),
        currency: z.string().regex(/^[A-Z]{3}$|^GBp$|^ZAc$|^ILA$/),
        date: z.iso.date(),
      }),
    )
    .max(5000),
  notes: z
    .array(
      z.object({
        id,
        title,
        symbol: z.union([z.literal(""), symbolSchema]),
        body: z.string().max(40000),
        updatedAt: z.iso.datetime(),
      }),
    )
    .max(150),
  alerts: z
    .array(
      z.object({
        id,
        symbol: symbolSchema,
        direction: z.enum(["above", "below"]),
        target: z.number().positive().max(1e12),
        enabled: z.boolean(),
        lastTriggered: z.iso.datetime().nullable(),
        triggeredPrice: z.number().positive().nullable(),
      }),
    )
    .max(60),
  dashboard: dashboardSchema.optional(),
  desk: deskSchema.optional(),
  overlays: z
    .array(
      z.object({
        id,
        name: title,
        spec: overlaySpecSchema,
        range: z.enum(overlayRanges),
      }),
    )
    .max(30)
    .default([]),
  drawings: z.array(drawingSchema).max(600).default([]),
  screens: z.array(screenSchema).max(20).default([]),
  relations: z.array(relationNoteSchema).max(400).default([]),
  chartTemplates: z.array(chartTemplateSchema).max(30).default([]),
  tourSeen: z.boolean().default(false),
  requests: z
    .array(
      z.object({
        id,
        query: z.string().trim().min(1).max(500),
        answer: z.string().max(8000).default(""),
        web: z.boolean().default(false),
        dashboard: dashboardSchema.optional(),
        symbol: symbolSchema.optional(),
        sources: z
          .array(
            z.object({
              title: z.string().max(500),
              url: z.url({ protocol: /^https$/ }).max(2500),
            }),
          )
          .max(12)
          .default([]),
      }),
    )
    .max(40),
  settings: z.object({
    theme: z.enum(["light", "dark", "system", "terminal"]),
    home: z.enum(["overview", "markets", "portfolio", "research"]),
    refresh: z.boolean(),
    chart: chartPreferencesSchema.default(defaultChartPreferences),
  }),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type Trade = Workspace["trades"][number];
export type ChartPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose?: number;
  volume: number | null;
};
export type Quote = {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number;
  previous: number | null;
  change: number | null;
  percent: number | null;
  periodPercent?: number | null;
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  volume: number | null;
  cap: number | null;
};
export type MarketSeries = {
  quote: Quote | null;
  points: ChartPoint[];
  /** Leading bars fetched only to warm up indicators; not part of the range. */
  lead?: number;
  source?: string;
  events?: CorporateEvent[];
};
export type CorporateEvent =
  | { kind: "dividend"; time: number; amount: number }
  | { kind: "split"; time: number; ratio: string };
export type News = {
  title: string;
  publisher: string;
  url: string;
  time: number;
};
export type Instrument = {
  symbol: string;
  name: string;
  exchange?: string;
  sector?: string;
  type?: string;
};

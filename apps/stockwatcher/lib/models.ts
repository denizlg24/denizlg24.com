import { z } from "zod";
import { dashboardSchema } from "./assistant-types";
import { deskSchema } from "./desk";
import { studyKeySchema } from "./indicators";
import { overlayRanges, overlaySpecSchema } from "./overlay";
import { screenSchema } from "./screens";
import { rangeKeys, symbolPattern } from "./universes";

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

export const alertMetrics = ["price", "change", "move", "volume"] as const;
export type AlertMetric = (typeof alertMetrics)[number];
export const channelKinds = [
  "email",
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "ntfy",
  "push",
  "webhook",
] as const;
export type ChannelKind = (typeof channelKinds)[number];

export const alertSchema = z
  .object({
    id,
    symbol: symbolSchema,
    metric: z.enum(alertMetrics).default("price"),
    direction: z.enum(["above", "below"]),
    target: z.number().finite().min(-1e12).max(1e12),
    /** Price when the alert was set; the base for `move` alerts. */
    reference: z.number().positive().nullable().default(null),
    repeat: z.enum(["once", "rearm"]).default("once"),
    /** False after a `rearm` alert fires, until the condition clears again. */
    primed: z.boolean().default(true),
    enabled: z.boolean(),
    note: z.string().trim().max(280).default(""),
    channels: z.array(z.string().uuid()).max(10).default([]),
    expires: z.iso.date().nullable().default(null),
    lastTriggered: z.iso.datetime().nullable(),
    triggeredPrice: z.number().positive().nullable(),
    triggerCount: z.number().int().min(0).default(0),
  })
  .refine(
    (alert) =>
      alert.metric === "change" || alert.metric === "move" || alert.target > 0,
    { message: "Price and volume targets must be positive.", path: ["target"] },
  )
  .refine((alert) => alert.metric !== "move" || alert.reference !== null, {
    message: "A move alert needs a reference price.",
    path: ["reference"],
  });
export type AlertRule = z.infer<typeof alertSchema>;

export const alertEventSchema = z.object({
  id,
  alertId: id,
  /** Empty for signal events, which carry a `label` instead. */
  symbol: z.union([z.literal(""), symbolSchema]),
  label: z.string().max(120).default(""),
  time: z.iso.datetime(),
  price: z.number().positive().nullable(),
  currency: z.string().max(8).default(""),
  message: z.string().max(400),
  deliveries: z
    .array(
      z.object({
        channel: z.string().uuid(),
        kind: z.enum(channelKinds),
        label: z.string().max(80),
        ok: z.boolean(),
        error: z.string().max(200).nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
});
export type AlertEvent = z.infer<typeof alertEventSchema>;

export const signalCadences = ["tick", "hourly", "daily"] as const;
export type SignalCadence = (typeof signalCadences)[number];
export const maxSignals = 10;
export const signalCodeLimit = 20_000;

/** A saved compute script that alerts when it returns true (or `{ trigger: true }`). */
export const signalSchema = z.object({
  id,
  name: title,
  /** The `compute` tool's data request; validated against it when the signal runs. */
  data: z.record(z.string(), z.json()).default({}),
  code: z.string().min(1).max(signalCodeLimit),
  cadence: z.enum(signalCadences).default("daily"),
  repeat: z.enum(["once", "rearm"]).default("once"),
  /** False after a `rearm` signal fires, until it returns false again. */
  primed: z.boolean().default(true),
  enabled: z.boolean(),
  note: z.string().trim().max(280).default(""),
  channels: z.array(z.string().uuid()).max(10).default([]),
  lastValue: z.number().finite().nullable().default(null),
  lastMessage: z.string().max(300).nullable().default(null),
  lastChecked: z.iso.datetime().nullable().default(null),
  lastError: z.string().max(300).nullable().default(null),
  /** Consecutive failed runs; the signal is disabled when it reaches the limit. */
  errorCount: z.number().int().min(0).default(0),
  lastTriggered: z.iso.datetime().nullable().default(null),
  triggerCount: z.number().int().min(0).default(0),
});
export type Signal = z.infer<typeof signalSchema>;

/** Per-run bookkeeping, stored outside the workspace so checks never bump its revision. */
export const signalRuntimeSchema = signalSchema.pick({
  lastValue: true,
  lastMessage: true,
  lastChecked: true,
  lastError: true,
  errorCount: true,
});
export type SignalRuntime = z.infer<typeof signalRuntimeSchema>;

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
  alerts: z.array(alertSchema).max(60),
  alertLog: z.array(alertEventSchema).max(120).default([]),
  signals: z.array(signalSchema).max(maxSignals).default([]),
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
    baseCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
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

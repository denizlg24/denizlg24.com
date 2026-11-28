import { z } from "zod";
import { defaultClockExchanges, exchangeKeys } from "./exchanges";
import { overlayWidgetSchema } from "./overlay";
import { rangeKeys, symbolPattern, universeKeys } from "./universes";

const ticker = z.string().regex(symbolPattern);
const widgetId = z.uuid();
const rangeKey = z.enum(rangeKeys);
const universeKey = z.enum(universeKeys);

export const deskFunctions = [
  "GC",
  "RRG",
  "CORR",
  "TOP",
  "EVTS",
  "PRSK",
  "FXC",
  "CMDTY",
  "CRYP",
  "GRID",
  "FEAR",
  "CONG",
  "TRMP",
  "FUND",
  "CONT",
  "PACS",
  "DARK",
  "PMKT",
  "WARN",
  "WSB",
  "ACFT",
] as const;
export type DeskFunction = (typeof deskFunctions)[number];

export const clockStyles = ["table", "dials", "timeline", "strip"] as const;
export type ClockStyle = (typeof clockStyles)[number];
export const fearGreedVariants = ["gauge", "history", "indicators"] as const;
export type FearGreedVariant = (typeof fearGreedVariants)[number];

const base = {
  id: widgetId,
  span: z.union([z.literal(1), z.literal(2)]).default(1),
};

export const widgetSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("brief") }),
  z.object({
    ...base,
    kind: z.literal("holdings"),
    bookId: z.uuid().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("movers"),
    source: z.enum(["holdings", "watchlist"]),
  }),
  z.object({
    ...base,
    kind: z.literal("watchlist"),
    watchlistId: z.uuid().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("chart"),
    symbol: ticker,
    range: rangeKey.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("news"),
    symbols: z.array(ticker).max(20).optional(),
  }),
  z.object({ ...base, kind: z.literal("alerts") }),
  z.object({
    ...base,
    kind: z.literal("compare"),
    symbols: z.array(ticker).min(2).max(6),
    since: z.iso.date().optional(),
  }),
  z.object({ ...base, kind: z.literal("market"), universe: universeKey }),
  z.object({
    ...base,
    kind: z.literal("insight"),
    title: z.string().trim().min(1).max(120),
    body: z.string().max(4000),
    symbols: z.array(ticker).max(12).default([]),
    createdAt: z.iso.datetime(),
  }),
  z.object({
    ...base,
    kind: z.literal("overlay"),
    ...overlayWidgetSchema.shape,
  }),
  z.object({
    ...base,
    kind: z.literal("function"),
    fn: z.enum(deskFunctions),
    symbols: z.array(ticker).max(30).optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("clocks"),
    exchanges: z.array(z.enum(exchangeKeys)).min(1).max(exchangeKeys.length),
    style: z.enum(clockStyles).default("table"),
  }),
  z.object({
    ...base,
    kind: z.literal("fearGreed"),
    variant: z.enum(fearGreedVariants).default("gauge"),
  }),
]);

export const deskSchema = z.object({
  widgets: z.array(widgetSchema).max(24),
});

export type Widget = z.infer<typeof widgetSchema>;
export type WidgetKind = Widget["kind"];
export type Desk = z.infer<typeof deskSchema>;

export function defaultDesk(newId: () => string): Desk {
  return {
    widgets: [
      { id: newId(), span: 2, kind: "brief" },
      { id: newId(), span: 1, kind: "holdings" },
      { id: newId(), span: 1, kind: "movers", source: "holdings" },
      { id: newId(), span: 1, kind: "watchlist" },
      { id: newId(), span: 1, kind: "news" },
      { id: newId(), span: 1, kind: "alerts" },
      {
        id: newId(),
        span: 1,
        kind: "clocks",
        exchanges: [...defaultClockExchanges],
        style: "table",
      },
    ],
  };
}

import { z } from "zod";
import { dashboardSchema } from "./assistant-types";
import { symbolPattern } from "./universes";

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(symbolPattern);
const id = z.string().uuid();
const title = z.string().trim().min(1).max(120);

export const workspaceSchema = z.object({
  watchlists: z
    .array(
      z.object({ id, name: title, symbols: z.array(symbolSchema).max(120) }),
    )
    .max(30),
  books: z.array(z.object({ id, name: title })).max(25),
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
    theme: z.enum(["light", "dark", "system"]),
    home: z.enum(["overview", "markets", "portfolio", "research"]),
    refresh: z.boolean(),
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
  source?: string;
};
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

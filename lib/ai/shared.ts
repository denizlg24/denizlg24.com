import "server-only";
import { z } from "zod";
import type { Quote } from "@/lib/models";
import { symbolPattern } from "@/lib/universes";

export const ticker = z
  .string()
  .trim()
  .toUpperCase()
  .regex(symbolPattern)
  .describe("Yahoo Finance style symbol, e.g. AAPL, ASML.AS, ^GSPC, BTC-USD");

export type ToolError = { error: string };

const failure = (error: unknown, fallback: string): ToolError => ({
  error:
    error instanceof Error && error.message.length < 300
      ? error.message
      : fallback,
});

export async function attempt<T>(
  run: () => Promise<T>,
  fallback: string,
): Promise<T | ToolError> {
  try {
    return await run();
  } catch (error) {
    return failure(error, fallback);
  }
}

export const round = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** digits) / 10 ** digits;

export const isoTime = (seconds: number) =>
  seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

export const snapshot = (quote: Quote) => ({
  symbol: quote.symbol,
  name: quote.name,
  price: round(quote.price, 4),
  currency: quote.currency,
  changePercent: round(quote.percent),
  time: isoTime(quote.time),
});

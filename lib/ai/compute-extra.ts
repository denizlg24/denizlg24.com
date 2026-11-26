import "server-only";
import { z } from "zod";
import { fredSeries, type MacroObservation } from "@/lib/fred";
import {
  loadFundamentals,
  type FundamentalPoint,
  type SymbolFundamentals,
} from "@/lib/sec-facts";

const MAX_CONCEPTS = 12;
const MAX_MACRO_SERIES = 20;
const MAX_POINTS = 150_000;
const FUNDAMENTALS_CONCURRENCY = 6;
const FUNDAMENTALS_BUDGET_MS = 90_000;

export const extraShape = {
  fundamentals: z
    .object({
      concepts: z
        .array(z.string().trim().min(2).max(120))
        .min(1)
        .max(MAX_CONCEPTS)
        .describe(
          "Alias (revenue, netIncome, eps, operatingCashFlow, capex, ...) or raw XBRL tag (e.g. Revenues, LongTermDebt)",
        ),
      frequency: z.enum(["annual", "quarterly", "all"]).default("all"),
      since: z
        .number()
        .int()
        .min(1990)
        .max(2100)
        .optional()
        .describe("Drop facts that end before this calendar year"),
    })
    .optional(),
  macro: z
    .object({
      series: z.array(z.string().trim().min(1).max(40)).min(1).max(MAX_MACRO_SERIES),
      from: z.iso.date().optional(),
    })
    .optional(),
};

type ExtraRequest = {
  fundamentals?: {
    concepts: string[];
    frequency: "annual" | "quarterly" | "all";
    since?: number;
  };
  macro?: { series: string[]; from?: string };
};

export type ExtraData = {
  fundamentals: Record<string, SymbolFundamentals["concepts"]>;
  macro: Record<string, MacroObservation[]>;
  missingFundamentals: string[];
  missingMacro: string[];
};

const countPoints = (rows: FundamentalPoint[][]) =>
  rows.reduce((sum, list) => sum + list.length, 0);

async function loadAllFundamentals(
  symbols: string[],
  request: NonNullable<ExtraRequest["fundamentals"]>,
) {
  const result: ExtraData["fundamentals"] = {};
  const missing: string[] = [];
  const until = Date.now() + FUNDAMENTALS_BUDGET_MS;
  let next = 0;
  let points = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      if (Date.now() > until) {
        missing.push(symbol);
        continue;
      }
      try {
        const loaded = await loadFundamentals(
          symbol,
          request.concepts,
          request.frequency,
          request.since,
        );
        if (!loaded) {
          missing.push(symbol);
          continue;
        }
        points += countPoints(Object.values(loaded.concepts));
        if (points > MAX_POINTS)
          throw new Error(
            `Fundamentals exceed ${MAX_POINTS.toLocaleString("en-US")} data points. Request fewer concepts or symbols, frequency "annual", or a later since year.`,
          );
        result[symbol] = loaded.concepts;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Fundamentals exceed"))
          throw error;
        missing.push(symbol);
      }
    }
  };
  await Promise.all(Array.from({ length: FUNDAMENTALS_CONCURRENCY }, worker));
  return { result, missing };
}

async function loadAllMacro(request: NonNullable<ExtraRequest["macro"]>) {
  const ids = [...new Set(request.series.map((id) => id.toUpperCase()))];
  const result: ExtraData["macro"] = {};
  const missing: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const series = await fredSeries(id, request.from);
        if (series.observations.length === 0) missing.push(id);
        else result[id] = series.observations;
      } catch {
        missing.push(id);
      }
    }),
  );
  return { result, missing };
}

export async function loadExtra(
  symbols: string[],
  request: ExtraRequest,
): Promise<ExtraData> {
  if (request.fundamentals && symbols.length === 0)
    throw new Error("data.fundamentals needs data.symbols or data.universe.");
  const [fundamentals, macro] = await Promise.all([
    request.fundamentals
      ? loadAllFundamentals(symbols, request.fundamentals)
      : { result: {}, missing: [] },
    request.macro ? loadAllMacro(request.macro) : { result: {}, missing: [] },
  ]);
  const macroPoints = Object.values(macro.result).reduce((sum, list) => sum + list.length, 0);
  if (macroPoints > MAX_POINTS)
    throw new Error(
      `Macro series exceed ${MAX_POINTS.toLocaleString("en-US")} observations. Pass macro.from to shorten the window or request fewer series.`,
    );
  return {
    fundamentals: fundamentals.result,
    macro: macro.result,
    missingFundamentals: fundamentals.missing,
    missingMacro: macro.missing,
  };
}

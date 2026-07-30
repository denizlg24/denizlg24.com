import type { FinanceFxSnapshot as FinanceFxSnapshotInput } from "@repo/schemas";
import { convertMinorWithRate } from "@repo/utils";
import type mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceAccount,
  FinanceFxSnapshot,
  FinanceLedgerEntry,
} from "@/models/Finance";
import { upsertFinanceFxSnapshot } from "./operations";
import { getFinanceSettings, markFinanceFxRefreshed } from "./settings";

/**
 * Exchange-rate ingestion.
 *
 * Rates are stored in `finance_fx_snapshots` as `rateMicros` — units of
 * `quoteCurrency` per one unit of `baseCurrency`, in MAJOR units, scaled by
 * 1e6. `convertMinorToBase` in dashboard.ts reads them back.
 *
 * Shaped as a provider interface for the same reason `providers/` is: swapping
 * to a keyed source with wider coverage should be a new file, not a rewrite.
 */

export interface FinanceFxProvider {
  readonly source: string;
  /** Latest rates for each quote currency against `base`. */
  fetchLatest(
    base: string,
    quotes: string[],
  ): Promise<{ date: string; rates: Record<string, number> }>;
}

/** Structural fetch signature — looser than `typeof fetch`, which wants `preconnect`. */
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const frankfurterResponseSchema = z.object({
  base: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive()),
});

/**
 * Frankfurter — ECB reference rates, free and unauthenticated.
 *
 * Covers only the ~30 currencies the ECB publishes, updates on weekdays around
 * 16:00 CET, and has no crypto. A currency it doesn't carry simply gets no
 * snapshot, and the dashboard reports those balances under
 * `unconvertedByCurrency` rather than folding them into the total.
 */
export class FrankfurterFxProvider implements FinanceFxProvider {
  readonly source = "frankfurter";
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.frankfurter.dev/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchLatest(base: string, quotes: string[]) {
    const wanted = quotes.filter((code) => code !== base);
    if (wanted.length === 0) return { date: today(), rates: {} };
    const url = new URL(`${this.baseUrl}/latest`);
    url.searchParams.set("base", base);
    url.searchParams.set("symbols", wanted.join(","));
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Frankfurter responded with HTTP ${response.status}`);
    }
    const parsed = frankfurterResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Frankfurter returned an unexpected payload");
    }
    return { date: parsed.data.date, rates: parsed.data.rates };
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function createFinanceFxProvider(
  source: "frankfurter",
): FinanceFxProvider {
  if (source === "frankfurter") return new FrankfurterFxProvider();
  throw new Error(`Unsupported FX source: ${source}`);
}

/** Every currency the ledger actually holds, so no rate is fetched needlessly. */
export async function financeCurrenciesInUse(): Promise<string[]> {
  await connectDB();
  const [accountCurrencies, ledgerCurrencies] = await Promise.all([
    FinanceAccount.distinct("currency"),
    FinanceLedgerEntry.distinct("currency"),
  ]);
  return [
    ...new Set([...accountCurrencies, ...ledgerCurrencies] as string[]),
  ].filter((code) => /^[A-Z]{3}$/.test(code));
}

export interface FinanceFxRefreshResult {
  base: string;
  source: string;
  date: string;
  updated: number;
  /** Currencies in use the source has no rate for. */
  unsupported: string[];
}

export async function refreshFinanceFxRates(
  options: { provider?: FinanceFxProvider; now?: Date } = {},
): Promise<FinanceFxRefreshResult> {
  const settings = await getFinanceSettings();
  const provider =
    options.provider ?? createFinanceFxProvider(settings.fxSource);
  const base = settings.baseCurrency;
  const quotes = (await financeCurrenciesInUse()).filter(
    (code) => code !== base,
  );
  if (quotes.length === 0) {
    const now = options.now ?? new Date();
    await markFinanceFxRefreshed(now);
    return {
      base,
      source: provider.source,
      date: now.toISOString().slice(0, 10),
      updated: 0,
      unsupported: [],
    };
  }

  const { date, rates } = await provider.fetchLatest(base, quotes);
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const snapshots: FinanceFxSnapshotInput[] = [];
  const unsupported: string[] = [];
  for (const quote of quotes) {
    const rate = rates[quote];
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      unsupported.push(quote);
      continue;
    }
    snapshots.push({
      date,
      baseCurrency: base,
      quoteCurrency: quote,
      rateMicros: Math.round(rate * 1_000_000),
      source: provider.source,
      fetchedAt,
    });
  }

  for (const snapshot of snapshots) {
    await upsertFinanceFxSnapshot(snapshot);
  }
  await markFinanceFxRefreshed(new Date(fetchedAt));

  return {
    base,
    source: provider.source,
    date,
    updated: snapshots.length,
    unsupported,
  };
}

export interface FinanceFxRate {
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: number;
}

/**
 * Converts between any two currencies the snapshots cover.
 *
 * Snapshots are all quoted against the pinned base, so a non-base pair is
 * resolved by pivoting through it (USD→EUR→GBP). Returns `undefined` rather
 * than guessing when no rate applies — callers must treat that as "cannot
 * compare", never as zero.
 */
export function createFinanceFxConverter(snapshots: FinanceFxRate[]) {
  // Snapshots arrive date-descending, so the first match on or before the
  // requested date is the most recent applicable rate.
  function directRate(from: string, to: string, date?: string) {
    for (const snapshot of snapshots) {
      if (date && snapshot.date > date) continue;
      if (snapshot.baseCurrency === from && snapshot.quoteCurrency === to) {
        return {
          rateMicros: snapshot.rateMicros,
          direction: "toQuote" as const,
        };
      }
      if (snapshot.baseCurrency === to && snapshot.quoteCurrency === from) {
        return {
          rateMicros: snapshot.rateMicros,
          direction: "toBase" as const,
        };
      }
    }
    return undefined;
  }

  function convert(
    amountMinor: number,
    from: string,
    to: string,
    date?: string,
  ): number | undefined {
    if (from === to) return amountMinor;

    const direct = directRate(from, to, date);
    if (direct) {
      return convertMinorWithRate({
        amountMinor,
        fromCurrency: from,
        toCurrency: to,
        rateMicros: direct.rateMicros,
        direction: direct.direction,
      });
    }

    for (const pivot of new Set(snapshots.map((row) => row.baseCurrency))) {
      if (pivot === from || pivot === to) continue;
      const first = directRate(from, pivot, date);
      const second = directRate(pivot, to, date);
      if (!first || !second) continue;
      const intermediate = convertMinorWithRate({
        amountMinor,
        fromCurrency: from,
        toCurrency: pivot,
        rateMicros: first.rateMicros,
        direction: first.direction,
      });
      return convertMinorWithRate({
        amountMinor: intermediate,
        fromCurrency: pivot,
        toCurrency: to,
        rateMicros: second.rateMicros,
        direction: second.direction,
      });
    }
    return undefined;
  }

  return { convert };
}

export type FinanceFxConverter = ReturnType<typeof createFinanceFxConverter>;

const CONVERTER_SNAPSHOT_LIMIT = 2_000;

export async function loadFinanceFxConverter(
  session?: mongoose.ClientSession,
): Promise<FinanceFxConverter> {
  const snapshots = await FinanceFxSnapshot.find()
    .sort({ date: -1 })
    .limit(CONVERTER_SNAPSHOT_LIMIT)
    .session(session ?? null)
    .lean();
  return createFinanceFxConverter(snapshots);
}

/** True when today's rates for the pinned base are already stored. */
export async function financeFxIsFresh(now = new Date()) {
  await connectDB();
  const settings = await getFinanceSettings();
  const existing = await FinanceFxSnapshot.findOne({
    baseCurrency: settings.baseCurrency,
    date: now.toISOString().slice(0, 10),
  });
  return Boolean(existing);
}

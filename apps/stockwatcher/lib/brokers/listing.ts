import "server-only";
import { series } from "../market";
import type { BrokerStatement } from "./ibkr";

const staleAfterSeconds = 14 * 86_400;
const concurrency = 6;

type Probe = "live" | "wrong" | "unknown";

async function probe(symbol: string, currency: string): Promise<Probe> {
  try {
    const { quote } = await series(symbol, "1D");
    if (!quote) return "wrong";
    const fresh = Date.now() / 1000 - quote.time < staleAfterSeconds;
    return fresh && quote.currency === currency ? "live" : "wrong";
  } catch (error) {
    return error instanceof Error && error.message === "Symbol not found"
      ? "wrong"
      : "unknown";
  }
}

/**
 * Yahoo keys secondary-currency lines of one Euronext listing as
 * BASE-CCY.SUFFIX (GOLD.PA is the dead USD line, GOLD-EUR.PA the live EUR one).
 * Minor-unit currencies (GBp, ZAc) never use this form.
 */
function currencyLine(symbol: string, currency: string) {
  const dot = symbol.lastIndexOf(".");
  if (dot <= 0 || currency !== currency.toUpperCase()) return null;
  return `${symbol.slice(0, dot)}-${currency}${symbol.slice(dot)}`;
}

async function resolve(symbol: string, currency: string) {
  if ((await probe(symbol, currency)) !== "wrong") return symbol;
  const alternative = currencyLine(symbol, currency);
  if (alternative && (await probe(alternative, currency)) === "live")
    return alternative;
  return symbol;
}

/** Swaps mapped listings that Yahoo quotes in another currency or no longer updates. */
export async function resolveListings(
  statement: BrokerStatement,
): Promise<BrokerStatement> {
  const keys = [
    ...new Set(
      statement.accounts.flatMap((account) =>
        account.lots.map((lot) => `${lot.symbol}\n${lot.currency}`),
      ),
    ),
  ];
  const resolved = new Map<string, string>();
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    const symbols = await Promise.all(
      batch.map((key) => {
        const [symbol, currency] = key.split("\n") as [string, string];
        return resolve(symbol, currency);
      }),
    );
    batch.forEach((key, index) => resolved.set(key, symbols[index]!));
  }
  return {
    ...statement,
    accounts: statement.accounts.map((account) => ({
      ...account,
      lots: account.lots.map((lot) => ({
        ...lot,
        symbol: resolved.get(`${lot.symbol}\n${lot.currency}`) ?? lot.symbol,
      })),
    })),
  };
}

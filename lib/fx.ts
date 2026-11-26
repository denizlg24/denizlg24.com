import "server-only";
import { fxSymbols, resolveFxRates } from "./fx-rates";
import { quotes } from "./market";

export async function fxRates(currencies: string[], base: string) {
  const symbols = fxSymbols(currencies, base);
  const live = symbols.length ? await quotes(symbols).catch(() => []) : [];
  return resolveFxRates(live, currencies, base);
}

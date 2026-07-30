/**
 * Minor-unit helpers.
 *
 * Amounts are stored as integer minor units, but "minor unit" is not always
 * 1/100: JPY and KRW have no fractional part at all, so ¥100 is 100 minor
 * units, not 1. Anything that divides by 100 or converts between currencies
 * has to go through the currency's own exponent or it is wrong by 100x.
 */

const exponentCache = new Map<string, number>();

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;
  let exponent = 2;
  try {
    exponent =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    exponent = 2;
  }
  exponentCache.set(code, exponent);
  return exponent;
}

export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyExponent(currency);
}

export function majorToMinor(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyExponent(currency));
}

/**
 * Converts between currencies given a rate expressed in **major** units of
 * `quoteCurrency` per one major unit of `baseCurrency`, scaled by 1e6.
 *
 * `direction` says which way the amount is travelling relative to that rate:
 * `"toBase"` takes an amount in `quoteCurrency` and returns `baseCurrency`.
 */
export function convertMinorWithRate(input: {
  amountMinor: number;
  fromCurrency: string;
  toCurrency: string;
  rateMicros: number;
  direction: "toBase" | "toQuote";
}): number {
  const fromScale = 10 ** currencyExponent(input.fromCurrency);
  const toScale = 10 ** currencyExponent(input.toCurrency);
  const major = input.amountMinor / fromScale;
  const converted =
    input.direction === "toBase"
      ? (major * 1_000_000) / input.rateMicros
      : (major * input.rateMicros) / 1_000_000;
  return Math.round(converted * toScale);
}

/** Formats a minor-unit amount using the currency's own fraction digits. */
export function formatMoney(
  amountMinor: number,
  currency: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const exponent = currencyExponent(currency);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    ...options,
  }).format(minorToMajor(amountMinor, currency));
}

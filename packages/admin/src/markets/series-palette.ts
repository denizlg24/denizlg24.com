/**
 * Fixed-order categorical hues for per-symbol series, validated for deuteranopia,
 * protanopia and tritanopia separation against both the light and dark chart
 * surfaces. The order is the contract: hue is assigned by a symbol's rank in the
 * full contribution list once, then held, so toggling a series off never
 * repaints the ones still on screen.
 *
 * Blue and grey are deliberately absent — they belong to the portfolio total and
 * its benchmark — as are green and red, which mean gain and loss everywhere else
 * in this app and would misread as polarity if they also meant identity here.
 */
export const SERIES_PALETTE = [
  "#ea580c",
  "#0d9488",
  "#7c3aed",
  "#db2777",
  "#65a30d",
  "#0891b2",
  "#b45309",
] as const;

export const PORTFOLIO_COLOR = "#2563eb";
export const BENCHMARK_COLOR = "#94a3b8";
/** Everything past the palette, pooled rather than given an invented hue. */
export const OTHER_COLOR = "#64748b";
export const OTHER_KEY = "__other";

/**
 * Assigns a hue per ticker in the order given. Callers pass the server's
 * ranking, which is stable across refreshes, so a symbol keeps its colour for as
 * long as it keeps its place in the portfolio.
 */
export function assignSeriesColors(tickers: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  tickers.forEach((ticker, index) => {
    colors.set(
      ticker,
      index < SERIES_PALETTE.length
        ? (SERIES_PALETTE[index] as string)
        : OTHER_COLOR,
    );
  });
  return colors;
}

/** Tickers past the palette are pooled into one "Other" series. */
export function splitByPalette<T extends { ticker: string }>(
  items: T[],
): { named: T[]; pooled: T[] } {
  return {
    named: items.slice(0, SERIES_PALETTE.length),
    pooled: items.slice(SERIES_PALETTE.length),
  };
}

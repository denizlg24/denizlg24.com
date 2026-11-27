import { benchmarks } from "./universes";

export const maxTickerSymbols = 24;
export const defaultTicker: string[] = Object.keys(benchmarks);

const labels: Record<string, string> = benchmarks;
export const tickerLabel = (symbol: string) => labels[symbol] ?? symbol;

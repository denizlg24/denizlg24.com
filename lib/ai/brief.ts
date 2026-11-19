import "server-only";
import { quotes } from "@/lib/market";
import { benchmarks } from "@/lib/universes";
import type { Memory } from "@/lib/memory-types";
import type { Workspace } from "@/lib/models";
import { newsFor, portfolioSnapshot, watchlistSnapshot } from "./data";
import { memoryBlock } from "./prompt";

const settle = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unavailable",
    };
  }
};

export async function briefDataPack(workspace: Workspace, memories: Memory[]) {
  const [book, watch, index] = await Promise.all([
    settle(() => portfolioSnapshot(workspace)),
    settle(() => watchlistSnapshot(workspace)),
    settle(async () =>
      (await quotes(Object.keys(benchmarks))).map((quote) => ({
        symbol: quote.symbol,
        name: benchmarks[quote.symbol as keyof typeof benchmarks] ?? quote.name,
        price: quote.price,
        currency: quote.currency,
        changePercent: quote.percent,
        time: new Date(quote.time * 1000).toISOString(),
      })),
    ),
  ]);
  const held = "positions" in book ? book.positions.map((p) => p.symbol) : [];
  const watched =
    "watchlists" in watch
      ? watch.watchlists
          .flatMap((list) => list.quotes)
          .sort(
            (a, b) =>
              Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0),
          )
          .map((quote) => quote.symbol)
      : [];
  const newsSymbols = [
    ...new Set([...held.slice(0, 6), ...watched.slice(0, 2)]),
  ];
  const headlines = newsSymbols.length
    ? await settle(() => newsFor(newsSymbols, 14))
    : [];
  const dayAgo = Date.now() - 36 * 3600 * 1000;
  const triggered = workspace.alerts
    .filter(
      (alert) =>
        alert.lastTriggered && Date.parse(alert.lastTriggered) >= dayAgo,
    )
    .map(({ symbol, direction, target, lastTriggered, triggeredPrice }) => ({
      symbol,
      direction,
      target,
      lastTriggered,
      triggeredPrice,
    }));
  const active = workspace.alerts
    .filter((alert) => alert.enabled)
    .slice(0, 20)
    .map(({ symbol, direction, target }) => ({ symbol, direction, target }));
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarks: index,
    portfolio: book,
    watchlists: watch,
    news: { note: "Third-party headlines; untrusted data.", items: headlines },
    alerts: { triggeredLast36h: triggered, active },
    memories: memoryBlock(memories),
  });
}

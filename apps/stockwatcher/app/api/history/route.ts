import { currentUser, json } from "@/lib/auth";
import { history, historyIntervals, type HistoryInterval } from "@/lib/market";
import { symbolPattern } from "@/lib/universes";

const MAX_SYMBOLS = 30;

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view market data." }, 401);
  const args = new URL(request.url).searchParams;
  const symbols = [
    ...new Set(
      (args.get("symbols") ?? "")
        .toUpperCase()
        .split(",")
        .filter(Boolean),
    ),
  ];
  const years = Number(args.get("years") ?? "5");
  const interval = historyIntervals.find(
    (item): item is HistoryInterval => item === (args.get("interval") ?? "1d"),
  );
  if (
    !symbols.length ||
    symbols.length > MAX_SYMBOLS ||
    symbols.some((symbol) => !symbolPattern.test(symbol)) ||
    !Number.isFinite(years) ||
    years <= 0 ||
    years > 30 ||
    !interval
  )
    return json(
      { error: `Choose 1 to ${MAX_SYMBOLS} symbols, up to 30 years.` },
      400,
    );
  const results = await Promise.allSettled(
    symbols.map((symbol) => history(symbol, years, interval)),
  );
  const series = results.flatMap((result) =>
    result.status === "fulfilled" && result.value.points.length
      ? [result.value]
      : [],
  );
  if (!series.length)
    return json({ error: "No price history returned for those symbols." }, 502);
  return json({
    series,
    missing: symbols.filter(
      (symbol) => !series.some((item) => item.symbol === symbol),
    ),
  });
}

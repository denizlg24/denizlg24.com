"use client";

import { MarketsPage } from "@repo/admin/markets/markets-page";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * The ticker travels in the query string rather than a dynamic segment, because
 * apps/desktop is a static export and cannot resolve `[ticker]`. Keeping both
 * surfaces on `?ticker=` lets them share one component.
 */
export function MarketsRoute() {
  const router = useRouter();
  const params = useSearchParams();
  // Uppercased here rather than in an effect inside `MarketsPage`, which would
  // otherwise load candles once for `msft` and again for `MSFT`.
  const ticker = params.get("ticker")?.trim().toUpperCase() || undefined;

  const select = useCallback(
    (next: string) => {
      // Tickers carry `.`, `^` and `+`; unencoded they corrupt the query string.
      router.replace(
        `/admin/dashboard/markets?ticker=${encodeURIComponent(next)}`,
        { scroll: false },
      );
    },
    [router],
  );

  return <MarketsPage ticker={ticker} onSelectTicker={select} />;
}

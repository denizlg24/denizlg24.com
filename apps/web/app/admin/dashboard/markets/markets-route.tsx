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
  const ticker = params.get("ticker") ?? undefined;

  const select = useCallback(
    (next: string) => {
      router.replace(`/admin/dashboard/markets?ticker=${next}`, {
        scroll: false,
      });
    },
    [router],
  );

  return <MarketsPage ticker={ticker} onSelectTicker={select} />;
}

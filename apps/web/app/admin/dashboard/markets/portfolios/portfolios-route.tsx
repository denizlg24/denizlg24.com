"use client";

import { PortfoliosPage } from "@repo/admin/markets/portfolios-page";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** `?portfolio=` rather than a segment, matching the markets route. */
export function PortfoliosRoute() {
  const router = useRouter();
  const params = useSearchParams();

  const select = useCallback(
    (id: string) => {
      router.replace(`/admin/dashboard/markets/portfolios?portfolio=${id}`, {
        scroll: false,
      });
    },
    [router],
  );

  const openSymbol = useCallback(
    (ticker: string) => {
      router.push(
        `/admin/dashboard/markets?ticker=${encodeURIComponent(ticker)}`,
      );
    },
    [router],
  );

  return (
    <PortfoliosPage
      portfolioId={params.get("portfolio") ?? undefined}
      onSelectPortfolio={select}
      onSelectTicker={openSymbol}
    />
  );
}

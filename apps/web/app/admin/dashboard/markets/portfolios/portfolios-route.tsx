"use client";

import { PortfoliosPage } from "@repo/admin/markets/portfolios-page";
import { useAdmin } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** `?portfolio=` rather than a segment, matching the markets route. */
export function PortfoliosRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const { routes } = useAdmin();

  const select = useCallback(
    (id: string) => {
      router.replace(routes.market.portfolio(id), { scroll: false });
    },
    [router, routes],
  );

  const openSymbol = useCallback(
    (ticker: string) => {
      router.push(routes.market.ticker(ticker));
    },
    [router, routes],
  );

  return (
    <PortfoliosPage
      portfolioId={params.get("portfolio") ?? undefined}
      onSelectPortfolio={select}
      onSelectTicker={openSymbol}
    />
  );
}

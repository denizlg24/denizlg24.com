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
      router.replace(`/admin/dashboard/finance/portfolios?portfolio=${id}`, {
        scroll: false,
      });
    },
    [router],
  );

  return (
    <PortfoliosPage
      portfolioId={params.get("portfolio") ?? undefined}
      onSelectPortfolio={select}
    />
  );
}

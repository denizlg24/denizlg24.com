"use client";

import {
  PortfoliosPage,
  PortfoliosSkeleton,
} from "@repo/admin/markets/portfolios-page";
import { AdminProvider } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

/** `?portfolio=` rather than a segment: this app is a static export. */
function PortfoliosRoute() {
  const { value, loading } = useDesktopAdmin();
  const router = useRouter();
  const params = useSearchParams();

  const select = useCallback(
    (id: string) => {
      router.replace(`/dashboard/finance/portfolios?portfolio=${id}`, {
        scroll: false,
      });
    },
    [router],
  );

  return (
    <AdminProvider value={value}>
      {loading ? (
        <PortfoliosSkeleton />
      ) : (
        <PortfoliosPage
          portfolioId={params.get("portfolio") ?? undefined}
          onSelectPortfolio={select}
        />
      )}
    </AdminProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PortfoliosSkeleton />}>
      <PortfoliosRoute />
    </Suspense>
  );
}

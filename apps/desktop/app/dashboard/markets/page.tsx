"use client";

import { MarketsPage, MarketsSkeleton } from "@repo/admin/markets/markets-page";
import { AdminProvider } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

/** `?ticker=` rather than a segment: this app is a static export. */
function MarketsRoute() {
  const { value, loading } = useDesktopAdmin();
  const router = useRouter();
  const params = useSearchParams();

  const select = useCallback(
    (next: string) => {
      router.replace(`/dashboard/markets?ticker=${next}`, {
        scroll: false,
      });
    },
    [router],
  );

  return (
    <AdminProvider value={value}>
      {loading ? (
        <MarketsSkeleton />
      ) : (
        <MarketsPage
          ticker={params.get("ticker") ?? undefined}
          onSelectTicker={select}
        />
      )}
    </AdminProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<MarketsSkeleton />}>
      <MarketsRoute />
    </Suspense>
  );
}

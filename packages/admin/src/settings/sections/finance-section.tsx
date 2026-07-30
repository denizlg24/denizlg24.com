"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFinanceDashboard } from "../../finance/finance-data";
import { FinanceSettingsForm } from "../../finance/finance-settings";
import { useAdmin } from "../../provider";

export function FinanceSection() {
  const { client } = useAdmin();
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await fetchFinanceDashboard(client));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load finance",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="grid gap-8 lg:grid-cols-2">
        {[0, 1].map((column) => (
          <div key={column} className="space-y-4">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return <FinanceSettingsForm data={data} onReload={load} />;
}

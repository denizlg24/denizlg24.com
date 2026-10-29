"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFinanceDashboard } from "../../finance/finance-data";
import { FinanceSettingsForm } from "../../finance/finance-settings";
import { useAdmin } from "../../provider";

export function FinanceSection() {
  const { client } = useAdmin();
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await fetchFinanceDashboard(client));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load finance",
      );
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !data) {
    return (
      <EmptyState
        label="Load failed"
        action={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCcw /> Retry
          </Button>
        }
      />
    );
  }

  if (loading || !data) {
    return (
      <>
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ))}
      </>
    );
  }

  return <FinanceSettingsForm data={data} onReload={load} />;
}

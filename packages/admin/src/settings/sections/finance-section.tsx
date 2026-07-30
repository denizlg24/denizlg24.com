"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
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
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-status-warning">
          Load failed
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-1.5 text-[11px]"
          onClick={() => void load()}
        >
          <RotateCcw className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

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

"use client";

import { pluralize } from "@repo/cloud-ui/format";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  type ActivityFilterState,
  ActivityFilters,
  DEFAULT_FILTERS,
} from "./_components/activity-filters";
import { ActivityTable } from "./_components/activity-table";
import { NotificationHistory } from "./_components/notification-history";

const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1_000;

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-20 w-full" />
      {Array.from({ length: 14 }, (_, index) => (
        <Skeleton key={index} className="h-5 w-full" />
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  // `filters` is state, so its identity only changes when a filter actually
  // changes — which is exactly when usePoll should restart.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // `from` is recomputed per call rather than memoised so a relative window
  // stays relative — a poll an hour later must not still ask for the old hour.
  const activityQuery = useCallback(
    () => ({
      category: filters.category.length > 0 ? filters.category : undefined,
      severity: filters.severity.length > 0 ? filters.severity : undefined,
      actorType: filters.actorType.length > 0 ? filters.actorType : undefined,
      method: filters.method.length > 0 ? filters.method : undefined,
      statusClass: filters.statusClass === "" ? undefined : filters.statusClass,
      action: filters.action || undefined,
      actorId: filters.actorId || undefined,
      pathPrefix: filters.pathPrefix || undefined,
      ip: filters.ip || undefined,
      minDurationMs: filters.minDurationMs
        ? Number(filters.minDurationMs)
        : undefined,
      q: filters.q || undefined,
      from:
        filters.windowHours > 0
          ? new Date(Date.now() - filters.windowHours * HOUR_MS).toISOString()
          : undefined,
    }),
    [filters],
  );

  const fetchActivity = useCallback(
    () => api.activity.list({ page, limit: PAGE_SIZE, ...activityQuery() }),
    [activityQuery, page],
  );

  const { data, error, unreachable, loading, reload } = usePoll(
    fetchActivity,
    30_000,
  );

  const fetchFacets = useCallback(() => api.activity.facets(7), []);
  const { data: facets } = usePoll(fetchFacets, 5 * 60_000);

  const fetchNotifications = useCallback(() => api.notifications.list(25), []);
  const { data: notifications, reload: reloadNotifications } = usePoll(
    fetchNotifications,
    60_000,
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Exports whatever the filters currently select, not the page on screen —
  // pagination is a reading aid, and a shared file that stopped at 100 rows
  // would be a trap.
  const runExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      await api.activity.exportNdjson(activityQuery());
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "export failed");
    } finally {
      setExporting(false);
    }
  }, [activityQuery]);

  const pagination = data?.pagination;
  const pageLabel = useMemo(
    () =>
      pagination
        ? `${pluralize(pagination.total, "entry", "entries")} · page ${pagination.page}/${pagination.totalPages}`
        : "",
    [pagination],
  );

  if (!data) {
    if (unreachable) {
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    }
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <ActivitySkeleton />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="activity">
        <ActivityFilters
          filters={filters}
          facets={facets ?? null}
          onChange={setFilters}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {exportError && (
          <p className="text-xs text-destructive">{exportError}</p>
        )}
        <ActivityTable entries={data.items} />
        <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{pageLabel}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={exporting}
              onClick={() => void runExport()}
            >
              <Download className="size-3" />
              {exporting ? "exporting…" : "export"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={
                pagination === undefined || page >= pagination.totalPages
              }
              onClick={() => setPage((current) => current + 1)}
            >
              next
            </Button>
          </div>
        </div>
      </Section>

      <NotificationHistory
        events={notifications ?? []}
        onChanged={() => void reloadNotifications()}
      />
    </div>
  );
}

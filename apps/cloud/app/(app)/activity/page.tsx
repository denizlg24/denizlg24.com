"use client";

import { pluralize } from "@repo/cloud-ui/format";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
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

  const fetchActivity = useCallback(
    () =>
      api.activity.list({
        page,
        limit: PAGE_SIZE,
        category: filters.category.length > 0 ? filters.category : undefined,
        severity: filters.severity.length > 0 ? filters.severity : undefined,
        statusClass:
          filters.statusClass === "" ? undefined : filters.statusClass,
        action: filters.action || undefined,
        actorId: filters.actorId || undefined,
        q: filters.q || undefined,
        from:
          filters.windowHours > 0
            ? new Date(Date.now() - filters.windowHours * HOUR_MS).toISOString()
            : undefined,
      }),
    [filters, page],
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
        <ActivityTable entries={data.items} />
        <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{pageLabel}</span>
          <div className="flex items-center gap-1">
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

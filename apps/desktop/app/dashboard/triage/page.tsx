"use client";

import { Button } from "@repo/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { cn } from "@repo/ui/utils";
import { Archive, Brain, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IEmailTriage,
  TriageFilter,
  TriageListResponse,
} from "@/lib/data-types";
import { TriageDetail } from "./_components/triage-detail";
import { TriageLoadingSkeleton } from "./_components/triage-loading-skeleton";
import { TriagePagination } from "./_components/triage-pagination";
import { TriageRow } from "./_components/triage-row";

const TRIAGE_PAGE_SIZE = 12;
const PREFETCH_PAGE_COUNT = 3;

const FILTERS: { value: TriageFilter; label: string }[] = [
  { value: "review", label: "Needs Review" },
  { value: "action-needed", label: "Action Needed" },
  { value: "purchases", label: "Purchases" },
  { value: "scheduled", label: "Scheduled" },
  { value: "fyi", label: "FYI" },
  { value: "newsletter", label: "Newsletters" },
  { value: "promo", label: "Promo" },
  { value: "spam", label: "Spam" },
  { value: "archived", label: "Archived" },
];

function isTriageFilter(value: string): value is TriageFilter {
  return FILTERS.some((filter) => filter.value === value);
}

function getPrefetchBlockStart(pageIndex: number) {
  return Math.floor(pageIndex / PREFETCH_PAGE_COUNT) * PREFETCH_PAGE_COUNT;
}

function getPrefetchBlockKey(
  filter: TriageFilter,
  pageIndex: number,
  pageSize: number,
) {
  return `${filter}:${getPrefetchBlockStart(pageIndex)}:${pageSize}`;
}

function splitItemsIntoPages<T>(
  items: T[],
  offset: number,
  pageSize: number,
): Record<number, T[]> {
  const firstPageIndex = Math.floor(offset / pageSize);
  const pages: Record<number, T[]> = {};

  for (let index = 0; index < items.length; index += pageSize) {
    pages[firstPageIndex + index / pageSize] = items.slice(
      index,
      index + pageSize,
    );
  }

  return pages;
}

function getTriageEndpoint(
  filter: TriageFilter,
  offset: number,
  limit: number,
): string {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  if (filter === "archived") {
    params.set("status", "archived");
    return `triage?${params.toString()}`;
  }

  params.set("status", "open");
  if (filter === "review") {
    params.set("reviewRequired", "true");
    return `triage?${params.toString()}`;
  }
  params.set("category", filter);
  return `triage?${params.toString()}`;
}

export default function TriagePage() {
  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [itemsByPage, setItemsByPage] = useState<
    Record<number, IEmailTriage[]>
  >({});
  const [totalRows, setTotalRows] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TriageFilter>("review");
  const [pageIndex, setPageIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  const loadedBlocksRef = useRef<Set<string>>(new Set());
  const inFlightBlocksRef = useRef<Set<string>>(new Set());
  const cacheGenerationRef = useRef(0);

  const items = itemsByPage[pageIndex] ?? [];
  const currentPageLoading = loading && items.length === 0;

  // Emails triaged before bodies were stored still need one IMAP fetch. Doing
  // it for the whole visible page on one connection means the first open of an
  // old row is instant too, instead of each one paying its own login.
  const warmedPagesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!api || items.length === 0) return;
    const key = `${filter}:${pageIndex}`;
    if (warmedPagesRef.current.has(key)) return;
    warmedPagesRef.current.add(key);
    void api.POST<{ ok: boolean }>({
      endpoint: "triage/bodies",
      body: { triageIds: items.map((item) => item._id) },
    });
  }, [api, filter, items, pageIndex]);

  const cacheItems = useCallback((page: TriageListResponse) => {
    setItemsByPage((prev) => ({
      ...prev,
      ...splitItemsIntoPages(page.items, page.offset, TRIAGE_PAGE_SIZE),
    }));
    setTotalRows(page.totalRows);
    if (page.stats) setStats(page.stats);
  }, []);

  const resetItemsCache = useCallback(() => {
    loadedBlocksRef.current = new Set();
    inFlightBlocksRef.current = new Set();
    cacheGenerationRef.current += 1;
    setItemsByPage({});
    setTotalRows(0);
  }, []);

  const fetchItems = useCallback(
    async (options?: { force?: boolean; pageIndex?: number }) => {
      if (!api) return;
      const targetPage = options?.pageIndex ?? pageIndex;
      const blockKey = getPrefetchBlockKey(
        filter,
        targetPage,
        TRIAGE_PAGE_SIZE,
      );
      if (!options?.force && loadedBlocksRef.current.has(blockKey)) {
        setLoading(false);
        return;
      }

      const blockStart = getPrefetchBlockStart(targetPage);
      const generation = cacheGenerationRef.current;

      // A forced fetch has not registered its block key by the time the effect
      // re-runs on the new pageIndex, so without an in-flight guard the same
      // request goes out twice. Scoped by generation so a cache reset can
      // immediately refetch a key that the previous generation still has open.
      const inFlightKey = `${generation}:${blockKey}`;
      if (inFlightBlocksRef.current.has(inFlightKey)) return;
      inFlightBlocksRef.current.add(inFlightKey);

      const offset = blockStart * TRIAGE_PAGE_SIZE;
      const limit = TRIAGE_PAGE_SIZE * PREFETCH_PAGE_COUNT;

      setLoading(true);
      try {
        const res = await api.GET<TriageListResponse>({
          endpoint: getTriageEndpoint(filter, offset, limit),
        });
        if (generation !== cacheGenerationRef.current) return;

        if ("code" in res) {
          toast.error("Failed to load triage");
        } else {
          loadedBlocksRef.current.add(blockKey);
          cacheItems(res);
        }
        setLoading(false);
      } finally {
        inFlightBlocksRef.current.delete(inFlightKey);
      }
    },
    [api, cacheItems, filter, pageIndex],
  );

  const refreshItems = useCallback(async () => {
    resetItemsCache();
    setPageIndex(0);
    await fetchItems({ force: true, pageIndex: 0 });
  }, [fetchItems, resetItemsCache]);

  /**
   * Applies a verdict without leaving the list.
   *
   * The row is dropped from the page rather than refetched: a review queue is
   * worked top to bottom, and re-fetching the block after every decision would
   * reflow the list under the pointer. Counts are adjusted locally and the next
   * block fetch reconciles them.
   */
  const decideInline = useCallback(
    async (item: IEmailTriage, body: Record<string, unknown>) => {
      if (!api) return;
      setDecidingIds((prev) => new Set(prev).add(item._id));

      const res = await api.PATCH<{ ok: boolean; error?: string }>({
        endpoint: `triage/${item._id}`,
        body,
      });

      setDecidingIds((prev) => {
        const next = new Set(prev);
        next.delete(item._id);
        return next;
      });

      if ("code" in res || res.ok === false) {
        toast.error(
          "error" in res && typeof res.error === "string"
            ? res.error
            : "Failed to update",
        );
        return;
      }

      setItemsByPage((prev) => {
        const next: Record<number, IEmailTriage[]> = {};
        for (const [page, rows] of Object.entries(prev)) {
          next[Number(page)] = rows.filter((row) => row._id !== item._id);
        }
        return next;
      });
      setTotalRows((total) => Math.max(0, total - 1));
      setStats((prev) => {
        const bucket = item.reviewRequired ? "review" : item.category;
        return { ...prev, [bucket]: Math.max(0, (prev[bucket] ?? 0) - 1) };
      });
      // The block is now short by one row, so the next visit must refetch it.
      loadedBlocksRef.current.delete(
        getPrefetchBlockKey(filter, pageIndex, TRIAGE_PAGE_SIZE),
      );
    },
    [api, filter, pageIndex],
  );

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const activeFilterLabel =
    FILTERS.find((entry) => entry.value === filter)?.label ?? "Items";

  const handleRun = async () => {
    if (!api) return;
    setRunning(true);
    const res = await api.POST<{
      stats: {
        scanned: number;
        prefilteredSpam: number;
        fullTriaged: number;
        manualReview: number;
      };
    }>({ endpoint: "triage/run", body: {} });
    setRunning(false);
    if ("code" in res) {
      toast.error("Triage run failed");
      return;
    }
    toast.success(
      `Scanned ${res.stats.scanned} · ${res.stats.fullTriaged} classified · ${res.stats.manualReview} need review`,
    );
    await refreshItems();
  };

  const handleArchiveAll = async () => {
    if (!api || filter === "archived") return;

    setArchivingAll(true);
    setSelectedId(null);

    const res = await api.PATCH<{
      ok: boolean;
      modifiedCount: number;
      error?: string;
    }>({
      endpoint: "triage/archive",
      body: { category: filter },
    });

    setArchivingAll(false);

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "message" in res
            ? res.message
            : "Failed to archive items",
      );
      return;
    }

    toast.success(
      res.modifiedCount === 0
        ? `No ${activeFilterLabel.toLowerCase()} items to archive`
        : `Archived ${res.modifiedCount} ${activeFilterLabel.toLowerCase()} item${res.modifiedCount === 1 ? "" : "s"}`,
    );

    await refreshItems();
  };

  if (loadingSettings) {
    return <TriageLoadingSkeleton />;
  }

  const reviewCount = stats.review ?? 0;

  // Selecting an item swaps the whole surface for the email, matching the
  // inbox's list/detail flow rather than overlaying a sheet.
  if (api && selectedId) {
    return (
      <TriageDetail
        api={api}
        triageId={selectedId}
        onBack={() => setSelectedId(null)}
        onChanged={() => refreshItems()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DashboardPageHeader
        icon={<Brain className="size-4 text-muted-foreground" />}
        title={
          <span className="flex items-baseline gap-2">
            <span>Triage</span>
            {reviewCount > 0 && (
              <span className="text-xs font-normal tabular-nums text-status-warning">
                {reviewCount} to review
              </span>
            )}
          </span>
        }
      >
        {filter !== "archived" && filter !== "review" && totalRows > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={handleArchiveAll}
            disabled={loading || archivingAll}
          >
            {archivingAll ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Archive className="size-3.5" />
            )}
            Archive {totalRows}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={handleRun}
          disabled={running || !api}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run now
        </Button>
      </DashboardPageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-4 pt-2">
        <Tabs
          className="min-w-0 shrink-0"
          value={filter}
          onValueChange={(value) => {
            if (isTriageFilter(value) && value !== filter) {
              setSelectedId(null);
              resetItemsCache();
              setPageIndex(0);
              setFilter(value);
            }
          }}
        >
          <TabsList
            variant="line"
            className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
          >
            {FILTERS.map((entry) => {
              const count = stats[entry.value] ?? 0;
              return (
                <TabsTrigger key={entry.value} value={entry.value}>
                  {entry.label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-1.5 tabular-nums",
                        entry.value === filter
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {totalRows > 0 && (
          <TriagePagination
            pageIndex={pageIndex}
            pageSize={TRIAGE_PAGE_SIZE}
            totalRows={totalRows}
            disabled={loading}
            onPageChange={setPageIndex}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {currentPageLoading ? (
            <TriageLoadingSkeleton contentOnly />
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">—</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <TriageRow
                  key={item._id}
                  item={item}
                  selected={item._id === selectedId}
                  busy={decidingIds.has(item._id)}
                  onSelect={() => setSelectedId(item._id)}
                  onConfirm={() =>
                    void decideInline(item, {
                      category: item.category,
                      userStatus: "reviewed",
                    })
                  }
                  onRecategorize={(category) =>
                    void decideInline(item, { category })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

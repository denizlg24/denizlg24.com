"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List } from "@repo/ui/list";
import { Page, PageBody, PageToolbar } from "@repo/ui/page";
import { Spinner } from "@repo/ui/spinner";
import { SplitList, SplitView } from "@repo/ui/split-view";
import { FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
import { Archive, Brain, Inbox, Mail, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IEmailTriage,
  TriageDetailResponse,
  TriageFilter,
  TriageListResponse,
  TriageUpdateInput,
  TriageUpdateResponse,
  TriageWarmBodiesInput,
  TriageWarmBodiesResponse,
} from "@/lib/data-types";
import { TriageDetail } from "./_components/triage-detail";
import {
  TriageListSkeleton,
  TriageLoadingSkeleton,
} from "./_components/triage-loading-skeleton";
import { TriagePagination } from "./_components/triage-pagination";
import { TriageRow } from "./_components/triage-row";

const TRIAGE_PAGE_SIZE = 12;
const PREFETCH_PAGE_COUNT = 3;

const FILTERS: { value: TriageFilter; label: string }[] = [
  { value: "review", label: "Review" },
  { value: "action-needed", label: "Action" },
  { value: "purchases", label: "Purchases" },
  { value: "scheduled", label: "Scheduled" },
  { value: "fyi", label: "FYI" },
  { value: "newsletter", label: "Newsletters" },
  { value: "promo", label: "Promo" },
  { value: "spam", label: "Spam" },
  { value: "archived", label: "Archived" },
];

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
    return new denizApi();
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
  const [selectedItem, setSelectedItem] = useState<IEmailTriage | null>(null);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  const loadedBlocksRef = useRef<Set<string>>(new Set());
  const inFlightBlocksRef = useRef<Set<string>>(new Set());
  const cacheGenerationRef = useRef(0);
  const detailCacheRef = useRef<Map<string, TriageDetailResponse>>(new Map());

  const items = itemsByPage[pageIndex] ?? [];
  const currentPageLoading = loading && items.length === 0;

  // Emails triaged before bodies were stored still need one IMAP fetch. Doing
  // it for the whole visible page on one connection means the first open of an
  // old row is instant too, instead of each one paying its own login.
  //
  // Keyed by the rows themselves, not by `filter:pageIndex`: a refresh can put
  // entirely different rows on the same page of the same filter, and a
  // position-based key would skip warming every one of them.
  const warmedPagesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!api || items.length === 0) return;
    const triageIds = items.map((item) => item._id);
    const key = triageIds.join(",");
    if (warmedPagesRef.current.has(key)) return;
    warmedPagesRef.current.add(key);
    const body: TriageWarmBodiesInput = { triageIds };
    void api.POST<TriageWarmBodiesResponse>({
      endpoint: "triage/bodies",
      body,
    });
  }, [api, items]);

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

  // A change made from the open detail keeps the list where it is: the split
  // view shows both, so jumping back to page one would lose the reader's place.
  const reloadCurrentPage = useCallback(async () => {
    loadedBlocksRef.current = new Set();
    await fetchItems({ force: true });
  }, [fetchItems]);

  /**
   * Applies a verdict without leaving the list.
   *
   * A row that the verdict removes from the active filter is dropped from the
   * page rather than refetched: a review queue is worked top to bottom, and
   * re-fetching the block after every decision would reflow the list under the
   * pointer. Counts are adjusted locally and the next block fetch reconciles
   * them.
   */
  const decideInline = useCallback(
    async (item: IEmailTriage, body: TriageUpdateInput) => {
      if (!api) return;
      setDecidingIds((prev) => new Set(prev).add(item._id));

      const res = await api.PATCH<TriageUpdateResponse>({
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

      // What the row becomes. Both verdicts clear `reviewRequired`, and only
      // `category` moves it between category tabs.
      const nextCategory = body.category ?? item.category;
      // The archived tab selects on `userStatus`, which neither verdict
      // changes — an archived row stays archived after being reclassified, so
      // removing it here would hide a record still in the result set.
      const staysVisible =
        filter === "archived" ||
        (filter !== "review" && filter === nextCategory);

      if (staysVisible) {
        setItemsByPage((prev) => {
          const next: Record<number, IEmailTriage[]> = {};
          for (const [page, rows] of Object.entries(prev)) {
            next[Number(page)] = rows.map((row) =>
              row._id === item._id
                ? { ...row, category: nextCategory, reviewRequired: false }
                : row,
            );
          }
          return next;
        });
      } else {
        setItemsByPage((prev) => {
          const next: Record<number, IEmailTriage[]> = {};
          for (const [page, rows] of Object.entries(prev)) {
            next[Number(page)] = rows.filter((row) => row._id !== item._id);
          }
          return next;
        });
        setTotalRows((total) => Math.max(0, total - 1));
        // The block is now short by one row, so the next visit must refetch it.
        loadedBlocksRef.current.delete(
          getPrefetchBlockKey(filter, pageIndex, TRIAGE_PAGE_SIZE),
        );
      }

      setStats((prev) => {
        const from = item.reviewRequired ? "review" : item.category;
        const to = nextCategory;
        if (from === to) return prev;
        return {
          ...prev,
          [from]: Math.max(0, (prev[from] ?? 0) - 1),
          [to]: (prev[to] ?? 0) + 1,
        };
      });
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
    setSelectedItem(null);

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
  const archivable = filter !== "archived" && filter !== "review";

  const changeFilter = (value: TriageFilter) => {
    if (value === filter) return;
    setSelectedItem(null);
    resetItemsCache();
    setPageIndex(0);
    setFilter(value);
  };

  return (
    <Page>
      <DashboardPageHeader
        icon={<Brain />}
        title={
          <span className="flex items-center gap-2">
            Triage
            {reviewCount > 0 ? (
              <Badge variant="warning">{reviewCount}</Badge>
            ) : null}
          </span>
        }
      >
        {archivable && totalRows > 0 ? (
          <ConfirmButton
            trigger={
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || archivingAll}
              >
                {archivingAll ? <Spinner className="size-3.5" /> : <Archive />}
                Archive {totalRows}
              </Button>
            }
            title={`Archive ${totalRows} ${activeFilterLabel.toLowerCase()}?`}
            actionLabel="Archive"
            onConfirm={handleArchiveAll}
          />
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRun}
          disabled={running || !api}
        >
          {running ? <Spinner className="size-3.5" /> : <Play />}
          Run
        </Button>
      </DashboardPageHeader>

      <PageToolbar>
        <FilterTabs
          value={filter}
          onChange={changeFilter}
          options={FILTERS.map((entry) => ({
            value: entry.value,
            label: entry.label,
            count: stats[entry.value] ? stats[entry.value] : undefined,
          }))}
        />
        <ToolbarSpacer />
        {totalRows > 0 ? (
          <TriagePagination
            pageIndex={pageIndex}
            pageSize={TRIAGE_PAGE_SIZE}
            totalRows={totalRows}
            disabled={loading}
            onPageChange={setPageIndex}
          />
        ) : null}
      </PageToolbar>

      <PageBody bleed className="flex">
        <SplitView
          listWidth="md:w-[26rem]"
          detailOpen={selectedItem !== null}
          list={
            <SplitList>
              {currentPageLoading ? (
                <TriageListSkeleton />
              ) : items.length === 0 ? (
                <EmptyState icon={<Inbox />} label="Nothing here" />
              ) : (
                <List>
                  {items.map((item) => (
                    <TriageRow
                      key={item._id}
                      item={item}
                      selected={item._id === selectedItem?._id}
                      busy={decidingIds.has(item._id)}
                      onSelect={() => setSelectedItem(item)}
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
                </List>
              )}
            </SplitList>
          }
          detail={
            api && selectedItem ? (
              <TriageDetail
                key={selectedItem._id}
                api={api}
                item={selectedItem}
                detailCache={detailCacheRef}
                onBack={() => setSelectedItem(null)}
                onChanged={reloadCurrentPage}
              />
            ) : (
              <EmptyState icon={<Mail />} label="No message selected" />
            )
          }
        />
      </PageBody>
    </Page>
  );
}

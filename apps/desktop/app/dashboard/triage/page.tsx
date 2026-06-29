"use client";

import { Button } from "@repo/ui/button";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
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
import { CategoryBadge } from "./_components/category-badge";
import { TriageLoadingSkeleton } from "./_components/triage-loading-skeleton";
import { TriageSheet } from "./_components/triage-sheet";

const TRIAGE_PAGE_SIZE = 10;
const PREFETCH_PAGE_COUNT = 3;

const FILTERS: { value: TriageFilter; label: string }[] = [
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
  params.set("category", filter);
  return `triage?${params.toString()}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TriageFilter>("action-needed");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: TRIAGE_PAGE_SIZE,
  });
  const [running, setRunning] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const loadedBlocksRef = useRef<Set<string>>(new Set());
  const cacheGenerationRef = useRef(0);

  const items = itemsByPage[pagination.pageIndex] ?? [];
  const currentPageLoading = loading && items.length === 0;

  const cacheItems = useCallback(
    (page: TriageListResponse, pageSize: number) => {
      setItemsByPage((prev) => ({
        ...prev,
        ...splitItemsIntoPages(page.items, page.offset, pageSize),
      }));
      setTotalRows(page.totalRows);
    },
    [],
  );

  const resetItemsCache = useCallback(() => {
    loadedBlocksRef.current = new Set();
    cacheGenerationRef.current += 1;
    setItemsByPage({});
    setTotalRows(0);
  }, []);

  const fetchItems = useCallback(
    async (options?: {
      force?: boolean;
      pageIndex?: number;
      pageSize?: number;
    }) => {
      if (!api) return;
      const pageIndex = options?.pageIndex ?? pagination.pageIndex;
      const pageSize = options?.pageSize ?? pagination.pageSize;
      const blockKey = getPrefetchBlockKey(filter, pageIndex, pageSize);
      if (!options?.force && loadedBlocksRef.current.has(blockKey)) {
        setLoading(false);
        return;
      }

      const blockStart = getPrefetchBlockStart(pageIndex);
      const generation = cacheGenerationRef.current;
      const offset = blockStart * pageSize;
      const limit = pageSize * PREFETCH_PAGE_COUNT;

      setLoading(true);
      const endpoint = getTriageEndpoint(filter, offset, limit);
      const res = await api.GET<TriageListResponse>({ endpoint });
      if (generation !== cacheGenerationRef.current) return;

      if ("code" in res) {
        toast.error("Failed to load triage");
      } else {
        loadedBlocksRef.current.add(blockKey);
        cacheItems(res, pageSize);
      }
      setLoading(false);
    },
    [api, cacheItems, filter, pagination.pageIndex, pagination.pageSize],
  );

  const refreshItems = useCallback(async () => {
    resetItemsCache();
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    await fetchItems({ force: true, pageIndex: 0 });
  }, [fetchItems, resetItemsCache]);

  const handlePaginationChange = useCallback(
    (next: PaginationState) => {
      if (next.pageSize !== pagination.pageSize) {
        resetItemsCache();
        setPagination({ pageIndex: 0, pageSize: next.pageSize });
        return;
      }

      setPagination(next);
    },
    [pagination.pageSize, resetItemsCache],
  );

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleRun = async () => {
    if (!api) return;
    setRunning(true);
    const res = await api.POST<{
      stats: {
        scanned: number;
        prefilteredSpam: number;
        fullTriaged: number;
      };
    }>({ endpoint: "triage/run", body: {} });
    setRunning(false);
    if ("code" in res) {
      toast.error("Triage run failed");
      return;
    }
    toast.success(
      `Scanned ${res.stats.scanned} · ${res.stats.fullTriaged} triaged · ${res.stats.prefilteredSpam} spam`,
    );
    await refreshItems();
  };

  const activeFilterLabel =
    FILTERS.find((entry) => entry.value === filter)?.label ?? "Items";

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

  const columns = useMemo<ColumnDef<IEmailTriage>[]>(
    () => [
      {
        id: "subject",
        header: "Subject",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-xs font-medium truncate max-w-xs">
              {row.original.email?.subject ?? "(no subject)"}
            </span>
            <span className="text-[10px] text-muted-foreground truncate max-w-xs">
              {row.original.email?.from
                .map((f) => f.name ?? f.address)
                .join(", ")}
            </span>
          </div>
        ),
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => <CategoryBadge category={row.original.category} />,
      },
      {
        id: "suggestions",
        meta: { className: "hidden md:table-cell" },
        header: "Suggestions",
        cell: ({ row }) => {
          const t = row.original.suggestedTasks.length;
          const e = row.original.suggestedEvents.length;
          if (t + e === 0)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span className="text-xs tabular-nums">
              {t > 0 && `${t}t`}
              {t > 0 && e > 0 && " · "}
              {e > 0 && `${e}e`}
            </span>
          );
        },
      },
      {
        id: "confidence",
        meta: { className: "hidden md:table-cell" },
        header: "Confidence",
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">
            {(row.original.confidence * 100).toFixed(0)}%
          </span>
        ),
      },
      {
        id: "triagedAt",
        meta: { className: "hidden lg:table-cell" },
        header: "Triaged",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatRelative(row.original.triagedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (loadingSettings) {
    return <TriageLoadingSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <DashboardPageHeader
        icon={<Brain className="size-4 text-muted-foreground" />}
        title="Triage"
      >
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

      <div className="px-4 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden pt-3 pb-8">
        <Tabs
          className="min-w-0"
          value={filter}
          onValueChange={(value) => {
            if (isTriageFilter(value) && value !== filter) {
              setSelectedId(null);
              resetItemsCache();
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              setFilter(value);
            }
          }}
        >
          <TabsList
            variant="line"
            className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
          >
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {filter !== "archived" && (
          <div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={handleArchiveAll}
              disabled={loading || archivingAll || totalRows === 0}
            >
              {archivingAll ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Archive className="size-3.5" />
              )}
              Archive all in {activeFilterLabel}
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {loading ? (
            <TriageLoadingSkeleton contentOnly />
          ) : (
            <PaginatedDataTable
              columns={columns}
              data={items}
              emptyMessage="No triage items"
              onRowClick={(item) => setSelectedId(item._id)}
              manualPagination={{
                pageIndex: pagination.pageIndex,
                pageSize: pagination.pageSize,
                totalRows,
                loading: currentPageLoading,
                onPaginationChange: handlePaginationChange,
              }}
            />
          )}
        </div>
      </div>

      {api && (
        <TriageSheet
          api={api}
          triageId={selectedId}
          open={!!selectedId}
          onOpenChange={(open) => !open && setSelectedId(null)}
          onSuggestionUpdated={() => refreshItems()}
        />
      )}
    </div>
  );
}

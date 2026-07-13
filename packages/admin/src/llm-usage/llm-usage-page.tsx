"use client";

import type {
  LlmDailyBreakdown,
  LlmModelBreakdown,
  LlmProviderBreakdown,
  LlmRecentRequest,
  LlmRecentRequestsPage,
  LlmSourceBreakdown,
  LlmUsageResponse,
} from "@repo/schemas";
import {
  llmRecentRequestsPageResponseSchema,
  llmUsageResponseSchema,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@repo/ui/chart";
import { SortHeader } from "@repo/ui/data-table";
import { PageHeader } from "@repo/ui/page-header";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Separator } from "@repo/ui/separator";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton, TabStripSkeleton } from "@repo/ui/skeleton-blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Brain } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useAdmin } from "../provider";

type TimePeriod = "allTime" | "last30d" | "last7d" | "last24h";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getProviderFromModel(model: string): string {
  return model.includes("/") ? model.split("/")[0] : "legacy";
}

function formatProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAverageTokens(
  inputTokens: number,
  outputTokens: number,
  requests: number,
) {
  if (requests === 0) return "0";
  return formatTokens((inputTokens + outputTokens) / requests);
}

function deriveProviderBreakdown(
  models: LlmModelBreakdown[],
): LlmProviderBreakdown[] {
  const byProvider = new Map<string, LlmProviderBreakdown>();

  for (const model of models) {
    const provider = getProviderFromModel(model.model);
    const current = byProvider.get(provider);

    if (current) {
      current.requests += model.requests;
      current.inputTokens += model.inputTokens;
      current.outputTokens += model.outputTokens;
      current.cost += model.cost;
    } else {
      byProvider.set(provider, {
        provider,
        requests: model.requests,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cost: model.cost,
      });
    }
  }

  return [...byProvider.values()].sort((left, right) => right.cost - left.cost);
}

const chartConfig = {
  cost: {
    label: "Cost",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const PERIOD_LABELS: Record<TimePeriod, string> = {
  allTime: "All Time",
  last30d: "30 Days",
  last7d: "7 Days",
  last24h: "24 Hours",
};

const RECENT_REQUEST_PAGE_SIZE = 10;
const PREFETCH_PAGE_COUNT = 3;

function getPrefetchBlockStart(pageIndex: number) {
  return Math.floor(pageIndex / PREFETCH_PAGE_COUNT) * PREFETCH_PAGE_COUNT;
}

function getPrefetchBlockKey(pageIndex: number, pageSize: number) {
  return `${getPrefetchBlockStart(pageIndex)}:${pageSize}`;
}

function splitItemsIntoPages<T>(
  items: T[],
  firstPageIndex: number,
  pageSize: number,
): Record<number, T[]> {
  const pages: Record<number, T[]> = {};

  for (let index = 0; index < items.length; index += pageSize) {
    pages[firstPageIndex + index / pageSize] = items.slice(
      index,
      index + pageSize,
    );
  }

  return pages;
}

function getRecentRequestsPath(options: {
  cursor?: string | null;
  limit: number;
  section?: "recent";
}) {
  const params = new URLSearchParams({ limit: String(options.limit) });

  if (options.section) params.set("section", options.section);
  if (options.cursor) params.set("lastId", options.cursor);

  return `llm/usage?${params.toString()}`;
}

const requestColumns: ColumnDef<LlmRecentRequest>[] = [
  {
    accessorKey: "llmModel",
    header: "Model",
    filterFn: "equalsString",
    cell: ({ row }) => (
      <span className="font-mono">{row.getValue("llmModel")}</span>
    ),
  },
  {
    id: "provider",
    header: "Provider",
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => (
      <Badge variant="secondary" className="text-xs">
        {formatProvider(getProviderFromModel(row.original.llmModel))}
      </Badge>
    ),
  },
  {
    accessorKey: "source",
    meta: { className: "hidden md:table-cell" },
    header: "Source",
    filterFn: "equalsString",
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.getValue("source")}
      </Badge>
    ),
  },
  {
    accessorKey: "inputTokens",
    meta: { className: "hidden md:table-cell" },
    header: () => <div className="text-right">Input</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {(row.getValue("inputTokens") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "outputTokens",
    meta: { className: "hidden md:table-cell" },
    header: () => <div className="text-right">Output</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {(row.getValue("outputTokens") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "costUsd",
    header: () => <div className="text-right">Cost</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatCost(row.getValue("costUsd"))}
      </div>
    ),
  },
  {
    accessorKey: "createdAt",
    header: () => <div className="text-right">Date</div>,
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">
        {formatDateTime(row.getValue("createdAt"))}
      </div>
    ),
  },
];

const modelColumns: ColumnDef<LlmModelBreakdown>[] = [
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => (
      <span className="font-mono">{row.getValue("model")}</span>
    ),
  },
  {
    accessorKey: "requests",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Requests" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {(row.getValue("requests") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "inputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Input" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("inputTokens"))}
      </div>
    ),
  },
  {
    accessorKey: "outputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Output" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("outputTokens"))}
      </div>
    ),
  },
  {
    accessorKey: "cost",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Cost" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatCost(row.getValue("cost"))}
      </div>
    ),
  },
];

const providerColumns: ColumnDef<LlmProviderBreakdown>[] = [
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => (
      <Badge variant="secondary" className="text-xs">
        {formatProvider(row.getValue("provider"))}
      </Badge>
    ),
  },
  {
    accessorKey: "requests",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Requests" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {(row.getValue("requests") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "inputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Input" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("inputTokens"))}
      </div>
    ),
  },
  {
    accessorKey: "outputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Output" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("outputTokens"))}
      </div>
    ),
  },
  {
    id: "avgTokens",
    meta: { className: "hidden lg:table-cell" },
    header: () => <div className="text-right">Avg / request</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatAverageTokens(
          row.original.inputTokens,
          row.original.outputTokens,
          row.original.requests,
        )}
      </div>
    ),
  },
  {
    accessorKey: "cost",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Cost" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatCost(row.getValue("cost"))}
      </div>
    ),
  },
];

const sourceColumns: ColumnDef<LlmSourceBreakdown>[] = [
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-mono text-xs">
        {row.getValue("source")}
      </Badge>
    ),
  },
  {
    accessorKey: "requests",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Requests" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {(row.getValue("requests") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "inputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Input" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("inputTokens"))}
      </div>
    ),
  },
  {
    accessorKey: "outputTokens",
    meta: { className: "hidden md:table-cell" },
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Output" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTokens(row.getValue("outputTokens"))}
      </div>
    ),
  },
  {
    accessorKey: "cost",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Cost" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatCost(row.getValue("cost"))}
      </div>
    ),
  },
];

export function LlmUsageSkeleton() {
  const { slots } = useAdmin();

  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {slots?.sidebarTrigger}
        <Brain className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">Token Usage</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <TabStripSkeleton widths={["w-14", "w-14", "w-12", "w-16"]} />
        <div className="flex gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t pt-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-[230px] w-full" />
        </div>
        <TabStripSkeleton widths={["w-28", "w-20", "w-16", "w-20"]} />
        <TableSkeleton
          rows={6}
          widths={["w-40", "w-20", "w-16", "w-16", "w-16", "w-16", "w-24"]}
        />
      </div>
    </div>
  );
}

export function LlmUsagePage() {
  const { client, slots } = useAdmin();

  const [data, setData] = useState<LlmUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>("last30d");
  const [recentRequestPages, setRecentRequestPages] = useState<
    Record<number, LlmRecentRequest[]>
  >({});
  const [recentRequestTotalRows, setRecentRequestTotalRows] = useState(0);
  const [recentRequestLoading, setRecentRequestLoading] = useState(false);
  const [recentRequestPagination, setRecentRequestPagination] =
    useState<PaginationState>({
      pageIndex: 0,
      pageSize: RECENT_REQUEST_PAGE_SIZE,
    });
  const loadedRecentBlocksRef = useRef<Set<string>>(new Set());
  const recentRequestCursorByPageRef = useRef<Map<number, string | null>>(
    new Map([[0, null]]),
  );
  const recentCacheGenerationRef = useRef(0);

  const cacheRecentRequests = useCallback(
    (page: LlmRecentRequestsPage, firstPageIndex: number, pageSize: number) => {
      setRecentRequestPages((prev) => ({
        ...prev,
        ...splitItemsIntoPages(page.items, firstPageIndex, pageSize),
      }));
      setRecentRequestTotalRows(page.totalRows);

      for (let index = 0; index < page.items.length; index += pageSize) {
        const pageItems = page.items.slice(index, index + pageSize);
        const pageIndex = firstPageIndex + index / pageSize;
        const lastItem = pageItems.at(-1);

        if (lastItem) {
          recentRequestCursorByPageRef.current.set(pageIndex + 1, lastItem._id);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    loadedRecentBlocksRef.current = new Set();
    recentRequestCursorByPageRef.current = new Map([[0, null]]);
    recentCacheGenerationRef.current += 1;
    const generation = recentCacheGenerationRef.current;
    setRecentRequestPages({});
    setRecentRequestTotalRows(0);
    setLoading(true);
    setRecentRequestPagination({
      pageIndex: 0,
      pageSize: RECENT_REQUEST_PAGE_SIZE,
    });

    client
      .get<unknown>(
        getRecentRequestsPath({
          limit: RECENT_REQUEST_PAGE_SIZE * PREFETCH_PAGE_COUNT,
        }),
      )
      .then((result) => {
        if (!active || generation !== recentCacheGenerationRef.current) return;
        const parsed = llmUsageResponseSchema.parse(result);
        loadedRecentBlocksRef.current.add(
          getPrefetchBlockKey(0, RECENT_REQUEST_PAGE_SIZE),
        );
        cacheRecentRequests(parsed.recentRequests, 0, RECENT_REQUEST_PAGE_SIZE);
        setData(parsed);
      })
      .catch(() => {
        if (active && generation === recentCacheGenerationRef.current) {
          toast.error("Failed to load usage data");
        }
      })
      .finally(() => {
        if (active && generation === recentCacheGenerationRef.current) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cacheRecentRequests, client]);

  const fetchRecentRequestBlock = useCallback(
    async (
      pageIndex = recentRequestPagination.pageIndex,
      pageSize = recentRequestPagination.pageSize,
      force = false,
    ) => {
      if (!data) return;

      const blockStart = getPrefetchBlockStart(pageIndex);
      const blockKey = getPrefetchBlockKey(pageIndex, pageSize);
      if (!force && loadedRecentBlocksRef.current.has(blockKey)) return;

      const generation = recentCacheGenerationRef.current;
      const limit = pageSize * PREFETCH_PAGE_COUNT;
      setRecentRequestLoading(true);

      try {
        let firstBlockStart = blockStart;

        while (
          firstBlockStart > 0 &&
          !recentRequestCursorByPageRef.current.has(firstBlockStart)
        ) {
          firstBlockStart -= PREFETCH_PAGE_COUNT;
        }

        for (
          let currentBlockStart = firstBlockStart;
          currentBlockStart <= blockStart;
          currentBlockStart += PREFETCH_PAGE_COUNT
        ) {
          const currentBlockKey = getPrefetchBlockKey(
            currentBlockStart,
            pageSize,
          );

          if (!force && loadedRecentBlocksRef.current.has(currentBlockKey)) {
            continue;
          }

          const cursor =
            recentRequestCursorByPageRef.current.get(currentBlockStart);

          if (cursor === undefined) {
            throw new Error("Missing cursor for request page");
          }

          const result = await client.get<unknown>(
            getRecentRequestsPath({
              section: "recent",
              cursor,
              limit,
            }),
          );
          if (generation !== recentCacheGenerationRef.current) return;
          const parsed = llmRecentRequestsPageResponseSchema.parse(result);
          loadedRecentBlocksRef.current.add(currentBlockKey);
          cacheRecentRequests(
            parsed.recentRequests,
            currentBlockStart,
            pageSize,
          );
        }
      } catch {
        if (generation === recentCacheGenerationRef.current) {
          toast.error("Failed to load request page");
        }
      } finally {
        if (generation === recentCacheGenerationRef.current) {
          setRecentRequestLoading(false);
        }
      }
    },
    [
      cacheRecentRequests,
      client,
      data,
      recentRequestPagination.pageIndex,
      recentRequestPagination.pageSize,
    ],
  );

  useEffect(() => {
    void fetchRecentRequestBlock();
  }, [fetchRecentRequestBlock]);

  const handleRecentRequestPaginationChange = useCallback(
    (next: PaginationState) => {
      if (next.pageSize !== recentRequestPagination.pageSize) {
        loadedRecentBlocksRef.current = new Set();
        recentRequestCursorByPageRef.current = new Map([[0, null]]);
        recentCacheGenerationRef.current += 1;
        setRecentRequestPages({});
        setRecentRequestTotalRows(0);
        setRecentRequestPagination({ pageIndex: 0, pageSize: next.pageSize });
        return;
      }

      setRecentRequestPagination(next);
    },
    [recentRequestPagination.pageSize],
  );

  if (loading) {
    return <LlmUsageSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <PageHeader
          leading={slots?.sidebarTrigger}
          icon={<Brain className="size-4 text-muted-foreground" />}
          title="Token Usage"
        />
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to load usage data.
        </div>
      </div>
    );
  }

  const stats = data[period];
  const providerRows =
    data.byProvider.length > 0
      ? data.byProvider
      : deriveProviderBreakdown(data.byModel);
  const currentRecentRequests =
    recentRequestPages[recentRequestPagination.pageIndex] ?? [];
  const currentRecentRequestsLoading =
    recentRequestLoading && currentRecentRequests.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Brain className="size-4 text-muted-foreground" />}
        title="Token Usage"
      />

      <div className="flex flex-1 min-h-0 flex-col gap-6 overflow-y-auto px-4 pt-3 pb-8">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
          <TabsList variant="line">
            {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {PERIOD_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Requests" value={stats.totalRequests.toLocaleString()} />
          <Stat
            label="Input Tokens"
            value={formatTokens(stats.totalInputTokens)}
          />
          <Stat
            label="Output Tokens"
            value={formatTokens(stats.totalOutputTokens)}
          />
          <Stat label="Total Cost" value={formatCost(stats.totalCost)} />
        </div>

        {data.dailyBreakdown.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-semibold">Daily Cost</h3>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                Last 30 days
              </p>
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <AreaChart data={data.dailyBreakdown} accessibilityLayer>
                  <defs>
                    <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--color-cost)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-cost)"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v) => `$${v}`}
                    width={50}
                  />
                  <ChartTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as LlmDailyBreakdown;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
                          <p className="font-medium mb-1.5">
                            {formatDate(String(label))}
                          </p>
                          <div className="flex flex-col gap-1 text-muted-foreground">
                            <span>
                              Cost:{" "}
                              <span className="text-foreground font-mono tabular-nums">
                                {formatCost(d.cost)}
                              </span>
                            </span>
                            <span>
                              Requests:{" "}
                              <span className="text-foreground font-mono tabular-nums">
                                {d.requests}
                              </span>
                            </span>
                            <span>
                              Tokens:{" "}
                              <span className="text-foreground font-mono tabular-nums">
                                {formatTokens(d.inputTokens + d.outputTokens)}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    dataKey="cost"
                    type="monotone"
                    fill="url(#costFill)"
                    stroke="var(--color-cost)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </>
        )}

        <Separator />

        <Tabs defaultValue="requests" className="flex flex-col gap-2">
          <TabsList variant="line">
            <TabsTrigger value="requests">Recent Requests</TabsTrigger>
            <TabsTrigger value="providers">By Provider</TabsTrigger>
            <TabsTrigger value="models">By Model</TabsTrigger>
            <TabsTrigger value="sources">By Source</TabsTrigger>
          </TabsList>
          <TabsContent value="requests" className="mt-0">
            <PaginatedDataTable
              columns={requestColumns}
              data={currentRecentRequests}
              emptyMessage="No recent requests"
              manualPagination={{
                pageIndex: recentRequestPagination.pageIndex,
                pageSize: recentRequestPagination.pageSize,
                totalRows: recentRequestTotalRows,
                loading: currentRecentRequestsLoading,
                onPaginationChange: handleRecentRequestPaginationChange,
              }}
            />
          </TabsContent>
          <TabsContent value="providers" className="mt-0">
            <PaginatedDataTable
              columns={providerColumns}
              data={providerRows}
              emptyMessage="No provider usage yet"
              searchPlaceholder="Search providers..."
            />
          </TabsContent>
          <TabsContent value="models" className="mt-0">
            <PaginatedDataTable
              columns={modelColumns}
              data={data.byModel}
              emptyMessage="No model usage yet"
              searchPlaceholder="Search models..."
            />
          </TabsContent>
          <TabsContent value="sources" className="mt-0">
            <PaginatedDataTable
              columns={sourceColumns}
              data={data.bySource}
              emptyMessage="No source usage yet"
              searchPlaceholder="Search sources..."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

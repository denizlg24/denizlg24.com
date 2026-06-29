"use client";

import type {
  LlmDailyBreakdown,
  LlmModelBreakdown,
  LlmRecentRequest,
  LlmSourceBreakdown,
  LlmUsageResponse,
} from "@repo/schemas";
import { llmUsageResponseSchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@repo/ui/chart";
import { SortHeader } from "@repo/ui/data-table";
import { PageHeader } from "@repo/ui/page-header";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Separator } from "@repo/ui/separator";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton, TabStripSkeleton } from "@repo/ui/skeleton-blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ColumnDef } from "@tanstack/react-table";
import { Brain } from "lucide-react";
import { useEffect, useState } from "react";
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
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Input" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {(row.getValue("inputTokens") as number).toLocaleString()}
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
        {(row.getValue("outputTokens") as number).toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "costUsd",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Cost" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatCost(row.getValue("costUsd"))}
      </div>
    ),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <div className="text-right">
        <SortHeader label="Date" column={column} />
      </div>
    ),
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
        <TabStripSkeleton widths={["w-28", "w-16", "w-20"]} />
        <TableSkeleton
          rows={6}
          widths={["w-40", "w-16", "w-16", "w-16", "w-16", "w-24"]}
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

  useEffect(() => {
    let active = true;

    client
      .get<unknown>("llm/usage")
      .then((result) => {
        if (!active) return;
        setData(llmUsageResponseSchema.parse(result));
      })
      .catch(() => {
        if (active) toast.error("Failed to load usage data");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client]);

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
            <TabsTrigger value="models">By Model</TabsTrigger>
            <TabsTrigger value="sources">By Source</TabsTrigger>
          </TabsList>
          <TabsContent value="requests" className="mt-0">
            <PaginatedDataTable
              columns={requestColumns}
              data={data.recentRequests}
              emptyMessage="No recent requests"
              searchPlaceholder="Search requests..."
              facetFilters={[
                { columnId: "llmModel", label: "models" },
                { columnId: "source", label: "sources" },
              ]}
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

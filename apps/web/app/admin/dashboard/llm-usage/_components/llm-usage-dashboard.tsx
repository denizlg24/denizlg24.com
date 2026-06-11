"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface UsageStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

interface ModelBreakdown {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface SourceBreakdown {
  source: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface DailyBreakdown {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface RecentRequest {
  _id: string;
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: string;
  createdAt: string;
}

interface UsageResponse {
  allTime: UsageStats;
  last30d: UsageStats;
  last7d: UsageStats;
  last24h: UsageStats;
  byModel: ModelBreakdown[];
  bySource: SourceBreakdown[];
  dailyBreakdown: DailyBreakdown[];
  recentRequests: RecentRequest[];
}

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

function SortHeader({ label, column }: { label: string; column: any }) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

const requestColumns: ColumnDef<RecentRequest>[] = [
  {
    accessorKey: "llmModel",
    header: "Model",
    cell: ({ row }) => (
      <span className="font-mono">{row.getValue("llmModel")}</span>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.getValue("source")}
      </Badge>
    ),
  },
  {
    accessorKey: "inputTokens",
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

const modelColumns: ColumnDef<ModelBreakdown>[] = [
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

const sourceColumns: ColumnDef<SourceBreakdown>[] = [
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

function DataTable<TData>({
  columns,
  data,
}: {
  columns: ColumnDef<TData, any>[];
  data: TData[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id} className="text-xs">
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="text-xs">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="h-20 text-center text-muted-foreground"
            >
              No data
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function UsageLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 pt-3">
      <Skeleton className="h-9 w-72 rounded-lg" />
      <div className="flex gap-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-md" />
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}

export function LlmUsageDashboard() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>("last30d");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/admin/llm/usage");
        if (response.ok) {
          const json = await response.json();
          setData(json);
        }
      } catch (error) {
        console.error("Failed to fetch LLM usage:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <UsageLoadingSkeleton />;
  }

  if (!data) {
    return (
      <div className="pt-12 text-center text-muted-foreground text-sm">
        Failed to load usage data.
      </div>
    );
  }

  const stats = data[period];

  return (
    <div className="flex flex-col gap-6 pt-3">
      <Tabs value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
        <TabsList>
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
                    const d = payload[0].payload as DailyBreakdown;
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

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Recent Requests</TabsTrigger>
          <TabsTrigger value="models">By Model</TabsTrigger>
          <TabsTrigger value="sources">By Source</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-2">
          <DataTable columns={requestColumns} data={data.recentRequests} />
        </TabsContent>
        <TabsContent value="models" className="mt-2">
          <DataTable columns={modelColumns} data={data.byModel} />
        </TabsContent>
        <TabsContent value="sources" className="mt-2">
          <DataTable columns={sourceColumns} data={data.bySource} />
        </TabsContent>
      </Tabs>
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

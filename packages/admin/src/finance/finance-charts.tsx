"use client";

import { type ChartConfig, ChartContainer, ChartTooltip } from "@repo/ui/chart";
import { cn } from "@repo/ui/utils";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  type BalancePoint,
  compactMoney,
  type DayFlow,
  money,
  shortDay,
  type WaterfallStep,
} from "./finance-series";

const balanceConfig = {
  balanceMinor: { label: "Balance", color: "var(--color-chart-1)" },
  projectedMinor: {
    label: "Projected",
    color: "var(--color-muted-foreground)",
  },
} satisfies ChartConfig;

const flowConfig = {
  incomeMinor: { label: "Income", color: "var(--color-status-good)" },
  spendPlot: { label: "Spend", color: "var(--color-status-critical)" },
} satisfies ChartConfig;

const waterfallConfig = {
  value: { label: "Amount", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function TooltipShell({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; className?: string }[];
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span
              className={cn(
                "ml-auto font-medium tabular-nums",
                row.className ?? "text-foreground",
              )}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BalanceChart({
  points,
  currency,
  className,
}: {
  points: BalancePoint[];
  currency: string;
  className?: string;
}) {
  const splitIndex = points.findIndex(
    (point) => point.balanceMinor === undefined,
  );
  const forecastStart =
    splitIndex > 0 ? points[splitIndex - 1]?.date : undefined;

  return (
    <ChartContainer
      config={balanceConfig}
      className={cn("h-52 w-full", className)}
    >
      <ComposedChart data={points} margin={{ left: 4, right: 4, top: 4 }}>
        <defs>
          <linearGradient id="financeBand" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-balanceMinor)"
              stopOpacity={0.16}
            />
            <stop
              offset="100%"
              stopColor="var(--color-balanceMinor)"
              stopOpacity={0.04}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={40}
          tickFormatter={shortDay}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={(value: number) => compactMoney(value, currency)}
        />
        {forecastStart && (
          <ReferenceLine
            x={forecastStart}
            stroke="var(--color-border)"
            strokeDasharray="3 3"
          />
        )}
        <ChartTooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as BalancePoint | undefined;
            if (!point) return null;
            const rows =
              point.balanceMinor !== undefined
                ? [
                    {
                      label: "Balance",
                      value: money(point.balanceMinor, currency),
                    },
                  ]
                : [
                    {
                      label: "Projected",
                      value: money(point.projectedMinor ?? 0, currency),
                    },
                    {
                      label: "Range",
                      value: point.bandMinor
                        ? `${compactMoney(point.bandMinor[0], currency)} – ${compactMoney(point.bandMinor[1], currency)}`
                        : "—",
                      className: "text-muted-foreground",
                    },
                  ];
            return <TooltipShell title={shortDay(String(label))} rows={rows} />;
          }}
        />
        <Area
          dataKey="bandMinor"
          type="monotone"
          fill="url(#financeBand)"
          stroke="none"
          isAnimationActive={false}
        />
        <Line
          dataKey="balanceMinor"
          type="monotone"
          stroke="var(--color-balanceMinor)"
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="projectedMinor"
          type="monotone"
          stroke="var(--color-projectedMinor)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function CashflowChart({
  days,
  currency,
  className,
}: {
  days: DayFlow[];
  currency: string;
  className?: string;
}) {
  const data = days.map((day) => ({ ...day, spendPlot: -day.spendMinor }));

  return (
    <ChartContainer
      config={flowConfig}
      className={cn("h-36 w-full", className)}
    >
      <BarChart data={data} margin={{ left: 4, right: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={shortDay}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={(value: number) => compactMoney(value, currency)}
        />
        <ReferenceLine y={0} stroke="var(--color-border)" />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const day = payload[0]?.payload as DayFlow | undefined;
            if (!day) return null;
            return (
              <TooltipShell
                title={shortDay(String(label))}
                rows={[
                  {
                    label: "Income",
                    value: money(day.incomeMinor, currency),
                    className: "text-status-good",
                  },
                  {
                    label: "Spend",
                    value: money(day.spendMinor, currency),
                    className: "text-status-critical",
                  },
                  { label: "Net", value: money(day.netMinor, currency) },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="incomeMinor"
          stackId="flow"
          fill="var(--color-incomeMinor)"
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="spendPlot"
          stackId="flow"
          fill="var(--color-spendPlot)"
          radius={[0, 0, 2, 2]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

const WATERFALL_FILL: Record<WaterfallStep["kind"], string> = {
  total: "var(--color-chart-1)",
  add: "var(--color-status-good)",
  subtract: "var(--color-status-critical)",
};

export function WaterfallChart({
  steps,
  currency,
  className,
}: {
  steps: WaterfallStep[];
  currency: string;
  className?: string;
}) {
  return (
    <ChartContainer
      config={waterfallConfig}
      className={cn("h-56 w-full", className)}
    >
      <BarChart data={steps} margin={{ left: 4, right: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={(value: number) => compactMoney(value, currency)}
        />
        <ReferenceLine y={0} stroke="var(--color-border)" />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const step = payload[0]?.payload as WaterfallStep | undefined;
            if (!step) return null;
            const rows = [
              { label: "Running", value: money(step.endMinor, currency) },
            ];
            if (step.kind !== "total") {
              rows.unshift({
                label: step.kind === "add" ? "Adds" : "Removes",
                value: money(step.value, currency),
              });
            }
            return <TooltipShell title={step.label} rows={rows} />;
          }}
        />
        <Bar
          dataKey="base"
          stackId="w"
          fill="transparent"
          isAnimationActive={false}
        />
        <Bar dataKey="value" stackId="w" radius={2} isAnimationActive={false}>
          {steps.map((step) => (
            <Cell key={step.label} fill={WATERFALL_FILL[step.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return <div className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 24 - ((value - min) / span) * 22 - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
    >
      <polyline
        points={points}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={rising ? "stroke-status-good" : "stroke-status-critical"}
      />
    </svg>
  );
}

export function Meter({
  share,
  className,
}: {
  share: number;
  className?: string;
}) {
  return (
    <div className={cn("h-px w-full bg-border", className)}>
      <div
        className="h-px bg-foreground/70"
        style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
      />
    </div>
  );
}

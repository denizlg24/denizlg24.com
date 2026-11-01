"use client";

import type { UiNode, UiTone } from "@repo/schemas";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { cn } from "@repo/ui/utils";
import {
  daysUntil,
  evalWhen,
  interpolate,
  resolveNumber,
  resolveValue,
  type SpecScope,
} from "@repo/utils/ui-spec";
import { format } from "date-fns";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
} from "recharts";
import { useAdmin } from "../../provider";
import { AppIcon } from "../page-icon";

const TONE_TEXT: Record<UiTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  accent: "text-accent-strong",
  good: "text-status-good",
  warning: "text-status-warning",
  critical: "text-status-critical",
  info: "text-status-info",
};

const TONE_BG: Record<UiTone, string> = {
  default: "bg-surface",
  muted: "bg-muted/60",
  accent: "bg-accent/25",
  good: "bg-status-good/15",
  warning: "bg-status-warning/20",
  critical: "bg-status-critical/15",
  info: "bg-status-info/15",
};

const TONE_FILL: Record<UiTone, string> = {
  default: "bg-accent-strong",
  muted: "bg-muted-foreground",
  accent: "bg-accent",
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  info: "bg-status-info",
};

const TEXT_SIZE = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
} as const;

const ICON_SIZE = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-7",
} as const;

const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

const ITEMS = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  between: "items-stretch",
} as const;

const SURFACE = {
  none: "",
  surface: "bg-surface rounded-lg p-3",
  muted: "bg-muted/50 rounded-lg p-3",
  accent: "bg-accent/20 rounded-lg p-3",
  outline: "border border-border rounded-lg p-3",
} as const;

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

function gapStyle(gap: number | undefined, fallback: number): CSSProperties {
  return { gap: `calc(var(--spacing) * ${gap ?? fallback})` };
}

function text(
  node: UiNode,
  scope: SpecScope,
  field: "text" | "caption" | "href" = "text",
) {
  const template = node[field];
  return template ? interpolate(template, scope) : "";
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function Clock({ node }: { node: UiNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      className={cn(
        "font-semibold tabular-nums tracking-tight",
        TEXT_SIZE[node.size ?? "xl"],
        TONE_TEXT[node.tone ?? "accent"],
      )}
    >
      {format(now, node.text || "HH:mm")}
    </span>
  );
}

function SpecChart({ node, scope }: { node: UiNode; scope: SpecScope }) {
  const chart = node.chart;
  const data = asRecords(node.value ? resolveValue(node.value, scope) : []);
  if (!chart || data.length === 0) {
    return <div className="text-xs text-muted-foreground">—</div>;
  }
  const config: ChartConfig = Object.fromEntries(
    chart.y.map((key, index) => [
      key,
      { label: key, color: CHART_COLORS[index % CHART_COLORS.length] },
    ]),
  );
  const height =
    node.size === "sm" ? "h-32" : node.size === "lg" ? "h-64" : "h-48";
  const numeric = data.map((row) => ({
    ...row,
    ...Object.fromEntries(chart.y.map((key) => [key, Number(row[key]) || 0])),
  }));
  return (
    <ChartContainer config={config} className={cn("w-full", height)}>
      {chart.kind === "pie" ? (
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={chart.x} />} />
          <Pie
            data={numeric.map((row, index) => ({
              ...row,
              fill: CHART_COLORS[index % CHART_COLORS.length],
            }))}
            dataKey={chart.y[0]}
            nameKey={chart.x}
            innerRadius="55%"
          />
        </PieChart>
      ) : chart.kind === "bar" ? (
        <BarChart data={numeric}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={chart.x} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {chart.y.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              fill={`var(--color-${key})`}
              radius={3}
            />
          ))}
        </BarChart>
      ) : chart.kind === "line" ? (
        <LineChart data={numeric}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={chart.x} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {chart.y.map((key) => (
            <Line
              key={key}
              dataKey={key}
              stroke={`var(--color-${key})`}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      ) : (
        <AreaChart data={numeric}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={chart.x} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {chart.y.map((key) => (
            <Area
              key={key}
              dataKey={key}
              stroke={`var(--color-${key})`}
              fill={`var(--color-${key})`}
              fillOpacity={0.15}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

function SpecLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const { platform } = useAdmin();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (/^https?:\/\//.test(href)) void platform.openExternal(href);
        else if (href.startsWith("/")) void platform.navigate(href);
      }}
    >
      {children}
    </button>
  );
}

/** Children of a container, repeated per element when it has `repeat`. */
function renderChildren(node: UiNode, scope: SpecScope, editing: EditingProps) {
  const children = node.children ?? [];
  if (!node.repeat) {
    return children.map((child) => (
      <SpecNode key={child.id} node={child} scope={scope} {...editing} />
    ));
  }
  const items = resolveValue(`{{${node.repeat}}}`, scope);
  if (!Array.isArray(items)) return null;
  return items
    .slice(0, 200)
    .flatMap((item, index) =>
      children.map((child) => (
        <SpecNode
          key={`${child.id}:${index}`}
          node={child}
          scope={{ ...scope, item, index }}
          {...editing}
        />
      )),
    );
}

type EditingProps = {
  /** The visual editor's selection; clicking a node selects it. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

function SpecNode({
  node,
  scope,
  selectedId,
  onSelect,
}: { node: UiNode; scope: SpecScope } & EditingProps) {
  if (node.when && !evalWhen(node.when, scope)) return null;
  const editing = { selectedId, onSelect };
  const tone = node.tone ?? "default";
  const size = node.size ?? "sm";
  let body: ReactNode;

  switch (node.type) {
    case "stack":
    case "card":
      body = (
        <div
          className={cn(
            "flex flex-col",
            node.align ? ITEMS[node.align] : null,
            SURFACE[
              node.surface ?? (node.type === "card" ? "surface" : "none")
            ],
          )}
          style={gapStyle(node.gap, 2)}
        >
          {renderChildren(node, scope, editing)}
        </div>
      );
      break;
    case "row":
      body = (
        <div
          className={cn(
            "flex flex-wrap items-center",
            JUSTIFY[node.align ?? "start"],
            SURFACE[node.surface ?? "none"],
          )}
          style={gapStyle(node.gap, 3)}
        >
          {renderChildren(node, scope, editing)}
        </div>
      );
      break;
    case "grid":
      body = (
        <div
          className={cn("grid", SURFACE[node.surface ?? "none"])}
          style={{
            ...gapStyle(node.gap, 3),
            gridTemplateColumns: `repeat(${node.columns ?? 2}, minmax(0, 1fr))`,
          }}
        >
          {renderChildren(node, scope, editing)}
        </div>
      );
      break;
    case "list":
      body = (
        <div
          className={cn(
            "flex flex-col divide-y divide-border",
            SURFACE[node.surface ?? "none"],
          )}
        >
          {renderChildren(node, scope, editing)}
        </div>
      );
      break;
    case "text":
      body = (
        <p
          className={cn(
            TEXT_SIZE[size],
            TONE_TEXT[tone],
            "whitespace-pre-wrap",
          )}
        >
          {text(node, scope)}
        </p>
      );
      break;
    case "heading": {
      const level = node.level ?? 2;
      const cls = cn(
        "theme-heading font-semibold tracking-tight",
        level === 1 ? "text-2xl" : level === 2 ? "text-lg" : "text-sm",
        TONE_TEXT[node.tone ?? "accent"],
      );
      const content = (
        <>
          {node.icon ? (
            <AppIcon
              value={node.icon}
              className="mr-1.5 inline-block align-[-2px]"
            />
          ) : null}
          {text(node, scope)}
          {node.caption ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {text(node, scope, "caption")}
            </span>
          ) : null}
        </>
      );
      body =
        level === 1 ? (
          <h1 className={cls}>{content}</h1>
        ) : level === 2 ? (
          <h2 className={cls}>{content}</h2>
        ) : (
          <h3 className={cls}>{content}</h3>
        );
      break;
    }
    case "stat":
      body = (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {node.icon ? (
              <AppIcon
                value={node.icon}
                className="mr-1 inline-block size-3 align-[-1px]"
              />
            ) : null}
            {text(node, scope)}
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums tracking-tight",
              TEXT_SIZE[node.size ?? "xl"],
              TONE_TEXT[node.tone ?? "accent"],
            )}
          >
            {node.value ? interpolate(node.value, scope) : "—"}
          </span>
          {node.caption ? (
            <span className="text-xs text-muted-foreground">
              {text(node, scope, "caption")}
            </span>
          ) : null}
        </div>
      );
      break;
    case "badge":
      body = (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            TONE_BG[tone],
            TONE_TEXT[tone === "default" ? "accent" : tone],
          )}
        >
          {node.icon ? <AppIcon value={node.icon} className="size-3" /> : null}
          {text(node, scope)}
        </span>
      );
      break;
    case "icon":
      body = node.icon ? (
        <AppIcon
          value={node.icon}
          className={cn(
            ICON_SIZE[node.size ?? "md"],
            node.tone ? TONE_TEXT[node.tone] : null,
          )}
        />
      ) : null;
      break;
    case "image": {
      // Literal only: a placeholder in an image URL would send bound data to its host.
      const src = node.href && !node.href.includes("{{") ? node.href : "";
      body = /^https:\/\//.test(src) ? (
        <img
          src={src}
          alt={text(node, scope)}
          className="max-h-96 w-full rounded-md object-cover"
        />
      ) : null;
      break;
    }
    case "progress": {
      const value = node.value ? resolveNumber(node.value, scope) : null;
      const max = node.max ? resolveNumber(node.max, scope) : 100;
      const ratio =
        value !== null && max ? Math.max(0, Math.min(1, value / max)) : 0;
      body = (
        <div className="flex flex-col gap-1">
          {node.text ? (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{text(node, scope)}</span>
              <span className="tabular-nums text-foreground">
                {node.caption
                  ? text(node, scope, "caption")
                  : `${Math.round(ratio * 100)}%`}
              </span>
            </div>
          ) : null}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
            <div
              className={cn(
                "h-full rounded-full",
                TONE_FILL[node.tone ?? "accent"],
              )}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
        </div>
      );
      break;
    }
    case "divider":
      body = <div className="h-px w-full bg-border" />;
      break;
    case "spacer":
      body = (
        <div style={{ height: `calc(var(--spacing) * ${node.gap ?? 4})` }} />
      );
      break;
    case "link":
      body = (
        <SpecLink
          href={text(node, scope, "href")}
          className={cn(
            "w-fit text-left underline decoration-border underline-offset-4 hover:decoration-current",
            TEXT_SIZE[size],
            TONE_TEXT[node.tone ?? "accent"],
          )}
        >
          {text(node, scope)}
        </SpecLink>
      );
      break;
    case "button":
      body = (
        <SpecLink
          href={text(node, scope, "href")}
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90",
            node.tone && node.tone !== "default"
              ? cn(TONE_FILL[node.tone], "text-background")
              : "bg-primary text-primary-foreground",
          )}
        >
          {node.icon ? (
            <AppIcon value={node.icon} className="size-3.5" />
          ) : null}
          {text(node, scope)}
        </SpecLink>
      );
      break;
    case "chart":
      body = <SpecChart node={node} scope={scope} />;
      break;
    case "countdown": {
      const target = node.value ? interpolate(node.value, scope) : "";
      const today =
        typeof scope.today === "string"
          ? scope.today
          : format(new Date(), "yyyy-MM-dd");
      const days = daysUntil(target, today);
      body = (
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "font-semibold tabular-nums tracking-tight",
              TEXT_SIZE[node.size ?? "xl"],
              TONE_TEXT[node.tone ?? "accent"],
            )}
          >
            {days === null ? "—" : Math.abs(days)}
          </span>
          <span className="text-sm text-muted-foreground">
            {days === null ? "" : days === 1 ? "day" : "days"}
            {node.text
              ? ` ${text(node, scope)}`
              : days !== null && days < 0
                ? " ago"
                : ""}
          </span>
        </div>
      );
      break;
    }
    case "clock":
      body = <Clock node={node} />;
      break;
    case "markdown":
      body = (
        <MarkdownRenderer
          content={text(node, scope)}
          allowRawHtml={false}
          className="text-sm"
        />
      );
      break;
  }

  if (!onSelect) return <>{body}</>;
  return (
    <div
      role="presentation"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      className={cn(
        "rounded-sm outline-offset-2",
        selectedId === node.id
          ? "outline outline-2 outline-ring"
          : "hover:outline hover:outline-1 hover:outline-border",
      )}
    >
      {body}
    </div>
  );
}

export function SpecRenderer({
  spec,
  scope,
  selectedId,
  onSelect,
}: { spec: UiNode; scope: SpecScope } & EditingProps) {
  return (
    <div className="min-w-0 text-sm">
      <SpecNode
        node={spec}
        scope={scope}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  );
}

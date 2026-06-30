"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@repo/ui/hover-card";
import { Skeleton } from "@repo/ui/skeleton";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface PublicDailyStatus {
  date: string;
  status: "up" | "degraded" | "down" | "unknown";
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
}

interface PublicSubResourceStatus {
  name: string;
  status: "up" | "down" | "stale";
  uptimePercent30d: number;
  dailyHistory: PublicDailyStatus[];
}

interface PublicResourceStatus {
  name: string;
  status: "up" | "degraded" | "down" | "stale";
  uptimePercent30d: number;
  dailyHistory: PublicDailyStatus[];
  subResources?: PublicSubResourceStatus[];
}

const HEADER_LABEL: Record<PublicResourceStatus["status"], string> = {
  up: "operational",
  degraded: "degraded",
  down: "down",
  stale: "stale",
};

const HEADER_COLOR: Record<PublicResourceStatus["status"], string> = {
  up: "text-accent-strong dark:text-accent",
  degraded: "text-amber-600 dark:text-amber-500",
  down: "text-destructive",
  stale: "text-muted-foreground",
};

const DAY_COLOR: Record<PublicDailyStatus["status"], string> = {
  up: "bg-accent",
  degraded: "bg-amber-500",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/25",
};

const DAY_LABEL: Record<
  PublicDailyStatus["status"],
  { label: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  up: {
    label: "No downtime",
    tone: "text-accent-strong dark:text-accent",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Partial outage",
    tone: "text-amber-500 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  down: {
    label: "Major outage",
    tone: "text-destructive",
    Icon: XCircle,
  },
  unknown: {
    label: "No data",
    tone: "text-muted-foreground",
    Icon: HelpCircle,
  },
};

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 mins";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins} mins`;
  if (mins === 0) return `${hrs} hrs`;
  return `${hrs} hrs ${mins} mins`;
}

function DayHover({ day }: { day: PublicDailyStatus }) {
  const { label, tone, Icon } = DAY_LABEL[day.status];
  const missed = Math.max(0, day.totalChecks - day.healthyChecks);
  // Cron runs every 5 minutes; missed checks ≈ minutes of outage.
  const outageMinutes = missed * 5;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">
        {format(parseISO(day.date), "d MMM yyyy")}
      </div>

      <div
        className={`flex items-center gap-2 bg-muted/20 px-3 py-2 text-accent-strong`}
      >
        <Icon className={`h-4 w-4 shrink-0  ${tone}`} />
        <span className="text-sm font-medium">{label}</span>
        {day.status !== "unknown" && day.totalChecks > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {formatDuration(outageMinutes)}
          </span>
        )}
      </div>

      {day.totalChecks > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {/* <dt className="text-muted-foreground">Healthy</dt>
          <dd className="tabular-nums text-right">
            {day.healthyChecks} / {day.totalChecks}
          </dd>

          <dt className="text-muted-foreground">Missed</dt>
          <dd className="tabular-nums text-right">{missed}</dd> */}

          <dt className="text-muted-foreground">Avg response</dt>
          <dd className="tabular-nums text-right">
            {day.avgResponseTimeMs != null
              ? `${day.avgResponseTimeMs} ms`
              : "—"}
          </dd>
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          No checks recorded on this day.
        </p>
      )}
    </div>
  );
}

function UptimeBars({
  name,
  dailyHistory,
  heightClass,
}: {
  name: string;
  dailyHistory: PublicDailyStatus[];
  heightClass: string;
}) {
  return (
    <div
      className={`flex gap-[2px] ${heightClass}`}
      role="img"
      aria-label={`${name} 30 day uptime history`}
    >
      {dailyHistory.map((d) => (
        <HoverCard key={d.date} openDelay={80} closeDelay={80}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              className={`flex-1 rounded-[1px] cursor-pointer transition-opacity hover:opacity-80 ${DAY_COLOR[d.status]}`}
              aria-label={`${d.date} — ${d.status}`}
            />
          </HoverCardTrigger>
          <HoverCardContent align="center" className="w-64">
            <DayHover day={d} />
          </HoverCardContent>
        </HoverCard>
      ))}
    </div>
  );
}

function SubStatusRow({ sub }: { sub: PublicSubResourceStatus }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">{sub.name}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">
            {sub.uptimePercent30d.toFixed(2)}%
          </span>
          <span
            className={`text-[10px] font-semibold capitalize ${HEADER_COLOR[sub.status]}`}
          >
            {HEADER_LABEL[sub.status]}
          </span>
        </span>
      </div>
      <UptimeBars
        name={sub.name}
        dailyHistory={sub.dailyHistory}
        heightClass="h-3"
      />
    </div>
  );
}

function StatusRow({ resource }: { resource: PublicResourceStatus }) {
  const subs = resource.subResources ?? [];

  return (
    <div className="py-3 border-b border-border/40 last:border-b-0">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{resource.name}</span>
        <span
          className={`text-xs font-semibold capitalize ${HEADER_COLOR[resource.status]}`}
        >
          {HEADER_LABEL[resource.status]}
        </span>
      </div>
      <UptimeBars
        name={resource.name}
        dailyHistory={resource.dailyHistory}
        heightClass="h-6"
      />
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground tabular-nums">
        <span>30 days ago</span>
        <span>{resource.uptimePercent30d.toFixed(2)}% uptime</span>
        <span>today</span>
      </div>
      {subs.length > 0 && (
        <div className="mt-2 ml-3 pl-3 border-l border-border/40">
          {subs.map((sub) => (
            <SubStatusRow key={sub.name} sub={sub} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusRowSkeleton() {
  return (
    <div className="py-3 border-b border-border/40 last:border-b-0">
      <div className="flex items-baseline justify-between mb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-6 w-full" />
      <div className="flex items-center justify-between mt-2">
        <Skeleton className="h-2 w-14" />
        <Skeleton className="h-2 w-20" />
        <Skeleton className="h-2 w-10" />
      </div>
    </div>
  );
}

export function ResourceStatus() {
  const [statuses, setStatuses] = useState<PublicResourceStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/resource-status")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStatuses(data.statuses ?? []);
      })
      .catch(() => {
        if (!cancelled) setStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (statuses !== null && statuses.length === 0) return null;

  return (
    <div className="mt-12 text-left">
      <h2 className="text-2xl font-calistoga mb-4">resource status</h2>
      <div>
        {statuses === null
          ? Array.from({ length: 3 }).map((_, i) => (
              <StatusRowSkeleton key={i} />
            ))
          : statuses.map((s) => <StatusRow key={s.name} resource={s} />)}
      </div>
    </div>
  );
}

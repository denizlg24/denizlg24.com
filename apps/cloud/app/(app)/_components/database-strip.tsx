"use client";

import { formatBytes, formatPercent } from "@repo/cloud-ui/format";
import type { DatabaseStats } from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";

function Bar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full",
          clamped >= 90
            ? "bg-status-critical"
            : clamped >= 75
              ? "bg-status-serious"
              : "bg-foreground/70",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function Engine({
  name,
  headline,
  percent,
  fields,
}: {
  name: string;
  headline: string;
  percent: number | null;
  fields: [string, string][];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {name}
        </span>
        <span className="truncate text-xs tabular-nums">{headline}</span>
      </div>
      {percent !== null && <Bar percent={percent} />}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {fields.map(([label, value]) => (
          <span
            key={label}
            className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
          >
            {label} <span className="text-foreground/80">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Unavailable({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {name}
        </span>
        <span className="text-xs text-muted-foreground">—</span>
      </div>
    </div>
  );
}

export function DatabaseStrip({ databases }: { databases: DatabaseStats }) {
  const { postgres, mongodb, redis } = databases;

  return (
    <section className="flex flex-col gap-3 border-y py-3">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {postgres ? (
          <Engine
            name="postgres"
            headline={`${postgres.connections} / ${postgres.maxConnections}`}
            percent={postgres.usagePercent}
            fields={[
              ["active", String(postgres.active)],
              ["idle", String(postgres.idle)],
              ["idle-tx", String(postgres.idleInTransaction)],
              ["waiting", String(postgres.waiting)],
            ]}
          />
        ) : (
          <Unavailable name="postgres" />
        )}

        {mongodb ? (
          <Engine
            name="mongodb"
            headline={`${mongodb.current} / ${mongodb.current + mongodb.available}`}
            percent={mongodb.usagePercent}
            fields={[
              ["active", String(mongodb.active)],
              ["available", String(mongodb.available)],
              ["queued", String(mongodb.queuedReaders + mongodb.queuedWriters)],
              ["created", mongodb.totalCreated.toLocaleString()],
            ]}
          />
        ) : (
          <Unavailable name="mongodb" />
        )}

        {redis ? (
          <Engine
            name="redis"
            headline={
              redis.usagePercent === null
                ? formatBytes(redis.usedMemoryBytes)
                : `${formatBytes(redis.usedMemoryBytes)} / ${formatBytes(redis.maxMemoryBytes)}`
            }
            percent={redis.usagePercent}
            fields={[
              ["clients", String(redis.connectedClients)],
              ["blocked", String(redis.blockedClients)],
              ...(redis.usagePercent === null
                ? ([["maxmemory", "unbounded"]] as [string, string][])
                : ([["mem", formatPercent(redis.usagePercent)]] as [
                    string,
                    string,
                  ][])),
            ]}
          />
        ) : (
          <Unavailable name="redis" />
        )}
      </div>
    </section>
  );
}

"use client";

import { trailingStopPrice } from "@repo/markets/core";
import type { Order, OrderStatus } from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { FilterTabs } from "@repo/ui/toolbar";
import { X } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";
import { money, trimQuantity } from "./format";

/** Statuses that can still do something. Everything else is history. */
const LIVE: OrderStatus[] = ["working", "pending"];

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  working: "good",
  pending: "secondary",
  filled: "info",
  cancelled: "outline",
  expired: "outline",
  rejected: "critical",
};

export interface OrderBlotterProps {
  orders: Order[];
  onCancel: (orderId: string) => Promise<void>;
  onSelectTicker?: (ticker: string) => void;
}

export function OrderBlotter({
  orders,
  onCancel,
  onSelectTicker,
}: OrderBlotterProps) {
  const [view, setView] = useState<"live" | "history">("live");

  const { live, history } = useMemo(() => {
    const sorted = [...orders].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    return {
      live: sorted.filter((order) => LIVE.includes(order.status)),
      history: sorted.filter((order) => !LIVE.includes(order.status)),
    };
  }, [orders]);

  const shown = view === "history" ? history : live;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FilterTabs
        value={view}
        onChange={setView}
        options={[
          { value: "live", label: "Open", count: live.length },
          { value: "history", label: "History", count: history.length },
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState
          compact
          label={view === "history" ? "No history" : "No open orders"}
        />
      ) : (
        <List className="max-h-[30rem] overflow-y-auto overscroll-contain">
          {shown.map((order) => (
            <ListRow
              key={order.id}
              onClick={
                onSelectTicker ? () => onSelectTicker(order.ticker) : undefined
              }
              title={
                <span className="flex items-baseline gap-1.5">
                  <span
                    className={
                      order.side === "buy"
                        ? "text-status-good"
                        : "text-status-critical"
                    }
                  >
                    {order.side}
                  </span>
                  <span className="font-medium">{order.ticker}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {trimQuantity(order.quantity)}
                  </span>
                </span>
              }
              description={
                <>
                  <TriggerCell order={order} />
                  <span className="uppercase">
                    {" · "}
                    {order.timeInForce}
                    {order.reduceOnly ? " · RO" : ""}
                  </span>
                </>
              }
              meta={
                <>
                  {order.filledPrice === null
                    ? null
                    : money(order.filledPrice * order.filledQuantity)}
                  <Badge
                    variant={STATUS_VARIANT[order.status]}
                    title={order.statusReason ?? undefined}
                  >
                    {order.status}
                  </Badge>
                </>
              }
              trailing={
                LIVE.includes(order.status) ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Cancel ${order.ticker} order`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCancel(order.id);
                    }}
                    className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                  >
                    <X />
                  </Button>
                ) : null
              }
            />
          ))}
        </List>
      )}
    </div>
  );
}

/**
 * What the order is waiting for, in the shortest form that still says it. A
 * trailing stop shows the level it has ratcheted to rather than its distance —
 * the distance is what was typed, the level is what will actually fire.
 */
function TriggerCell({ order }: { order: Order }) {
  if (order.type === "trailing_stop") {
    const resting = trailingStopPrice(order);
    const distance =
      order.trailBasis === "percent"
        ? `${((order.trailValue ?? 0) * 100).toFixed(1)}%`
        : (order.trailValue ?? 0).toFixed(2);
    return (
      <span className="tabular-nums">
        trail {distance}
        {resting === null ? "" : ` → ${resting.toFixed(2)}`}
      </span>
    );
  }
  if (order.type === "market") return <span>market</span>;

  const parts: string[] = [];
  if (order.stopPrice !== null)
    parts.push(`stop ${order.stopPrice.toFixed(2)}`);
  if (order.limitPrice !== null) {
    parts.push(`limit ${order.limitPrice.toFixed(2)}`);
  }
  return (
    <span className="tabular-nums">
      {parts.join(" · ")}
      {order.stopTriggeredAt ? (
        <Badge variant="warning" className="ml-1">
          armed
        </Badge>
      ) : null}
    </span>
  );
}

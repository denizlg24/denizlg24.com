"use client";

import { trailingStopPrice } from "@repo/markets/core";
import type { Order, OrderStatus } from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { ScrollArea } from "@repo/ui/scroll-area";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { money, trimQuantity } from "./format";

/** Statuses that can still do something. Everything else is history. */
const LIVE: OrderStatus[] = ["working", "pending"];

const STATUS_TONE: Record<OrderStatus, string> = {
  working: "text-emerald-600",
  pending: "text-muted-foreground",
  filled: "text-foreground",
  cancelled: "text-muted-foreground",
  expired: "text-muted-foreground",
  rejected: "text-red-600",
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
  const [showHistory, setShowHistory] = useState(false);

  const { live, history } = useMemo(() => {
    const sorted = [...orders].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    return {
      live: sorted.filter((order) => LIVE.includes(order.status)),
      history: sorted.filter((order) => !LIVE.includes(order.status)),
    };
  }, [orders]);

  const shown = showHistory ? history : live;

  return (
    <div className="flex h-80 min-h-0 flex-col lg:h-auto">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b px-4 text-[10px] uppercase tracking-wide">
        <button
          type="button"
          onClick={() => setShowHistory(false)}
          className={
            showHistory ? "text-muted-foreground hover:text-foreground" : ""
          }
        >
          Orders {live.length > 0 ? `(${live.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className={
            showHistory ? "" : "text-muted-foreground hover:text-foreground"
          }
        >
          History
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbars="both">
        {shown.length === 0 ? (
          <div className="px-4 py-2 text-muted-foreground text-xs">—</div>
        ) : (
          <table className="w-full text-xs [&_td]:whitespace-nowrap">
            <tbody>
              {shown.map((order) => (
                <tr
                  key={order.id}
                  className="group border-b last:border-b-0 hover:bg-muted/50"
                >
                  <td className="py-1 pl-3">
                    <span
                      className={`text-[10px] uppercase ${
                        order.side === "buy"
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {order.side}
                    </span>
                  </td>
                  <td className="max-w-24 truncate px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => onSelectTicker?.(order.ticker)}
                      className="font-medium hover:underline"
                    >
                      {order.ticker}
                    </button>
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {trimQuantity(order.quantity)}
                  </td>
                  {/* The only cell here whose width is not bounded by its own
                      format — a stop-limit prints two prices and a badge. */}
                  <td className="max-w-40 truncate px-1.5 py-1 text-muted-foreground">
                    <TriggerCell order={order} />
                  </td>
                  <td className="hidden px-1.5 py-1 text-[10px] text-muted-foreground uppercase xl:table-cell">
                    {order.timeInForce}
                    {order.reduceOnly ? " · RO" : ""}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {order.filledPrice === null
                      ? ""
                      : money(order.filledPrice * order.filledQuantity)}
                  </td>
                  <td className="px-1.5 py-1">
                    <span
                      className={`text-[10px] uppercase ${STATUS_TONE[order.status]}`}
                      title={order.statusReason ?? undefined}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="w-8 px-1.5 py-1 text-right">
                    {LIVE.includes(order.status) ? (
                      <button
                        type="button"
                        aria-label={`Cancel ${order.ticker} order`}
                        onClick={() => void onCancel(order.id)}
                        className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
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
        <Badge
          variant="outline"
          className="ml-1 px-1 py-0 text-[9px] uppercase"
          title="Stop breached; working as a limit"
        >
          armed
        </Badge>
      ) : null}
    </span>
  );
}

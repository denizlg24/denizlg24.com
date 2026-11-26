"use client";

import { Button } from "@/components/ui/button";
import { monitorFunctions } from "@/lib/terminal";
import {
  Correlation,
  CrossRates,
  commodityBoard,
  cryptoBoard,
  QuoteBoard,
  YieldCurve,
} from "../security/boards";
import { EarningsCalendar } from "../security/calendar";
import { ChartGrid } from "../security/grid";
import { PortfolioRiskView } from "../security/risk";
import { Rotation } from "../security/rotation";
import { NewsWire } from "../security/wire";
import { WidgetFrame, type WidgetProps } from "./frame";

export function FunctionWidget({ widget, ctx }: WidgetProps<"function">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const info = monitorFunctions.find((item) => item.code === widget.fn);
  const symbols = widget.symbols;
  const body = (() => {
    switch (widget.fn) {
      case "GC":
        return <YieldCurve />;
      case "RRG":
        return <Rotation select={onOpenSymbol} />;
      case "CORR":
        return <Correlation select={onOpenSymbol} initial={symbols} />;
      case "TOP":
        return (
          <NewsWire
            watchlists={workspace.watchlists}
            trades={workspace.trades}
            initial={symbols}
            select={onOpenSymbol}
          />
        );
      case "EVTS":
        return (
          <EarningsCalendar
            watchlists={workspace.watchlists}
            trades={workspace.trades}
            open={(ticker, fn) => onOpenView({ view: "security", ticker, fn })}
          />
        );
      case "PRSK":
        return (
          <PortfolioRiskView
            books={workspace.books}
            trades={workspace.trades}
            select={onOpenSymbol}
          />
        );
      case "FXC":
        return <CrossRates select={onOpenSymbol} />;
      case "CMDTY":
        return (
          <QuoteBoard
            groups={commodityBoard}
            refresh={refresh}
            select={onOpenSymbol}
            source="Front-month futures · Yahoo Finance"
          />
        );
      case "CRYP":
        return (
          <QuoteBoard
            groups={cryptoBoard}
            refresh={refresh}
            select={onOpenSymbol}
            source="Spot in USD · Yahoo Finance"
          />
        );
      case "GRID":
        return <ChartGrid initial={symbols} select={onOpenSymbol} />;
    }
  })();
  return (
    <WidgetFrame
      label={`${widget.fn} · ${info?.label ?? "Function"}`}
      className="desk-function"
      subtitle={symbols?.length ? symbols.join(" ") : info?.detail}
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            onOpenView({
              view: "monitor",
              fn: widget.fn,
              ...(symbols?.length ? { symbols } : {}),
            })
          }
        >
          Open
        </Button>
      }
    >
      <div className="desk-function-body">{body}</div>
    </WidgetFrame>
  );
}

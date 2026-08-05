"use client";

import type { MarginState } from "@repo/markets/schemas";
import { money, toneClass } from "./format";

/**
 * Exposure, requirement and headroom in one strip.
 *
 * A margin call takes its own row rather than sitting as a sixteenth muted
 * figure among fifteen. It is the only state on this page where the difference
 * between noticing and not noticing is the difference between choosing what to
 * close and having it chosen for you.
 */
export function MarginStrip({
  margin,
  baseCurrency,
}: {
  margin: MarginState;
  baseCurrency: string;
}) {
  return (
    <div className="shrink-0 border-b">
      {margin.marginCall ? (
        <div className="flex items-baseline gap-2 bg-red-600/10 px-4 py-1 text-red-600 text-xs">
          <span className="font-medium uppercase tracking-wide">
            Margin call
          </span>
          <span className="tabular-nums">
            {money(margin.marginCallAmount)} {baseCurrency} to restore
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 px-4 py-2 text-xs sm:grid-cols-4 sm:gap-x-6 xl:grid-cols-7">
        <Cell label="Equity" value={money(margin.equity)} />
        <Cell label="Long" value={money(margin.longExposure)} />
        <Cell label="Short" value={money(margin.shortExposure)} />
        <Cell label="Net" value={money(margin.netExposure)} />
        <Cell label="Buying power" value={money(margin.buyingPower)} />
        <Cell
          label="Excess liq"
          value={money(margin.excessLiquidity)}
          tone={margin.excessLiquidity}
        />
        <Cell
          label="Leverage"
          value={
            margin.leverage === null ? "—" : `${margin.leverage.toFixed(2)}×`
          }
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className={`truncate tabular-nums ${toneClass(tone)}`}>{value}</div>
    </div>
  );
}
